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
