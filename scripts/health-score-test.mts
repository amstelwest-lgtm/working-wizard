/**
 * Quick sanity checks for unified computeOverallHealth.
 * Run: pnpm exec vite-node --config scripts/vite-test.config.ts scripts/health-score-test.mts
 */
import {
  computeOverallHealth,
  scoreRatio,
  scoreCashRunway,
  healthFromRatioInputs,
  scoreFromFlatFinancials,
} from "../src/lib/health-score";
import type { RatioInputs } from "../src/lib/ratios";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// Per-ratio scoring still matches prior heuristics for core ratios
assert(Math.round(scoreRatio("Operating Margin", 0.2)) === 100, "OM 20% → 100");
assert(Math.round(scoreRatio("Debtor Days", 0)) === 100, "DD 0 → 100");
assert(Math.round(scoreRatio("Debtor Days", 90)) === 0, "DD 90 → 0");

// Cash runway bands
assert(scoreCashRunway(16) === 100, "16wk runway");
assert(scoreCashRunway(8) === 65, "8wk runway");
assert(scoreCashRunway(3) === 25, "3wk runway");

// Critical pillar demotes Healthy display
const mixed = computeOverallHealth({
  scoredRatios: [
    { name: "Gross Margin", score: 90, pillar: "profit" },
    { name: "Asset Turnover", score: 90, pillar: "assets" },
    { name: "Equity Multiplier", score: 90, pillar: "financing" },
    { name: "Debtor Days", score: 20, pillar: "cash" },
  ],
});
assert(mixed.overall != null && mixed.overall >= 65, `overall should be healthy-ish, got ${mixed.overall}`);
assert(mixed.status === "healthy", `raw status healthy, got ${mixed.status}`);
assert(mixed.hasCriticalPillar, "cash pillar critical");
assert(mixed.displayStatus === "at_risk", `display demoted, got ${mixed.displayStatus}`);
assert(mixed.displayLabel === "Watch", `label Watch, got ${mixed.displayLabel}`);

// Flat financials + runway agree with ratio-input path
const inputs: RatioInputs = {
  revenue: "1000000",
  cogs: "600000",
  ebit: "150000",
  ebt: "140000",
  netIncome: "100000",
  ebitda: "180000",
  operatingCashflow: "160000",
  totalAssets: "800000",
  equity: "400000",
  receivables: "120000",
  inventory: "80000",
  payables: "60000",
  fixedCosts: "200000",
  variableCosts: "400000",
  top5Revenue: "400000",
  laborCost: "250000",
  employees: "10",
  founderHours: "40",
};
const fromInputs = healthFromRatioInputs(inputs, 10);
const fromFlat = scoreFromFlatFinancials(
  {
    revenue: "1000000",
    cogs: "600000",
    ebit: "150000",
    ebt: "140000",
    netIncome: "100000",
    ebitda: "180000",
    operatingCashflow: "160000",
    totalAssets: "800000",
    equity: "400000",
    receivables: "120000",
    inventory: "80000",
    payables: "60000",
    fixedCosts: "200000",
    variableCosts: "400000",
    top5Revenue: "400000",
    laborCost: "250000",
    employees: "10",
  },
  10,
);
assert(fromInputs.overall === fromFlat, `flat vs inputs: ${fromInputs.overall} vs ${fromFlat}`);
assert(fromInputs.pillars.every((p) => p.score != null), "all pillars scored");

console.log("health-score-test: ok");
console.log("sample overall", fromInputs.overall, fromInputs.displayLabel, fromInputs.pillars.map((p) => `${p.id}:${p.score}`).join(" "));
