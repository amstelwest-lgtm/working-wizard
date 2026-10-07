import { coherentEquity, effectivePeriodMonths } from "@/lib/equity-coherence";
import {
  bandedPillarStatus,
  computeRatios,
  healthBandLabel,
  scoreTier,
  type HealthTier,
  type RatioInputs,
} from "@/lib/ratios";
import { salesPerEmployeeHealthy } from "@/lib/market/benchmarks";
import type { ResolvedMarket } from "@/lib/market/types";
import {
  scoreCreditorDays,
  scoreLowerIsBetterDays,
  scoreWorkingCapitalDays,
  scoreWorkingCapitalFunding,
} from "@/lib/client-metrics";

export type ScoreMarket = Pick<ResolvedMarket, "country" | "copyPack">;

/**
 * Single source of truth for overall health scoring.
 *
 * Surfaces that must agree:
 * - Owner app overview sphere + captions
 * - Accountant portfolio dashboard (ring + status chip)
 * - Client header ring + sphere pillars
 * - `client_score_history` writes
 * - Health Scorecard PDF overall + pillar band
 *
 * Overall = equal average of available pillar scores.
 * Cash runway (when known) is one leg of the cash pillar — never a 55% override.
 * A client never shows a clean "Healthy" chip when any pillar is critical,
 * when runway is 0 weeks, or when week 1 of the forecast is already short.
 */

export type FlatFinancials = Record<string, string | number | undefined | null> | null | undefined;

export type HealthPillarId = "profit" | "assets" | "financing" | "cash";

export type PillarScore = {
  id: HealthPillarId;
  label: string;
  score: number | null;
  status: HealthTier;
};

export type OverallHealth = {
  /** Rounded 0–100 overall, or null when nothing scorable exists. */
  overall: number | null;
  /** Tier from the overall number alone. */
  status: HealthTier;
  /**
   * Display tier. "healthy" is demoted to "at_risk" when any pillar is critical
   * or week 1 is short. Zero weeks of runway forces "critical".
   */
  displayStatus: HealthTier;
  /** Short UI label for chips ("Healthy" / "Watch" / "Critical"). */
  displayLabel: string;
  pillars: PillarScore[];
  weakestPillar: PillarScore | null;
  hasCriticalPillar: boolean;
};

export const PILLAR_LABELS: Record<HealthPillarId, string> = {
  profit: "Profitability",
  assets: "Asset Efficiency",
  financing: "Financing",
  cash: "Cash & Working Capital",
};

/** Maps `computeRatios()` human-readable names → camelCase keys used in UI health maps. */
export const RATIO_NAME_TO_KEY: Record<string, string> = {
  "Gross Margin": "grossMargin",
  "Gross Profit Margin": "grossMargin",
  "Operating Margin": "operatingMargin",
  "Net Margin": "netMargin",
  "Return on Assets": "roa",
  "Return on Equity": "roe",
  "Asset Turnover": "assetTurnover",
  "Equity Multiplier": "equityMultiplier",
  "Debt-to-Equity": "debtToEquity",
  "Interest Burden": "interestBurden",
  "Tax Burden": "taxBurden",
  "Debtor Days": "debtorDays",
  "Inventory Days": "inventoryDays",
  "Creditor Days": "creditorDays",
  "Working Capital Days": "workingCapitalDays",
  "Fixed Cost Ratio": "fixedCostRatio",
  "Degree of Operating Leverage": "dol",
  "Top-5 Customer Share": "customerConcentration",
  "Gross Profit / Labor": "gpToLabor",
  "Sales-per-Employee Ratio": "salesPerEmployee",
  "OCF / EBITDA": "ocfToEbitda",
};

/** Build a camelCase healthMap from `computeRatios` output via shared `scoreRatio`. */
export function healthMapFromRatios(
  ratios: Record<string, number>,
  market?: ScoreMarket,
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const [name, val] of Object.entries(ratios)) {
    if (!Number.isFinite(val)) continue;
    const scored = scoreRatio(name, val, market);
    if (!Number.isFinite(scored)) continue;
    const key = RATIO_NAME_TO_KEY[name];
    if (key) map[key] = Math.round(scored);
  }
  return map;
}

/** Catalogue keys that share a scored ratio under another name. */
const PLAYBOOK_RATIO_ALIAS: Record<string, string> = {
  wipDays: "inventoryDays",
};

