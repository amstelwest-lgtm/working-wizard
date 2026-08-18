/**
 * overview-insights.ts
 * Pure helpers for the Business Health simplified overview rail.
 * Extracted from app.tsx so the owner board stays readable.
 *
 * Honesty rule: never invent peer cohorts, week-over-week deltas, or
 * cash forecasts from P&L heuristics. Prefer null / empty + honest copy.
 */

export type WeekChange = {
  label: string;
  value: string;
  sentiment: "good" | "bad" | "neutral";
};

export type CashTrajectory = {
  points: number[];
  projectedLabel: string;
  projectedValue: string;
};

/**
 * Peer ranking is not available until a real cohort exists.
 * Previously returned avgHealth clamped as a fake "percentile" — removed.
 */
export function computePositionPercentile(
  _hasRealFinancials: boolean,
  _avgHealth: number,
): number | null {
  return null;
}

/** Honest health band for the rail when no peer set exists. */
export function computeHealthBand(avgHealth: number): {
  score: number;
  label: string;
} | null {
  if (!Number.isFinite(avgHealth)) return null;
  const score = Math.round(avgHealth);
  let label = "Needs attention";
  if (score >= 65) label = "In good shape";
  else if (score >= 40) label = "Needs monitoring";
  return { score, label };
}

/**
 * Snapshot-style figure highlights from current inputs — NOT week-over-week changes.
 * Callers must label the rail as "From your figures", never "This Week".
 */
export function computeWeekChanges(input: {
  revenueGrowth: number;
  cashHealth: number;
  profitHealth: number;
  grossMarginRatio: number;
}): WeekChange[] {
  const changes: WeekChange[] = [];
  const { revenueGrowth, cashHealth, profitHealth, grossMarginRatio } = input;

  if (isFinite(revenueGrowth)) {
    const pct = Math.round(revenueGrowth * 100);
    changes.push({
      label: "Revenue growth (input)",
      value: `${pct >= 0 ? "+" : ""}${pct}%`,
      sentiment: pct > 0 ? "good" : pct < 0 ? "bad" : "neutral",
    });
  }

  if (isFinite(cashHealth) && isFinite(profitHealth)) {
    const gap = Math.round(cashHealth - profitHealth);
    changes.push({
      label: "Cash vs profit health",
      value: gap === 0 ? "Aligned" : `${gap > 0 ? "+" : ""}${gap} pts`,
      sentiment: gap > 0 ? "good" : gap < 0 ? "bad" : "neutral",
    });
  }

  if (isFinite(grossMarginRatio)) {
    const gm = Math.round(grossMarginRatio * 1000) / 10;
    changes.push({
      label: "Gross margin",
      value: `${gm}%`,
      sentiment: gm >= 35 ? "good" : gm >= 20 ? "neutral" : "bad",
    });
  }

  return changes.slice(0, 3);
}

/**
 * Do not invent a 90-day cash series from P&L.
 * Real outlook lives on the Cash Forecast tab (bank draft / weekly inputs).
 */
export function computeCashTrajectory(_input: {
  hasRealFinancials: boolean;
  revenue: number;
  operatingCashflow: number;
  currentAssets: number;
  currentLiabilities: number;
}): CashTrajectory | null {
  return null;
}

export function computeOverviewCaption(input: {
  hasRealFinancials: boolean;
  avgHealth: number;
  cashHealth: number;
}): string | undefined {
  const { hasRealFinancials, avgHealth, cashHealth } = input;
  if (!hasRealFinancials || !isFinite(avgHealth)) return undefined;
  if (isFinite(cashHealth) && cashHealth < avgHealth - 5) {
    return "Your business is stable, but cash conversion is holding you back.";
  }
  if (avgHealth >= 65) return "Your business is in good shape — keep building momentum.";
  if (avgHealth >= 40) return "Your business needs some attention — start with the priority below.";
  return "Your business needs urgent attention — start with the priority below.";
}

export function computeNextMoveImpactLabel(input: {
  topKey?: string;
  revenue: number;
  receivables: number;
}): string | undefined {
  const { topKey, revenue, receivables } = input;
  if (!topKey) return undefined;

  const fmtImpact = (amount: number) => {
    if (amount >= 1_000_000) return `+R${(amount / 1_000_000).toFixed(1)}m`;
    if (amount >= 1_000) return `+R${Math.round(amount / 1000)}k`;
    return `+R${Math.round(amount)}`;
  };

  if (topKey === "debtorDays" && receivables >= 5_000) {
    const unlock = receivables * 0.15;
    if (unlock >= 1_000)
      return `${fmtImpact(unlock)} additional cash in next 90 days (illustrative)`;
  }
  if (revenue >= 50_000) {
    const unlock = revenue * 0.02;
    if (unlock >= 1_000) return `${fmtImpact(unlock)} potential swing this quarter (illustrative)`;
  }
  return undefined;
}
