# Root cause: PDF zeros, second strike

AQA retested the keep-with-next work at main `58982e1d` (QA US, Ben), all 11 PDFs. Keep-with-next passes. Zeros fail again. This note is the two-strike write-up. No formatter change is in this branch.

## (a) Why the zeros still leak

`#657` added `varianceIsZeroPair` and used it in one place: the Variance tag and the % cell on the budget PDF, and only when `budget === 0 && actual === 0` (`src/lib/budget.variance.ts:360-362`, `src/reports/budget-variance.tsx:161-176`). A row of `$700,000` against `$700,000` is not that pair. Its delta is about 0, so the old path still runs: `overUnder` prints "In line" (`budget-variance.tsx:99`), `signedMoney` prints the amount (`:92-95`, `:168`), and `formatVariancePct` prints `0.0%` (`budget.variance.ts:342`).

Nothing else asks that predicate. A numeric zero still goes through a formatter that prints a zero.

Shared printers, none of which turn 0 into `—`:

| Printer | Where | What 0 becomes |
| --- | --- | --- |
| `formatMoney`, `formatMoneyCompact`, `formatMoneyUnit`, `formatMoneyChartTick` | `src/lib/market/format.ts:35-103` | `$0` or `R 0`. A negative is a leading `-`. Only a non-finite value is already `—`. |
| `fmtRand`, `fmtRandCompact` | `src/components/pdf/theme.ts:144-150` | Those strings, after `Math.round`. |
| `fmtPct` | `theme.ts:152-155` | `0.0%`. Non-finite is `n/m`. |
| `formatVariancePct` | `src/lib/budget.variance.ts:339-345` | `0.0%` when `\|pct\| < 0.05`. |
| `variancePctCell` | `budget.variance.ts:351-354` | A note becomes `n/a`. Otherwise the same percent. |
| `signedMoney` | `budget-variance.tsx:92-95` | `n > 0` prefixes `+` before `fmtRand`. A delta in `(0, 0.5)` rounds to `$0` and keeps the plus: `+$0`. |
| `overUnder` | `budget-variance.tsx:97-101` | Exact `0/0` is `—`. Any other `\|delta\| < 1` is "In line", and the amount is still printed under it. |

Local percent printers that also emit `0.0%`: `fmtRatioVal` (`src/lib/scorecard-rows.ts:33-45`), `fmt` (`src/reports/ratio-movement.tsx:66-68`), `fmtBenchVal` (`src/routes/_authenticated/reports-studio.tsx:1340-1343`), `formatStatementMargin` (`src/lib/statement-margin.ts:55-58`), plus inline `toFixed(1)%` in the waterfall (`profitability-waterfall.tsx:453`, `:569`), labor (`labor-productivity.tsx:274`), and leverage rates (`leverage-solvency.tsx:190`, `:259`, `:318`).

The 11 reports:

1. **Scorecard** `src/reports/health-scorecard.tsx`. No money helper. The percent on each ratio is `formatted_value` from `fmtRatioVal` (`scorecard-rows.ts:45`, consumed at `health-scorecard.tsx:455-465`). A zero ratio is `0.0%`.
2. **Intervention** `src/reports/intervention-priority.tsx`. Counts only. No money or percent printer.
3. **Cash forecast** `src/reports/cash-forecast.tsx`. Opening, receipts, net, and closing call `fmtRand` (`:301`, `:304`, `:319`, `:332`) so a zero is `$0`. Payments are always wrapped: `({fmtRand(Math.abs(...))})` at `:307`, so a zero payment is `($0)`. Headlines use `fmtRand` / `fmtRandCompact` (`:201`, `:412`, `:418`, `:425`, `:474`, `:480`).
4. **Cash cycle** `src/reports/cash-cycle.tsx`. Money at `:328-329`, `:348`, `:368`, `:530`, `:535`. Percents via `fmtPct` at `:417` and `:422`.
5. **Waterfall** `src/reports/profitability-waterfall.tsx`. Chart labels at `:249-251`: a decrease is `` `(${fmtRandCompact(Math.abs(s.delta))})` ``, so a zero step is `($0)`; a zero increase is `fmtRandCompact` → `$0`. Ladder amounts and percents `:335`, `:347`. Comparison table `:432-441` and the change percent `:453`. Headlines `:525-587`.
6. **Leverage** `src/reports/leverage-solvency.tsx`. Drawings are always `` `-${fmtRand(Math.abs(roll.drawings))}` `` at `:445`, so zero drawings are `-$0`. Net profit is always `` `+${fmtRand(Math.abs(roll.profit))}` `` at `:440`, so zero profit is `+$0`. Movement notes prefix `+` at `:269` and `:461`. Other money and percents: `:100`, `:111`, `:118`, `:125`, `:187`, `:194`, `:201`, `:256`, `:265`, `:274`, `:296`, `:313`, `:435`, `:451`, `:457`.
7. **Assets** `src/reports/asset-productivity.tsx`. `fmtPct` at `:292`, `:298`, `:339`. A zero margin is `0.0%`.
8. **Labor** `src/reports/labor-productivity.tsx`. The Period Detail row is `p.label`, revenue `fmtRand` (`:433`), employees as a raw number (`:444`), wages `fmtRand` (`:455`), rev/employee `—` when headcount is 0 (`:466`). "Current Period $700,000 0 $0 —" is that row: the `0` is headcount, the `$0` is wages. Repeated at `:491-500`. `fmtRand(1)` at `:278` and `:316` is the unit in "GP per $1 of wages". That call must stay `$1`. Percents: `:289`, `:294`, `:326`, `:363`.
9. **Movement** `src/reports/ratio-movement.tsx:66-68`. Its own percent printer. Zero is `0.0%`.
10. **Benchmark** `src/reports/benchmark-report.tsx:241-243`. Prints `formatted_current`, `formatted_median`, and `formatted_top_quartile`, baked by `fmtBenchVal` (`reports-studio.tsx:1340-1341`). Zero is `0.0%`.
11. **Budget** `src/reports/budget-variance.tsx`. Budget and actual columns always call `fmtRand` (`:155`, `:158`), so a real zero there is still `$0`. Variance and % become `—` only for a null delta or an exact 0/0 pair (`:161-176`). The summary note is `` `Budget ${fmtRand} · ${signedMoney}` `` (`:219`), which is `Budget $700,000 · +$0` when the rounded delta is zero but still positive. The KPI sets `direction: "flat"` when the signal is inline (`:212-213`).

