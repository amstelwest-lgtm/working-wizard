/**
 * 13-week forecast seeds from the same actuals Budget uses.
 * A client with imported months and no manual lines gets a forecast.
 * Run: pnpm test:forecast-13w-seed
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { OPENING_CASH_UNKNOWN, SEEDED_FROM_ACTUALS_LABEL } from "../src/lib/budget.bridges.ts";
import { cashForecastWeeksFromOutlook } from "../src/lib/cash-forecast-parity.ts";
import {
  resolveCashScreenForecast,
  resolveThirteenWeekForecast,
} from "../src/lib/client-metrics.ts";
import { FORECAST_PREVIEW_EMPTY, forecastPreviewGap } from "../src/lib/report-preview.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const monday = new Date(2026, 9, 5);
const nineMonths = {
  revenue: 412000,
  cogs: 171000,
  fixedCosts: 90000,
  periodMonths: 9,
};

const seeded = resolveCashScreenForecast({
  financials: nineMonths,
  cashflow: { revenue: [], expenses: [] },
  now: monday,
});
assert(seeded.seededFromActuals === true, "nine months of actuals seed a baseline");
assert(seeded.estimateLabel === SEEDED_FROM_ACTUALS_LABEL, seeded.estimateLabel ?? "missing label");
assert(seeded.openingCash === null, "no balance sheet does not become opening 0");
assert(seeded.openingNote === OPENING_CASH_UNKNOWN, seeded.openingNote ?? "missing opening note");
assert(seeded.floor === 0, `a missing opening does not mint a floor (${seeded.floor})`);
assert(seeded.dipsBelowFloorWeek == null, "a missing opening does not dip");
assert(seeded.cashOnFile === false, "cash stays off file");
const weeks = cashForecastWeeksFromOutlook(seeded);
assert(weeks != null && weeks.length === 13, "the 13-week forecast is not empty");
const receipt = weeks[0]?.total_receipts;
const payment = weeks[0]?.total_payments;
assert(receipt != null && receipt > 0, `receipts were not seeded (${receipt})`);
assert(payment != null && payment > 0, `payments were not seeded (${payment})`);
assert(
  weeks.every((week) => week.total_receipts === receipt && week.total_payments === payment),
  "monthly actuals are spread evenly across each week",
);
assert(
  weeks.every((week) => week.opening_balance == null && week.closing_balance == null),
  "a missing opening is not printed as 0",
);
assert(weeks.seedLabel === SEEDED_FROM_ACTUALS_LABEL, weeks.seedLabel ?? "missing seed label");

const withCash = resolveCashScreenForecast({
  financials: { ...nineMonths, cash: 25000 },
  cashflow: null,
  now: monday,
});
assert(withCash.openingCash === 25000, `balance-sheet cash was dropped (${withCash.openingCash})`);
assert(withCash.openingNote == null, "a known opening does not say it is unknown");
const cashWeeks = cashForecastWeeksFromOutlook(withCash);
assert(
  cashWeeks != null && cashWeeks[0]?.opening_balance === 25000,
  "week 1 opens on the balance sheet",
);
assert(
  cashWeeks.every((week) => week.closing_balance != null),
  "closings roll once opening cash is on file",
);

const revenueOnly = resolveThirteenWeekForecast({
  financials: { revenue: 90000, periodMonths: 9 },
  openingCash: null,
  now: monday,
});
assert(revenueOnly.receiptsWeekly != null && revenueOnly.receiptsWeekly > 0, "revenue still seeds");
assert(revenueOnly.paymentsWeekly === null, "missing costs stay null");
const revenueWeeks = cashForecastWeeksFromOutlook(revenueOnly);
assert(revenueWeeks != null && revenueWeeks.length === 13, "revenue-only actuals still forecast");
assert(
  revenueWeeks.every((week) => week.total_payments == null && week.total_payments !== 0),
  "missing payments are not coerced to 0",
);
assert(
  revenueWeeks.every((week) => week.total_receipts != null && week.closing_balance == null),
  "one missing side does not invent a closing",
);

const manual = resolveThirteenWeekForecast({
  financials: { ...nineMonths, cash: 25000 },
  openingCash: 25000,
  now: monday,
  cashflow: {
    startDate: "2026-10-05",
    openingBalance: "25000",
    revenue: [
      { id: "manual", name: "Invoice", amount: "100", frequency: "recurring-weekly", startWeek: 1 },
    ],
    expenses: [
      { id: "rent", name: "Rent", amount: "40", frequency: "recurring-weekly", startWeek: 1 },
    ],
  },
});
assert(manual.source === "stored", `a manual line was replaced (${manual.source})`);
assert(manual.seededFromActuals !== true, "a manual line is not labelled as the actuals seed");
assert(
  manual.inflow.every((n) => Math.round(n) === 100),
  `manual receipts were overwritten (${manual.inflow[0]})`,
);
assert(
  manual.outflow.every((n) => Math.round(n) === 40),
  `manual payments were overwritten (${manual.outflow[0]})`,
);

const noMonths = resolveCashScreenForecast({
  financials: { revenue: 412000 },
  cashflow: { revenue: [], expenses: [] },
  now: monday,
});
const noWeeks = cashForecastWeeksFromOutlook(noMonths);
assert(noWeeks == null, "zero months of actuals do not invent a forecast");
const gap = forecastPreviewGap(noWeeks);
assert(gap === FORECAST_PREVIEW_EMPTY && gap.includes("Not enough data"), gap ?? "missing gap");

const owner = readFileSync(resolve("src/routes/app.tsx"), "utf8");
const accountant = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
assert(owner.includes("<CashForecastPanel"), "the owner cash screen renders the shared panel");
assert(
  accountant.includes("<CashForecastPanel"),
  "the accountant cash screen renders the shared panel",
);

console.log("forecast 13w seed ok");
