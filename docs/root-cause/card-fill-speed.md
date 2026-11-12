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

## What a fix would be

Client-side, and not done in this change: start the cashflow and financials reads in parallel with the workspace list when a stored client id exists, and do not hold the cashflow read for role resolution. Paint `Cash is …` from the stored opening as soon as that row returns, and replace it if the pillar is critical. Do not show the row before the workspace list confirms the id.

That edit sits in the owner boot in `src/routes/app.tsx`. It is the access gate, not a display tweak, so it is not in this batch. It does not need a new table or an edge function. An edge or SQL change is not required.
