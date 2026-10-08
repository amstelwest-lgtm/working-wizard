/**
 * Cash figures the tab, Overview, the PDF, and the Bot must share.
 * Run: pnpm test:cash-forecast-parity
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildFinancialSnapshot } from "../src/lib/client-briefing";
import {
  assessClientMetrics,
  baseCashflow,
  forecastMinimumCash,
  ledgerOpeningIsCashEvidence,
  RUNWAY_PROFITABLE_LABEL,
} from "../src/lib/client-metrics";
import {
  canonicalForecastFloor,
  forecastFloorPosition,
  cashEmptyPresentation,
  forecastLowestPoint,
  forecastPositionPhrase,
  forecastRunwayHeadlineShared,
  openingSourceLabel,
} from "../src/lib/cash-forecast-parity";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const closings = [140, 130, 150];
const low = forecastLowestPoint(120, closings);
assert(low.amount === 120 && low.isOpening && low.week === 0, `opening is the low, got ${low.amount} w${low.week}`);

const later = forecastLowestPoint(200, closings);
assert(later.amount === 130 && later.week === 2 && !later.isOpening, `week 2 is the low, got ${later.week}`);

const floor = canonicalForecastFloor({ weeklyOutflows: [10, 10, 10, 10] });
assert(floor === forecastMinimumCash({ weeklyOutflows: [10, 10, 10, 10] }), "floor wrapper matches the engine");

const under = forecastFloorPosition({ opening: 7400, closings: [8000, 8100], floor: 7500 });
assert(under.opensBelow && under.staysAbove === false && under.firstDipWeek == null, "opening under the floor");
assert(
  forecastPositionPhrase({ opening: 7400, closings: [8000, 8100], floor: 7500 }) === "opens below floor",
  "opening under the floor is not 'stays above'",
);

const dip = forecastFloorPosition({ opening: 20000, closings: [18000, 9000, 12000, 8000], floor: 10800 });
assert(dip.firstDipWeek === 2 && dip.weeksBelow === 2 && dip.opensBelow === false, `dip ${JSON.stringify(dip)}`);
const story = forecastRunwayHeadlineShared({
  opening: 20000,
  closings: [18000, 9000, 12000, 8000],
  floor: 10800,
  runwayLabel: "21 weeks",
});
assert(story.headline === "2 weeks below", story.headline);
assert(story.note.includes("week 2"), story.note);

const clear = forecastRunwayHeadlineShared({
  opening: 20000,
  closings: [21000, 22000],
  floor: 10800,
  runwayLabel: "21 weeks",
});
assert(clear.headline === "21 weeks", clear.headline);

const opened = buildFinancialSnapshot({
  chips: [],
  cash: { amount: 7430, floor: 7500, dipsBelowFloorWeek: null },
});
assert(
  opened.find((row) => row.key === "cash")?.value.includes("opens below floor") === true,
  opened.find((row) => row.key === "cash")?.value ?? "missing",
);
assert(
  opened.find((row) => row.key === "cash")?.value.includes("stays above floor") !== true,
  "opening under the floor must not say stays above",
);

const base = baseCashflow({
  collectDelay: 8,
  revAdj: 80,
  expAdj: 110,
  revGrowthPct: 2,
  capexAmount: 5000,
  revenue: [{ amount: "1" }],
  seededFromBanksAt: "2026-10-01",
});
assert(base.collectDelay === 0 && base.revAdj === 100 && base.capexAmount === 0, "knobs zeroed");
assert(base.seededFromBanksAt === "2026-10-01", "unknown keys survive");
assert((base.revenue as { amount: string }[])[0]?.amount === "1", "lines survive");

assert(ledgerOpeningIsCashEvidence({ openingBalanceSource: "qbo" }) === true, "qbo opening is cash evidence");
assert(ledgerOpeningIsCashEvidence({ forecastLinesSource: "xero-bank-summary" }) === true, "xero lines are cash evidence");
assert(ledgerOpeningIsCashEvidence({ seededFromBanksAt: "2026-10-01" }) === false, "a stamp alone is not ledger evidence");

const profitable = assessClientMetrics({
  financials: { cash: "128450", revenue: "50000", netIncome: "8000", periodMonths: "1" },
  cashflow: { openingBalance: "128450", openingBalanceSource: "qbo" },
});
assert(
  profitable.runway.label !== RUNWAY_PROFITABLE_LABEL,
  `ledger opening should count as cash evidence, got ${profitable.runway.label}`,
);
assert(profitable.runway.kind === "cash_generative", profitable.runway.label);

const statementOnly = assessClientMetrics({
  financials: { cash: "128450", revenue: "50000", netIncome: "8000", periodMonths: "1" },
  cashflow: { openingBalance: "128450" },
});
assert(
  statementOnly.runway.label === RUNWAY_PROFITABLE_LABEL,
  "a bare opening is still not a bank publish",
);

assert(openingSourceLabel({ openingBalanceSource: "qbo" }) === "Sync", "qbo chip");
assert(openingSourceLabel({ seededFromBanksAt: "2026-10-01" }) === "Bank", "bank chip");
assert(openingSourceLabel({ forecastLinesSource: "pl-estimate" }) === "Estimate", "estimate chip");
assert(openingSourceLabel({ openingBalance: "10" }) === null, "unknown source stays blank");

const stressed = assessClientMetrics({
  financials: { cash: "25000", revenue: "120000", cogs: "40000", fixedCosts: "30000", netIncome: "10000", periodMonths: "1" },
  cashflow: {
    openingBalance: "25000",
    collectDelay: 8,
    revenue: [{ amount: "10000", frequency: "recurring-weekly", startWeek: 1 }],
    expenses: [{ amount: "4000", frequency: "recurring-weekly", startWeek: 1 }],
  },
});
assert(
  (stressed.outlook.timingNote ?? "").includes("collections delayed") === false,
  "published series does not keep a saved collection delay",
);

const blank = cashEmptyPresentation({ opening: 0, linesBlank: true });
assert(blank.showChart === false && blank.lowestBlank, "empty cash hides the chart and the $0 trough");
const openingOnly = cashEmptyPresentation({ opening: 128450, linesBlank: true });
assert(openingOnly.showChart === false && openingOnly.lowestBlank === false, "an opening is a real low, still no chart");
const populated = cashEmptyPresentation({ opening: 128450, linesBlank: false });
assert(populated.showChart && populated.lowestBlank === false, "lines draw the chart");

const cashTab = readFileSync(resolve("src/components/cash-forecast.tsx"), "utf8");
const nothingPhrases = cashTab.split("Nothing is forecast yet").length - 1;
assert(nothingPhrases === 1, `empty copy is said once, found ${nothingPhrases}`);
assert(cashTab.includes("cashEmptyPresentation"), "the tab uses the empty-state helper");

console.log("cash-forecast-parity-test: all assertions passed");
