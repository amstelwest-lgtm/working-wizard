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
  runwayTileValue,
} from "../src/lib/client-metrics";
import {
  canonicalForecastFloor,
  forecastFloorPosition,
  forecastLinesSourceLabel,
  forecastWeeksBelowReadout,
  cashEmptyPresentation,
  forecastLowestPoint,
  forecastPositionPhrase,
  forecastRunwayHeadlineShared,
  openingSourceLabel,
} from "../src/lib/cash-forecast-parity";
import { formatMoneyChartTick } from "../src/lib/market/format.ts";
import { resolveMarket } from "../src/lib/market/resolve.ts";
import { cashForecastNarrative } from "../src/reports/narrative.ts";
import { cashChecklistSourceChip } from "../src/lib/deliverable-input-config.ts";

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
assert(!cashTab.includes("baseResetRef"), "reset to base does not schedule a database write");
assert(!cashTab.includes("storedCollectDelay"), "opening the tab does not restore a saved collection delay");
assert(cashTab.includes("baseCashflow({})"), "a real base save writes base knobs, not the session scenario");

const pdfSrc = readFileSync(resolve("src/reports/cash-forecast.tsx"), "utf8");
assert(pdfSrc.includes("forecastFloorPosition"), "PDF uses the shared floor position");
assert(pdfSrc.includes("forecastWeeksBelowReadout"), "PDF weeks-below uses the shared readout");
assert(pdfSrc.includes('label: "Base forecast"'), "base export is not labelled a scenario");
assert(
  pdfSrc.includes("draft={!isDemo && !sample && !reviewSignoff}"),
  "unsigned cash PDF gets the draft treatment",
);
const reportsSrc = readFileSync(resolve("src/routes/_authenticated/reports.index.tsx"), "utf8");
assert(reportsSrc.includes('scenario: "base"'), "the reports studio exports the base forecast");
const signoffSrc = readFileSync(resolve("src/components/review-signoff.tsx"), "utf8");
assert(signoffSrc.includes("Not signed off"), "the reports list shows an unsigned forecast");

const us = resolveMarket({ country: "US", regionCode: "NY" });
const yankeesCopy = cashForecastNarrative(
  {
    runwayWeeks: null,
    cashGenerative: true,
    minBalance: 7430,
    threshold: 7500,
    weeksBelow: 0,
    firstBreachWeek: null,
    opensBelow: true,
  },
  undefined,
  us,
);
assert(/below the \$7\.5k minimum/i.test(yankeesCopy), yankeesCopy);
assert(!/above the \$7\.5k minimum/i.test(yankeesCopy), yankeesCopy);
assert(!/cash generative/i.test(yankeesCopy), yankeesCopy);
assert(/\$7\.4k/.test(yankeesCopy), yankeesCopy);

const yankeesWeeks = forecastWeeksBelowReadout(
  forecastFloorPosition({ opening: 7430, closings: [8000, 8200], floor: 7500 }),
);
assert(yankeesWeeks.value === "Below floor", yankeesWeeks.value);
assert(yankeesWeeks.note === "opening is under the floor", yankeesWeeks.note);
assert(!/none projected/i.test(yankeesWeeks.note), yankeesWeeks.note);

const clearWeeks = forecastWeeksBelowReadout(
  forecastFloorPosition({ opening: 128450, closings: [130000, 140000], floor: 7600 }),
);
assert(clearWeeks.value === "0" && clearWeeks.note === "none projected", JSON.stringify(clearWeeks));

const aboveFloor = forecastRunwayHeadlineShared({
  opening: 128450,
  closings: [130000, 140000],
  floor: 7600,
  runwayLabel: RUNWAY_PROFITABLE_LABEL,
  cashGenerative: false,
});
assert(aboveFloor.headline === "No shortfall", aboveFloor.headline);
assert(aboveFloor.note === "above the floor", aboveFloor.note);
assert(!aboveFloor.headline.includes("Profitable"), aboveFloor.headline);

const profitableTile = forecastRunwayHeadlineShared({
  opening: 0,
  closings: [0, 0],
  floor: 0,
  runwayLabel: RUNWAY_PROFITABLE_LABEL,
});
assert(profitableTile.headline === "Profitable", profitableTile.headline);
assert(runwayTileValue(RUNWAY_PROFITABLE_LABEL) === "Profitable", "clients list tile");
assert(!profitableTile.headline.includes("P&L"), profitableTile.headline);

const generativeTile = forecastRunwayHeadlineShared({
  opening: 128450,
  closings: [130000],
  floor: 7600,
  cashGenerative: true,
  runwayLabel: RUNWAY_PROFITABLE_LABEL,
});
assert(generativeTile.headline === "Cash generative", generativeTile.headline);

assert(forecastLinesSourceLabel({ seededFromBanksAt: "2026-10-01" }) === "Bank", "bank lines");
assert(forecastLinesSourceLabel({ forecastLinesSource: "qbo-bank-activity" }) === "Sync", "sync lines");
assert(forecastLinesSourceLabel({ openingBalance: "10" }) === null, "untagged lines stay blank");
assert(
  cashChecklistSourceChip("bank:operating", { cashLineSource: "Sync" }) === "Bank",
  "a named bank account is Bank",
);
assert(
  cashChecklistSourceChip("bank_accounts", { cashLineSource: "Sync" }) === "Sync",
  "the bank checklist uses the known line source",
);
assert(cashChecklistSourceChip("pl", {}) === null, "an unknown P&L source stays blank");

const zaTick = formatMoneyChartTick(30000);
assert(zaTick === "R30.0k", zaTick);
assert(!zaTick.includes(" "), "axis tick has no breakable space");
const usTick = formatMoneyChartTick(30000, us);
assert(usTick === "$30.0k", usTick);

console.log("cash-forecast-parity-test: all assertions passed");