The stray dash on the KPI is that flat direction. `ExecSummary` draws an `Arrow` whenever `direction` is set (`src/components/pdf/exec-summary.tsx:90`). The flat arrow is a 1.5pt horizontal rule (`src/components/pdf/glyphs.tsx:24-28`), drawn beside `$700,000`. It is not a money character. That is the `$700,000 –` tile.

## (b) Files

Printers and the one special case: `src/lib/market/format.ts`, `src/components/pdf/theme.ts`, `src/lib/budget.variance.ts`, `src/lib/scorecard-rows.ts`, `src/lib/statement-margin.ts`, `src/reports/budget-variance.tsx`, `src/components/pdf/exec-summary.tsx`, `src/components/pdf/glyphs.tsx`.

Report call sites: `src/reports/health-scorecard.tsx`, `src/reports/intervention-priority.tsx` (no money), `src/reports/cash-forecast.tsx`, `src/reports/cash-cycle.tsx`, `src/reports/profitability-waterfall.tsx`, `src/reports/leverage-solvency.tsx`, `src/reports/asset-productivity.tsx`, `src/reports/labor-productivity.tsx`, `src/reports/ratio-movement.tsx`, `src/reports/benchmark-report.tsx`, `src/routes/_authenticated/reports-studio.tsx` (`fmtBenchVal`).

Period label: `src/lib/budget-pdf.ts`, `src/lib/budget.months.ts`, `src/lib/market/format.ts`, `src/lib/market/date-presets.ts`. Cover length: `src/lib/ratios.ts`.

The leaked comment: `src/reports/cash-forecast.tsx`. Same class outside the 11: `src/components/action-plan.tsx`.

The test that missed it: `scripts/report-section-keep-test.mts`.

## (c) Why `#657` and its test missed it

The predicate is "both sides are exactly 0", not "the variance is zero" and not "the printed money is zero". QA's budget rows are large equal numbers. `varianceIsZeroPair(700000, 700000)` is false, so the dash never runs, and `+$0` / `0.0%` still do.

`illustrativeBudgetPack` (`src/lib/budget-pdf.ts:730-751`) uploads one month of non-zero actuals. Depreciation is the 0/0 cell. Overhead rows with both sides under 1 are dropped (`budget-pdf.ts:561`), so those zeros never reach the page.

`scripts/report-section-keep-test.mts:549-552` checks that one depreciation line: no `n/a`, and no dash followed by `R` or `$`. It does not build an all-zero pack or a mixed pack. It does not search the 11 PDFs for `$0`, `($0)`, `-$0`, `+$0`, `R 0`, `0.0%`, or `//`. Cash-forecast weeks in that render have real receipts and payments, so `($0)` is never on the page. The sparse shape drops empty sections. It does not zero the money. The cells AQA failed (payments, wages, drawings, chart labels, a ~0 delta on a `$700,000` line) are different cells from the depreciation pair the assertion looks at.

## (d) The leaked `// date-ok` string

`src/reports/cash-forecast.tsx:298`:

```tsx
{w.period_label} // date-ok: week row label, not a calendar span
```

In JSX, `//` is a comment only inside `{ ... }`. After the `}` it is a text child, so every week row renders `Week 1 // date-ok: week row label, not a calendar span`. The Week column is narrow, so the sentence wraps onto three lines. Line `:192` is the same mistake on the chart axis (`week axis label`).

The date-ok lint only requires the marker to sit near a date-like string. It does not check that the marker is actually a comment. The keep-with-next test extracts page text and never forbids `//`.

