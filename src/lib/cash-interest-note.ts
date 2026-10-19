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

export function interestOfRevenue(
  financials: Record<string, unknown> | null | undefined,
): InterestOfRevenue | null {
  if (!financials) return null;
  const bridge = periodProfitBridge(financials);
  if (!bridge.interestIsFact || !(bridge.interest > 0) || !(bridge.revenue > 0)) return null;
  return {
    interest: bridge.interest,
    revenue: bridge.revenue,
    percent: (bridge.interest / bridge.revenue) * 100,
  };
}

/** One sentence beside the cash lines. Null when interest is not a fact. */
export function interestOfRevenueSentence(
  financials: Record<string, unknown> | null | undefined,
  money: (amount: number) => string,
): string | null {
  const row = interestOfRevenue(financials);
  if (!row) return null;
  return `Interest on the P&L is ${row.percent.toFixed(1)}% of revenue (${money(row.interest)}).`;
}
