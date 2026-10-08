/**
 * Direction-aware bands, playbook scoring, forecast cash-generative label,
 * report period, and budget actuals from the statement.
 * Run: pnpm exec vite-node --config scripts/vite-test.config.ts scripts/report-direction-test.mts
 */
import { readFileSync } from "node:fs";
import { budgetActualFromFinancials, buildBudgetPdfModel, illustrativeBudgetPack } from "../src/lib/budget-pdf";
import { forecastIsCashGenerative, forecastRunwayHeadline, scoreCreditorDays } from "../src/lib/client-metrics";
import { scorePlaybookCatalogue } from "../src/lib/health-score";
import {
  HEALTH_BAND_TABLE,
  SLOW_CREDITOR_DAYS_STEP,
  benchmarkHealthyEnd,
  benchmarkPosition,
  computeRatios,
  creditorDaysPaysSlowly,
  metricDirection,
} from "../src/lib/ratios";
import { reportDataPeriodLabel } from "../src/lib/statement-period";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const creditor = metricDirection("creditorDays");
const debtor = metricDirection("debtorDays");
const fixed = metricDirection("fixedCostRatio");
assert(creditor?.direction === "sweet_spot", "creditor days are a sweet spot");
assert(creditor?.healthyMin === 30 && creditor?.healthyMax === 60, "creditor healthy band is 30–60 days");
assert(debtor?.direction === "lower_is_better", "debtor days are lower-is-better");
assert(fixed?.direction === "lower_is_better", "fixed cost ratio is lower-is-better");
assert(
  HEALTH_BAND_TABLE.metrics.some((row) => row.key === "creditorDays"),
  "direction rows live on the band table",
);

const debtorEnd = benchmarkHealthyEnd(debtor!, 20, 60);
assert(debtorEnd.top === 20 && debtorEnd.lowerIsBetter, `debtor top quartile is p25, got ${debtorEnd.top}`);
assert(
  benchmarkPosition({
    value: 60,
    median: 40,
    top: debtorEnd.top,
    direction: "lower_is_better",
  }) === "below_median",
  "60 debtor days is not top quartile against a 40-day median",
);

const fixedEnd = benchmarkHealthyEnd(fixed!, 0.3, 0.6);
assert(
  fixedEnd.top === 0.3 && fixedEnd.lowerIsBetter,
  `fixed-cost top quartile is the low tail, got ${fixedEnd.top}`,
);
assert(
  benchmarkPosition({
    value: 0.6,
    median: 0.45,
    top: fixedEnd.top,
    direction: "lower_is_better",
  }) === "below_median",
  "a 60% fixed-cost ratio is below a 45% median",
);

const creditorEnd = benchmarkHealthyEnd(creditor!, 15, 45);
assert(
  benchmarkPosition({
    value: 329,
    median: 30,
    top: creditorEnd.top,
    direction: "sweet_spot",
    healthyMin: 30,
    healthyMax: 60,
  }) === "below_median",
  "329 creditor days is not top quartile versus a 30-day median",
);
assert(
  benchmarkPosition({
    value: 37,
    median: 40,
    top: 30,
    direction: "sweet_spot",
    healthyMin: 30,
    healthyMax: 60,
  }) === "in_band",
  "creditor days inside the same band as the median are not top quartile",
);
assert(
  benchmarkPosition({
    value: 37,
    median: 40,
    top: 20,
    direction: "lower_is_better",
  }) === "above_median",
  "37 debtor days beat a 40-day median without reaching the top quartile",
);
assert(scoreCreditorDays(329) === 0, "329 creditor days still score 0");
assert(creditorDaysPaysSlowly(329) && !creditorDaysPaysSlowly(45), "only days past the band are slow payment");
assert(!/too quickly/i.test(SLOW_CREDITOR_DAYS_STEP.step_description), "advice must not say paying too quickly");
assert(/slowly/i.test(SLOW_CREDITOR_DAYS_STEP.step_description), "advice says paying slowly");
assert(/arrears/i.test(SLOW_CREDITOR_DAYS_STEP.step_description), "advice names arrears risk");

const playbook = JSON.parse(readFileSync(new URL("../src/lib/playbook-data.json", import.meta.url), "utf8")) as Array<{
  ratio_key: string;
  health_tier: string;
  step_number: number;
  step_description: string;
}>;
const criticalStep = playbook.find(
  (step) => step.ratio_key === "creditorDays" && step.health_tier === "critical" && step.step_number === 1,
);
assert(Boolean(criticalStep), "critical creditor step exists");
assert(!/too quickly/i.test(criticalStep?.step_description ?? ""), "playbook step 1 is not the early-payment pack");

