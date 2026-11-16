# Diagnose still narrates negative days, WC 162, and GM 104.6%

AQA gate FAIL on prod `4940fee2`, Chill Pepper `79c4c485` (Practice·Theo). The Diagnose narrative still reads, in substance:

> Full year on file show negative creditor and inventory days, which cannot be true…
>
> Creditor Days of not meaningful and Inventory Days of not meaningful, yet Working Capital Days of 162. Gross Margin is stored as 104.6%, above 100%.

The ratio tiles do not say that. Working-capital days are unscored. Gross profit on the header is R1 159 000, about 95.4% of R1 215 000 revenue, not 104.6%.

No narrative code is changed in this note.

## Cached text, not a live sentence

There is no template in `src/` or `supabase/functions` that contains “cannot be true”, “Days of not meaningful”, or “stored as 104.6%”.

The paragraph is pre-generated. The Analyst model writes it, and `supabase/functions/agent-analyst/execute.ts` stores it with `shapeRecordedCopy` (`src/lib/agent-bus.ts`) into `agent_findings.title` and `agent_findings.detail`. `supabase/functions/agent-analyst/run.ts` also inserts a row from `handoffFinding` (`src/lib/owner-handoff.ts`) when a run finishes with a summary and no saved finding. The prompt (`supabase/functions/_shared/agent-prompts/analyst.ts`) tells the model to copy numbers a tool just returned. Page render does not call `computeRatios` to build this paragraph.

What render does is a light rewrite of that cached string:

- `rewriteDraftMonthStamp` (`src/lib/statement-period.ts`) turns `Sep 2026 books` / `Mar 2026 statement` into `Full year on file`. `agreeFullYearGrammar` only repairs “Full year on file look”, so “Full year on file show” keeps the plural verb.
- `quoteUnusableDayCounts` (`src/lib/ratios.ts`) replaces a negative day count in place. `Creditor Days of -248` becomes `Creditor Days of not meaningful`. Inventory is the same. `ratioSentence` (“Creditor Days is not meaningful.”) is not on this path.
- A positive `Working Capital Days of 162` and `Gross Margin is stored as 104.6%` match neither rewrite, so they stay.

`shapeRecordedCopy` can ground a new finding against live ratios, but only through `groundAdvisoryNarrative`. That skips a ratio when the live value is NaN, and “stored as” is not one of its connectors. An old `agent_findings` row is not rewritten in the table. The next open shows the cached sentences, then the display pass above.

## Surfaces

| Surface | What it shows | Live or cached |
| --- | --- | --- |
| Home | Accountant home thread and owner desk. `MilonTeamPane` (`src/components/milon-team/milon-team-pane.tsx`) runs `findingSentence`, then `rewriteDraftMonthStamp` again. The client file mounts that pane (`src/routes/_authenticated/clients.$clientId.tsx`). Owner: `milon-team-desk.tsx`, `owner-draft-card.tsx`, `owner-presence.ts`. | Cached `agent_findings`, then `formatFindingProse`. |
| Analyst | The same pane when the Analyst is selected, and `PracticeAgentThread`, which runs `rewriteDraftMonthStamp` on the finding. | Same cached row. |
| Financial Manager | No separate FM sentence. The Manager shows it on the team desk, or in a hand-off note whose body is the Analyst summary (`handoffFinishNote`). `ownerHomeLines` does not build this paragraph. | Same cached text. |
| PDF | The health scorecard exec summary is a different paragraph: `healthNarrative` in `src/reports/narrative.ts`, computed live from the scored ratios and passed to `ExecSummary`. It does not read `agent_findings`. Ratio rows use `presentScorecardRatio` (dash or “not meaningful” when the day count is not finite). A pack PDF can still print the paragraph if a stored pack section copied the finding; `advisory-pack-panel.tsx` only runs `rewriteDraftMonthStamp` on that body. | Scorecard: live. Pack body: cached, if it was copied in. |
| Emails | No product template (task, invite, welcome, mention) interpolates `agent_findings`. The only send path is a person-sent advisory draft (`advisory-drafter.tsx`): the stored body is passed through `rewriteDraftMonthStamp`, then mailto or WhatsApp. If that draft copied the finding, the email carries the cached paragraph. | Cached draft body. |

## What 162 and 104.6% are

Both are formula readings of the signed statement. They are not a second ledger total and not a units mix-up (days stay days; the margin is a fraction printed as a percent).

Working-capital days of 162 is the signed sum. With debtor days 6.6, inventory days −93, and creditor days −248: `6.6 + (−93) − (−248) = 161.6`, which rounds to 162. Live `operatingCycleDays` (`src/lib/ratios.ts`) refuses that. Chill Pepper’s cost of sales is R56 000 on R1 215 000 revenue, under the 5% cover, so creditor days, inventory days, and working-capital days are NaN. The tile is unscored (“not meaningful” / no data). 162 exists only in the cached sentence.

Gross margin of 104.6% is revenue minus a negative cost: `(1 215 000 − (−56 000)) / 1 215 000`. The header and the tiles treat the cost as a cost (`costMagnitude` / `correctedGrossMarginFraction`): gross profit R1 159 000, about 95.4%. The finding kept the uncorrected percent. `groundAdvisoryNarrative` does not rewrite “Gross Margin is stored as 104.6%”.

## Why #962 and #963 missed it

#962 stopped the tiles and `findingMetricContext` from printing a negative day count, and taught `operatingCycleDays` to return NaN when cost of sales is under 5% of revenue. `quoteUnusableDayCounts` only matches `creditor days -248`, not `Creditor Days of -248`, not “negative creditor and inventory days”, and not a later WC or gross-margin clause.

#963 changed `ratioSentence` to “Creditor Days is not meaningful.” The Diagnose paragraph is `formatFindingProse`. It never calls `ratioSentence`.

## Fix that landed

Not a rewrite of the cached sentence.

`computeRatios` / `operatingCycleDays` (`src/lib/ratios.ts`) are the inputs Overview, the tiles, and the Analyst prompt share (`overviewRatios`, `ask-ai/derive-ratios.ts`). A negative or missing day component makes working-capital days NaN. Negative cost of sales, negative payables, or a gross margin above 100% is a data-sign flag. Those ratios are not quoted. Stored financials are not rewritten.

`validateRatioInputs` is that check. `computeRatios`, `dataSignIssue`, and the cached-finding gate all call it. The gate does not look for particular sentences. It reads each ratio name the text cites, takes the number beside that name, and asks the validator. A live tile ratio that is already NaN fails the same way.

`presentCachedFinding` swaps only the sentence that fails. The rest of an email, meeting agenda, exec summary, or hand-off note stays, including after `rewriteDraftMonthStamp`. The replacement is `renderHealthNarrative` plus “Refreshed from current figures.” Home and Analyst pass the same figures and live snapshot into `findingSentence`. The action plan passes them into the Financial Manager hand-off. The client page passes them into the advisory drafter. The `agent_findings` title and detail stay as stored. The desk uses the existing source-check chip with `forceStale`. No new column. The next `record_finding` does not dedupe onto that row; it inserts a new one and sets the existing `superseded_by` on the old row (`agent-analyst/execute.ts`).