`src/components/action-plan.tsx:2186` has the same text-child comment (`// date-ok: action plan quarter stamp`). It is outside the 11 reports. The comment fix should cover it so it is not a third strike.

## (e) Budget period: report label vs equal dollars

These are two bugs with two owners.

**"Jan 26 – Dec 26" is a report bug (this area).** `comparedLabel` (`src/lib/budget-pdf.ts:636-645`) uses `contiguousLabel` (`:237-242`), which calls `formatMonthLabel` (`src/lib/budget.months.ts:205-206` → `src/lib/market/format.ts:543-548` → `monthColumnLabel` at `src/lib/market/date-presets.ts:69-73`). That helper is specified as `"Oct 26"`. A January–December window therefore prints `Jan 26 – Dec 26 · 12 months`. The four-digit form already exists and is what the page should use: `formatMonthRange` (`date-presets.ts:82-91`) returns `Jan 2026 – Dec 2026`. `budgetWindowLabel` (`budget.months.ts:176-187`) already goes through `formatBudgetMonthYear` (`:150-159`) so the FY caption is not read as a day. The compared span does not call it.

**`$700,000` actual vs `$700,000` budget is the numbers engine (Eng1), and the `0.0%` / `+$0` on top of it is the formatter above.** The PDF does not copy the annual budget into the actual column.

- `periodMonthsOf` (`src/lib/ratios.ts:459-463`) reads stored `periodMonths` and defaults to 12.
- `budgetActualFromFinancials` (`src/lib/budget-pdf.ts:420`) stores that length as `statementCoverMonths`.
- `budgetMonthsForCover` (`budget-pdf.ts:250-252`) returns the whole FY when the cover is 12, including when the statement is dated in September.
- The budget sum is that window. The actual sum is the statement total, not a monthly slice (`budget-pdf.ts:465-472`).
- `scripts/report-period-basis-test.mts:31-43` is the QA US shape: revenue `"700000"`, `periodMonths: "12"`, `periodEnd: "2026-09-30"`. Lines `97-98` assert that budget and actual are both `700000`, and that the note says the variance covers the full budget year. A PDF change that compared one month of this file would fail that test and bring back `$700,000` vs `$58,333` (`700000 / 12`).

A plan seeded from that statement matches line by line, so each compared delta is about 0. Printing that delta as "In line +$0" and `0.0%` is the formatter in (a). The equal dollars are the stored 12-month cover plus the seed.

A line shows `$700,000` only when that line's own sums are `$700,000`. For this fixture that is revenue, and the single revenue driver (`report-period-basis-test.mts:231-232`, `:244-245`). COGS, operating expenses, and profit keep their own totals (`280000`, `351000`, `60000` in the same fixture, `:209-215`). This note did not re-read Ben's live row. If a non-revenue line on that PDF is also `$700,000`, the number is what was stored for that line.

## (f) The single fix to build after this note is confirmed

One shared zero-aware money, variance, and percent formatter, called from every site in (a), including the waterfall chart labels.

- A money value that rounds to 0 prints `—`. Never `$0`, `($0)`, `-$0`, `+$0`, or `R 0`.
- A variance whose rounded amount is 0 prints `—` for the tag, the amount, and the percent. No "In line" next to a zero. A zero ratio or a zero variance prints `—`, never `0.0%`.
- A non-zero payment keeps its parentheses. A non-zero signed variance keeps `+` or `-`.
- `fmtRand(1)` in "GP per $1 of wages" stays `$1` / `R 1`, because the input is 1, not 0.
- A headcount of 0 stays `0`. It is not money.
- A zero-variance KPI does not set `direction`, so the flat rule in `glyphs.tsx:24-28` is not drawn beside the figure.
- The compared span uses `formatMonthRange`, so January through December 2026 reads `Jan 2026 – Dec 2026`.
- The `// date-ok` text at `cash-forecast.tsx:192` and `:298`, and at `action-plan.tsx:2186`, moves into a real comment.

## (g) Verification, once that fix exists

A CI test renders all 11 reports and reads each page with the same text extract the keep-with-next test uses (pdftotext / unpdf). Three data shapes: normal, all-zero money, and mixed (some zeros, some real amounts).

Fail if the rendered text contains `$0`, `($0)`, `-$0`, `+$0`, `R 0`, `0.0%`, or `//`.

Stray dash on the KPI tiles: fail if a tile's text is a money figure followed by a hyphen, en dash, or em dash (`$700,000 –`). A lone `—` is the correct zero and must pass. Also assert the zero-variance figure is built with no `direction`, because the flat mark is a drawn rule and a text extract can miss it.

Also assert the FY 2026 compared span is `Jan 2026 – Dec 2026`, and that a cash-forecast week row reads `Week 1` with no `date-ok`.

Do not fail a bare employee `0`, or the unit `$1` / `R 1`.

No code until this note is confirmed. Do not merge. Do not deploy.
