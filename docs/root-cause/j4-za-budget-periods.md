# J4 ZA Budget cards quote three different periods

AQA gate FAIL on prod `5f8e3725`, firm 1020F, client "AQA J2 ZA 1020F", Budget tab.

The This year card (Mar–Sep 2026, prorated) showed revenue R 320 444 and operating profit R 40 460. On the same page, This year vs last year showed revenue R 412 000, and the profit waterfall showed operating profit R 52 000. The Month engine printed `R 45777.78`.

ZA fiscal year starts in March. US firm 1020E uses the calendar year.

## Which figure is which

The statement on file is nine months, 1 Jan 2026 – 30 Sep 2026: revenue 412 000, operating profit 52 000. A March firm year that contains September 2026 runs Mar 2026 – Feb 2027, so the overlap is Mar–Sep (7 of the 9 months).

| Card | What it read on `5f8e3725` | Period | Basis |
| --- | --- | --- | --- |
| This year | Seeded plan summed over the firm-year window | Mar–Sep 2026, prorated | Fiscal YTD of the plan, not the statement |
| This year vs last year | `actuals.revenue` from the full profit bridge | Jan–Sep 2026 | Raw statement total |
| Waterfall operating profit | `periodProfitBridge` on the raw statement | Jan–Sep 2026 | Raw statement total |
| Month engine price | Currency symbol plus the unformatted cell | One month | Annualised monthly price, 2 decimals |

412 000 × 7/9 is 320 444.44, which prints as R 320 444. That is why the This year revenue already matched a straight March-year clip. 52 000 × 7/9 is 40 444.44, which prints as R 40 444. The card's R 40 460 is not that clip. It is the seeded plan: flow lines are annualised by 12/cover, gross margin is rounded, and the seven window months are summed (`src/lib/budget.bridges.ts:1326-1341`). The straight statement clip is the figure the three cards should share. The plan sum stays on the chart, where it is the budget being built.

A US calendar year contains January–September, so the overlap is the whole statement (412 000 and 52 000). A March clip must not be applied there.

The correct period is the firm-year overlap of the statement. Scale each present flow line by overlap ÷ statement months. Scale is 1 when the statement already sits inside the firm year, and when the statement has a stored cover but no dates. A missing line stays null.

## Cause

Three readers, one statement.

1. `budgetVersusStatement` keeps actuals as the full `periodProfitBridge` (`src/lib/budget.bridges.ts:1290-1297`) and puts the plan window sum on `budgetRevenue` / `budgetEbit` (`src/lib/budget.bridges.ts:1326-1341`). The This year card printed those plan sums.
2. `ownerYearFromStatement` reads `actuals.revenue`, which is that full bridge (`src/lib/budget-year-compare.ts:135-152`). This year vs last year therefore showed R 412 000.
3. `derivePeriodWaterfallFallback` sends the raw statement through `periodProfitBridge` (`src/lib/weekly-inputs.ts:115-117`). The waterfall draws operating profit as revenue − COGS − overheads − depreciation (`src/components/profitability-waterfall.tsx:889-891`), which equals the stated EBIT when the lines reconcile. That was R 52 000.

The Month engine drew the currency symbol next to `cell.price` (45 777.78, the annualised monthly price kept at two decimals). The rest of the page uses `formatMoney` via `fmtBudgetMoney` (`src/lib/budget.compute.ts:312-314`), which prints whole rands and a space thousands separator.

`budgetVersusStatement`'s `revenue` and `budgetEbit` are unchanged. Existing tests still expect the full statement actual and the plan window sum. The page now attaches a separate slice and the cards read that.

## Fix

`fiscalStatementSlice` (`src/lib/budget-period.ts:77-143`) is the overlap. `BudgetPanel` attaches it for both portals (`src/components/budget/budget-panel.tsx:458-470`).

