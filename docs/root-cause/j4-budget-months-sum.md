# J4 month totals disagree with the year

AQA gate 2026-11-18 on `468e2bea` (#971). J4 fails on both regions. ZA Budget, monthly revenue table, totals about R2.88m against a year of R1.215m. US monthly operating-profit actuals show $0 against a year of $52k. The chart bars were brought back to the year in #966. The table was never on that path. No code in this note. The Waterfall DRAFT watermark stays with Eng2.

Chill Pepper `79c4c485` is the ZA shape already measured in `docs/root-cause/j4-budget-sum-regression.md`: stored Mar–Oct book months sum to R2,880,836, and the statement year is R1,215,000. The US year of $52,000 is the January–September operating profit on the 1020E statement (revenue $412,000), the same pair `scripts/budget-chart-table-test.mts` already uses for the header.

## Cause

Two readers, one year.

The year tiles are `budgetStatementDisplayTotals` (`src/lib/budget-chart-table.ts`). A firm-year slice with a real revenue or operating profit wins, so the tiles stay on the statement: R1,215,000 and, for the US fixture, $52,000.

The chart’s Actual bars go through `chartRevenueActuals` in that same file. Stored months that already sum to the year stay as stored. Any other stored series is scaled with `scaleMoney` so the bars add up to `yearRevenue`. `BudgetMonthChart` (`src/components/budget/budget-chart-table.tsx`) calls it with `yearRevenue={totals.revenue}` and `storedMonths={loaded.length > 0}`. On Chill Pepper that scales R2,880,836 down to R1,215,000 and sets the caption to `CHART_ACTUALS_SCALED` (“Actual bars are scaled to the period revenue.”).

The table does not call that function. `BudgetMonthTable` builds rows with `budgetTableRows` and puts the row total in `budgetPeriodTotalCell`. Both read `row.actual` off `budgetMonthViews`. Those views are the stored `budget_month_actuals` rows when any exist, and otherwise `statementPaceBudgetMonths`. The Revenue total is the sum of `actual.revenue`. The Operating profit total is the sum of `actual.ebit`. Nothing scales either sum onto the year tile.

So the ZA table still adds the raw book months (R2,880,836) while the chart and the year tile show R1,215,000. That is the #962 miss, still open on the table. It is not a chart regression after #966: `scaleMoney` is present on `468e2bea`.

The US operating-profit cells are zero because the month object exists and its `ebit` is 0. `statementMonthActuals` (`src/lib/budget.bridges.ts`) builds one month from the annualised statement and returns revenue, cost of sales, and operating expenses. It reads `periodProfitBridge` and does not put `bridge.ebit` on the result. `statementPaceBudgetMonths` copies those three fields into `normalizeTaxonomyTotals`. `EMPTY_TOTALS.ebit` is 0 (`src/lib/budget.variance.ts`), and `normalizeTaxonomyTotals` keeps a missing `ebit` at 0. It does not derive operating profit from gross profit minus overheads. `budgetTableRows` then treats any present month as an actual, so 0 is printed, and `budgetPeriodTotalCell` adds the zeros. The year tile still shows the slice’s $52,000. A stored month row whose `totals` omit `ebit` takes the same zero through `mapRow` → `normalizeTaxonomyTotals`.

## Files

ZA revenue table:

- `src/lib/budget-chart-table.ts` — `budgetMonthViews` attaches the raw month. `budgetTableRows` (`across`, id `revenue`) writes `totals.revenue` into each Actual cell. `budgetPeriodTotalCell` sums those cells into the Total column.
- `src/components/budget/budget-chart-table.tsx` — `BudgetMonthTable` renders that grid. The footer “Period total” uses the year tiles (`totals`), so the footer can say R1,215,000 while the Revenue row’s own Total says R2.88m.
- `src/lib/budget-chart-table.ts` — `chartRevenueActuals` and `scaleMoney` are the chart-only guard. `BudgetMonthChart` is the only caller.

US operating-profit actuals:

- `src/lib/budget.bridges.ts` — `statementMonthActuals` drops `bridge.ebit`.
- `src/lib/budget-chart-table.ts` — `statementPaceBudgetMonths` stores revenue, cost of sales, and overheads, and leaves `ebit` unset.
- `src/lib/budget.variance.ts` — `normalizeTaxonomyTotals` fills the gap with 0. `listBudgetMonthActuals` (`src/lib/budget-actuals.functions.ts`) runs the same normaliser on every stored row.
- `src/lib/budget-chart-table.ts` — `budgetTableRows` id `profit` reads `totals.ebit`. `budgetPeriodTotalCell` sums it.
- `src/lib/budget-chart-table.ts` — `budgetStatementDisplayTotals` is what puts $52,000 on the year tile, from `budgetHeaderFromSlice`.

## Why the #962 sum guard missed the table and the US

#962 (`199c0414`, merged as `8e5a3e37`) added `chartRevenueActuals` so the bars follow the year revenue. The assertion in `scripts/budget-chart-table-test.mts` called it with `storedMonths: false` and eight synthetic months. That is the even-split branch. It never built a table row.

#964 (`cc09f089`, merged as `cc8bc528`) stopped scaling and showed the raw book months on the chart. `docs/root-cause/j4-budget-sum-regression.md` records that fail: bars R2,880,836, header R1,215,000. #966 (`361f7985`, merged as `0c37f532`) put `scaleMoney` back. The test that locks the fix calls `chartRevenueActuals` on `budgetMonthViews` of the book months and checks the bar sum against `header.revenue`. It does not call `budgetTableRows` or `budgetPeriodTotalCell`.

The US check in the same file only asserts `budgetStatementDisplayTotals(...).operatingProfit === 52_000`. That is the year tile. It never builds pace months, never reads `actual.ebit`, and never sums a table row. `chartRevenueActuals` is revenue-only, so a green chart sum says nothing about operating profit.

## What changed, and what did not regress

| Commit | PR | What it did to this gap |
| --- | --- | --- |
| `49cedef7` | #387 | Table Actual cells and the row total read `row.actual` directly. Still the table path on `468e2bea`. |
| `73e0e958` | #278 | `statementMonthActuals` returns revenue and costs, not operating profit. |
| `af8da00f1` | #897 | The month helper takes cost of sales and operating expenses from the bridge, and still omits `ebit`. |
| `d54a0cd0` | #899 | Empty month-actuals fall back to `statementPaceBudgetMonths`, which copies those three fields and leaves `ebit` at 0. |
| `199c0414` | #962 | Chart bars scale to the year. The table is untouched. |
| `cc09f089` | #964 | Chart stops scaling. This is the chart-only regression, already written up. |
| `361f7985` | #966 | Chart scales again. `git grep scaleMoney origin/main` still hits `chartRevenueActuals` only. |

No later commit on `main` at `468e2bea` removes `scaleMoney` or points the table at `chartRevenueActuals`. The ZA table figure is the original raw sum. The US $0 is the pace fallback from #899, not a revert of #966.

## J3, borderline over 3s

Both regions sit just over 3s, which points at the shared mount rather than a ZA-only hop. `docs/root-cause/j3-mount-time.md` timed `warmMs` (`client-warm-line` in the standby) at about 3.6–4.1s after #949, in front of the boot select. #954 (`4b08bd2b`) already paints a client file from this user’s unexpired stored session before `getSession` and before the entitlement call (`earlyClientFileOpen` in `src/lib/early-client-file.ts`, used by `src/routes/_authenticated.gate.tsx`). The cash line still has its own user and firm check. What remains in front of that paint is the blocking app stylesheet, the entry chunk, and the stored-session read. That is a few hundred milliseconds once the session is warm, which matches a miss that is only just over 3s on both regions.

A further cut is cheap if it stays on that paint: load the Google Fonts sheet the way the landing page loads app CSS (`media=print`), or keep one more home import off the first commit. Another entitlement redesign is not what this miss is waiting on. #954 already opened the file before Stripe. No SQL.

## Proposed fix

Not built here.

One helper, used by the chart and the table, that takes a month series and the year figure the header already shows:

- a series that already sums to the year stays as stored
- a series with a real sum that does not match is scaled onto the year, same rounding as `scaleMoney`
- a missing series stays blank when the year figure is blank
- operating profit uses the same rule against the year operating profit, so a pace month cannot publish 0 when the statement has $52,000

`chartRevenueActuals` and `budgetPeriodTotalCell` / `budgetTableRows` both call it. The year tiles stay `budgetStatementDisplayTotals`.

Tests, in `scripts/budget-chart-table-test.mts` (`pnpm test:budget-chart-table`):

- Chill Pepper stored Mar–Oct months: the Revenue row total equals the header R1,215,000, and the chart sum still equals that header.
- US January–September statement, operating profit $52,000, no stored `ebit`: the Operating profit row total equals $52,000, and a month is not painted as $0 while that year figure is present.

## Verification

Before the helper exists, on `468e2bea`:

`pnpm test:budget-chart-table` passes, and a throwaway sum of `budgetTableRows` on the same `bookViews` already used for the chart assertion is R2,880,836 while `chartRevenueActuals` on those views is R1,215,000. `statementPaceBudgetMonths` on the US slice’s annualised inputs yields `ebit === 0` on every month while `budgetStatementDisplayTotals` for that slice returns 52,000.

After the helper, the same script fails if either the chart or the table drifts off the year, including the US operating-profit fixture.
