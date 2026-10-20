# Root cause: missing day metrics scored as zero, third strike

AQA ran prod `13a72c3f`, which includes `#674`, on a US client with a P&L and no balance sheet. Currency zeros, `//`, and the flat KPI arrow pass. What is still on the page is a missing day count printed as `0` and then scored.

The lines AQA called out all come from that one substitution:

- Cash Flow Cycle page 1: `It takes 0 days for $1 spent to return as cash — the cycle is Healthy. — is trapped in working capital.` Every day tile is `0 d`, including `Accounts payable · 0d` and `Funding gap · 0 days`.
- Cash Flow Cycle page 2: `Shortening the cycle by one day releases —.` and `Days sales outstanding 0d 100 HEALTHY`.
- Scorecard page 2: `Debtor Days 0d 100 HEALTHY` and `Creditor Days 0d 70 WATCH`.
- Ratio Movement: `Debtor Days — — — 0d`.
- Intervention Plan page 2: `Days payable outstanding is 0d.`
- Labor: the period row prints headcount `0`.
- Industry Benchmark throws `Generation failed: No benchmarks yet for Wholesale Trade — Non-Specialised.` The card stays enabled. It should be disabled, with that note on the card.

This note is the write-up. No code change is in this branch.

## (1) Where null or undefined becomes 0

`computeRatios` already treats a blank as missing. The zero is introduced after that, and the scorers then do the right thing for a real zero.

### The ratio engine keeps a blank as NaN

`src/lib/ratios.ts:586-606`. A blank string is `NaN`. `safe` returns `NaN` when either side is not finite, and returns `0` only for a finite numerator over a zero denominator. `operatingCycleDays` (`:514-554`) uses the same rule. A P&L with no receivables therefore leaves `Debtor Days` as `NaN`. A typed `0` receivables against real revenue is a real `0` days.

`overviewRatioInputs` (`src/lib/health-score.ts:306-322`) passes a missing key through as `""`, so `computeRatios` sees the blank. `scoreRatio` (`health-score.ts:497-499`) returns `NaN` for a non-finite value and does not invent a midpoint.

### Blank receivables and payables are then replaced with 0

`src/lib/deliverable-input-config.ts:162-166`. `num` maps `null` and `""` to `0`.

`computedDaysAr` (`:206-213`) divides that `0` by annualised revenue and returns `0`. `computedDaysAp` (`:216-228`) does the same with blank payables and COGS. Neither returns `null` for a blank stock.

Inventory already does the other thing. `computedDaysInventory` (`:231-234`) and `statementStockAmount` (`:248-253`) leave a blank as `null`, and the comment says a stored `0` stays `0`. Days AR and Days AP do not follow that comment.

`withCanonicalDebtorCreditorDays` (`:300-307`) copies those results onto the ratio map whenever they are not `null`. `0` is not `null`, so the `NaN` from `computeRatios` is overwritten with `0`. Both callers do this: `overviewRatios` (`src/lib/health-score.ts:355-362`) and `scorecardRatiosFromFinancials` (`src/lib/scorecard-rows.ts:82`).

Inventory days stay `NaN`, because the canonical helper does not overwrite them. Working-capital days stay `NaN` too, because `:311-312` only rewrites the net when debtor, inventory, and creditor days are all finite.

### A real 0 scores as good

`presentScorecardRatio` (`src/lib/report-coherence.ts:493-515`) treats only a non-finite value as missing. `0` is finite, so the row is scored. The "not meaningful" set (`:416-420`) is never consulted.

`buildScorecardRatioResults` (`src/lib/scorecard-rows.ts:97-110`) then calls `scoreRatio`. `fmtRatioVal` (`:35`) prints `${Math.round(val)}d`, so the cell is `0d`.

The day scorers, given a genuine `0`:

| Scorer | Where | What `0` scores |
| --- | --- | --- |
| `scoreLowerIsBetterDays` | `src/lib/client-metrics.ts:546-549` | `((90 - 0) / 90) * 100` = `100` |
| `scoreCreditorDays` | `client-metrics.ts:557-562` | `70 + (0 / 30) * 30` = `70` |
| `scoreWorkingCapitalDays` | `client-metrics.ts:656-658` | `((90 - 0) / 90) * 100` = `100` |

