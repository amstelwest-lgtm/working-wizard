# Owner board hydration — what `ownerBoardReady` waits on

Investigation only. No product change in this note. The owner failure “Couldn't open your workspace” is the 8s board gate in `src/routes/app.tsx`. Do not lengthen `SHELL_GATE_TIMEOUT_MS`.

Read against `src/routes/app.tsx` on main `27924fa8` (prod project `jxclnsbsqpixxqlbcapl`). `/app` is `createFileRoute("/app")`. It is not a child of `/_authenticated`, so `AuthGate` in `src/routes/_authenticated.gate.tsx` does not mount here.

Two samples:

- AQA on 1020D’s owner, `/app?tab=health`, cache disabled, 05:25–05:34 SAST on 21 Oct 2026, prod `023c3572` through `27924fa8`. 20 of 20 loads opened the workspace. Typical load 2.4–2.6s. Outliers were a cold load about 13s, a reload about 8.9s, and a reload about 4.0s. The “Your business” skeleton stayed up for seconds on those outliers. The long bars were all PostgREST. No Stripe, billing, or edge call took over 2s.
- Read-only SQL and anon HTTP from this environment, same day, plus an authenticated `EXPLAIN (ANALYZE)` as 1020D’s owner `c01a8ea3-8a63-47c7-860b-ed5ff491d1e7` (client `24149d9c-4e27-4fc2-9b98-1a92767e3bc3`, “AQA Throwaway ClR”). 1020B (`7b111d2a-2339-4722-9596-13225801ec8f`) is the earlier payload sample: one owned client, and its only membership is that same client, so the third workspace query does not run.

The browser bars are seconds. The same statements, run as that authenticated role on a quiet database, are 0.07–39ms. The seconds are in front of the executor (browser queue or gateway time-to-first-byte). Wrapping `auth.uid()` does not account for a 12s bar. It does fix the one plan that calls `has_client_access` once per client row.

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
| `client_memberships` `client_id, role` where `user_id` | Yes. Second step. | Serial, critical | 0.48 / 8.55 ms (212 calls). Authenticated explain for 1020D’s owner: 2.1ms | 343ms anon. Browser on the 1020D outliers: 9.52s | 120ms on the serial rerun, 346ms on the first warm pass | DB and anon HTTP measured. 9.52s is the browser bar, not `EXPLAIN`. |
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

Both are estimates only in the sense that they add measured hops. A real browser runs A and B together, so the third term is one hop, which is what the sum uses. That sum is the anon probe from this environment. The 1020D browser session below is the one with multi-second PostgREST bars.

## Browser waterfall (1020D, cache disabled)

The long bars QA recorded, and where each one sits relative to `ownerBoardReady`. “Browser” is the DevTools duration from that session. “SQL” is `EXPLAIN (ANALYZE)` on prod as `SET ROLE authenticated` with `request.jwt.claims.sub` set to 1020D’s owner, unless noted.

| Call QA saw | Browser | SQL as 1020D’s owner | On the gate? | Serial or parallel |
| --- | --- | --- | --- | --- |
| `deliverable_drafts?select=…` | 12.48s | 0.74ms (`select id` where `client_id` and `status in ('draft','ready')` limit 20). 0.08ms for the wider team-feed column list. 6 rows in the table, largest body 5612 bytes. | No. Starts when `OwnerDoor` mounts, which is after the gate. | Parallel with the door’s other reads. |
| `client_memberships?select=client_id,role` | 9.52s | 2.1ms. Bitmap index scan, 1 row. `pg_stat_statements` max for this shape is 8.55ms. | Yes. Step 2 of `listWorkspaces`. | Serial, after `clients` `id, name`. This is the only one of these bars on the critical path. |
| `user_roles?select=role` | 3.65s | 1.3ms. Seq scan, 24 rows removed, one page. | No for a returning owner. Bounce, and the brand hydrate only if the firm list is empty. | Parallel with the client link. |
| `firm_memberships?select=firm_id,user_id` | 3.19s | 1.3ms for `select firm_id where user_id` (0 rows for this owner). | No. | Parallel. See the two statements below. |
| `profiles?select=full_name` | 2.31s | 0.075ms. Seq scan, 33 rows removed, one page. | No. `AccountantProfileProvider` in the root chrome. | Parallel with the client link. |
| `clients?select=id` | 1.56s | 39ms for `select id where owner_user_id` limit 1. Seq scan, `has_client_access` per row, 473 buffer hits, 19 rows removed. | The gate’s workspace list is `select=id,name`, which was not in the slow set. `select=id` is the invite claim and the no-workspace role fallback. | Off the happy path. |
| `clients?select=market` | 1.36s | 1.8ms. Primary key, then one `has_client_access`, 457 buffer hits. | No. `useAgentActivity` inside `OwnerDoor`. | Parallel, after the gate. |

