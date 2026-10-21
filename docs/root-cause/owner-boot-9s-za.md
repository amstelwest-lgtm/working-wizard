# ZA invite owner still dies at ~8.9s after #732

Prod deploy `5f8e3725` includes #732 (`a7920c89`). US owner AQA Throwaway CIR: 80/80, cold and reload p95 2.0–3.2s. ZA owner Zanele, invite-joined `client_owner` on firm 1020F, repeat strike 3: one hard fail (cold error at 8.86s, Retry still not open at 30s) and two recoveries (error 9.02s then board 13.88s; error 8.84s then board 15.54s). Cold p95 13.88s, reload p95 4.65s. Console on ZA, lining up with every error: `[user-roles] list failed TypeError: Failed to fetch` several times per run, and `Failed to load notes TypeError: Failed to fetch` once per run. On the US owner both lines appeared once, on a load that still opened at 5.41s. Prod `user_roles` RLS is one policy, `user_id = auth.uid()`. `Failed to fetch` is a browser network rejection, not an `AbortError` and not a PostgREST body.

The render repro is in `scripts/page-render-smoke-test.mts` (`invite owner hung user_roles`, `invite owner slow chain`). The fix is on the same branch.

## Why the screen is ~8.9s and not 4s

Both clocks are real. They are not the same read.

`BOOT_READ_TIMEOUT_MS` is 4_000 (`src/lib/boot-read.ts`). A critical `bootSelect` swallows the first abort and runs one retry. The screen is painted only when the second attempt fails, so a wrapped hang is observed at about 8s from when that read started, not at 4s. That screen is `data-owner-boot="load-error"` / "Couldn't load your workspace". The 8s shell backstop is held for that case (`shellBackstopDue` stays false while `bootCriticalRetryFailed()` is set).

`SHELL_GATE_TIMEOUT_MS` is 8_000 (`src/lib/shell-gate.ts`). The owner board arms it once auth has settled and the board is not ready (`src/routes/app.tsx`, `const backstopAt = Date.now() + SHELL_GATE_TIMEOUT_MS`). Auth on these runs is about a second, so the backstop clusters at ~8.9s. That screen is `data-owner-boot="timeout"` / "Couldn't open your workspace". The backstop is suppressed only while a critical retry is in flight or has already failed. It is not suppressed during the first attempt of a read, and it is not reset when an earlier read in the same boot used part of the 8s.

The ZA console line is the second clock, and it is not a wrapped read.

The string `[user-roles] list failed` plus `error.message` is `listAppRoles` (`src/lib/user-roles.ts`). That function calls `supabase.from("user_roles")` and does not pass an `AbortSignal`, does not call `bootSelect`, and is not a server function. There is one browser Supabase client (`src/integrations/supabase/client.ts`). The other warn, in the role effect (`src/routes/app.tsx`), runs only when `bootSelect` returns `{ ok: true }` with a settled PostgREST error. A `Failed to fetch` is retryable, so the wrapped read returns `{ ok: false }` and does not print that line. A 4s abort would surface inside `bootSelect` as `TimeoutError` "Boot read timed out", which is also not this log.

`listAppRoles` on `/app` starts when the gate has already settled, or when the board has already opened:

- The practice bounce calls `shouldBounceFromOwnerApp` → `resolvePortalRoles` → `listAppRoles`, and only after `ownerGateSettled` (`boardReady || ownerBootTimedOut || workspaceLoadFailed || criticalBootFailed`). The timeout itself sets that flag. The warn is printed because the error screen appeared.
- `AccountantProfileProvider` calls `listAppRoles` only when `readUserFirms` returns an empty list with no error, and only after `deferSideReads` is false. On `/app` that waits until the board reports ready. An invite `client_owner` with no firm row takes this branch. An owner who already has a firm row does not.

Nothing sits in front of this fetch. `fetchWithAuth` (`@supabase/supabase-js`) awaits `getSession()` and then calls `fetch`. The auth lock covers the token read, not the HTTP body. `listAppRoles` is not queued behind a cold start, and it is not retried. "Several times per run" is several callers: the bounce effect depends on the `user` object, so a new session runs it again, and every time the gate settles (each error, and again after Retry) it runs again. When a recovered board opens, the empty firm list adds one more call. The smoke repro logs the warn twice in a single cold boot.

