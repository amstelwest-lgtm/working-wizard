# Owner board hydration — what `ownerBoardReady` waits on

Investigation only. No product change in this note. The owner failure “Couldn't open your workspace” is the 8s board gate in `src/routes/app.tsx`. Do not lengthen `SHELL_GATE_TIMEOUT_MS`. The steady-state PostgREST calls are a few hundred milliseconds. The ways a reload still misses the gate are the auth-lock refresh and the empty-workspace retry ladder, not a slow `SELECT` and not Stripe.

Read against `src/routes/app.tsx` on main `27924fa8` (prod project `jxclnsbsqpixxqlbcapl`). `/app` is `createFileRoute("/app")`. It is not a child of `/_authenticated`, so `AuthGate` in `src/routes/_authenticated.gate.tsx` does not mount here. Timings below are from 21 Oct 2026.

The sample reload is AQA Gate Throwaway 1020B (`7b111d2a-2339-4722-9596-13225801ec8f`, owner `efc7d90e-6b8e-4f3b-9ea4-8db9670f8744`). That owner has one owned client and one membership, and the membership is that same client, so the third workspace query does not run.

## What the gate actually waits for

`ownerBoardReady` (`src/lib/first-run.ts`) stays false until both `roleResolved` and `clientLinkResolved` are true. With no `effectiveClientId` it then returns true. Otherwise it waits for `onboardingGateReady`. If the profile funnel is open or `firstRunStep` is set, it returns true without financials. A returning owner who already has books (funnel closed, `firstRunStep` null) also waits for `financialsHydrated` (`hydratedClientId === effectiveClientId`).

The timer that paints “Couldn't open your workspace” starts only once `authLoading` is false, a user is present, and the board is not ready. It fires at `SHELL_GATE_TIMEOUT_MS` (8000). While `authLoading` is still true the page is the boot spinner, not this error. `useLayoutEffect` in `src/hooks/use-auth.tsx` copies a stored session into React before `getSession` returns, and the client-link effect depends on `user.id`, not on `authLoading`. Those reads still take the same auth lock as `getSession` (below), so they do not finish while a refresh holds that lock.

`restoreSession` gives up on `getSession` at 8s and, if a stored user exists, sets `authLoading` false anyway. `settleWithin` does not cancel the `getSession` that is still inside the lock.

## Call map on `/app?tab=health`

Returning owner, workspace already exists, no invite, token still outside the refresh margin. This is the path QA hits on a reload of 1020B.

```
auth getSession (local if the access token has more than 90s left)
  └─ holds tabAuthLock for the whole read, and for a refresh if it needs one
client-link effect, serial, then sets clientLinkResolved
  1. clients  select id, name   eq owner_user_id
  2. client_memberships  select client_id, role   eq user_id
  3. clients  select id, name   in extra membership ids
       (skipped when every membership is already in the owned set — 1020B)
role effect, after clientLinkResolved
  active workspace → boardRoleForWorkspace, local, no network, setRoleResolved
then the slower of these two, both required for a scored board
  A. clients  select financials   eq id          (starts as soon as effectiveClientId is set)
  B. clients  select meta + cashflow   eq id     (starts one commit later, after roleResolved)
       sets onboardingGateReady
```

Critical path after a fresh token: step 1, then step 2, then `max(A, B)`. Role adds no network. Step 3 is not on the 1020B path.

Same effect, other branches, still inside `clientLinkResolved`:

- Invite id set: up to 5 times, serial `openInvitedClient` (clients by id+owner, then memberships by client+user) and then `listWorkspaces`, with 250ms between empty tries.
- List empty: the same `listWorkspaces` runs up to 5 times with 250ms between tries. A PostgREST error is ignored (`const { data }`), so a failed read looks empty and takes the ladder.
- Still empty, and the metadata says this is a customer signup: `user_roles` select, then `listUserFirms`, then RPC `ensure_own_client`. That is first-run provisioning, not a reload of 1020B.
- No workspace and no provision: role effect falls through to `resolvePortalRoles` (`user_roles`), then `clients` by owner, then `client_memberships`. `ownerBoardReady` does not wait for financials when `effectiveClientId` stays null.

Concurrent once `user` is set, and **not** flags of `ownerBoardReady`. They share the auth lock and the same host, so a refresh they queue behind is felt by the critical path. They do not themselves flip the gate.