const yankees = computeRatios({
  revenue: "8633.6",
  cogs: "775.98",
  ebit: "2501.12",
  ebt: "2501.12",
  netIncome: "2501.12",
  ebitda: "",
  operatingCashflow: "0",
  totalAssets: "",
  equity: "",
  receivables: "9194.51",
  inventory: "",
  payables: "8386.76",
  fixedCosts: "5356.5",
  variableCosts: "",
  top5Revenue: "",
  laborCost: "",
  employees: "",
  founderHours: "",
  periodMonths: "1",
});
assert(Math.round(yankees["Creditor Days"]) === 329, `yankees creditor days ${yankees["Creditor Days"]}`);
const cards = scorePlaybookCatalogue(
  [
    { ratio_key: "creditorDays", ratio_name: "Creditor Days" },
    { ratio_key: "currentRatio", ratio_name: "Current Ratio" },
    { ratio_key: "revenueGrowth", ratio_name: "Revenue Growth" },
    { ratio_key: "salesPerEmployee", ratio_name: "Revenue per Employee" },
    { ratio_key: "gpToLabor", ratio_name: "Labour ROI" },
  ],
  yankees,
);
const byKey = Object.fromEntries(cards.map((row) => [row.ratio_key, row]));
assert(
  byKey.creditorDays.health_score === 0 && byKey.creditorDays.health_tier === "critical" && !byKey.creditorDays.unscored,
  `live creditor card ${JSON.stringify(byKey.creditorDays)}`,
);
for (const key of ["currentRatio", "revenueGrowth", "salesPerEmployee", "gpToLabor"]) {
  assert(byKey[key].unscored === true && byKey[key].health_score === 0, `${key} must be not scored`);
}

assert(forecastIsCashGenerative(20_000, 35_160) === false, "ZAR forecast net is negative");
assert(forecastIsCashGenerative(20_000, 15_000) === true, "positive net is cash generative");
assert(
  forecastRunwayHeadline({
    totalInflow: 20_000,
    totalOutflow: 35_160,
    cashGenerative: true,
    weeksUntilBreach: 4,
    horizonWeeks: 13,
  }) !== "Cash generative",
  "a negative forecast must not be labelled cash generative",
);
assert(
  forecastRunwayHeadline({
    totalInflow: 30_000,
    totalOutflow: 10_000,
    cashGenerative: true,
    weeksUntilBreach: null,
    horizonWeeks: 13,
  }) === "Cash generative",
  "positive net with cash-flow evidence stays cash generative",
);
assert(
  forecastRunwayHeadline({
    totalInflow: 30_000,
    totalOutflow: 10_000,
    cashGenerative: false,
    weeksUntilBreach: null,
    horizonWeeks: 13,
  }) !== "Cash generative",
  "a positive series without cash-flow evidence is not labelled cash generative",
);

assert(
  reportDataPeriodLabel({ periodStart: "2026-09-01", periodEnd: "2026-09-21" }) ===
    "1\u201321 Sep 2026 (part month)",
  "part month uses the statement dates",
);
assert(
  reportDataPeriodLabel({ periodStart: "2026-09-01", periodEnd: "2026-09-30" }) === "September 2026",
  "a full month is the month name",
);

const { doc } = illustrativeBudgetPack("2026-01");
const bare = buildBudgetPdfModel(doc, []);
assert(/No month actuals/.test(bare.comparedLabel), "empty uploads say no month actuals");
const actual = budgetActualFromFinancials({
  periodStart: "2026-09-01",
  periodEnd: "2026-09-21",
  revenue: 8633.6,
  cogs: 775.98,
  fixedCosts: 5356.5,
  ebit: 2501.12,
});
assert(actual?.month === "2026-09", `statement month ${actual?.month}`);
const withActuals = buildBudgetPdfModel(doc, actual ? [actual] : []);
assert(withActuals.hasActuals, "statement figures count as month actuals");
assert(!/No month actuals/i.test(withActuals.comparedLabel), withActuals.comparedLabel);
assert(!/No month actuals/i.test(withActuals.headline), withActuals.headline);

console.log("report-direction-test ok");