/** Chip and score line when a live client has no inputs for a catalogue ratio. */
export const NOT_SCORED_LABEL = "Not scored";

/**
 * Playbook card score from the shared ratio map. Missing keys are unscored —
 * callers show "Not scored" instead of a catalogue fixture such as Healthy 75.
 */
export function scorePlaybookRatio(
  ratioKey: string,
  healthMap: Record<string, number> | null | undefined,
): { health_score: number; health_tier: HealthTier; unscored: boolean } | null {
  if (!healthMap) return null;
  const key = PLAYBOOK_RATIO_ALIAS[ratioKey] ?? ratioKey;
  const score = healthMap[key];
  if (score == null || !Number.isFinite(score)) {
    return { health_score: 0, health_tier: "critical", unscored: true };
  }
  const health_score = Math.round(score);
  return { health_score, health_tier: scoreTier(health_score), unscored: false };
}

/**
 * Score a playbook catalogue from live ratios. Fixture scores on the rows are
 * dropped. A key with no inputs (revenue per employee with no headcount) is
 * "Not scored" — health_score 0 and unscored, never the demo 75 / 28 / 41.
 */
export function scorePlaybookCatalogue<T extends { ratio_key: string }>(
  rows: readonly T[],
  ratios: Record<string, number>,
  market?: ScoreMarket,
): Array<T & { health_score: number; health_tier: HealthTier; unscored: boolean }> {
  const map = healthMapFromRatios(ratios, market);
  const wcDays = ratios["Working Capital Days"];
  if (Number.isFinite(wcDays)) {
    const funded = scoreWorkingCapitalFunding(wcDays / 365);
    if (Number.isFinite(funded)) map.workingCapitalFunding = Math.round(funded);
  }
  return rows.map((row) => {
    const scored = scorePlaybookRatio(row.ratio_key, map);
    if (!scored || scored.unscored) {
      return { ...row, health_score: 0, health_tier: "at_risk" as const, unscored: true };
    }
    return {
      ...row,
      health_score: scored.health_score,
      health_tier: scored.health_tier,
      unscored: false,
    };
  });
}

/** Which ratios feed each pillar (human names from `computeRatios`). */
export const PILLAR_RATIO_NAMES: Record<HealthPillarId, readonly string[]> = {
  profit: [
    "Gross Margin",
    "Operating Margin",
    "Net Margin",
    "Fixed Cost Ratio",
    "Degree of Operating Leverage",
    "Gross Profit / Labor",
    "Top-5 Customer Share",
  ],
  assets: ["Asset Turnover", "Return on Assets", "Inventory Days", "Sales-per-Employee Ratio"],
  financing: ["Equity Multiplier", "Debt-to-Equity", "Interest Burden", "Tax Burden", "Return on Equity"],
  cash: ["Debtor Days", "Creditor Days", "Working Capital Days", "OCF / EBITDA"],
};

const ALL_PILLARS: HealthPillarId[] = ["profit", "assets", "financing", "cash"];

function clamp(n: number): number {
  return Math.min(100, Math.max(0, n));
}

/** Mean of finite scores only. Empty / non-finite inputs are omitted — never 0 or 50. */
function avg(nums: number[]): number | null {
  const finite = nums.filter((n) => Number.isFinite(n));
  if (!finite.length) return null;
  return finite.reduce((s, n) => s + n, 0) / finite.length;
}

/** Real numeric ratio only — empty string / null / NaN are missing, not 0. */
function toFiniteNumber(val: unknown): number | null {
  if (val == null || val === "") return null;
  const n = typeof val === "number" ? val : Number(val);
  return Number.isFinite(n) ? n : null;
}

