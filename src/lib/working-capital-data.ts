import { scoreWorkingCapitalFunding } from "./client-metrics.ts";
import { scoreAndBand } from "./health-score.ts";
import { periodMonthsOf } from "./ratios.ts";

/**
 * Cash-cycle figures for the report pack.
 * A missing day stays null and is not scored. The cycle, funding, and cash
 * trapped follow: null when any day is missing, NaN when a day is not
 * meaningful. A full sheet keeps the previous arithmetic, including WIP at
 * 0 days.
 */
export type WorkingCapitalSlice = {
  debtor_days: number | null;
  inventory_days: number | null;
  wip_days: number;
  creditor_days: number | null;
  cash_conversion_cycle: number | null;
  working_capital_funding: number | null;
  working_capital_utilization: number | null;
  working_capital_days: number | null;
  annual_revenue: number;
  cash_trapped_rands: number | null;
  health_scores: {
    debtor_days: number | null;
    inventory_days: number | null;
    creditor_days: number | null;
    wip_days: number;
    working_capital_days: number | null;
    working_capital_funding: number | null;
    working_capital_utilization: number | null;
  };
};

function money(fin: Record<string, string>, key: string): number {
  const value = fin[key];
  return value && value.trim() !== "" ? parseFloat(value) : Number.NaN;
}

function dayPart(value: number | null | undefined): number | null {
  if (value == null) return null;
  return Number.isFinite(value) ? value : Number.NaN;
}

function cycleFrom(debtor: number | null, inventory: number | null, creditor: number | null): number | null {
  if (debtor == null || inventory == null || creditor == null) return null;
  if (![debtor, inventory, creditor].every((days) => Number.isFinite(days))) return Number.NaN;
  return debtor + inventory - creditor;
}

function dayScore(name: string, days: number | null): number | null {
  if (days == null || !Number.isFinite(days)) return null;
  return scoreAndBand(name, days).score;
}

export function buildWorkingCapitalSlice(
  fin: Record<string, string>,
  rawRatios: Record<string, number | null | undefined>,
): WorkingCapitalSlice | null {
  const revenue = money(fin, "revenue");
  if (!Number.isFinite(revenue) || revenue <= 0) return null;
  const months = periodMonthsOf(fin);
  const annualRevenue = revenue * (12 / months);
  const debtor = dayPart(rawRatios["Debtor Days"]);
  const inventory = dayPart(rawRatios["Inventory Days"]);
  const creditor = dayPart(rawRatios["Creditor Days"]);
  const cycle = cycleFrom(debtor, inventory, creditor);
  const funding = cycle != null && Number.isFinite(cycle) ? cycle / 365 : cycle;
  const utilization =
    funding != null && Number.isFinite(funding) ? Math.min(1, Math.max(0, funding * 2)) : funding;
  const trapped =
    funding != null && Number.isFinite(funding) ? annualRevenue * Math.max(0, funding) : funding;
  const fundingScore =
    funding != null && Number.isFinite(funding) ? Math.round(scoreWorkingCapitalFunding(funding)) : null;
  const utilizationScore =
    funding != null && Number.isFinite(funding)
      ? Math.round(
          scoreWorkingCapitalFunding(funding) === 0 && (funding < -1 || funding > 2)
            ? 0
            : Math.min(100, Math.max(0, (1 - Math.min(2, Math.max(-1, funding))) * 90)),
        )
      : null;
  const wipScore = scoreAndBand("Inventory Days", 0).score ?? 0;
  return {
    debtor_days: debtor,
    inventory_days: inventory,
    wip_days: 0,
    creditor_days: creditor,
    cash_conversion_cycle: cycle,
    working_capital_funding: funding,
    working_capital_utilization: utilization,
    working_capital_days: cycle,
    annual_revenue: annualRevenue,
    cash_trapped_rands: trapped,
    health_scores: {
      debtor_days: dayScore("Debtor Days", debtor),
      inventory_days: dayScore("Inventory Days", inventory),
      creditor_days: dayScore("Creditor Days", creditor),
      wip_days: wipScore,
      working_capital_days: dayScore("Working Capital Days", cycle),
      working_capital_funding: fundingScore,
      working_capital_utilization: utilizationScore,
    },
  };
}
