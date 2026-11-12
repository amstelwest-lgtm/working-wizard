# Owner card text is slower than the heading

AQA 2026-11-12, Ben, US client 353f1dbf (1020E). First card text (`Cash is $46,300…`) fills in about 10–11s on a warm reload. The bar is under 3s. The heading paints at about 3.2s. ZA Chill Pepper is about 4.1s cold and 4.3s warm. No new measurement was taken from this environment. The times below are AQA's. The wait chain is the code those times line up with.

## What the sentence waits on

The sentence is `ownerAnswerTiles` in `src/lib/owner-answers.ts`. `Cash is …` is chosen only after `cashflow` supplies an opening and `cashPillarStatus` is healthy or at risk. There is no LLM on that line.

Warm reload still does this in order:

1. Workspace list (`clients` the user owns, then `client_memberships`) before `effectiveClientId` is set. The heading can paint from that list. About 3.2s on the US run.
2. Role resolution waits until that link has settled (`src/routes/app.tsx`). A known workspace finishes in the same turn. A missing role does two more reads.
3. Client meta, including the `cashflow` jsonb, starts only after the role is resolved.
4. Period financials are a second `clients.financials` read. The cash pillar is computed from those figures. Until the pillar agrees, the opening sentence stays off the card.

The extra 7s after the heading is those two client reads, gated behind the workspace list, plus the pillar. ZA is the same chain and finishes nearer 4s, so the US gap is the size of the cashflow and financials payloads, not a model call.

## Fix

Client-side only. `beginOwnerClientReads` in `src/lib/owner-boot-reads.ts` starts the cashflow select and the `clients.financials` select together, as soon as `effectiveClientId` is set. Neither waits on role resolution. Role resolution still gates the profile funnel, after those reads. Each select stays a critical `bootSelect`: first attempt aborts at 4s, one overlapping retry, no third try.

The stored opening paints as `Cash is …` when that figure is known and the cash pillar is not scored yet. A floor or dip line from the same cashflow still wins when it can be computed. A critical pillar replaces the opening line once financials score it.

The heading still waits on the workspace list (about 3.2s on the US run). The cash line should now appear when the cashflow select returns, in parallel with financials, instead of after the role check and a second serial read. That removes the role gate and the serial gap from the 10–11s. The remaining wait is the slower of the two client reads. ZA stays on the same path and should stay near its 4s. No edge function and no SQL.

## Addendum 1

AQA narrow spot on prod `d9ec8a71` (`e5820428` is in that merge). The times did not move. US 1020E (`353f1dbf-a7ba-4092-878d-792223ba3536`, MLN-HVAZV4) took 11.2s, 10.0s and 11.7s warm until `Cash is $46,300…` filled. ZA Chill Pepper (`79c4c485-9fa7-4499-9139-e1bb7cb40649`) took 11.9s and 10.5s warm, and the text that filled was `Cash is the weakest pillar at 25… Figures changed since this was written, regenerate.` The heading still paints at about 3s. No code change in this note.

### What paints each card

US. The sentence is the Financial Manager home card. `OwnerHome` (`src/components/owner-door/owner-home.tsx`) renders `HomeBotCard`, and the lines are `ownerHomeLines` → `cashTile` in `src/lib/owner-answers.ts`. The figure is the stored opening. On this client `clients.cashflow` is `openingBalance: "46300"` with empty revenue and expense lines (98 bytes) and `clients.financials.cash` is `"46300"`. `Cash is $46,300` is that opening, formatted. There is no model call on this line.

ZA. This is not the cash tile. The stored row is analyst finding `f88f0f11-72c0-49f3-9f66-03da5d6d50c0`, kind `weakest_pillar`, title `Cash is the weakest pillar at 25, and the live health score is 54 on the books for the full year on file.` `findingSentence` (`src/lib/milon-team-activity.ts`) runs that title through `reconcileStoredHealthNarrative`. When the stored scores disagree with the live snapshot, that returns `staleHealthNarrative`: the live lead (`Cash is the weakest pillar at …`) plus `Figures changed since this was written, regenerate.` `HealthNarrativeLine` (`src/components/health-narrative-line.tsx`) prints the lead and the regenerate control. The desk row is `MilonTeamDesk` (`src/components/milon-team/milon-team-desk.tsx`); the same line is on `OwnerDraftCard`. The home draft cell in `owner-home.tsx` splits the same string into the lead and the button. The data is `agent_findings`, checked against the live score from `clients.financials`. It is not `clients.cashflow`.

### Mount to text

Owner home, US:

