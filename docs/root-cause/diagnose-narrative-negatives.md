# Diagnose still narrates negative days, WC 162, and GM 104.6%

AQA gate FAIL on prod `4940fee2`, Chill Pepper `79c4c485` (Practice·Theo). The Diagnose narrative still reads, in substance:

> Full year on file show negative creditor and inventory days, which cannot be true…
>
> Creditor Days of not meaningful and Inventory Days of not meaningful, yet Working Capital Days of 162. Gross Margin is stored as 104.6%, above 100%.

The ratio tiles do not say that. Working-capital days are unscored. Gross profit on the header is R1 159 000, about 95.4% of R1 215 000 revenue, not 104.6%.

No narrative code is changed in this note.

## Where the words come from

There is no template in `src/` or `supabase/functions` that contains “cannot be true”, “Days of not meaningful”, or “stored as 104.6%”. Those sentences are stored prose.

The Analyst writes them. `supabase/functions/agent-analyst/run.ts` inserts `agent_findings` (`title`, `detail`, `evidence`) from `record_finding`, and from `handoffFinding` in `src/lib/owner-handoff.ts` when a run finishes with a summary and no saved finding. The model is told to copy numbers a tool just returned (`supabase/functions/_shared/agent-prompts/analyst.ts`). It is not a live sentence built from `computeRatios` at page render.

Display then rewrites that stored text. It does not recompute it.

- `rewriteDraftMonthStamp` (`src/lib/statement-period.ts`) turns `Sep 2026 books` / `Mar 2026 statement` into `Full year on file`. `agreeFullYearGrammar` only repairs “Full year on file look”. “Full year on file show” is that rewrite leaving the plural verb.
- `quoteUnusableDayCounts` (`src/lib/ratios.ts`) replaces a negative creditor or inventory day count in place. `Creditor Days of -248` becomes `Creditor Days of not meaningful`. The same happens for inventory. That is the broken grammar. `ratioSentence` (“Creditor Days is not meaningful.”) is not on this path.
- A positive `Working Capital Days of 162` and `Gross Margin is stored as 104.6%` do not match those rewrites, so they survive.

## Every surface that renders it

The same stored row, passed through `findingSentence` → `formatFindingProse` (`src/lib/milon-team-activity.ts`):

- Diagnose and the accountant home thread: `MilonTeamPane` (`src/components/milon-team/milon-team-pane.tsx`) builds `findingSentence`, then runs `rewriteDraftMonthStamp` again. The client file mounts that pane for the home thread and the agent tab (`src/routes/_authenticated/clients.$clientId.tsx`).
- Analyst: the same pane when the Analyst is the selected agent, and `PracticeAgentThread`, which runs `rewriteDraftMonthStamp` on the finding text.
- Owner desk and draft cards: `milon-team-desk.tsx`, `owner-draft-card.tsx`, and `owner-presence.ts` call `findingSentence` or `formatFindingProse`.
- Financial Manager: there is no second FM sentence for this. The Manager shows it when the team desk or a hand-off note quotes the Analyst summary (`handoffFinishNote` stores that summary on the action). `ownerHomeLines` does not build this paragraph.
- PDF: `src/reports` and the PDF components do not call `findingSentence`. The health scorecard uses `presentScorecardRatio`, which prints “not meaningful” or a dash for a non-finite day count. A pack section can still show the paragraph if the stored pack body copied the finding; `advisory-pack-panel.tsx` only runs `rewriteDraftMonthStamp` on that body.

## Why #962 and #963 missed it

#962 stopped the tiles and `findingMetricContext` from printing a negative day count, and taught `operatingCycleDays` to return NaN when cost of sales is under 5% of revenue. The substitution in `quoteUnusableDayCounts` only matches `creditor days -248`, not `Creditor Days of -248`, not the words “negative creditor and inventory days”, and not a later WC or gross-margin clause.

#963 changed `ratioSentence` to “Creditor Days is not meaningful.” The Diagnose paragraph is `formatFindingProse`. It never calls `ratioSentence`.

## What 162 and 104.6% are

Both are formula readings of the signed statement, not a second set of books.

Working-capital days of 162 is the signed sum. With debtor days 6.6, inventory days −93, and creditor days −248: `6.6 + (−93) − (−248) = 161.6`, which rounds to 162. Live `operatingCycleDays` (`src/lib/ratios.ts`) refuses that. Chill Pepper’s cost of sales is R56 000 on R1 215 000 revenue, under the 5% cover, so creditor days, inventory days, and working-capital days are NaN. The tile is unscored (“not meaningful” / no data). 162 is only in the stored sentence.

Gross margin of 104.6% is revenue minus a negative cost: `(1 215 000 − (−56 000)) / 1 215 000`. The header and the tiles use the cost as a cost (`costMagnitude` / `correctedGrossMarginFraction`): gross profit R1 159 000, about 95.4%. The finding kept the uncorrected percent. `groundAdvisoryNarrative` does not rewrite “Gross Margin is stored as 104.6%”, because “stored as” is not one of its connectors.

## Proposed fix

One display pass in `formatFindingProse`, still not a rewrite of the `agent_findings` row:

- When live creditor or inventory days are not finite, replace the whole citation (“of -248”, “of not meaningful”, “negative creditor and inventory days”) with “Creditor days are not meaningful.” and “Inventory days are not meaningful.”
- When live working-capital days are NaN, drop a “Working Capital Days of 162” citation instead of leaving it beside those sentences.
- When the corrected gross margin is the tile value, rewrite “stored as 104.6%” to that percent.
- Agree “Full year on file show” the same way “look” is already agreed.

Test: feed the two Chill Pepper sentences plus figures `{ creditorDays: -248, inventoryDays: -93, workingCapitalDays: 161.6, grossMargin: 1.046 }` and canonical ratios with NaN days and gross margin `1_159_000 / 1_215_000`. The result has no negative day count, no “of not meaningful”, no 162, and no 104.6%.
