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
import { CASH_RUNWAY_THRESHOLD_RAND } from "../src/lib/cash-runway";
import { computeRatios, type RatioInputs } from "../src/lib/ratios";

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

// R50k cash-runway floor is shared — PDF exports must not invent a R0 floor.
assert(CASH_RUNWAY_THRESHOLD_RAND === 50_000, "R50k runway floor");

const emptyInputs: RatioInputs = {
  revenue: "",
  cogs: "",
  ebit: "",
  ebt: "",
  netIncome: "",
  ebitda: "",
  operatingCashflow: "",
  totalAssets: "",
  equity: "",
  receivables: "",
  inventory: "",
  payables: "",
  fixedCosts: "",
  variableCosts: "",
  top5Revenue: "",
  laborCost: "",
  employees: "",
  founderHours: "",
};

function pillarScore(h: ReturnType<typeof computeOverallHealth>, id: string) {
  return h.pillars.find((p) => p.id === id)?.score ?? null;
}

// Missing / not-yet-calculated ratios must not become a fake 50 (or 0).
assert(!Number.isFinite(scoreRatio("Gross Margin", NaN)), "scoreRatio NaN is not a fake 50");
assert(!Number.isFinite(scoreRatio("Operating Margin", Number.POSITIVE_INFINITY)), "scoreRatio inf omitted");
assert(!Number.isFinite(scoreCashRunway(NaN)), "scoreCashRunway NaN is not a fake 50");

// Missing ratio omitted from the pillar average (not averaged as 0 or 50).
const omitMissing = computeOverallHealth({
  ratios: {
    "Gross Margin": 0.4, // → 100
    "Operating Margin": NaN,
    "Net Margin": Number.NaN,
  },
});
assert(pillarScore(omitMissing, "profit") === 100, `missing OM/NM omitted, profit=100, got ${pillarScore(omitMissing, "profit")}`);
assert(omitMissing.overall === 100, `overall is profit-only 100, got ${omitMissing.overall}`);

// Same leak via scoreRatio(NaN) → used to return 50 and dilute the mean.
const viaScoreRatio = computeOverallHealth({
  scoredRatios: [
    { name: "Gross Margin", score: scoreRatio("Gross Margin", 0.4), pillar: "profit" },
    { name: "Operating Margin", score: scoreRatio("Operating Margin", NaN), pillar: "profit" },
  ],
});
assert(
  pillarScore(viaScoreRatio, "profit") === 100,
  `scoreRatio(NaN) omitted from avg, got ${pillarScore(viaScoreRatio, "profit")}`,
);

// All-empty pillar / orb is blank — not a fake 0 or 50.
const allEmpty = healthFromRatioInputs(emptyInputs);
assert(allEmpty.overall == null, `all-empty overall blank, got ${allEmpty.overall}`);
assert(
  allEmpty.pillars.every((p) => p.score == null),
  `all-empty pillars blank, got ${allEmpty.pillars.map((p) => `${p.id}:${p.score}`).join(" ")}`,
);
assert(scoreFromFlatFinancials({}) == null, "empty flat financials → null overall");
assert(scoreFromFlatFinancials(null) == null, "null financials → null overall");

const gmOnly = computeOverallHealth({ ratios: { "Gross Margin": 0.4 } });
assert(pillarScore(gmOnly, "profit") === 100, "GM-only profit=100");
assert(pillarScore(gmOnly, "assets") == null, `empty assets pillar not 0/50, got ${pillarScore(gmOnly, "assets")}`);
assert(pillarScore(gmOnly, "financing") == null, "empty financing pillar blank");
assert(pillarScore(gmOnly, "cash") == null, "empty cash pillar blank");
assert(gmOnly.overall === 100, `overall not diluted by empty pillars, got ${gmOnly.overall}`);

// Mixed filled + empty uses only filled scores.
const mixedFilled = healthFromRatioInputs({
  ...emptyInputs,
  revenue: "1000000",
  cogs: "600000", // GM 40% → 100
  ebit: "200000", // OM 20% → 100
  // netIncome blank → Net Margin omitted, not 0
});
assert(pillarScore(mixedFilled, "profit") === 100, `mixed profit uses only GM+OM, got ${pillarScore(mixedFilled, "profit")}`);
assert(pillarScore(mixedFilled, "cash") == null, "mixed: empty cash pillar blank");
assert(mixedFilled.overall === 100, `mixed overall = scored pillar only, got ${mixedFilled.overall}`);

// Service-like: R0 COGS is real, but blank inventory must not invent Inventory Days = 0 → 100.
const serviceRatios = computeRatios({
  ...emptyInputs,
  revenue: "1000000",
  cogs: "0",
  totalAssets: "800000",
});
assert(!Number.isFinite(serviceRatios["Inventory Days"]), "blank inventory + R0 COGS → Inventory Days omitted");
assert(!Number.isFinite(serviceRatios["Creditor Days"]), "blank payables + R0 COGS → Creditor Days omitted");
const serviceHealth = healthFromRatioInputs({
  ...emptyInputs,
  revenue: "1000000",
  cogs: "0",
  totalAssets: "800000",
});
// Asset Turnover = 1.25 → (1.25/1.5)*100 = 83. If a fake inventory-days 100 leaked, avg would be 92.
assert(
  pillarScore(serviceHealth, "assets") === 83,
  `service assets = AT only (83), not diluted by invented inventory days, got ${pillarScore(serviceHealth, "assets")}`,
);

console.log("health-score-test: ok");
console.log("sample overall", fromInputs.overall, fromInputs.displayLabel, fromInputs.pillars.map((p) => `${p.id}:${p.score}`).join(" "));