1. Auth. `use-auth.tsx` calls `restoreSession` → `getSession`, capped at `SHELL_GATE_TIMEOUT_MS` (8s). A timeout aborts that refresh (`session-deadline.ts`) and still mounts from the stored user.
2. Workspace list (`clients` the user owns, then memberships) through `bootSelect`. The shell heading is the workspace name. About 3s. This list does not select `cashflow` or `financials`.
3. `ownerBoardReady` (`src/lib/first-run.ts`) keeps the content pane a skeleton until the role has settled, the client-meta read has settled (`onboardingGateReady`), and financials have hydrated. A known workspace sets the role in the same turn. The cards do not paint in that turn.
4. `beginOwnerClientReads` starts `clients.cashflow` and `clients.financials` together, each with `bootSelect({ critical: true })`. There is no `ask-ai`, no summary fetch, and no poll on this line. The only timers are the boot ones: the first attempt is abandoned at 4s, a second select starts at 2.5s if the first is still open, and that retry may run 6s. No third try. The shell ceiling is 12s.
5. The abort is not wrapped around the auth lock. `fetchWithAuth` waits for `getSession` before the HTTP body, and the 4s clock is already running. A read that has not been sent can still be abandoned, and the retry then waits on `getSession` again.
6. Postgres is not the wait. `EXPLAIN ANALYZE` of the client-row select is an index scan, execution 0.155ms, shared hits only. RLS is `has_client_access` → `can_access_company`, a membership lookup, not a scan of the book. US `cashflow` is 98 bytes. ZA `cashflow` is about 9KB and `financials` about 2KB.

About 10s is the 4s abort plus the retry (up to 6s) plus the time already spent before those selects start. The heading has already painted from the name list.

ZA stored card, once the home or the analyst desk is up:

1. Same auth and same client-row gate as above. The live snapshot does not exist until `clients.financials` has hydrated, so the regenerate line cannot be chosen before that.
2. The finding itself is `useAgentActivity` (`src/hooks/use-agent-activity.ts`): `agent_runs`, `agent_findings`, and `agent_messages` in one `Promise.all`, plus a `clients.market` read. Limit 20. Not `bootSelect`. An 8s `setTimeout` (`SHELL_GATE_TIMEOUT_MS`) only stops the spinner; it does not paint the sentence.
3. The analyst desk (`useMilonTeamFeed`) loads the client row again with eight other tables, then the firm, the sign-off, and action titles, in that order. No `ask-ai`. The 650ms `setTimeout` there only refreshes after an action-plan event.
4. `reconcileStoredHealthNarrative` then appends the regenerate marker. Until the live snapshot exists it returns the stored title with no marker. The text AQA saw includes the marker, so the clock includes the financials hydration, not a second model call.

### Why e5820428 did not move it

That commit starts the cashflow and financials selects together and can paint `Cash is …` before the pillar is scored. It does not change when the cards are allowed on screen. `ownerBoardReady` still waits for financials hydration. Both selects are still critical `bootSelect`s, so each one can spend the 4s abort inside `getSession` and then retry. Two fast queries issued together still share that lock. The US opening was already a 98-byte column; reading it beside financials does not remove an 8s wait. The ZA sentence is a stored finding plus the live snapshot, so painting the cash opening never fed it.

### One fix

Client-side. No edge function and no SQL.

Do not start the 4s abort until the select has a token and the HTTP request has been sent. A `getSession` that is still on the auth lock must not count as a failed read and must not start the retry. Keep the one retry for a fetch that was actually sent and then aborted or dropped. On the boot shell, which already shows the heading, paint the Financial Manager line from `clientMeta.cashflow` as soon as that select returns, instead of holding every card for `financialsHydrated`. The ZA regenerate line can follow when the live snapshot arrives; it should not be the first text the cash card waits on.

## Fix

Shipped on this branch. Client-side only. No edge function and no SQL.

`noteBootRequestSent` runs from `coordinatedAuthFetch`, which is called only after `fetchWithAuth` has the access token and is handing the request to `fetch`. That is when the 4s abort starts. Until then the attempt is bounded by `BOOT_AUTH_WAIT_MS` (8s), and that timeout fails into the same one-retry path as an aborted fetch. The hedge starts when the request is sent, not while `getSession` is still on the lock.

The boot shell (`data-owner-boot="pending"`) renders `bootShellCashLine(clientMeta.cashflow)` as soon as that row is set. It does not wait for `hydratedClientId` or `ownerBoardReady`. A client switch clears `cashflow` through `cashflowOnClientSwitch` before the next read, and `hasRealFinancials` is no longer a dependency of that effect.

A new tab stays on the loading state until `clientAccessGate` has a session user. The client select in `clients.$clientId.tsx` re-runs when that user id arrives or changes, so an empty anonymous read is not kept as "Client not found".

What I noticed collapses `kind=handoff` rows to the latest per agent. Show all passes the full list through `noticedHandoffRows`.

Verification: `pnpm test:owner-boot-9s` (abort starts at send, lock timeout is the scaled 8s and retries once, boot-shell cash line, client switch), `pnpm test:client-agent-cards` (restoring session is loading, not missing), `pnpm test:finding-dedupe` (latest handoff per agent, Show all keeps history). US opening `46300` paints `Cash is $46,300.` with no pillar.