`scoreTier` (`src/lib/ratios.ts:349-354`) labels `100` Healthy and `70` Watch. That is why the scorecard says `Debtor Days 0d 100 HEALTHY` and `Creditor Days 0d 70 WATCH`. `RatioRow` (`src/components/pdf/ratio-row.tsx:101-108`) prints the number and `HEALTHY` / `WATCH` whenever `unscored` is false. The scorecard passes that flag through at `src/reports/health-scorecard.tsx:462-467`.

### The cash-cycle builder fills every remaining hole with 0

`buildWorkingCapitalData` (`src/routes/_authenticated/reports-studio.tsx:1494-1498`). A non-finite day becomes `0`. The function returns `null` only when debtor days and inventory days are both non-finite. After the canonical overwrite, debtor days is the finite `0`, so a P&L-only file still builds a report. Inventory's `NaN` is forced to `0` here. Creditor days are already `0`. The cycle is `0 + 0 - 0`.

`wip_days` is hardcoded `0` and scored as inventory days of `0` (`:1504`, `:1516-1517`). The timeline hides a WIP segment when the days are not greater than `0` (`src/reports/cash-cycle.tsx:186`, `:396`), so that particular `0` does not get its own tile. The other zeros do.

The PDF prints the number it was given. It does not look back at the balance sheet:

- Narrative, `cashCycleStory` (`src/lib/report-coherence.ts:197-228`), called from `cashCycleNarrative` (`src/reports/narrative.ts:213-235`) and again from the PDF (`cash-cycle.tsx:325-330`). A non-finite cycle is set to `0` at `:197`. At `0` the sentence is `It takes 0 days for $1 spent to return as cash — the cycle is Healthy.` Trapped cash is `0`, and `#674` prints that money as `—`, which is the `— is trapped in working capital` clause. `dayRelease` is `null` because the cycle is not greater than `0` (`:224`).
- Page 2 (`cash-cycle.tsx:535`) still writes `Shortening the cycle by one day releases ${fmtRand(story.dayRelease ?? 0)}`. The `?? 0` turns the null release into money `0`, which prints `—`.
- Tiles use `` `${Math.round(...)} d` `` (`cash-cycle.tsx:337`, `:354`, `:388-413`). The timeline prints `Accounts payable · 0d` from `t("payables")` plus creditor days (`:169`, `:251`) and `Funding gap · 0 days` (`:277`). US copy makes DSO `Days sales outstanding` (`src/lib/market/copy.ts:46`). The ratio row then shows `0d 100 HEALTHY` from the scores computed at `reports-studio.tsx:1512-1518`.

### Movement, the plan, and headcount

Ratio Movement keeps a finite `0` as the current column and leaves missing history null (`reports-studio.tsx:1466-1478`). `fmt` (`src/reports/ratio-movement.tsx:66-70`) prints `—` for null and `${round}d` for `0`. The columns are twelve months, six, three, then current (`:243-246`), so the row reads `Debtor Days — — — 0d`.

Creditor days of `70` are Watch, so the ratio is in the intervention list (`reports-studio.tsx:1950-1952`). `groundInterventionStep` (`src/lib/intervention-grounding.ts:42-43`) prepends `Creditor Days is 0d.` The PDF spells that for the US pack (`src/reports/intervention-priority.tsx:142`, `src/lib/market/copy.ts:154`), which is `Days payable outstanding is 0d.` Debtor days score `100`, so they are Healthy and do not open a step. That is why the plan quotes payables and not sales outstanding.

Labor does not use `num`. `getNum` (`reports-studio.tsx:1227-1229`) leaves a blank headcount as `NaN`. `buildLaborData` (`:1800`, `:1820`, `:1834`) then stores `employee_count` and `periods[].employees` as `0` when headcount is missing. The Headcount tile already prints `—` when the count is not greater than `0` (`src/reports/labor-productivity.tsx:254`, `:286-287`). The period row prints `p.employees` with no check (`:445`). That raw `0` is the labor line AQA saw.

