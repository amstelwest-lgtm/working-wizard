# 13-week forecast stays on "Not enough data" after monthly actuals are imported

Client AQA J2 US 1020E (US) has about nine months of P&L actuals imported (January–September 2026). Budget builds a plan from that period. The 13-week cash forecast stayed on "Not enough data" until someone typed a line. The balance sheet for that client was not on file, so there was no opening cash either.

## Cause

Two gates refused the same actuals Budget already reads. Either one is enough to keep the chart and the PDF empty.

1. Missing opening cash returned an empty series before the P&L was read. On `ef4dcd63` (main before this change) `resolveThirteenWeekForecast` did this at `src/lib/client-metrics.ts:1495`:

```ts
if (!resolvedOpening.onFile) return missingCashForecast(anchor, weeks);
```

`missingCashForecast` (`src/lib/client-metrics.ts:1463`) is thirteen zeros, `cashOnFile: false`, and no lines. A P&L is not a cash balance (`resolveForecastOpening`, same file), so nine months of revenue never reached the forecast when `financials.cash` and the bank opening were blank. That is the 1020E file: the P&L imported, the balance sheet did not.

2. When an opening was on file, the engine still did not publish a forecast. It built a hidden sketch: `source: "derived"`, `estimateLabel` `PL_ESTIMATE_LABEL` (`src/lib/client-metrics.ts:853`), line ids `derived-collections` and `derived-operating` (`derivedLines`, `src/lib/client-metrics.ts:1388`), and amounts landed only on the monthly cadence weeks (`landMonthlyRunRate`, `src/lib/client-metrics.ts:1380`). The cash tab and the PDF both require an entered line:

- `forecastWeeksAreEntered` (`src/lib/cash-forecast-parity.ts:49-57`) was `source === "stored" && !estimateLabel`. A derived sketch failed it, so `cashForecastWeeksFromOutlook` returned null.
- `forecastLineIsDerived` (`src/lib/cash-forecast-parity.ts:59-66`) drops `derived-*` ids and the monthly collection / operating-payment names. `forecastLinesBlank` then says there is nothing to chart.
- The cash tab throws that sketch away on hydrate when `replaceStored && !enteredForecast` (`src/components/cash-forecast.tsx:1074`).
- The preview copy is `FORECAST_PREVIEW_EMPTY` (`src/lib/report-preview.ts:2`): "Not enough data. The 13-week chart appears once a forecast line is entered." The same sentence is the cash-tab empty state (`src/components/cash-forecast.tsx:2364`).

Budget does not use either gate. `seedBudgetFromFinancials` (`src/lib/budget.bridges.ts:354`) annualises the statement with `annualiseBudgetFinancials` and reads the month count from `statementCoverMonthCount` (`src/lib/statement-cover.ts:198`, re-exported from `budget.bridges.ts`). Unknown cover is null, not twelve months. `periodMonthsOf` (`src/lib/ratios.ts:461-464`) is the other reader, and a missing length there becomes 12. The forecast was using that default only inside the hidden sketch, and only after an opening existed. It never treated "months on file, no typed line" as a forecast.

## What changed

`weeklyBaselineFromActuals` (`src/lib/client-metrics.ts:198`) uses Budget's cover reader and the same annualise step, then divides by 52. That is the monthly average spread evenly across every week. A missing revenue or cost line stays null. A stored zero stays zero. The reader lives in `src/lib/statement-cover.ts` so the forecast does not import `budget.bridges.ts` (that module pulls in browser code, which fails the ask-ai Deno check).

`resolveThirteenWeekForecast` (`src/lib/client-metrics.ts:1673`) no longer returns the empty series first. A typed line still wins. Otherwise a known month cover seeds receipts and payments (`seededForecast`, `src/lib/client-metrics.ts:1599`) with the label "Seeded from actuals. Monthly totals are spread evenly across each week." Opening cash is the balance sheet or bank balance when one is on file. When it is missing, the weeks still publish, closings stay unset, and the note is "Opening cash unknown". No number is invented for that opening. `forecastWeeksAreEntered` publishes the seeded series (`src/lib/cash-forecast-parity.ts:55`). The old lumpy sketch remains only when the month cover itself is unknown, so zero months still shows "Not enough data".

Owner and accountant both render `CashForecastPanel`. That panel reads `resolveCashScreenForecast`, which calls this engine. One series, both sides.

## Lowest point said $46.3k was under a $36,923 floor

On prod `5f8e3725` the same client showed a lowest point of `$46.3k — Opening · $3.7k under the floor`, a floor of `$36,923`, the banner `Nothing is forecast yet… stay at $0`, and weeks-below-floor `—`. `$46.3k` is about `$9.4k` above `$36,923`. The `$3.7k` is `$50,000 − $46,300`.

The series was empty, so every closing stayed equal to the opening (`computeScenario` in `src/components/cash-forecast.tsx`, the `bal += net[i]` loop with a zero net). `lowestCashPoint` (`src/lib/cash-forecast-view.ts`) keeps the first minimum, which is that opening. `cashEmptyPresentation` (`src/lib/cash-forecast-parity.ts`, before this section) set `lowestBlank` only when the opening was zero (`linesBlank && !hasOpening`), so a real opening still ran the floor sentence.

That sentence used `forecastMinimumCash` (`src/lib/client-metrics.ts`). With no weekly outflows and no confirmed floor it returns `CASH_RUNWAY_THRESHOLD_USD` (`src/lib/cash-runway.ts:10`), `$50,000`. The tile then did `minimumCash - lowestBal` and, because `$46.3k < $50,000`, wrote "under". The `$36,923` floor is four weeks of this client's operating outflows (the figure the suggestion card reads from the statement). The empty series never passed those outflows in, so the delta used the fallback instead of the series floor. The sign was not flipped against `$36,923`. It was the gap to a different number.

Weeks-below-floor did not use that comparison. `weeksBelowFloorCopy` returns `—` as soon as `forecastEmpty` is true (`src/lib/cash-forecast-view.ts`). The banner said the figures stay at `$0` (`CashForecastPanel`, the "Nothing is forecast yet" notice).

`forecastScreenTiles` (`src/lib/cash-forecast-view.ts:134`) now reads one opening, one closing list, and one floor. The gap is `lowest − floor`: negative is "under", otherwise "above". Weeks-below uses `forecastFloorPosition` on those same three inputs. An empty series returns "Not enough data" for both tiles and does not format a balance or a floor. A missing opening stays "Opening cash unknown". The empty banner is `FORECAST_PREVIEW_EMPTY`, which does not claim `$0`.

With the actuals seed, 1020E has weekly lines, so the tiles use that series. The floor is four weeks of those payments (`seriesTotals` / `forecastMinimumCash` on the same outflows), and the lowest point is the minimum of that series. Owner and accountant both render `CashForecastPanel`, so both tiles call this helper.
