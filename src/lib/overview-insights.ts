/**
 * overview-insights.ts
 * Pure helpers for the Business Health simplified overview rail.
 * Extracted from app.tsx so the owner board stays readable.
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

export function computePositionPercentile(
  hasRealFinancials: boolean,
  avgHealth: number,
): number | null {
  if (!hasRealFinancials || !isFinite(avgHealth)) return null;
  return Math.max(5, Math.min(95, Math.round(avgHealth)));
}

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
      label: "Revenue",
      value: `${pct >= 0 ? "+ " : ""}${pct}%`,
      sentiment: pct > 0 ? "good" : pct < 0 ? "bad" : "neutral",
    });
  }

  if (isFinite(cashHealth) && isFinite(profitHealth)) {
    const gap = Math.round(cashHealth - profitHealth);
    changes.push({
      label: "Cash conversion",
      value: gap === 0 ? "Unchanged" : `${gap > 0 ? "+ " : "- "}${Math.abs(gap)}%`,
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

export function computeCashTrajectory(input: {
  hasRealFinancials: boolean;
  revenue: number;
  operatingCashflow: number;
  currentAssets: number;
  currentLiabilities: number;
}): CashTrajectory | null {
  if (!input.hasRealFinancials) return null;

  const { revenue, operatingCashflow, currentAssets, currentLiabilities } = input;
  const wc =
    currentAssets > 0 || currentLiabilities > 0
      ? Math.max(0, currentAssets - currentLiabilities)
      : NaN;
  const monthlyFromOcf = operatingCashflow !== 0 ? operatingCashflow / 12 : NaN;
  const monthlyFromRev = revenue > 0 ? (revenue * 0.04) / 12 : NaN;
  const monthly =
    isFinite(monthlyFromOcf) && Math.abs(monthlyFromOcf) >= 500
      ? monthlyFromOcf
      : monthlyFromRev;
  const seed =
    isFinite(wc) && wc >= 5_000
      ? wc
      : isFinite(monthly)
        ? Math.max(monthly * 2, revenue > 0 ? revenue * 0.05 : 0)
        : NaN;

  if (!isFinite(seed) && !isFinite(monthly)) return null;
  const start = isFinite(seed) ? seed : (monthly as number) * 2;
  const add = isFinite(monthly) ? (monthly as number) : start * 0.08;
  if (start < 1_000 && (!isFinite(revenue) || revenue < 10_000)) return null;

  const points = [0, 1, 2, 3].map((i) => Math.max(0, start + add * i));
  const projected = points[points.length - 1];
  const fmt = (amount: number) =>
    amount >= 1_000_000
      ? `R${(amount / 1_000_000).toFixed(1)}m`
      : amount >= 1_000
        ? `R${Math.round(amount / 1000)}k`
        : `R${Math.round(amount)}`;

  return {
    points,
    projectedLabel: "Projected cash in 90 days",
    projectedValue: fmt(projected),
  };
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
    if (unlock >= 1_000) return `${fmtImpact(unlock)} additional cash in next 90 days`;
  }
  if (revenue >= 50_000) {
    const unlock = revenue * 0.02;
    if (unlock >= 1_000) return `${fmtImpact(unlock)} potential swing this quarter`;
  }
  return undefined;
}
