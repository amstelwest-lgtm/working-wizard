# J3 addendum 2 — US card text slower after #945

AQA 2026-11-13, Ben, US client HVAZV4 (`353f1dbf-a7ba-4092-878d-792223ba3536`). Prod `cc6018ea` (#945). Reload-to-card-text on the box clock was 16.55s and 11.57s. The same clock on `d180ae4b` this morning was about 4s. Both later runs showed real card text, not an empty state. The box clock includes the tool round-trip, so both numbers are high. The gap between them is still the thing to explain. No fix in this note.

## (a) Boot order, `d180ae4b` versus `cc6018ea`

`git diff d180ae4b cc6018ea` does not change `src/lib/boot-read.ts`, `src/lib/client-home-phase.ts`, `src/lib/first-run.ts`, or `src/hooks/use-auth.tsx`. The client file's load effect is the same shape.

Order on both commits, accountant client file (`src/routes/_authenticated/clients.$clientId.tsx`):

1. `clientAccessGate` stays on the standby while auth is loading or the session user is missing (`client-home-phase.ts`).
2. The client-row `bootSelect` starts only after that (`clients.$clientId.tsx` around line 2309). It is still one critical select: 4s abort after the request is sent, one hedge, shell ceiling 12s (`SHELL_BOOT_CEILING_MS` in `src/lib/shell-gate.ts`). `bindShellBackstop` is unchanged.
3. Settled home lines, including the Financial Manager sentence, render only after that select returns and `homePhase` leaves `"loading"`.

#945 added two things beside that sequence. Neither is a new wait in front of the select.

- `coordinatedAuthFetch` (`src/integrations/supabase/tab-auth.ts` lines 179–197) calls `noteBootRequestSent` inside `send`, immediately before `fetch`. On `d180ae4b` it called `noteBootRequestSent` and then `fetch` on the same path for any request that is not a token refresh. A PostgREST read such as `clients?id=eq.…` is not a refresh (`refreshTokenFromRequest` returns null unless the URL contains `grant_type=refresh_token`). For that read the 4s clock still starts as `fetch` is called. The only delay is on a refresh grant: the mark now waits until `refreshFlight.refresh` calls `fetch`, and that coordinator can sit for `followWaitMs` (8s) if another tab won the claim (`src/integrations/supabase/refresh-flight.ts`). That wait already existed. #945 stopped the 4s abort from starting during it. It does not start the client-row select.
- The warm line is a synchronous `sessionStorage` read inside `ClientAgentStandby` while the row is in flight. It does not await a network call and it does not move `bootSelect`.

So #945 did not reorder or block the boot reads in a way that adds seconds to the US reload. The 4s to 11–16s gap is not explained by a change in that order.

## (b) Is the cached line written and read for HVAZV4?

The write is `rememberWarmBootCard(client.id, line)` after `homeLines` exist (`clients.$clientId.tsx` lines 3832–3836). The line is the first Financial Manager sentence from `ownerHomeLines`. `"Checking…"` and `"Couldn't load…"` are refused (`src/lib/warm-boot-cards.ts` lines 12–21).

The key is `milon-warm-boot-card:${clientId}`. The write uses `client.id`. The read uses the route param passed into `ClientAgentStandby` (line 4087). The prod requests in the window are `id=eq.353f1dbf-a7ba-4092-878d-792223ba3536`, so the route param is that uuid, which is `client.id`. After a reload of the same tab the key matches. `sessionStorage` survives that reload. The in-memory `Map` does not. A new tab has neither.

The read can paint only the Financial Manager line. Analyst and Advisor stay `"Checking…"`, `data-client-agents` stays `"loading"`, and the lede stays `"Checking this client."` (`client-agent-standby.tsx` lines 21–53). The settled home, which is the real three-card text, is still behind the same `bootSelect`. A clock that waits for that text does not stop when the cached line paints, and the cache is empty on the first load of a tab.

## (c) What the logs show

Window 12:55–13:05 SAST is 10:55–11:05Z on 2026-11-13. Project `jxclnsbsqpixxqlbcapl`. No `performance.mark` for card text exists in the client. `markBootContent` (`src/lib/shell-gate.ts` lines 99–118) logs one `[boot-timing]` line when the authenticated shell leaves its skeleton (`src/routes/_authenticated.gate.tsx` line 584). That is not the first card sentence, and it is not stored server-side.

Edge logs for this client, once the browser sent them, completed as `GET | 200` in the same second as the matching `OPTIONS`. The boot row (`clients?select=id,name,business_type,…`) is logged at:

- 10:57:17.349Z
- 10:57:42.173Z
- 10:58:09.688Z
- 11:00:57.639Z
- 11:04:08.061Z

The 10:57:17 burst's `OPTIONS` for that row is 10:57:17.323Z and the `GET` is 10:57:17.349Z. The API did not spend 11s on that response. Auth `GET /user` durations in the same window are about 3ms to 200ms (the logged `duration` field is nanoseconds). There is no client mark to place those responses against navigation start.

PostgREST also logged `Warp server error: Thread killed by timeout manager` 22 times from 10:51:00Z to 11:05:01Z. The HVAZV4 row reads that did complete were still fast. A killed first attempt would not show up as one of those 200s, and the client would then sit on the existing 4s abort plus one retry. That path is the same on `d180ae4b`. It is a plausible way to land near 11s. It is not something #945 introduced, and these logs cannot tie a killed thread to this client.

## (d) Proposed mark, not shipped

One mark pair, client only, no ids:

- `performance.mark("client-reload")` when `ClientView` mounts.
- `performance.mark("client-card-text")` the first time the settled home (not the standby) commits a Financial Manager line that is not `"Checking…"` and does not start with `"Couldn't load"`.
- `console.info("[card-timing]", { ms })` where `ms` is the `client-card-text` mark's `startTime`. One line per load.
- A second line `[card-timing] { warmMs }` if the standby paints a cached line, so a later spot can see whether the cache fired and whether the clock stopped on that line or on the settled home.

Test: install a fake `performance.mark` / `getEntriesByName`, render the standby with a stored line and then the settled home with `Cash is $46,300.`, and assert one `[card-timing]` for the settled line, that `warmMs` is present only when the cache hit, and that a second render does not log again. No network.

Do not change abort timing or the boot select on the back of this note. The next spot should use `[card-timing]`, not the box clock.
