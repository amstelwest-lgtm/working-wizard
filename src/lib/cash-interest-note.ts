/**
 * Interest the cash screen can show. The amount is the P&L bridge
 * (`periodProfitBridge`). This file does not estimate a rate.
 */
import { periodProfitBridge } from "./period-profit.ts";

export type InterestOfRevenue = {
  interest: number;
  revenue: number;
  /** Interest ÷ revenue × 100. One decimal, the same rounding as the waterfall. */
  percent: number;
};

/**
 * A firm-year clip of the statement (budget-period `fiscalOverlap` scale and
 * the slice label). The Waterfall prints interest on that slice, so this line
 * scales the same way and carries the same pro-rated label.
 */
export type InterestPeriodClip = { scale: number; label: string | null };

function usableClip(clip: InterestPeriodClip | null | undefined): InterestPeriodClip | null {
  if (!clip || !Number.isFinite(clip.scale) || !(clip.scale > 0) || clip.scale >= 1) return null;
  return clip;
}

export function interestOfRevenue(
  financials: Record<string, unknown> | null | undefined,
  clip?: InterestPeriodClip | null,
): InterestOfRevenue | null {
  if (!financials) return null;
  const bridge = periodProfitBridge(financials);
  if (!bridge.interestIsFact || !(bridge.interest > 0) || !(bridge.revenue > 0)) return null;
  const scale = usableClip(clip)?.scale ?? 1;
  return {
    interest: bridge.interest * scale,
    revenue: bridge.revenue * scale,
    percent: (bridge.interest / bridge.revenue) * 100,
  };
}

/** One sentence beside the cash lines. Null when interest is not a fact. */
export function interestOfRevenueSentence(
  financials: Record<string, unknown> | null | undefined,
  money: (amount: number) => string,
  clip?: InterestPeriodClip | null,
): string | null {
  const row = interestOfRevenue(financials, clip);
  if (!row) return null;
  const label = usableClip(clip)?.label;
  const period = label ? ` ${label}.` : "";
  return `Interest on the P&L is ${row.percent.toFixed(1)}% of revenue (${money(row.interest)}).${period}`;
}
