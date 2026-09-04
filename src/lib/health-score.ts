import { computeRatios, scoreTier, type HealthTier, type RatioInputs } from "@/lib/ratios";
import { salesPerEmployeeHealthy } from "@/lib/market/benchmarks";
import type { ResolvedMarket } from "@/lib/market/types";

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
 * A client never shows a clean "Healthy" chip when any pillar is critical.
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
   * Display tier — same as `status`, except "healthy" is demoted to "at_risk"
   * when any pillar is critical (the critical-pillar tell).
   */
  displayStatus: HealthTier;
  /** Short UI label for chips ("Healthy" / "Watch" / "At risk"). */
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
  financing: ["Equity Multiplier", "Interest Burden", "Tax Burden", "Return on Equity"],
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

/** Map a flat `clients.financials` blob into RatioInputs. */
export function flatToRatioInputs(financials: FlatFinancials): RatioInputs {
  const base = emptyRatioInputs();
  if (!financials) return base;
  const keys = Object.keys(base) as (keyof RatioInputs)[];
  for (const k of keys) {
    const v = financials[k];
    if (v == null || v === "") continue;
    base[k] = String(v);
  }
  return base;
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

  // Days — lower usually better (except creditors, where longer payment terms help cash)
  if (name === "Debtor Days") return clamp(((90 - val) / 90) * 100);
  if (name === "Inventory Days") return clamp(((90 - val) / 90) * 100);
  if (name === "Working Capital Days") return clamp(((90 - val) / 90) * 100);
  if (name === "Creditor Days") return clamp((val / 60) * 100);

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
 * Aligns with scoreTier bands: ≥12 wk healthy, 4–12 watch, <4 critical.
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
  if (status === "healthy") return "Healthy";
  if (status === "at_risk") return "Watch";
  return "At risk";
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
    const score = avg(bucket[id]);
    const rounded = score == null ? null : Math.round(score);
    return {
      id,
      label: PILLAR_LABELS[id],
      score: rounded,
      status: scoreTier(rounded),
    };
  });

  const scoredPillars = pillars.filter((p) => p.score != null) as Array<
    PillarScore & { score: number }
  >;
  const overallRaw = avg(scoredPillars.map((p) => p.score));
  const overall = overallRaw == null ? null : Math.round(overallRaw);
  const status = scoreTier(overall);
  const hasCriticalPillar = scoredPillars.some((p) => p.status === "critical");
  const displayStatus: HealthTier = hasCriticalPillar && status === "healthy" ? "at_risk" : status;

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
    ratios: financials ? computeRatios(flatToRatioInputs(financials)) : undefined,
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
    ratios: financials ? computeRatios(flatToRatioInputs(financials)) : undefined,
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
): OverallHealth {
  return computeOverallHealth({
    ratios: computeRatios(inputs),
    cashRunwayWeeks,
    market,
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
