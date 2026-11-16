# J4 budget bars no longer sum to the year

AQA retest of `#964` at `cc8bc528`, Chill Pepper `79c4c485`. Budget → This year, monthly Actual bars are about R345k–R401k. Mar–Oct sums to R2,880,836. The year header is R1,215,000. At `#963` (`4940fee2`) the same bars summed to R1,214,998. The header still says the statement year, and the chart now adds “Monthly split from your books; year total from your statements.”

## Cause

`#963` drew Actual bars from the same year revenue as the header. `BudgetMonthChart` passes `yearRevenue={totals.revenue}`, and `totals` is `budgetStatementDisplayTotals`. `chartRevenueActuals` kept stored months that already summed to that year. Any other stored series was scaled onto it (`scaleMoney`), so the bars added up to the header.

`#964` commit `cc09f089` (“Keep stored monthly actuals when they do not match the year”) deleted `scaleMoney`. The same call now returns the raw book months whenever `storedMonths` is true, and sets the caption to `CHART_ACTUALS_BOOKS_SPLIT` when the sum differs from the year. Chill Pepper’s stored Mar–Oct months are the book split (R2,880,836). The header stays the statement year (R1,215,000). The bars and the header no longer share a total.

The YTD caption change in the same PR is separate. `budgetChartPeriodCaption` still builds the range from months that have an actual (`YTD Mar–Oct 2026`). This note does not undo that.

## Files

- `src/lib/budget-chart-table.ts` — `chartRevenueActuals` stopped scaling. `budgetStatementDisplayTotals` itself did not change.
- `src/components/budget/budget-chart-table.tsx` — `BudgetMonthChart` still calls `chartRevenueActuals({ views, yearRevenue, storedMonths })` with `yearRevenue={totals.revenue}` and `storedMonths={loaded.length > 0}`. The call did not move. The function behind it did.
- `scripts/budget-chart-table-test.mts` — the sum check did not use that call.

## Why the #962 sum test did not catch it

The Chill Pepper assertion called `chartRevenueActuals` with `storedMonths: false` and eight synthetic R405,000 months. That is the even-split branch, which always totals the year. It never built `budgetMonthViews` from stored book months, never took `yearRevenue` from `budgetStatementDisplayTotals`, and never passed `storedMonths: true`. That is the path the chart uses once `loaded.length > 0`. A later assertion then required a R400,000 / R400,000 mismatch to stay raw and to show the books-split note, so the regression was locked in.

## Verification

On `cc8bc528`, before this revert, the real-path test was:

`chart bars sum 2880836 against header 1215000`

Checked by running `pnpm exec vite-node --config scripts/vite-test.config.ts scripts/budget-chart-table-test.mts` against that commit’s `chartRevenueActuals`, with the new assertion already in the test and the function still on the `#964` body.

After restoring `scaleMoney`, the same test passes. Stored Mar–Oct months are scaled onto the header R1,215,000, the books-split note is not used, and the caption stays `YTD Mar–Oct 2026`. Months that already sum to the year are still left as stored, with no note.