So the 4s abort cannot end the attempt that prints this line. That attempt is not wrapped. The line lands on the ~8.9s mark because that is when the shell backstop sets `ownerGateSettled` and the bounce issues the request. On a dead ZA connection the new request rejects immediately with `Failed to fetch`, which is why the warn lines up with the error instead of trailing it by seconds.

What holds the board until that backstop is the invite chain in front of the gate, not `user_roles`.

`stampInviteMetadata` writes `user_metadata.invite_client_id` and nothing clears it on a later login (`src/lib/invite-member.server.ts`). Every `/app` boot for this account takes the invite branch in the client-link effect. A handoff `client_owner` is `clients.owner_user_id`, so `openInvitedClient` is one read, then `listWorkspaces` (owned clients and memberships together, then a `clients.in` only for extra ids). The role effect then sets the board role from the workspace and does not read `user_roles`. Client meta and financials run after that, each its own `bootSelect`. Each of those reads aborts only at 4s from its own start. The backstop is 8s for the whole boot. Two or three reads at ~3s each, all under the abort, still cross 8s while the later read is on its first attempt. `bootRetryInFlight()` is false, so the backstop paints "Couldn't open". No request was aborted. That is the ~8.9s screen.

The render repro uses that shape: invite metadata, membership role `client_owner`, no firm row, each invite read delayed 3.2s. The captured screen is `data-owner-boot="timeout"`, not `load-error`. The `user_roles` read at that moment is `listAppRoles` via `shouldBounceFromOwnerApp`, with no abort signal. The case is marked expected-fail on base `5f8e3725`: the assertion "invite reads under 4s must not reach the 8s backstop" throws, and the test fails closed if that throw disappears.

Hanging `listAppRoles` on its own does not do this. The paired case leaves every other read fast and never resolves the unwrapped `user_roles` query. The invited board still opens, and neither error screen appears. The wrapped role-effect read is not the gate once a workspace exists (`boardRoleForWorkspace`, `src/lib/owner-workspaces.ts`). Empty `user_roles` is not consulted. The fallback (owned client, then membership) runs only when `clientLinkResolved` is true and there is no active workspace.

## (a) Which `user_roles` call, and is it the gate?

The call that prints the ZA line is `listAppRoles`. It is outside `bootSelect`. It is not on the critical gate for an invite-joined owner who already has a workspace. The wrapped read in the role effect is the critical one, and only when no active workspace is known. This account has one: the invite stamp plus the ownership or `client_owner` membership. The role effect hits `setUserRole(boardRoleForWorkspace(...))` and returns. It does not poll. `listAppRoles` does not retry.

## (b) Why ~8.9s rather than 4s

The failing console read is outside `boot-read.ts`, so the 4s abort is not applied to it. It also does not decide the deadline. The deadline is the 8s shell backstop, armed after auth, firing because the invite chain is still on its first attempt of a later read. A wrapped hang would be a different screen ("Couldn't load") at two silent 4s attempts. The ZA heading path in this repro is the backstop. The absence of `AbortError` in the console is expected: `bootSelect` does not log the abort, and `listAppRoles` was not aborted.

## (c) Why Retry takes 5–7s, and once never opens

Retry on either screen clears the flags and increments `ownerBootAttempt`. It does not reload, and it does not wrap `getSession`. The client-link, role, meta, and financials effects run again. That is the same serial invite chain. A chain that then finishes in 5–7s opens the board (13.88s and 15.54s are ~5s and ~6.7s after the ~9s error). The 30s miss is that second pass still not ready when AQA stopped. The auth lock is not the wait: `fetchWithAuth` holds it only to copy the access token, then fetches. `tabAuthLock` can reject a waiter at 8s with "Acquiring process lock…", which is a different message from `Failed to fetch`.

## (d) Why this account and not the US owner

The US self-signup stores `invite_client_id: null` and owns the client directly, so boot is one `listWorkspaces` plus meta and financials. That finishes inside the backstop (p95 2–3.2s). Zanele keeps `invite_client_id`, so every cold boot adds `openInvitedClient` in front of the list. Cold ZA latency makes that series cross 8s. A warm reload (p95 4.65s) often does not, which matches reload being healthier than cold.

