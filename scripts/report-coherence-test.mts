/**
 * Accountant-report coherence: prior period, equity roll-forward, negative
 * cash cycle, not-scored ratios, pillar ties, and narratives from the band table.
 * Run: pnpm exec vite-node --config scripts/vite-test.config.ts scripts/report-coherence-test.mts
 */
import { scorePlaybookCatalogue, scoreRatio } from "../src/lib/health-score";
import { clientIndustryLabel } from "../src/lib/profile-signals";
import { resolvePriorSnapshot, snapshotIsCurrentPeriod } from "../src/lib/prior-period";
import {
  cashCycleStory,
  equityRollForward,
  movementVerdict,
  MOVEMENT_VERDICT_LABEL,
  NO_HISTORY_YET,
  pickPillarExtreme,
  presentReturn,
  presentScorecardRatio,
  priorFiguresAreCopy,
  ROE_TOO_SMALL,
  scorecardCountCopy,
} from "../src/lib/report-coherence";
import {
  computeRatios,
  healthBandLabel,
  interestBurdenRatio,
  ocfToEbitdaRatio,
  scoreTier,
  taxBurdenRatio,
  type RatioInputs,
} from "../src/lib/ratios";
import { diagnoseDuPont, healthNarrative, profitabilityNarrative } from "../src/reports/narrative";
import { ZA_MARKET } from "../src/lib/market";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const currentFigures = { revenue: 10_000, netIncome: 2_900 };
const copiedPrior = {
  period_label: "Prior",
  period_date: "2025-06-30",
  financials: { revenue: 10_000, netIncome: 2_900 },
};
assert(
  snapshotIsCurrentPeriod(copiedPrior, {
    periodEnd: "2026-06-30",
    financials: currentFigures,
  }),
  "a snapshot with the same revenue and profit is the current period",
);
assert(
  resolvePriorSnapshot([copiedPrior], new Date("2026-07-15"), {
    periodEnd: "2026-06-30",
    financials: currentFigures,
  }) === null,
  "the waterfall must not treat a copied snapshot as a prior period",
);
const realPrior = {
  period_label: "Jun 2025",
  period_date: "2025-06-30",
  financials: { revenue: 8_000, netIncome: 1_200 },
};
assert(
  resolvePriorSnapshot([realPrior], new Date("2026-07-15"), {
    periodEnd: "2026-06-30",
    financials: currentFigures,
  })?.period_label === "Jun 2025",
  "a distinct older snapshot is the prior period",
);
assert(
  priorFiguresAreCopy(currentFigures, { revenue: 10_000, netIncome: 2_900 }),
  "matching revenue and profit are a copy",
);
assert(
  !priorFiguresAreCopy(currentFigures, { revenue: 8_000, netIncome: 1_200 }),
  "a different profit is not a copy",
);

const flat = profitabilityNarrative(
  {
    revenue: 10_000,
    net_profit: 2_900,
    gross_margin_pct: 0.4,
    net_margin_pct: 0.29,
    priorNetMargin: 0.29,
  },
  null,
  ZA_MARKET,
);
assert(!/improved from/i.test(flat), "equal net margin does not say the margin improved");
const noPrior = profitabilityNarrative(
  {
    revenue: 10_000,
    net_profit: 2_900,
    gross_margin_pct: 0.4,
    net_margin_pct: 0.29,
  },
  null,
  ZA_MARKET,
);
assert(!/improved from/i.test(noPrior) && !/slipped from/i.test(noPrior), "no prior means no comparative claim");
const moved = profitabilityNarrative(
  {
    revenue: 10_000,
    net_profit: 2_900,
    gross_margin_pct: 0.4,
    net_margin_pct: 0.29,
    priorNetMargin: 0.2,
  },
  null,
  ZA_MARKET,
);
assert(/improved from/i.test(moved), "a real prior margin can say improved");

const unknownOpening = equityRollForward({
  closingEquity: 8_267,
  periodProfit: 2_501,
  drawings: 0,
  priorEquity: null,
});
assert(!unknownOpening.hasPrior && unknownOpening.opening === null, "missing prior leaves opening unknown");
assert(unknownOpening.movement === null, "missing prior must not print a fake +0 movement");
assert(unknownOpening.retained === 2_501, "retained is still profit minus drawings");

