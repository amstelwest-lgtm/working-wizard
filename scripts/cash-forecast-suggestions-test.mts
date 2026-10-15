/**
 * Cash suggestions come from the statement, snapshots, or the forecast.
 * Run: pnpm test:cash-forecast-suggestions
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CashSuggestionCard } from "../src/components/cash-suggestion-card";
import { periodProfitBridge } from "../src/lib/period-profit";
import { forecastMinimumCash } from "../src/lib/client-metrics";
import {
  floorFromWeeklyOutflows,
  ledgerFromOpeningSource,
  statementFixedCostTotal,
  suggestCashForecast,
  suggestionsMatchConfirm,
} from "../src/lib/cash-forecast-suggestions";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const statement = { revenue: 420000, cogs: 80000, fixedCosts: 140000, periodMonths: 2, periodEnd: "2026-09-30" };
assert(
  statementFixedCostTotal(statement) === periodProfitBridge(statement).operatingExpenses,
  "the fixed-cost total matches Profit",
);
assert(statementFixedCostTotal({ revenue: 100 }) === null, "no fixed costs and no ebit is empty");
assert(
  statementFixedCostTotal({ fixedCosts: 140000, periodEnd: "2026-09-30" }) === 140000,
  "a statement total does not need a period length",
);

const missingMonths = suggestCashForecast({
  ledger: "QuickBooks",
  openingCash: 186000,
  currentFinancials: { fixedCosts: 140000, cash: 186000, periodEnd: "2026-09-30" },
  currentPeriodEnd: "2026-09-30",
  trailing: [],
  forecastHasMovement: false,
});
assert(
  missingMonths.suggestions.every((row) => row.key !== "fixed"),
  "a missing period length does not invent a monthly fixed cost",
);
assert(
  missingMonths.steps[1]?.amount === null && missingMonths.steps[1]?.note.includes("Period length"),
  "step 2 says the monthly figure is not on file",
);
assert(missingMonths.suggestions.find((row) => row.key === "opening")?.source === "QuickBooks", "opening uses the ledger");
assert(missingMonths.suggestions.every((row) => row.amount !== 50000), "the fallback floor is not suggested");

const weeks = new Array(13).fill(12500);
assert(floorFromWeeklyOutflows(weeks) === forecastMinimumCash({ weeklyOutflows: weeks }), "the floor matches the chart");
assert(floorFromWeeklyOutflows(weeks) === 50000, "a real floor of 50,000 is kept");
assert(floorFromWeeklyOutflows([0, 0, 0]) === null, "zero outflows do not become the fallback floor");

const month = (periodDate: string, fixed: number) => ({
  periodDate,
  financials: { fixedCosts: fixed, periodMonths: 1, operatingExpenses: fixed },
});
const trailing = suggestCashForecast({
  ledger: "Xero",
  openingCash: 1000,
  currentFinancials: { fixedCosts: 300, periodMonths: 1, periodEnd: "2026-09-30" },
  currentPeriodEnd: "2026-09-30",
  trailing: [month("2026-08-31", 200), month("2026-07-31", 100), month("2026-09-30", 300)],
  forecastHasMovement: false,
});
const fixed = trailing.suggestions.find((row) => row.key === "fixed");
assert(fixed?.source === "Trailing 3 months", "three distinct months are labelled trailing");
assert(fixed?.amount === 200, "the trailing figure is the average, not a new number");
assert(trailing.steps[0]?.amount === 300, "step 1 is this period's statement total");
assert(trailing.steps[2]?.amount === 200, "step 3 places the monthly amount when the forecast is empty");

const two = suggestCashForecast({
  ledger: "On file",
  openingCash: null,
  currentFinancials: { fixedCosts: 300, periodMonths: 1, periodEnd: "2026-09-30" },
  currentPeriodEnd: "2026-09-30",
  trailing: [month("2026-08-31", 200)],
  forecastHasMovement: false,
});
assert(two.suggestions.find((row) => row.key === "fixed")?.source === "On file", "two months stay on this period");

const moved = suggestCashForecast({
  ledger: "On file",
  openingCash: 186000,
  currentFinancials: statement,
  currentPeriodEnd: "2026-09-30",
  trailing: [],
  forecastWeeklyOutflows: [1000, 1000, 1000],
  forecastHasMovement: true,
});
assert(moved.fixedAlreadyInForecast, "movement means the fixed costs are already in the forecast");
assert(moved.steps[2]?.amount === null && moved.steps[2]?.note.includes("Already inside"), "step 3 does not add them again");
assert(
  moved.suggestions.find((row) => row.key === "floor")?.amount === forecastMinimumCash({ weeklyOutflows: [1000, 1000, 1000] }),
  "a forecast with payments uses those weeks for the floor",
);

assert(ledgerFromOpeningSource("qbo") === "QuickBooks", "qbo is QuickBooks");
assert(ledgerFromOpeningSource("xero") === "Xero", "xero is Xero");
assert(ledgerFromOpeningSource("upload") === "On file", "anything else is on file");

const confirmed = suggestionsMatchConfirm(moved.suggestions, {
  opening: 186000,
  floor: moved.suggestions.find((row) => row.key === "floor")!.amount,
  fixedMonthly: moved.suggestions.find((row) => row.key === "fixed")!.amount,
  at: "2026-10-15T00:00:00.000Z",
});
assert(confirmed, "confirm matches the suggested amounts");

const markup = renderToStaticMarkup(
  createElement(CashSuggestionCard, {
    model: missingMonths,
    confirmed: false,
    formatAmount: (amount) => `R ${amount}`,
    canConfirm: true,
    onConfirm: () => {},
  }),
);
assert(markup.includes("suggested – confirm"), "the card asks for confirmation");
assert(markup.includes("Confirm all"), "one button confirms every suggestion");
assert(!markup.includes("supabase"), "the card does not post anywhere");
const cardSource = readFileSync("src/components/cash-suggestion-card.tsx", "utf8");
assert(cardSource.includes("{step.n}. {step.label}"), "the drawer numbers the steps");
assert(cardSource.includes("Confirm all"), "confirm is one button");

console.log("cash-forecast-suggestions ok");
