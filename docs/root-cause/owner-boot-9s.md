# Owner boot fails at ~9.0s with "Couldn't open your workspace"

AQA still sees "Couldn't open your workspace" on 3 of 80 owner-board runs after #726 (prod `3618a507`) and #729 (the clients RLS initplan). Every failure lands at about 9.0 seconds. The console at those moments shows `TypeError: Failed to fetch`, once from "Failed to load notes" (ZA owner) and once from `[user-roles] list failed` (US owner). Successful runs can take 5–7.5s. Earlier slow calls were `deliverable_drafts` 12.5s, `client_memberships` 9.5s, and `user_roles` 3.7s. p50 is about 1.55s.

## Cause

The deadline is **8 seconds, not 9**. `SHELL_GATE_TIMEOUT_MS` is `8_000` in `src/lib/shell-gate.ts:7`. Before this change the owner board armed it at `src/routes/app.tsx:4143`:

```ts
const timer = window.setTimeout(() => setOwnerBootTimedOut(true), SHELL_GATE_TIMEOUT_MS);
```

The effect runs only when `!authLoading && user?.id && !boardReady` (`src/routes/app.tsx:4138-4145`). `authLoading` stays true until `restoreSession(() => supabase.auth.getSession(), SHELL_GATE_TIMEOUT_MS)` settles in `src/hooks/use-auth.tsx:205` and then calls `setLoading(false)`. The stopwatch therefore reads auth time plus 8s. Auth on these runs is about a second, so the hard fail clusters at ~9.0s. There is no 9000ms constant.

That timer is the only path to the copy AQA sees. `setOwnerBootTimedOut(true)` renders `data-owner-boot="timeout"` and the heading "Couldn't open your workspace" (`src/routes/app.tsx:4178-4186` before this change). A settled PostgREST error object on the workspace list is a different screen: `data-owner-boot="load-error"` and "Couldn't load your workspace" (`src/routes/app.tsx:4146-4154`). A hang never produces `{ error }`, so the load-error screen never runs.

`ownerBoardReady` (`src/lib/first-run.ts:110-116`) stays false until the role and the client link have settled, and, when a client id is set, until the client meta fetch has settled (`onboardingGateReady`) and financials have hydrated. One hung critical select keeps the board unready until the 8s backstop.

Critical fetches, before this change:

1. Workspace list, `src/routes/app.tsx:2384-2390`. `listWorkspaces` awaits `clients` (`owner_user_id`) and `client_memberships` (`user_id`) together, then an optional `clients.in(...)` at line 2408. The client-link effect sets `clientLinkResolved` in `finally` (`src/routes/app.tsx:2695`). A hang never reaches `finally`.
2. Client row, `src/routes/app.tsx:2857`. `onboardingGateReady` is set only in that effect's `finally` (`src/routes/app.tsx:2937`). A hang never sets it.
3. Financials, `src/routes/app.tsx:3099`. `hydratedClientId` is set in `then` and in `catch`. A rejection opens the board with empty figures. A hang does not.
4. Role, `src/routes/app.tsx:3007-3009`, only when no active workspace is already known. An active workspace sets the board role synchronously and does not read `user_roles`. When the read is required, `setRoleResolved(true)` is in `finally` (`src/routes/app.tsx:3049`), so a hang never resolves the role.

The console lines at the 9s mark are not the deadline.

- Notes (`src/contexts/notes.tsx:197`, "Failed to load notes") do not feed `ownerBoardReady`. `NoteLayer` mounts only after the board is ready (`src/routes/app.tsx:6517` before this change). A notes `Failed to fetch` cannot arm the timer.
- `[user-roles] list failed` (`src/lib/user-roles.ts:42`) runs from the practice bounce, and that bounce waits for `ownerGateSettled` (`src/routes/app.tsx:4111`). The timeout itself sets `ownerGateSettled` (`boardReady || ownerBootTimedOut || workspaceLoadFailed` at `src/routes/app.tsx:4104`). The role list is a consequence of the hard fail when a workspace is already known, not the read that armed the timer.
- `deliverable_drafts` (`src/components/owner-door/owner-door.tsx:687`) loads only on the owner accountant screen. It does not gate the board.

A single hung critical select is enough. The other reads can be slow or can fail and the board still has to wait out the backstop, because `boardReady` is the conjunction of the flags above.

## Files