She has no firm membership. `readUserFirms` returns `[]`, and once the board is ready the profile calls `listAppRoles`. The US owner with a firm row skips that call. `decideOwnerAppBounce` does not send a pure `client_owner` with no firm to `/practice`. `ensure_own_client` is the empty self-signup path, after the invite branch has already returned, so it is not her boot. The one US `Failed to fetch` on a 5.41s success is the same off-gate `listAppRoles` (and the notes read below). It does not hold `ownerBoardReady`.

## (e) What #726, #729, and #732 missed

#726 handled a settled PostgREST `{ error }` and a stuck session restore. A fetch that never settles never took that path. The backstop stayed the only exit.

#729 rewrote `clients` to `(select auth.uid())`. `user_roles` is already a single `auth.uid()` check. A browser `Failed to fetch` is not a slow plan, and the policy was not the thing to shorten.

#732 aborts and retries only the reads that pass the signal into `bootSelect`, and it turns a failed retry into "Couldn't load" so the backstop does not paint "Couldn't open" for that case. `listAppRoles`, `readUserFirms`, `is_milon_it_member`, `ensure_own_client`, the invite membership upsert, and the notes server function are not in that wrapper. The new tests hung one workspace-list `bootSelect`. They never built an invite-joined `client_owner` with no firm, a persisted `invite_client_id`, and a series of reads that each stay under 4s. That series still trips the 8s backstop on the first attempt of the later read. The `user_roles` warn was treated as a consequence of the gate. That part was right for the log, and it hid the chain that arms the gate.

Notes are the same class of miss, and they are not this deadline. `src/contexts/notes.tsx` calls `bootSelect` with `critical: false` and ignores the signal. The server function is `listClientNotes`, which imports `ratio-queries`. `NoteLayer` registers the surface only after the board is ready. A run that never opens the board does not emit "Failed to load notes". The US success emitted it once. It does not feed `ownerBoardReady`.

## Logs 09:03–09:06 UTC

A later 40-load sample on the same prod deploy, cold, as this invite owner: 39 OK, 1 error, p50 1.73s, p95 6.68s. The error (#9) aborted `rest/v1/clients` at exactly 4.00s (status 0), then aborted the retry at 4.00s, and showed "Couldn't load your workspace" at 8.93s. Three slow loads aborted one `clients` or `client_memberships` read at 4.00s and recovered on the retry (5.7–8.7s). `user_roles` did not fail. Two of those reads were canceled on iframe teardown.

Supabase logs for that window: in 4 of the 5 flagged 4s aborts, the CORS preflight (OPTIONS) reached Supabase with 200 in 0–16ms, and the GET did not arrive until the retry 4s later, which then ran in about 105ms. The request stalls on the browser or network path after the preflight. It is not slow at the server. The fifth request did arrive. It took 3.1s at the gateway, with PostgREST at 2ms. That is intermittent latency between Supabase's edge and gateway, not the database. No slow SQL and no 499s.

Per CoS, Vercel runtime logs for `dpl_8Gevs4CL` from 09:03:30 to 09:06:00 UTC show zero runtime lines and no Init Duration cold starts, so nothing stalled on the function side. That is consistent with a stall on the browser or network path after the preflight.

A fixed 4s + 4s retry turns one of those stalls into a hard fail, and it adds about 4s to a slow load that would have completed. The hedged second select starts at 2.5s, while the first request is still in flight.

## Fix

A known `client_owner` or owned workspace skips `openInvitedClient`, so this account's cold boot is one workspace list, like the US owner. An invite with no membership yet still uses `openInvitedClient`. The shell backstop resets its 8s idle window on each completed boot read and keeps a 12s ceiling from auth. The ceiling is checked before an in-flight retry, so a read that starts at 9.4s cannot hold the boot until the hedge finishes. Each attempt, including that hedge, is capped at the time left, and a hedge does not start in the last 500ms. At the ceiling the screen is "Couldn't load" with Retry, and in-flight boot reads are aborted. The same arm is on the accountant client page. A critical select starts a second identical read at 2.5s if the first has not resolved, lets that retry run for 6s, and takes whichever returns first. The loser is aborted. A true hang still ends on "Couldn't load" with Retry. `listAppRoles` takes an abort signal and drops a rejection after the bounce or profile effect unmounts.

`invite owner slow chain` has to open the board. `first attempt hangs past 4s and the retry returns at 5s` has to open with no error screen. Hanging `listAppRoles` on its own still must not be the gate.
