import { computeRatios, scoreTier, type RatioInputs } from "@/lib/ratios";

/**
 * Single source of truth for turning a client's raw financials into one
 * overall 0-100 health score, and for building the 8-point trend used by
 * sparklines across the accountant portal.
 *
 * Mirrors the same three signals the dashboard's client-list RAG badge has
 * always used (operating margin, net margin, debtor days, cash runway) so
 * the score shown here always agrees with the Red/Amber/Green badge.
 */

export type FlatFinancials = Record<string, string | number | undefined | null> | null | undefined;

function num(v: string | number | undefined | null): number {
  if (v == null || v === "") return 0;
  return typeof v === "number" ? v : parseFloat(v) || 0;
}

/** Score (0-100) from a flat financials object shaped like `clients.financials`. */
export function scoreFromFlatFinancials(
  financials: FlatFinancials,
  cashRunwayWeeks?: number | null,
): number | null {
  if (!financials && cashRunwayWeeks == null) return null;

  let ratioScore: number | null = null;
  if (financials) {
    const revenue = num(financials.revenue);
    const ebit = num(financials.ebit);
    const receivables = num(financials.receivables);
    const netIncome = num(financials.netIncome);
    if (revenue > 0) {
      const safe = (a: number, b: number) => (b === 0 ? 0 : a / b);
      const operatingMargin = safe(ebit, revenue);
      const netMargin = safe(netIncome, revenue);
      const debtorDays = safe(receivables, revenue) * 365;
      const omHealth = clamp((operatingMargin / 0.2) * 100);
      const nmHealth = clamp((netMargin / 0.15) * 100);
      const ddHealth = clamp(((90 - debtorDays) / 90) * 100);
      ratioScore = (omHealth + nmHealth + ddHealth) / 3;
    }
  }

  let cashScore: number | null = null;
  if (cashRunwayWeeks != null) {
    if (cashRunwayWeeks < 8) cashScore = 0;
    else if (cashRunwayWeeks < 16) cashScore = 40;
    else cashScore = 100;
  }

  if (ratioScore == null && cashScore == null) return null;
  if (ratioScore == null) return cashScore;
  if (cashScore == null) return ratioScore;
  return cashScore * 0.55 + ratioScore * 0.45;
}

/** Score (0-100) computed from a full `RatioInputs` snapshot (used for uploaded statements). */
export function scoreFromRatioInputs(inputs: RatioInputs, cashRunwayWeeks?: number | null): number | null {
  const ratios = computeRatios(inputs);
  const revenue = parseFloat(inputs.revenue) || 0;
  if (revenue <= 0) return scoreFromFlatFinancials(null, cashRunwayWeeks);
  const omHealth = clamp((ratios["Operating Margin"] / 0.2) * 100);
  const nmHealth = clamp((ratios["Net Margin"] / 0.15) * 100);
  const ddHealth = Number.isFinite(ratios["Debtor Days"])
    ? clamp(((90 - ratios["Debtor Days"]) / 90) * 100)
    : 50;
  const ratioScore = (omHealth + nmHealth + ddHealth) / 3;

  let cashScore: number | null = null;
  if (cashRunwayWeeks != null) {
    if (cashRunwayWeeks < 8) cashScore = 0;
    else if (cashRunwayWeeks < 16) cashScore = 40;
    else cashScore = 100;
  }
  return cashScore == null ? ratioScore : cashScore * 0.55 + ratioScore * 0.45;
}

function clamp(n: number): number {
  return Math.min(100, Math.max(0, n));
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