const rolled = equityRollForward({
  closingEquity: 8_267,
  periodProfit: 2_501,
  drawings: 400,
  priorEquity: 6_000,
});
assert(
  Math.abs(rolled.opening! + rolled.profit - rolled.drawings + rolled.other - rolled.closing) < 0.001,
  "closing equals opening + profit − drawings + other",
);
assert(rolled.movement === 8_267 - 6_000, "movement is closing minus the real opening");
assert(rolled.retained === 2_101, "retained is profit minus drawings");

const negativeCycle = cashCycleStory({
  ccc: -296,
  dailyRevenue: 284,
  formatMoney: (n) => `$${Math.round(n)}`,
  formatUnit: (n) => `$${n}`,
});
assert(negativeCycle.supplierFunded, "a negative cycle is supplier-funded");
assert(negativeCycle.trapped === 0 && negativeCycle.dayRelease === null, "nothing is trapped and no day is released");
assert(/no financing gap/i.test(negativeCycle.sentence), "the sentence says there is no financing gap");
assert(/beyond normal terms/i.test(negativeCycle.sentence), "a critical negative cycle is beyond normal terms");
assert(!negativeCycle.sentence.includes("$284"), "a negative cycle must not quote daily revenue as cash released");
const mildNegative = cashCycleStory({
  ccc: -10,
  dailyRevenue: 284,
  formatMoney: (n) => `$${Math.round(n)}`,
  formatUnit: (n) => `$${n}`,
});
assert(mildNegative.supplierFunded && mildNegative.dayRelease === null, "a short negative cycle is still supplier-funded");
assert(!/beyond normal terms/i.test(mildNegative.sentence), "a healthy negative cycle is not called extreme");

const positiveCycle = cashCycleStory({
  ccc: 10,
  dailyRevenue: 284,
  formatMoney: (n) => `$${Math.round(n)}`,
  formatUnit: (n) => `$${n}`,
});
assert(positiveCycle.trapped === 2_840 && positiveCycle.dayRelease === 284, "trapped cash and the daily release use the same daily revenue");
assert(positiveCycle.sentence.includes("$2840") && positiveCycle.sentence.includes("$284"), "the sentence quotes both figures from that one story");

assert(!Number.isFinite(ocfToEbitdaRatio(Number.NaN, 100)), "missing operating cash flow is not a ratio");
assert(!Number.isFinite(ocfToEbitdaRatio(0, 0)), "zero EBITDA is not 0.00×");
const ocfRow = presentScorecardRatio({ name: "OCF / EBITDA", value: Number.NaN });
assert(ocfRow.include && ocfRow.unscored && ocfRow.scoredValue === null, "OCF with no cash-flow data is Not scored");
assert(!Number.isFinite(scoreRatio("OCF / EBITDA", Number.NaN)), "a missing OCF ratio is not given a score");

assert(interestBurdenRatio(100, 100) === 1, "no interest is a DuPont burden of 1");
assert(taxBurdenRatio(80, 80) === 1, "no tax is a DuPont burden of 1");
assert(!Number.isFinite(interestBurdenRatio(0, 0)), "a non-positive EBIT is not a 0% or 100% burden");
const missingBurden = presentScorecardRatio({ name: "Tax Burden", value: Number.NaN });
assert(missingBurden.unscored, "a missing tax burden stays Not scored");

assert(
  movementVerdict({ current: 0.2, three_months: null, six_months: null, twelve_months: null }) === "no_history",
  "one period is not stable",
);
assert(MOVEMENT_VERDICT_LABEL.no_history === "n/a", "no history prints n/a");
assert(NO_HISTORY_YET === "No history yet", "the empty movement report says No history yet");

const strongest = pickPillarExtreme(
  [
    { id: "financing", label: "Leverage & Finance", score: 100 },
    { id: "assets", label: "Asset Productivity", score: 100 },
    { id: "profit", label: "Profit Drivers", score: 40 },
  ],
  "strongest",
);
assert(strongest?.id === "assets" && strongest.label === "Asset Productivity", "a 100–100 tie goes to Asset Productivity");
const counts = scorecardCountCopy(14);
assert(counts.subtitle.includes("14 ratios") && counts.tracked === "of 14 tracked", "subtitle and tracked count share one list length");