### Why `deliverable_drafts` shows sentry-lite, and why the gate does not wait

`src/lib/monitoring.ts` loads `src/lib/sentry-lite.ts` and calls `Sentry.init`. That module is a named re-export of `@sentry/react`. The init options add `captureConsoleIntegration` only. The SDK still installs its default integrations, and the breadcrumbs integration patches `window.fetch`. The patch lives in the sentry-lite chunk, so Chrome’s initiator column names that script. Sentry does not select from `deliverable_drafts`.

The health tab’s fetch is `OwnerDoor` (`src/components/owner-door/owner-door.tsx`). On mount, with a `clientId`, it runs `Promise.all` of `qbo_connections`, `xero_connections`, `action_items_v`, and:

```
deliverable_drafts
  select id
  eq client_id
  in status (draft, ready)
  limit 20
```

That count feeds the door. It is not a flag of `ownerBoardReady`.

A second select, `id, kind, body, status, created_at, updated_at`, lives in `useMilonTeamFeed` and runs only when `MilonTeamPane` mounts. The health door does not render that pane, so the 12.48s bar on `tab=health` is the `select id` above.

`app.tsx` returns `OwnerShell` plus a panel skeleton while the board is not ready. The name falls back to “Your business” until a workspace row is in hand. `OwnerDoor` is rendered only after that early return. The drafts request cannot start until the skeleton has been replaced, so it cannot be what holds the skeleton. It can still make the cold load read ~13s, because it starts the moment the skeleton leaves and was the longest bar in the session.

### `firm_memberships?select=firm_id,user_id`

The boot call the browser makes is `listUserFirms` in `src/lib/firm-brand.ts`: `select=firm_id` filtered by `user_id`, in parallel with `firms` by `owner_user_id`. That is the brand hydrate and the bounce, both off the gate.

The statement whose select list is exactly `firm_id, user_id` is `src/lib/owner-billing.server.ts`, inside `loadOwnerEntitlement`. `OwnerDoor` calls the `getOwnerEntitlement` server function from a mount effect. That is after the gate. The server call is not a browser PostgREST bar unless the waterfall is the server’s own log. Either reading of the 3.19s bar is off `ownerBoardReady`. The RLS is the same.

### RLS on the five tables

Source is the migrations. Live `EXPLAIN` confirms the policies are still the ones below: `auth.uid()` is inlined as `current_setting('request.jwt.claims')`, and it is not wrapped in `(select auth.uid())`.

| Table | Select policy | Per-row helper | Index the boot filter can use |
| --- | --- | --- | --- |
| `client_memberships` | `user_id = auth.uid() OR has_client_access(auth.uid(), client_id)` (`20260512074910`) | `has_client_access` is `SECURITY DEFINER`, `STABLE`. It calls `is_milon_it_member` (reads `milon_it_members` and `auth.users`), then `clients` by id, then `client_memberships` again, then `has_active_practice_assignment`. That helper reads `client_practice_access` and, on the principal fallback, `is_practice_principal`, which reads `firms` and `firm_memberships`. | Unique `(client_id, user_id)`. The 1020D plan bitmap-scans it for `user_id = <literal>` and runs the helper only on that one row. A `user_id`-only index is not what the 9.52s bar is. |
| `user_roles` | `user_id = auth.uid()` | None. The plan turns this into a one-time filter, then a seq scan. | Unique `(user_id, role)` exists. The planner seq-scans because the table is one page (25 rows). |
| `firm_memberships` | `user_id = auth.uid() OR is_firm_member(auth.uid(), firm_id)` | `is_firm_member` is `SECURITY DEFINER` and reads `firm_memberships` and `firms` per row that reaches the filter. | Unique `(firm_id, user_id)`. The plan bitmap-scans it for `user_id` and finds 0 rows, so the helper does not run a loop. |
| `deliverable_drafts` | `has_client_access(auth.uid(), client_id)` only (`20260907140000`) | Same helper, on every row the index returns. No cheap `user_id = auth.uid()` arm. | `(client_id, created_at desc)`. The plan uses it. No `status` index. Six rows, so that missing index is not a 12s plan. |
| `profiles` | `id = auth.uid()` | None. One-time filter, then a seq scan. | Primary key on `id`. One page (34 rows), so the seq scan is the plan. |

`clients` is the scan that matches the “helper per row” shape. Policy is only `has_client_access(auth.uid(), id)`. There is no index on `owner_user_id`. `select id where owner_user_id = <1020D owner> limit 1` seq-scans, calls the helper for each row, and took 39ms with 473 shared buffer hits. `auth.uid()` sits inside the function argument in the Filter, so it is not an InitPlan. Wrapping it as `(select auth.uid())` lets the planner evaluate the uid once. An `owner_user_id` index lets that filter seek instead of calling the helper for every client. At today’s size that measured plan is 39ms, not 1.56s.