- Bounce effect: dynamic `import("@/lib/user-roles")` (bundle, not the network), then `shouldOpenItInbox` → RPC `is_milon_it_member`, then `shouldBounceFromOwnerApp` → `Promise.all(user_roles, auth.getSession)` and then `listUserFirms` (`firms` by `owner_user_id` and `firm_memberships` by `user_id` in parallel; a third `firms.in` only when the membership points at a firm the user does not own). `readPracticeSignup` is `getSession` plus local metadata. Firm list is cached 60s after the first success.
- After `effectiveClientId`: `client_financial_snapshots` (limit 24, includes `financials`), `client_score_history` (limit 24), and server function `listClientReviewSignoffs` (`GET`, `requireSupabaseAuth`, then `auth.getUser()`, `assertClientAccess`, `client_review_signoffs` select `*`).
- `useAskAiMount` only imports `ask-ai.js` once a mount node exists. The boot skeleton does not render that node.
- Autosave (`clients` select + update) runs only after `hydratedClientId` matches. It is after the gate.
- `TrialEndedPlanBlock` renders only after `boardReady`. It is not on this path.

## Eng2 billing calls, observed and not on `/app`

Not edited. Not imported by `src/routes/app.tsx`.

`AuthGate` (`src/routes/_authenticated.gate.tsx`) calls server function `getFirmBillingEntitlement` and `loadFirmClientGateContext` (`clients` select `id` where `firm_id` is not null, limit 2). Entitlement resolution goes through `findFirmCustomerId` in `src/lib/stripe-entitlement.ts`. A stored customer id is read first, under `STORED_CUSTOMER_READ_BUDGET_MS` (1000). Metadata search runs only when that id is missing or not trusted, under one shared `FIRM_CUSTOMER_SEARCH_BUDGET_MS` (4000, from #707), with Stripe retries off. That 4s budget can exceed ~3s **on the accountant gate**. It is not a caller of `ownerBoardReady`. The accountant gate uses the same 8s constant for its own `noteFailure("timeout")`. It does not render “Couldn't open your workspace”.

## Cold timing

Two measured layers. They are not the same number.

**Database execution** is `EXPLAIN (ANALYZE)` and `pg_stat_statements` on prod, read-only. The planner time is server time. It does not include the browser, PostgREST, or TLS. `pg_stat_statements` max is the worst call still in the stats window, not a cold-start figure.

**HTTP** is an anon call from this environment to `https://jxclnsbsqpixxqlbcapl.supabase.co` with the publishable key and no user JWT. RLS returns `[]` (2 bytes) with status 200, so the round trip includes TLS, PostgREST, and the policy. It does not include a user-sized payload or a GoTrue refresh of a real session. “Cold” here means a new TLS connection per call. “Warm” means the next call on a kept-alive connection. TCP to the host was about 14ms, so this VM is close to the project. A distant browser adds its own RTT on top of these figures. No owner session was available, so there is no authenticated Playwright trace. The anon calls are the transport measurement.

Payloads on the client row are small. Largest `financials` in prod is 1945 bytes (Chill Pepper). Largest `cashflow` is 3178 bytes. 1020B is 663 and 98 bytes. Transfer of the JSON is not the gate.

| Call | On `ownerBoardReady` | Serial / parallel | DB mean / max | HTTP cold | HTTP warm | Which number |
| --- | --- | --- | --- | --- | --- | --- |
| `auth.getSession`, token more than 90s from expiry | Before the 8s board timer. Holds `tabAuthLock`, so the rows below wait. | Serial with everything else that needs the lock | none | no network | no network | Estimated. `EXPIRY_MARGIN_MS` is 90s (`3 × 30s` in auth-js). A fresh token is a storage read. |
| `POST /auth/v1/token?grant_type=refresh_token` | Same, when the access token is inside that 90s margin. `getSession` → `_acquireLock` → `__loadSession` → `_callRefreshToken`, and the lock is held for the retries. | Serial. Blocks every PostgREST `getSession`. | none | 240ms for a **rejected** dummy grant (HTTP 400) | not remeasured | 240ms measured. A successful refresh was not timed. Retryable fetch errors sleep 200, 400, 800, 1600, 3200… ms while the elapsed time stays inside the 30s refresh tick. That schedule can pass 3s and the 8s gate. Estimated from auth-js `retryable`, not from a captured hang. `restoreSession` stops waiting at 8s and does not abort this call. |
| `clients` `id, name` where `owner_user_id` | Yes. First step of `listWorkspaces`. | Serial, critical | 9.93 / 66.71 ms (215 calls) | 580ms | 318–321ms | Both measured. `EXPLAIN ANALYZE` of the same filter plus `has_client_access` on 1020B’s owner: seq scan, 31 rows, execution 2.3ms. There is no `owner_user_id` index. At this size the scan is not the gate. |
| `client_memberships` `client_id, role` where `user_id` | Yes. Second step. | Serial, critical | 0.48 / 8.55 ms (212 calls) | 343ms | 120ms on the serial rerun, 346ms on the first warm pass | Both measured. No `user_id`-only index. Table heap is 8kB. |
| `clients` `id, name` where `id in extraIds` | Yes only when a membership is not already owned. Not taken for 1020B. | Serial, critical on that branch | not isolated | not separately timed | — | Estimated equal to the owner `clients` read, ~350–580ms HTTP. |
| `boardRoleForWorkspace` | Yes for a returning owner with a workspace. | After the link. No network. | — | 0 | 0 | Measured by inspection. The `user_roles` read in the role effect runs only when there is no active workspace. |
| `clients` `financials` where `id` | Yes for a returning owner with books. | Parallel with the meta read. Critical. | 0.90 / 220.64 ms (2340 calls) | 359ms | 98ms on the serial rerun, 340ms first warm | Both measured. 221ms is the slowest **database** tail on the critical path. Still far under 3s. |
| `clients` meta (`business_type`, `cash_runway_weeks`, `cashflow`, timestamps, `operating_profile`, `financial_year_start_month`, `market`, `firm_id`, `is_demo`) | Yes. Sets `onboardingGateReady`. A second select without `market` runs only if the first error is missing-market support. | Parallel with financials, one React commit later. Critical. | 1.23 / 38.20 ms (241 calls) | 365ms | 121ms | Both measured. |
| Empty `listWorkspaces` ladder | Yes, when the first list is empty or the read errors and `data` is null. Not the 1020B success path. | Serial, up to 5 × (steps 1–2 + 250ms) | queries as above | — | — | Estimated. Five warm attempts at the measured serial pair (about 440ms) plus 250ms is about 3.5s. Five cold attempts (about 580+343+250) is about 5.9s. An invite loop adds two more serial reads per try and can clear 8s. |
| `user_roles` `role` where `user_id` | No on the returning-owner path. Yes on the bounce, and on the no-workspace role fallback. | Parallel with the link (bounce). | 0.27 / 74.67 ms (13455 calls) | 341ms | 337ms | Both measured. |
| RPC `is_milon_it_member` | No. Bounce only. | Parallel. Cached for the session after a success. | 2.20 / 179.71 ms (9542 calls) | 356ms | 317ms | Both measured. The function also reads `auth.users` and `milon_it_members`. |
| `firms` by `owner_user_id` and `firm_memberships` by `user_id` | No, unless the client-link effect is on the self-signup branch with no workspace (`listUserFirms` before `ensure_own_client`). | Parallel with each other, after the bounce’s role read. | `firms` by owner, id only: 0.13 / 18.68 ms (2565 calls). Memberships query not isolated. | 345ms and 328ms | 356ms and 127ms | HTTP measured. DB for the wide firm select is sub-millisecond mean in the stats that matched. |
| `client_financial_snapshots` limit 24 | No. | Parallel after `effectiveClientId`. | A snapshots select in stats: mean 1.25–2.12 ms, max 516 ms (the max row is a wider column list than the owner effect). | 339ms | 122ms | HTTP measured for the owner column list. DB max is the stats tail, not this exact select. |
| `client_score_history` limit 24 | No. | Parallel. | 1.69 / 299.71 ms (2247 calls) | 354ms | 318ms | Both measured. |
| `listClientReviewSignoffs` | No. The effect catches errors. | Parallel server function. Browser `getSession`, then the server’s `auth.getUser()`, then `client_review_signoffs` select `*`. | sign-offs select: 1.67 / 830.46 ms (4614 calls) | server `getUser` not timed | — | DB measured. 830ms is the worst stats tail of any call in this map, and it is off the gate. The GoTrue `getUser` hop was not timed. |
| `ensure_own_client` | Only the self-signup provision branch. | Serial at the end of client-link. | not isolated in this pass | not timed | — | Not on a reload of an existing workspace. |
| Stripe `customers.search` (metadata) | **No.** Accountant `AuthGate` only. | — | — | not called | — | The 4000ms budget is the source constant. This note did not send a Stripe request. |
| `loadFirmClientGateContext` | **No.** Same gate. | — | firm-id list: mean 23.68 / max 732.37 ms (731 calls) | not timed from `/app` | — | DB measured. Off this page. |

Nothing in the critical-path `SELECT`s has a measured database time over 221ms, or a measured anon HTTP time over 580ms.

Happy-path sum from the measured HTTP, fresh token, 1020B shape (no third query, no ladder):

- Cold, new connection per hop: 580 + 343 + max(359, 365) = **1288ms**.
- Warm, one connection: 321 + 120 + max(98, 121) = **562ms**.

Both are estimates only in the sense that they add measured hops. A real browser runs A and B together, so the third term is one hop, which is what the sum uses. Neither sum is over ~3s. Multiplying by a slow link (three times this VM) still leaves the happy path under the 8s gate.

## What can exceed ~3s

1. **Token refresh while it holds `tabAuthLock`.** A reload inside the last 90s of the access token refreshes before any of the PostgREST calls can read the session. One rejected grant returned in 240ms. auth-js retries retryable fetch errors with exponential sleeps that cross 3s (200+400+800+1600 = 3.0s of sleep before the fifth attempt) and keeps going until the 30s tick. The board timer does not include a refresh that finishes before `authLoading` flips. It does include every query that is still waiting on a refresh `restoreSession` already gave up on. That abandoned `getSession` keeps the lock, waiters give up at another 8s (`tabAuthLock` caps the wait at `SHELL_GATE_TIMEOUT_MS`), and the gate fires. This is the mechanism that matches a flake on some reloads and not others. It was not reproduced against a live session.

2. **The empty-list ladder.** Five serial passes of steps 1 and 2, plus 250ms, is about 3.5s on the warm numbers and about 5.9s on the cold numbers. The invite variant, with two extra serial reads per pass, can pass 8s. A swallowed error takes this ladder even when the workspace exists. 1020B’s row is present (the owner query returns 1 row in 2.3ms under `has_client_access`), so a successful read does not enter the ladder.

3. **Stripe metadata search, 4s budget.** Real, and not on `/app`. Chasing it will not move this gate. The stored-customer read next to it is capped at 1s and is also only on the accountant gate.

The serial waterfall that is on every successful owner boot is steps 1 then 2, then the financials/meta pair. It is real, and on the measured numbers it costs one extra round trip (about 120ms warm, about 340ms cold), not the 8s.

## Fixes, ranked by time they take off the gate

No timer change. No edit to `stripe-entitlement.ts`, `firm-client-cap.server.ts`, or `_authenticated.gate.tsx`.

1. **Stop a refresh from outliving the lock the board needs.** When `restoreSession` hits 8s, the in-flight `getSession` / `_refreshAccessToken` must release `tabAuthLock` (abort the retry loop, or read the stored access token for PostgREST without waiting on that refresh). This is the only path whose code budget is over both ~3s and the 8s gate. Saving it removes the stall that turns a ~1.3s waterfall into “Couldn't open your workspace”. Estimated, because the hang was not captured.

2. **Run the two `listWorkspaces` reads in `Promise.all`.** They do not depend on each other. Saves one round trip on every boot: about 340ms cold, about 120ms warm, both measured. Keep the extra `clients.in` behind the membership result.

3. **Drop the financials blob and the wide meta row off `ownerBoardReady`.** The owner door already paints `OwnerShell` plus a panel skeleton while the board is not ready. Mark the gate ready once the client link and the local role are done, and let financials and meta fill that pane. Saves the third hop, about 360ms cold / about 120ms warm, measured. The funnel decision can follow into the pane. A scored owner no longer holds the 8s gate on `cashflow` plus `financials`.

4. **Retry only a successful empty list, and only while an invite is in hand.** A PostgREST `error` must not look like “no workspace”. That stops four extra serial passes (about 3s warm, about 4.7s cold, estimated from the measured pair plus the 250ms sleep) and keeps a single slow failure from stacking into the gate.

5. **Start the bounce, snapshots, score history, and sign-offs after the gate, not beside it.** They are already off the flag. Deferring them keeps their `getSession` calls from queueing behind the same refresh. Steady-state saving is small once the lock is free (the warm hops are ~300ms and overlap). Worth doing with 1, not instead of it.

An index on `clients.owner_user_id` or `client_memberships.user_id` would shave the 2ms seq scan. It does not move the gate. Leave Stripe’s 4s search on the accountant gate, where it already is.