const weakMargin = diagnoseDuPont({ roe: 0.4, netMargin: 0.02, assetTurnover: 2, equityMultiplier: 1.2 });
assert(!/All three ROE levers/i.test(weakMargin.sentence), "a critical margin is not called healthy");
assert(/Net Profit Margin/i.test(weakMargin.sentence), "the weakest lever is named");
const balanced = diagnoseDuPont({ roe: 0.4, netMargin: 0.2, assetTurnover: 2, equityMultiplier: 1.2 });
assert(/Healthy band/i.test(balanced.sentence), "all three levers in the Healthy band can say so");

const watchStory = healthNarrative(
  72,
  [
    { id: "profit", label: "Profit Drivers", score: 70 },
    { id: "cash", label: "Cash Flow", score: 30 },
  ],
  weakMargin,
  null,
  ZA_MARKET,
  "at_risk",
);
assert(!/fundamentally sound/i.test(watchStory), "a Watch score is not fundamentally sound");
assert(!/prevent further deterioration/i.test(watchStory), "the Watch line does not warn of further deterioration");
assert(/Watch/.test(watchStory), "the narrative uses the display band");
assert(/Cash Flow/.test(watchStory) && /Critical/.test(watchStory), "the weak pillar uses its own band");

const tinyRoe = presentReturn({
  ratioName: "Return on Equity",
  value: 3.63,
  equity: 8_267,
  currency: "USD",
  periodMonths: 1,
});
assert(tinyRoe.unscored && tinyRoe.text === ROE_TOO_SMALL, "equity below the floor is not a 363% ROE");
const monthRoa = presentReturn({
  ratioName: "Return on Assets",
  value: 1.41,
  periodMonths: 1,
  partMonth: true,
});
assert(!monthRoa.unscored && monthRoa.text.includes("part-month, annualised"), "a part month is labelled annualised");

assert(scoreTier(71) === "at_risk" && healthBandLabel("at_risk") === "Watch", "a score of 71 is Watch on the band table");
const fixed = scorePlaybookCatalogue(
  [{ ratio_key: "fixedCostRatio", health_tier: "healthy" as const, health_score: 71 }],
  { "Fixed Cost Ratio": 0.145 },
);
assert(fixed[0].health_tier === "at_risk" && !fixed[0].unscored, "playbook fixed-cost burden uses the same Watch band");

const blank: RatioInputs = {
  revenue: "120000",
  cogs: "40000",
  ebit: "20000",
  ebt: "20000",
  netIncome: "20000",
  ebitda: "",
  operatingCashflow: "",
  totalAssets: "80000",
  equity: "80000",
  receivables: "",
  inventory: "",
  payables: "",
  fixedCosts: "",
  variableCosts: "",
  top5Revenue: "",
  laborCost: "30000",
  employees: "",
  founderHours: "",
  periodMonths: "1",
};
const live = computeRatios(blank);
assert(!Number.isFinite(live["Sales-per-Employee Ratio"]), "missing headcount does not invent revenue per employee");
assert(!Number.isFinite(live["OCF / EBITDA"]), "blank cash flow does not become 0.00×");
const labourCards = scorePlaybookCatalogue(
  [{ ratio_key: "salesPerEmployee" }, { ratio_key: "gpToLabor" }],
  live,
);
assert(labourCards.find((row) => row.ratio_key === "salesPerEmployee")?.unscored, "playbooks do not score revenue per employee without headcount");
assert(labourCards.find((row) => row.ratio_key === "gpToLabor")?.unscored === false, "labour ROI still uses labor cost when headcount is missing");

assert(
  clientIndustryLabel({ templateId: "day_labour" }, "service") === "Labour & staffing",
  "the operating-profile template is the industry label",
);
assert(clientIndustryLabel(null, "service") === "Service business", "a raw business type is not left as SERVICE");

console.log("report-coherence-test: ok");
