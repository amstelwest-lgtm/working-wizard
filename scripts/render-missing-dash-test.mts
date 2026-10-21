/**
 * Missing figures render as a dash or "Not enough data".
 * One check per audit item. Stored zeros stay zeros. Scoring stays put.
 * Run: pnpm test:render-missing-dash
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { HealthScoreGauge } from "../src/components/pdf/health-score-gauge";
import { RatioRow } from "../src/components/pdf/ratio-row";
import { buildAdvisoryPack } from "../src/lib/advisory-pack";
import { headlineFor, type BudgetPdfRow } from "../src/lib/budget-pdf";
import { detectDataGaps } from "../src/lib/data-requests";
import { forecastExportRunwayWeeks } from "../src/lib/forecast-export-runway";
import { resolveMarket } from "../src/lib/market/resolve";
import { statedDepreciation } from "../src/reports/profitability-waterfall";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const US = resolveMarket({ country: "US", regionCode: "NY" });

function source(path: string): string {
  return readFileSync(resolve(path), "utf8");
}

function containsGauge(node: unknown): boolean {
  if (node == null || typeof node !== "object") return false;
  if (Array.isArray(node)) return node.some(containsGauge);
  const el = node as { type?: unknown; props?: { children?: unknown } };
  if (el.type === HealthScoreGauge) return true;
  return containsGauge(el.props?.children);
}

function textOf(node: unknown): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  const el = node as { props?: { children?: unknown } };
  return textOf(el.props?.children);
}

// 1. Advisory pack: a missing opening is not zero and does not "start from zero".
{
  const pack = buildAdvisoryPack({
    clientName: "Northline",
    firmName: null,
    hasFirm: false,
    periodLabel: "Oct 2026",
    priorPeriodLabel: null,
    figuresAsOf: "2026-10-01",
    health: null,
    ratios: null,
    priorRatios: null,
    openingBalance: null,
    closings: [1000, 800],
    cashRunwayWeeks: null,
    recommendations: [],
    dataRequests: [],
    openActions: 0,
    overdueActions: 0,
    now: "2026-10-21T00:00:00.000Z",
    currency: "USD",
    market: { locale: "en-US" },
  });
  const forecast = pack.sections.find((section) => section.key === "forecast")!.body;
  const state = pack.sections.find((section) => section.key === "state_of_business")!.body;
  const combined = `${state}\n${forecast}`;
  assert(combined.includes("Not enough data"), "a missing opening says Not enough data");
  assert(combined.includes("no opening bank balance"), "a missing opening is named");
  assert(!/starts from zero/i.test(combined), "a missing opening does not start from zero");
  assert(!combined.includes("$0"), `a missing opening is not printed as $0:\n${combined}`);
  assert(pack.forecast?.openingBalance == null, "the pack keeps a null opening");
  assert(pack.forecast?.lowestClosing === 800, "a real low stays the closing, not zero");
}

// 2. Owner export runway weeks. Null stays null. A stored 0 stays 0.
{
  assert(forecastExportRunwayWeeks(null, 0) === null, "a missing runway is not week 0");
  assert(forecastExportRunwayWeeks(undefined, 2) === null, "an absent runway is not week 0");
  assert(forecastExportRunwayWeeks(Number.NaN, 0) === null, "a non-finite runway is not week 0");
  assert(forecastExportRunwayWeeks(8, 3) === 5, "a real runway counts down");
  assert(forecastExportRunwayWeeks(0, 0) === 0, "a stored zero runway stays zero");
  assert(forecastExportRunwayWeeks(0, 4) === 0, "later weeks of a stored zero stay zero");
  const panel = source("src/components/cash-forecast.tsx");
  assert(!panel.includes("screenRunway.weeks ?? 0"), "the export no longer coerces a missing runway");
  assert(
    panel.includes("forecastExportRunwayWeeks(screenRunway.weeks, i)"),
    "each exported week uses the helper",
  );
  assert(
    source("src/lib/cash-forecast-parity.ts").includes("runway_weeks: 0"),
    "the outlook week helper is unchanged",
  );
}

// 4. Health gauge draws nothing without a score. Zero still draws.
{
  assert(HealthScoreGauge({ score: null }) == null, "a missing health score draws no gauge");
  assert(HealthScoreGauge({ score: Number.NaN }) == null, "a non-finite health score draws no gauge");
  assert(HealthScoreGauge({ score: 0 }) != null, "a stored zero health score still draws");
  assert(HealthScoreGauge({ score: 40 }) != null, "a real health score still draws");
  assert(
    !source("src/reports/health-scorecard.tsx").includes("overallScore ?? 0"),
    "the scorecard no longer feeds the gauge a zero",
  );
}

// 5. Budget variance. A null delta is not over or under by $0.
{
  const row = (delta: number | null): BudgetPdfRow => ({
    label: "Rent",
    budget: 100,
    actual: delta == null ? null : 100 + delta,
    delta,
    deltaPct: null,
    signal: "adverse",
    material: false,
    emphasis: false,
  });
  const missing = headlineFor([row(null)], true, false, US);
  assert(missing === "Not enough data", `null delta headline was ${missing}`);
  assert(!missing.includes("$0"), "a null delta is not $0");
  assert(!/over budget|under budget/i.test(missing), "a null delta is not over or under");
  const present = headlineFor([row(40)], true, false, US);
  assert(present.includes("over budget"), present);
  assert(present.includes("$40"), present);
  assert(!source("src/reports/budget-variance.tsx").includes("delta ?? 0"), "the variance table no longer coerces delta");
  assert(!source("src/lib/budget-pdf.ts").includes("delta ?? 0"), "the variance sentence no longer coerces delta");
}

// 7. Bridge depreciation. Missing is not a zero bar. Zero and twelve stay themselves.
{
  assert(statedDepreciation(null) === null, "missing depreciation is not zero");
  assert(statedDepreciation(undefined) === null, "absent depreciation is not zero");
  assert(statedDepreciation(Number.NaN) === null, "non-finite depreciation is not zero");
  assert(statedDepreciation(0) === 0, "a stored zero depreciation stays zero");
  assert(statedDepreciation(12) === 12, "a real depreciation stays");
  assert(statedDepreciation(-4) === 0, "a negative depreciation does not draw below zero");
  assert(
    !source("src/reports/profitability-waterfall.tsx").includes("depreciation ?? 0"),
    "the bridge no longer coerces depreciation",
  );
}

// 8. Ratio gauges. No score draws nothing. A real zero still draws and prints 0.
{
  const blank = RatioRow({
    ratioName: "Gross Margin",
    formattedValue: "—",
    healthScore: null,
    healthTier: "at_risk",
    unscored: false,
  });
  assert(!containsGauge(blank), "a missing ratio score draws no gauge");
  assert(textOf(blank).includes("—"), "a missing ratio score prints a dash");
  assert(!textOf(blank).includes(" 0"), `a missing ratio score is not 0 (${textOf(blank)})`);

  const zero = RatioRow({
    ratioName: "Gross Margin",
    formattedValue: "1%",
    healthScore: 0,
    healthTier: "critical",
  });
  assert(containsGauge(zero), "a stored zero ratio score still draws");
  assert(textOf(zero).includes("0"), "a stored zero ratio score still prints");

  const scored = RatioRow({
    ratioName: "Gross Margin",
    formattedValue: "40%",
    healthScore: 40,
    healthTier: "healthy",
  });
  assert(containsGauge(scored), "a real ratio score still draws");
  for (const file of [
    "src/reports/labor-productivity.tsx",
    "src/reports/asset-productivity.tsx",
    "src/reports/profitability-waterfall.tsx",
  ]) {
    assert(!source(file).includes("r.score ?? 0"), `${file} no longer coerces a ratio score`);
  }
}

// 9. Data-request copy. The ask stays. It does not say the runway starts from zero.
{
  const drafts = detectDataGaps({
    state: "forecasting",
    figuresAsOf: "2026-10-01",
    ratios: { "Debtor Days": 30, "Creditor Days": 20 },
    hasForecast: true,
    forecastOpeningBalance: null,
    hasAgedDebtors: true,
    hasAgedCreditors: true,
    now: "2026-10-21",
  });
  const ask = drafts.find((draft) => draft.rule_key === "forecast_opening_balance");
  assert(ask, "a blank opening still asks for the bank balance");
  assert(!/starts from zero/i.test(ask.reason), ask.reason);
  assert(ask.reason.includes("Not enough data"), ask.reason);
  assert(ask.reason.includes("no opening balance"), ask.reason);
}

console.log("render-missing-dash: ok");