- `src/lib/shell-gate.ts` — the 8s constant.
- `src/hooks/use-auth.tsx` — session restore finishes before the board timer starts.
- `src/routes/app.tsx` — workspace list, client meta, financials, role, the backstop, and both error screens.
- `src/lib/first-run.ts` — `ownerBoardReady`.
- `src/contexts/notes.tsx`, `src/components/note-layer.tsx` — notes failure is logged and must stay off the boot gate.
- `src/lib/user-roles.ts` — the bounce log.
- `src/components/owner-door/owner-door.tsx` — `deliverable_drafts`.
- `src/routes/_authenticated/clients.$clientId.tsx` — the accountant client load has its own 8s standby (`src/routes/_authenticated/clients.$clientId.tsx:2395`). It is a separate loader, not `listWorkspaces`. The same select bound applies there so a hung client row does not sit on a spinner for the whole backstop.
- `src/integrations/supabase/client.ts` and `src/integrations/supabase/tab-auth.ts` — auth lock. Not modified. The data fetch must stay outside it.
- `@supabase/supabase-js` `fetchWithAuth` awaits the access token (that read takes the auth lock) and only then calls `fetch`. The HTTP body does not hold the lock.

## Why #726 and #729 missed it

#726 (merge `3618a507`) parallelized the workspace reads, painted a provisional shell, and added Retry when `listWorkspaces` returns `{ ok: false }` from a settled PostgREST error object. It also aborts a stuck session restore so that restore can release the auth lock. A fetch that never settles never returns `{ error }`, so the new load-error path does not run. The 8s timer was still the only exit. OK runs of 5–7.5s are the same stall finishing just under that timer.

#729 (`0eddf595`) rewrites `auth.uid()` as `(select auth.uid())` on the live `clients` policies and adds `clients(owner_user_id)`. That can shorten a query that returns (p50 ~1.55s). It cannot abort a browser fetch that never receives a response. The AQA failures are `Failed to fetch` or a hang at the client deadline, not a slow plan that still returns a row.

## Constraints on the fix

1. Retry only idempotent reads (`GET` / `select`). One retry after a network error or a timeout, for the critical selects only (workspace, client, membership, and role when the board cannot render without it). Never retry a write or an RPC with side effects. `ensure_own_client` (`src/routes/app.tsx` around the provision RPC) and the `client_memberships` upsert on the invite path are not retried. A non-retryable error (permission, missing column) is not a network retry; the workspace list still uses "Couldn't load".
2. A hung data fetch must not hold the Supabase auth lock. The per-request `AbortController` is passed only to the PostgREST builder, which applies it to the HTTP `fetch` after `fetchWithAuth` has already released the lock. No boot timeout and no retry wraps or runs inside `getSession`, a refresh, or an `onAuthStateChange` callback. The session read must not wait behind a stalled data fetch. The 8s backstop stays. It is armed once per attempt (`const backstopAt = Date.now() + SHELL_GATE_TIMEOUT_MS`). While one critical retry is still in flight it does not fire, and a retry that has already failed does not release it onto "Couldn't open". That original timestamp is not extended.

Non-critical reads (notes, `deliverable_drafts`, and `user_roles` when an active workspace already supplied the board role) never fail the boot. The shell renders, and that section shows its own Retry.

## When the retry also fails

A critical select that fails twice (the attempt and the one retry, each an abort or a network error) must not fall through to "Couldn't open your workspace". That heading is the hard backstop (`data-owner-boot="timeout"`). The failed retry renders the in-place load state instead: `data-owner-boot="load-error"`, the heading "Couldn't load your workspace", and Retry.

Retry bumps `ownerBootAttempt` and re-runs the critical selects (workspace list, client row, financials, and the role read when the board still needs it). It does not reload the page. The same `ownerBootAttempt` dependency already restarts role resolution.

The 8s backstop must not take this case. `shellBackstopDue` stays false after the critical retry fails, and the owner arm returns without scheduling another tick while `bootCriticalRetryFailed()` is set. The original `backstopAt` timestamp is not moved. The load-error screen is what renders, including when the clock is already past that timestamp. "Couldn't open your workspace" stays only for a stall that never settled a critical select, such as a hung `ensure_own_client`, which is not retried.

The accountant client page has the same critical select. `clients.$clientId.tsx` reads the client row through `bootSelect({ critical: true })`. When that retry fails, `ClientAgentStandby` shows "Couldn't load this client" (`data-client-boot="load-error"`) and Retry. Retry bumps `clientLoadAttempt`, which re-runs that select, and does not reload. Its 8s arm uses the same `bootCriticalRetryFailed()` hold, so the backstop does not replace that screen.

## How it is verified

Scratch only. Nothing is applied to production.

- A fake fetch that hangs once, then succeeds, opens the workspace and does not show "Couldn't open".
- A non-critical read that rejects with `TypeError("Failed to fetch")` still opens the workspace and shows that section's Retry.
- A critical read whose first attempt hangs and whose retry hangs or fails renders "Couldn't load" and Retry, not "Couldn't open your workspace". Clicking Retry, with the next fetch succeeding, opens the board in the same document.
- The same hang-then-fail, then Retry, opens the accountant client page without a reload.
- After that failed retry, the original backstop timestamp is not due. The next critical read clears the hold.
- While a data read is hung, taking the auth lock the way a session read does resolves immediately (well under 200ms), and the boot-read helper does not call into the auth lock.
- `SHELL_GATE_TIMEOUT_MS` stays `8_000`.