- This year, simple and complex, uses `budgetHeadlineFigures` (`src/components/budget/budget-simple-view.tsx:262-280`, `src/components/budget/budget-workspace.tsx:414-431`).
- This year vs last year uses `yearMoneyFromFiscalSlice` when the slice is present (`src/components/budget/budget-simple-view.tsx:266-271`) and prints the same period caption.
- The owner waterfall (`src/routes/app.tsx:3681-3690`, drawn at 4885, 4910, 6424) and the accountant waterfall (`src/routes/_authenticated/clients.$clientId.tsx:2326-2329`, drawn at 5120) use `fiscalWaterfallFallback`, which scales the statement before the shared bridge. Both cards say `Mar 2026 – Sep 2026, prorated` (or `Jan 2026 – Sep 2026, prorated` for a calendar year).

The Month engine read-only price is `money(cell.price)` (`src/components/budget/budget-simple-view.tsx:452-453`). The editable price uses `MoneyField`, which calls `formatMoney`. 45 777.78 prints as `R 45 778`.

## Why #680, #721, and #690 missed it

- #680 ("One live health snapshot for agent narratives") made agent copy read one health snapshot. It does not choose a budget period.
- #721 ("Show stale health copy only when the cited scores differ") gates stale health sentences and the period pill. It does not change which total the Budget cards add up.
- #690 ("Quote one net profit on Budget, year-over-year, Profit, and Analyst") separated operating profit from net profit on a US full-year fixture (1 Jan – 31 Dec, `periodMonths` 12). On that fixture the firm-year window is the whole statement, so the three bases agree. It never compared a March year with a statement that opens in January. US 1020E looks like 1020F (412 000 / 52 000, Jan–Sep) because a calendar year contains the whole statement. The bug only shows up when the firm year starts later than the statement.

## Verification

`pnpm test:budget-za-period` covers:

- ZA March year, January–September statement: all three figures are 412 000 × 7/9 and 52 000 × 7/9, labelled Mar–Sep 2026, prorated. The year strip is not 412 000. The waterfall is not 52 000. The card is the straight slice, not the seeded plan sum.
- ZA March year, March–September statement: all three are the statement's own 320 444 and 40 460. Scale is 1.
- US calendar year, January–September statement: all three are 412 000 and 52 000, labelled Jan–Sep, not March, and not annualised.
- An undated stored cover is not clipped to March. Missing revenue, COGS, operating profit, and net profit stay null.
- `fmtBudgetMoney(45777.78, ZA)` is `R 45 778`.

## Eng2 follow-up

None of `missing-metrics.ts`, `health-metric-row.ts`, `stripe-entitlement.ts`, `firm-client-cap*.ts`, or `_authenticated.gate.tsx` needed a change.

`profitability-waterfall.tsx` still draws operating profit as gross − overheads − depreciation. When the statement has EBIT, the bridge makes that step equal the stated EBIT, so the scaled fallback matches the cards. When EBIT is blank, the slice returns null and the chart can still draw a derived step. That component was left as it is.

## Edges

No edge function imports `budget-period.ts`. These still quote the unclipped statement through `period-profit.ts` and were not edited:

- `supabase/functions/ask-ai/deliverable-summaries.ts` (`periodProfitBridge`)
- `supabase/functions/ask-ai/overview-brief.ts` (`statementNetProfit`)
- `supabase/functions/milon-bot/` quotes that overview brief

`brain-propose` and `brain-deliverable-draft` do not import the budget period engine.

`ask-ai` already type-checks `budget.types` through `deliverable-input-config`. The slice type lives in `src/lib/budget-period-types.ts` so that path does not load `budget-period.ts`, `budget.months`, or the market barrel (`zod`).

## Other side?

Both sides of the Budget cards and the waterfall. Owner and accountant share `BudgetPanel`. The owner waterfall is `src/routes/app.tsx`. The accountant waterfall is `src/routes/_authenticated/clients.$clientId.tsx`. Both call `fiscalWaterfallFallback`.

Other side: N/A — the tax-specialist owner door and home do not draw these cards. The owner waterfall is `app.tsx`, updated with the accountant client route.
