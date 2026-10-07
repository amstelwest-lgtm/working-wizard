/**
 * Financial Health Scorecard rows.
 *
 * Reports studio and Overview Export both call this. Debtor and creditor days
 * come from the stored figures-cover (`periodMonthsOf`), the same cover Ratios
 * and Collections use. A year-to-date span must not replace them.
 */
import { withCanonicalDebtorCreditorDays } from "@/lib/deliverable-input-config";
import { reportScalarInputs } from "@/lib/equity-coherence";
import { pillarForRatioName, scoreRatio } from "@/lib/health-score";
import { ZA_MARKET, type ResolvedMarket } from "@/lib/market";
import { computeRatios, scoreTier, type HealthTier, type RatioInputs } from "@/lib/ratios";
import { presentScorecardRatio } from "@/lib/report-coherence";

export type ScorecardRatioRow = {
  ratio_key: string;
  ratio_name: string;
  pillar: "profit" | "assets" | "financing" | "cash";
  current_value: number;
  health_score: number;
  health_tier: HealthTier;
  unscored?: boolean;
  formatted_value: string;
  annotation?: string | null;
};

function fmtRatioVal(name: string, val: number): string {
  if (!Number.isFinite(val)) return "—";
  if (name.includes("Days")) return `${Math.round(val)}d`;
  if (
    name === "Asset Turnover" ||
    name === "Equity Multiplier" ||
    name === "Debt-to-Equity" ||
    name === "Degree of Operating Leverage" ||
    name === "OCF / EBITDA"
  ) {
    return `${val.toFixed(2)}×`;
  }
  return `${(val * 100).toFixed(1)}%`;
}

/**
 * Ratio map the scorecard prints. Margins stay on the year-span cover.
 * Debtor and creditor days are overlaid from the raw blob's stored cover.
 */
export function scorecardRatiosFromFinancials(
  financials: Record<string, unknown> | null | undefined,
  opts?: { fyStartMonth?: number | null },
): Record<string, number> {
  const raw = financials ?? {};
  const fin = reportScalarInputs(raw, opts);
  const ratioInputs: RatioInputs = {
    revenue: fin.revenue ?? "",
    cogs: fin.cogs ?? "",
    ebit: fin.ebit ?? "",
    ebt: fin.ebt ?? "",
    netIncome: fin.netIncome ?? "",
    ebitda: fin.ebitda ?? "",
    operatingCashflow: fin.operatingCashflow ?? "",
    totalAssets: fin.totalAssets ?? "",
    equity: fin.equity ?? "",
    receivables: fin.receivables ?? "",
    inventory: fin.inventory ?? "",
    payables: fin.payables ?? "",
    fixedCosts: fin.fixedCosts ?? "",
    variableCosts: fin.variableCosts ?? "",
    top5Revenue: fin.top5Revenue ?? "",
    laborCost: fin.laborCost ?? "",
    employees: fin.employees ?? "",
    founderHours: fin.founderHours ?? "",
    totalLiabilities: fin.totalLiabilities ?? "",
    periodMonths: fin.periodMonths ?? "",
  };
  return withCanonicalDebtorCreditorDays(computeRatios(ratioInputs), raw);
}

export function buildScorecardRatioResults(
  rawRatios: Record<string, number>,
  market: ResolvedMarket = ZA_MARKET,
  context?: {
    equity?: number | null;
    periodMonths?: number | null;
    partMonth?: boolean;
    cashFlowKnown?: boolean;
  },
): ScorecardRatioRow[] {
  const rows: ScorecardRatioRow[] = [];
  for (const [name, val] of Object.entries(rawRatios)) {
    const presented = presentScorecardRatio({
      name,
      value: val,
      equity: context?.equity,
      currency: market.currency,
      periodMonths: context?.periodMonths,
      partMonth: context?.partMonth,
      cashFlowKnown: context?.cashFlowKnown,
    });
    if (!presented.include) continue;
    const scoredValue = presented.scoredValue;
    const score =
      presented.unscored || scoredValue == null
        ? 0
        : Math.round(scoreRatio(name, scoredValue, market));
    rows.push({
      ratio_key: name.toLowerCase().replace(/[^a-z0-9]/g, "_"),
      ratio_name: name,
      pillar: pillarForRatioName(name),
      current_value: scoredValue ?? (Number.isFinite(val) ? val : Number.NaN),
      health_score: score,
      health_tier: presented.unscored ? "at_risk" : scoreTier(score),
      formatted_value: presented.text ?? fmtRatioVal(name, scoredValue ?? val),
      annotation: presented.note,
      unscored: presented.unscored || undefined,
    });
  }
  return rows;
}

/** Archived Overview scorecards are not re-served. The download renders live. */
export function scorecardDownloadShouldRenderLive(row: {
  kind?: string | null;
  report_key?: string | null;
}): boolean {
  return row.kind === "report_pdf" && row.report_key === "scorecard";
}