### Benchmark throws instead of disabling the card

`GEN.benchmark` (`reports-studio.tsx:2855-2869`) throws `benchmarkEmptyCopy`'s message (`src/lib/benchmark-empty.ts:39`) when the sector has no rows. `handleGenerate` (`reports-studio.tsx:3940-3941`) prefixes every throw with `Generation failed:`. Preview already catches that message and shows it inline (`:3979-3988`). The card does not. `reportReady` (`src/lib/reports-drafter-copy.ts:75-81`) returns false only for leverage and assets. `unavailableFor` (`reports-studio.tsx:3725-3734`) only attaches those two notes. Cash Flow Cycle is the same shape of gap: `liveOrDemo` (`:2628`) throws `Working-capital report needs debtor/inventory days…` (`:2722-2724`) when the slice is null, instead of disabling the card the way leverage does (`:2757-2761`, `:3732`).

On this P&L-only file the cycle slice is not null, because of the `0` fill above, so the throw does not run. The PDF of zeros does.

## (2) Why `#674` and the earlier zero fixes missed it

`#674` changes how a rounded money amount, a signed variance, and a percent are printed. A day count never goes through `formatReportAmount`. `fmtRatioVal` still has its own days branch (`scorecard-rows.ts:35`). The cash-cycle tiles, the timeline, and the movement current column interpolate `Math.round` themselves. The earlier zero passes (`#657`, the keep-with-next scan, `#666`) looked for `$0`, `($0)`, `0.0%`, and `//`. `0d` and `0 days` were not in that list. `#674`'s own note said a headcount of `0` stays `0`, because it is not money.

The CI fixture is a full set of books. `scripts/report-zero-format-test.mts` puts `totalAssets`, `equity`, `receivables`, `inventory`, `payables`, and `employees` on every shape (`:191-211`). The zero shape stores `"0"`, which is an entered zero, not an omitted balance sheet. The cash-cycle element is a hand-built `workingCapitalData` (`:287-316`): even the zero shape keeps inventory at `35` and creditor days at `28`, and passes health scores in directly. The test never calls `buildWorkingCapitalData`, `withCanonicalDebtorCreditorDays`, or `handleGenerate`. It cannot see a P&L-only file, and it cannot see `Generation failed`.

`#674` does explain one word in the sentence AQA quoted. Trapped cash of `0` now prints `—`, so the narrative reads `— is trapped in working capital` instead of `$0 is trapped`. The `0 days` and the Healthy band were never part of that formatter.

## (3) Numbers engine and report presentation

**Eng1, the numbers.** Whether a blank stock is `NaN` or `0`, and what a real `0` scores.

- `src/lib/ratios.ts`: `computeRatios`, `operatingCycleDays`, `safe`, `scoreTier`. The blank-is-`NaN` rule here is already right. Do not change it into a dash.
- `src/lib/health-score.ts`: `overviewRatioInputs`, `overviewRatios`, `scoreRatio`.
- `src/lib/client-metrics.ts`: `scoreLowerIsBetterDays`, `scoreCreditorDays`, `scoreWorkingCapitalDays`. A real `0` debtor days scoring `100` is the formula. The bug is calling it.
- `src/lib/deliverable-input-config.ts`: `num`, `computedDaysAr`, `computedDaysAp`, `withCanonicalDebtorCreditorDays`. This is the overwrite.
- `src/lib/scorecard-rows.ts`: `scorecardRatiosFromFinancials` and the `scoreRatio` call inside `pushRow`.
- `src/routes/_authenticated/reports-studio.tsx`: `buildWorkingCapitalData` (the `|| 0` fill and the scores), `buildLaborData` (the stored `0` headcount), and the movement row that keeps a finite `0`.

**Report presentation.** What a missing figure says, and whether the card can be clicked.