`pg_stat_statements` still has no multi-second execution of the memberships or financials selects (memberships max 8.55ms, financials max 221ms). A quiet `EXPLAIN` does not include pooler queue or browser stall. Those are the gap between 2ms and 9.52s.

## What can exceed ~3s

1. **The PostgREST bars in the 1020D session.** `client_memberships` at 9.52s is serial on the gate and is long enough to hold “Your business” for seconds. This 20-load session still opened the workspace every time, so that bar did not sit entirely inside the 8s timer (part of it is queueing before the timer, or the board became ready on a faster duplicate of the same statement). `deliverable_drafts` at 12.48s is the cold-load outlier and is after the gate. `user_roles` 3.65s, `firm_memberships` 3.19s, and `profiles` 2.31s are parallel and off the gate. None of those durations are the SQL times above.

2. **Token refresh while it holds `tabAuthLock`.** A reload inside the last 90s of the access token refreshes before any PostgREST call can read the session. One rejected grant returned in 240ms. auth-js retries retryable fetch errors with sleeps 200, 400, 800, 1600, 3200… ms while the elapsed time stays inside the 30s refresh tick. That schedule can pass 3s and the 8s gate. `restoreSession` stops waiting at 8s and does not abort the refresh, so the lock outlives the timer. Not reproduced in the 1020D session. Estimated from auth-js.

3. **The empty-list ladder.** Five serial passes of steps 1 and 2, plus 250ms, is about 3.5s on the warm anon numbers and about 5.9s on the cold ones. A swallowed PostgREST error looks like an empty list. A successful read of 1020B or 1020D does not enter it.

4. **Stripe metadata search, 4s budget.** On the accountant `AuthGate` only. The 1020D capture had no Stripe, billing, or edge call over 2s. The 4s budget is not this gate.

The serial waterfall on every successful owner boot is still steps 1 then 2, then the financials/meta pair. Anon HTTP puts that near 1.3s cold. The 1020D outliers show step 2 can be ~9.5s in the browser while the database runs it in 2ms.

## Fixes, ranked by the time the 1020D bars actually spent

No timer change. No edit to `stripe-entitlement.ts`, `firm-client-cap.server.ts`, or `_authenticated.gate.tsx`.

1. **Take `deliverable_drafts` off the door’s first paint.** The 12.48s bar is the longest in the session and the gate does not wait on it. Fetch the count when the owner opens the deliverables or accountant screen. Measured browser saving on a cold load: that 12.48s tail. SQL saving is ~1ms. This is “take drafts off boot”.

2. **Let the shell paint from the stored client id while `client_memberships` is in flight.** That 9.52s bar is the only slow request on the critical path, and it is serial. The skeleton already has a stored workspace id (`readStoredOwnerClientId`). Painting “Your business” until the memberships response returns is what held the skeleton for seconds. Progressive render takes that bar off the skeleton even though the SQL is 2.1ms. The financials and meta reads (the third hop, ~360ms cold anon HTTP) can fill the pane the same way.

3. **Run the two `listWorkspaces` reads in `Promise.all`.** They do not depend on each other. Saves one serial hop on every boot: about 340ms cold anon HTTP, about 120ms warm. It does not shrink a 9.52s time-to-first-byte by itself. Keep `clients.in` behind the membership result.

4. **Defer `user_roles`, `firm_memberships`, and `profiles` until after the gate.** Browser 3.65s, 3.19s, and 2.31s, all parallel, none of them flags. They share the host with the serial memberships call. SQL is 1.3ms, 1.3ms, and 0.075ms, so the saving is fewer in-flight PostgREST calls during the gate, which is the plausible source of a multi-second stall in front of a 2ms query. Estimated.

5. **Wrap `auth.uid()` as `(select auth.uid())` and add `clients(owner_user_id)`.** This is the plan that calls a `SECURITY DEFINER` helper per row. Measured at 39ms and 473 buffer hits for 1020D’s owner, against a 31-row `clients` table. Do it so the helper does not grow with the table. It does not explain the 9–12s bars. Memberships and firm memberships already bitmap-scan their composite unique indexes; a separate `user_id` index does not change those plans. `user_roles` and `profiles` are one-page seq scans with a one-time `auth.uid()` filter.

6. **Release the auth lock when session restore hits 8s, and retry the workspace list only on a successful empty read during an invite.** These are the code paths whose budget can still pass 8s when the PostgREST bars are the usual few hundred milliseconds. The 1020D session did not hit them (20 of 20 opened). A PostgREST `error` must not look like “no workspace”.

Leave Stripe’s 4s search on the accountant gate.