function emptyRatioInputs(): RatioInputs {
  return {
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
}

function fyStartForScore(market?: ScoreMarket): number | undefined {
  if (market?.country === "US") return 1;
  if (market?.country === "ZA") return 3;
  return undefined;
}

/** Map a flat `clients.financials` blob into RatioInputs. */
export function flatToRatioInputs(
  financials: FlatFinancials,
  opts?: { fyStartMonth?: number | null },
): RatioInputs {
  const base = emptyRatioInputs();
  if (!financials) return base;
  const keys = Object.keys(base) as (keyof RatioInputs)[];
  for (const k of keys) {
    const v = financials[k];
    if (v == null || v === "") continue;
    base[k] = String(v);
  }
  base.periodMonths = String(
    effectivePeriodMonths(financials as Record<string, unknown>, opts),
  );
  const liabilities = (financials as Record<string, unknown>).totalLiabilities;
  if (liabilities != null && liabilities !== "") base.totalLiabilities = String(liabilities);
  const coherent = coherentEquity(financials as Record<string, unknown>);
  if (coherent.equity) base.equity = coherent.equity;
  return base;
}

/**
 * Ratio inputs Overview and the Ratios grid score.
 * Period length follows the financial-year span. Equity stays the figure on
 * the statement — the same fields the accountant page passes to `computeRatios`.
 */
export function overviewRatioInputs(
  financials: FlatFinancials | Record<string, unknown> | null | undefined,
  opts?: { fyStartMonth?: number | null },
): RatioInputs & { totalLiabilities?: string } {
  const fin = (financials ?? {}) as Record<string, unknown>;
  const text = (key: string): string => {
    const value = fin[key];
    if (value == null) return "";
    return typeof value === "string" ? value : String(value);
  };
  return {
    revenue: text("revenue"),
    cogs: text("cogs"),
    ebit: text("ebit"),
    ebt: text("ebt"),
    netIncome: text("netIncome"),
    ebitda: text("ebitda"),
    operatingCashflow: text("operatingCashflow"),
    totalAssets: text("totalAssets"),
    equity: text("equity"),
    receivables: text("receivables"),
    inventory: text("inventory"),
    payables: text("payables"),
    fixedCosts: text("fixedCosts"),
    variableCosts: text("variableCosts"),
    top5Revenue: text("top5Revenue"),
    laborCost: text("laborCost"),
    employees: text("employees"),
    founderHours: text("founderHours"),
    periodMonths: String(effectivePeriodMonths(fin, opts)),
    totalLiabilities: text("totalLiabilities"),
  };
}

/** Ratios Overview and the Ratios grid show for this statement. */
export function overviewRatios(
  financials: FlatFinancials | Record<string, unknown> | null | undefined,
  opts?: { fyStartMonth?: number | null },
): Record<string, number> {
  return computeRatios(overviewRatioInputs(financials, opts));
}

/**
 * Per-ratio health score (0–100). Shared by client page, reports studio,
 * and overall aggregation.
 */
export function scoreRatio(name: string, val: number, market?: ScoreMarket): number {
  // Missing / not-yet-calculated ratios must not become a fake midpoint.
  if (!Number.isFinite(val)) return Number.NaN;

  // Margins / returns — higher is better
  if (name === "Net Margin") return clamp((val / 0.15) * 100);
  if (name === "Operating Margin") return clamp((val / 0.2) * 100);
  if (name === "Gross Margin") return clamp((val / 0.4) * 100);
  if (name === "Return on Assets") return clamp((val / 0.12) * 100);
  if (name === "Return on Equity") return clamp((val / 0.2) * 100);
  if (name === "Asset Turnover") return clamp((val / 1.5) * 100);
  if (name === "Gross Profit / Labor") return clamp((val / 0.6) * 100);
  if (name === "Sales-per-Employee Ratio") {
    return clamp((val / salesPerEmployeeHealthy(market)) * 100);
  }
  if (name === "OCF / EBITDA") return clamp(val * 100);
  if (name === "Interest Burden") return clamp(val * 100);
  if (name === "Tax Burden") return clamp(val * 100);

  // Lower-is-better cost / concentration burdens
  if (name === "Fixed Cost Ratio") return clamp(((0.5 - val) / 0.5) * 100);
  if (name === "Top-5 Customer Share") return clamp(((0.8 - val) / 0.8) * 100);

  // Days. Creditors have a 30–60 day sweet spot; past that, longer is a risk.
  // Values beyond ±1000 days score 0 — they are not a healthy extreme.
  if (name === "Debtor Days" || name === "Inventory Days") return scoreLowerIsBetterDays(val);
  if (name === "Working Capital Days") return scoreWorkingCapitalDays(val);
  if (name === "Creditor Days") return scoreCreditorDays(val);

  // Structure / leverage
  if (name === "Equity Multiplier") return clamp(((4 - val) / 3) * 100);
  if (name === "Degree of Operating Leverage") {
    // Moderate operating leverage is healthier than extreme sensitivity
    if (val <= 0) return 30;
    if (val <= 2) return clamp(50 + (val / 2) * 40);
    if (val <= 4) return clamp(90 - ((val - 2) / 2) * 40);
    return clamp(50 - (val - 4) * 10);
  }

  // Extra names used by report builders / camelCase aliases
  if (name === "Debt-to-Equity" || name === "Debt to Equity") return clamp(((2 - val) / 2) * 100);
  if (name === "Debt-to-Assets" || name === "Debt to Assets")
    return clamp(((0.7 - val) / 0.7) * 100);
  if (name === "Current Ratio") return clamp((val / 2) * 100);
  if (name === "Revenue Growth") return clamp((val / 0.2) * 100);

  return 50;
}

/**
 * Cash runway → 0–100.
 * Aligns with HEALTH_BAND_TABLE: ≥12 wk (85) Healthy, 4–12 wk (45 and 65)
 * Watch, <4 wk critical.
 */
export function scoreCashRunway(weeks: number): number {
  if (!Number.isFinite(weeks)) return Number.NaN;
  if (weeks >= 16) return 100;
  if (weeks >= 12) return 85;
  if (weeks >= 8) return 65;
  if (weeks >= 4) return 45;
  if (weeks >= 2) return 25;
  return 10;
}

/** Assign a ratio's human name to a pillar. */
export function pillarForRatioName(name: string): HealthPillarId {
  for (const id of ALL_PILLARS) {
    if ((PILLAR_RATIO_NAMES[id] as readonly string[]).includes(name)) return id;
  }
  // Heuristic fallback for report-only names
  if (
    name.includes("Margin") ||
    name.includes("Growth") ||
    name.includes("Leverage") ||
    name.includes("Labor") ||
    name.includes("Customer") ||
    name.includes("Cost")
  ) {
    return "profit";
  }
  if (
    name.includes("Days") ||
    name.includes("Capital") ||
    name.includes("OCF") ||
    name.includes("Cash")
  ) {
    return "cash";
  }
  if (
    (name.includes("Equity") && !name.includes("Return")) ||
    name.includes("Multiplier") ||
    name.includes("Burden") ||
    name.includes("Debt") ||
    name.includes("Interest")
  ) {
    return "financing";
  }
  return "assets";
}

function chipLabel(status: HealthTier): string {
  return healthBandLabel(status);
}

/**
 * Profitability step chip. Same score and label as the Profit pillar
 * (`scoreRatio` + `HEALTH_BAND_TABLE`), not a private 10% / 20% scale.
 */
export function profitStepBand(
  ratioName: string,
  ratio: number,
): { tier: HealthTier; label: string } {
  const tier = scoreTier(scoreRatio(ratioName, ratio));
  return { tier, label: healthBandLabel(tier) };
}

export type ComputeOverallHealthInput = {
  /** Human-named ratio values from `computeRatios` (or equivalent). */
  ratios?: Record<string, number | null | undefined>;
  /**
   * Pre-scored ratios (e.g. scorecard `RatioResult[]`). When provided these
   * are used instead of re-scoring `ratios`.
   */
  scoredRatios?: Array<{
    name: string;
    score: number;
    pillar?: HealthPillarId;
  }>;
  cashRunwayWeeks?: number | null;
  /**
   * First forecast week that closes below zero. Week 1 cannot display Healthy.
   * Zero weeks of runway cannot display Healthy either — the chip is Critical.
   */
  shortfallWeek?: number | null;
  /** Sales-per-employee uses a market-specific healthy target. Defaults ZA. */
  market?: ScoreMarket;
};

/**
 * Canonical overall health. Equal-weight average of pillars that have data.
 * Cash runway (when present) is blended into the cash pillar.
 */
export function computeOverallHealth(input: ComputeOverallHealthInput): OverallHealth {
  const bucket: Record<HealthPillarId, number[]> = {
    profit: [],
    assets: [],
    financing: [],
    cash: [],
  };

  if (input.scoredRatios?.length) {
    for (const r of input.scoredRatios) {
      if (!Number.isFinite(r.score)) continue;
      const pillar = r.pillar ?? pillarForRatioName(r.name);
      bucket[pillar].push(r.score);
    }
  } else if (input.ratios) {
    for (const [name, val] of Object.entries(input.ratios)) {
      const n = toFiniteNumber(val);
      if (n == null) continue;
      const scored = scoreRatio(name, n, input.market);
      if (!Number.isFinite(scored)) continue;
      const pillar = pillarForRatioName(name);
      bucket[pillar].push(scored);
    }
  }

  if (input.cashRunwayWeeks != null && Number.isFinite(input.cashRunwayWeeks)) {
    bucket.cash.push(scoreCashRunway(input.cashRunwayWeeks));
  }

  const pillars: PillarScore[] = ALL_PILLARS.map((id) => {
    const components = bucket[id];
    const score = avg(components);
    const rounded = score == null ? null : Math.round(score);
    return {
      id,
      label: PILLAR_LABELS[id],
      score: rounded,
      status: bandedPillarStatus(rounded, components),
    };
  });

  const scoredPillars = pillars.filter((p) => p.score != null) as Array<
    PillarScore & { score: number }
  >;
  const overallRaw = avg(scoredPillars.map((p) => p.score));
  const overall = overallRaw == null ? null : Math.round(overallRaw);
  const status = scoreTier(overall);
  const hasCriticalPillar = scoredPillars.some((p) => p.status === "critical");
  let displayStatus: HealthTier = hasCriticalPillar && status === "healthy" ? "at_risk" : status;
  if (input.cashRunwayWeeks === 0) displayStatus = "critical";
  else if (input.shortfallWeek === 1 && displayStatus === "healthy") displayStatus = "at_risk";

  const weakestPillar =
    scoredPillars.length === 0
      ? null
      : ([...scoredPillars].sort((a, b) => a.score - b.score)[0] ?? null);

  return {
    overall,
    status,
    displayStatus,
    displayLabel: chipLabel(displayStatus),
    pillars,
    weakestPillar,
    hasCriticalPillar,
  };
}

/** Score (0-100) from a flat financials object shaped like `clients.financials`. */
export function scoreFromFlatFinancials(
  financials: FlatFinancials,
  cashRunwayWeeks?: number | null,
  market?: ScoreMarket,
): number | null {
  if (!financials && cashRunwayWeeks == null) return null;
  return computeOverallHealth({
    ratios: financials
      ? computeRatios(flatToRatioInputs(financials, { fyStartMonth: fyStartForScore(market) }))
      : undefined,
    cashRunwayWeeks,
    market,
  }).overall;
}

/** Full OverallHealth from flat financials — for chips that need the critical-pillar tell. */
export function healthFromFlatFinancials(
  financials: FlatFinancials,
  cashRunwayWeeks?: number | null,
  market?: ScoreMarket,
): OverallHealth {
  return computeOverallHealth({
    ratios: financials
      ? computeRatios(flatToRatioInputs(financials, { fyStartMonth: fyStartForScore(market) }))
      : undefined,
    cashRunwayWeeks,
    market,
  });
}

/** Score (0-100) from a full `RatioInputs` snapshot. */
export function scoreFromRatioInputs(
  inputs: RatioInputs,
  cashRunwayWeeks?: number | null,
  market?: ScoreMarket,
): number | null {
  return computeOverallHealth({
    ratios: computeRatios(inputs),
    cashRunwayWeeks,
    market,
  }).overall;
}

export function healthFromRatioInputs(
  inputs: RatioInputs,
  cashRunwayWeeks?: number | null,
  market?: ScoreMarket,
  shortfallWeek?: number | null,
): OverallHealth {
  return computeOverallHealth({
    ratios: computeRatios(inputs),
    cashRunwayWeeks,
    market,
    shortfallWeek,
  });
}

export { scoreTier };

export type TrendPoint = { score: number; isEstimated: boolean };

/**
 * Builds an 8-point trend from real `client_score_history` rows (most recent
 * last). When there is less real history than 8 points, the earliest known
 * real score is repeated backward to fill the gap so the sparkline still
 * renders — those padded points are flagged `isEstimated: true` so the UI
 * can visibly mark them (e.g. dashed/lighter) instead of presenting them as
 * real history.
 */
export function buildTrend(
  history: { score: number; is_estimated: boolean }[],
  targetLength = 8,
): TrendPoint[] {
  if (history.length === 0) return [];
  const real = history.map((h) => ({ score: h.score, isEstimated: h.is_estimated }));
  if (real.length >= targetLength) return real.slice(-targetLength);
  const padCount = targetLength - real.length;
  const pad = Array.from({ length: padCount }, () => ({
    score: real[0].score,
    isEstimated: true,
  }));
  return [...pad, ...real];
}