- `src/reports/cash-cycle.tsx`: tiles, timeline labels, the page-2 release sentence.
- `src/lib/report-coherence.ts`: `cashCycleStory` (the sentence, and the non-finite-to-`0` at `:197`). `presentScorecardRatio` decides unscored, which the PDF then prints.
- `src/reports/narrative.ts`: `cashCycleNarrative`.
- `src/reports/health-scorecard.tsx` and `src/components/pdf/ratio-row.tsx`: the value, the score, and the Healthy / Watch chip.
- `src/reports/ratio-movement.tsx`: the `0d` current column.
- `src/lib/intervention-grounding.ts` and `src/reports/intervention-priority.tsx`: the `is 0d` sentence and the US spelling.
- `src/reports/labor-productivity.tsx`: the period cell that prints `p.employees`. The Headcount tile is already `—`.
- `src/routes/_authenticated/reports-studio.tsx`: `liveOrDemo` for the cycle, `GEN.benchmark`'s throw, `handleGenerate`'s `Generation failed` prefix, and `unavailableFor`.
- `src/lib/reports-drafter-copy.ts`: `reportReady`, which today disables only leverage and assets.
- `src/lib/benchmark-empty.ts`: the note already exists. The card does not use it as a disabled reason.

A stored `0` stays Eng1's number. Presentation must not dash it. A blank field must never become that `0`.

## (4) The single fix

Carry null from a blank stock and a blank headcount through to the page. Do not coerce it to `0` on the way.

- `computedDaysAr` and `computedDaysAp` treat a blank the way `computedDaysInventory` already treats blank stock: `null`, not `0`. A stored `0` stays `0`.
- `withCanonicalDebtorCreditorDays` does not overwrite a `NaN` ratio with that null. `buildWorkingCapitalData` does not replace a non-finite day with `0`, and returns null when debtor, inventory, and creditor days are all missing. It does not score a null.
- `buildLaborData` leaves a missing headcount null. The period row prints `—`, the same as the Headcount tile. A stored headcount of `0` still prints `0`.
- A missing day on the scorecard, the movement report, and the intervention plan prints `—` and `Not enough data`. No score, no gauge, no Healthy, and no Watch. The playbook step is not opened, so the `is 0d` sentence is not there. `RatioRow` already has an unscored chip (`ratio-row.tsx:101-108`, copy `Not scored` at `report-coherence.ts:25`). The fix uses `Not enough data` for this case.
- `cashCycleStory` is not called for a missing cycle. The `It takes 0 days…` sentence and the page-2 `releases —` sentence are both dropped.
- Cash Flow Cycle is disabled with a note when the books have no balance-sheet days, by the same `reportReady` / `unavailableFor` path leverage and assets already use. `liveOrDemo` must not throw for that card.
- Industry Benchmark with no rows for the sector is disabled the same way, with the existing `benchmarkEmptyCopy` note on the card. Generate does not throw, so the toast is not `Generation failed: No benchmarks yet for …`.

The day formulas in `scoreLowerIsBetterDays` and `scoreCreditorDays` stay as they are. They are correct for a zero that was entered.

## (5) How it will be verified

One CI test builds all 11 reports for three fixtures, in ZA and US, and reads the text the way `scripts/report-zero-format-test.mts` does.

1. **P&L only.** Revenue, COGS, EBIT, and net income are present. Receivables, inventory, payables, assets, equity, and employees are omitted. They are not the string `"0"`.
2. **Full books.** Those balance-sheet fields and a real headcount are present, with non-zero days.
3. **All zeros.** The same keys are present and stored as `0`. That remains a real zero.

The test has to go through `scorecardRatiosFromFinancials`, `buildWorkingCapitalData`, `buildLaborData`, and the benchmark empty path. Hand-built PDF props, which is what `#674` renders, skip the overwrite and will pass while prod is still wrong.

On the P&L-only fixture the rendered text must not contain `0d`, `0 days`, or `Healthy` / `Watch` on a day row. The cash-cycle narrative sentence must be absent. Cash Flow Cycle and Industry Benchmark must come back as a disabled card with a note, and generation must not throw `Generation failed`. The labor period row must not print a bare headcount `0`.

The full-books fixture must still show its real day counts and bands. The stored-zero fixture may still print `0d` for an entered zero. That print is not a failure. `Generation failed` is a failure on every fixture.

No code until this note is confirmed. Do not merge. Do not deploy.
