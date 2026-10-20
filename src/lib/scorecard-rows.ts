/**
 * Financial Health Scorecard rows.
 *
 * Reports studio and Overview Export both call this. Annualised returns and
 * debtor and creditor days use the stored figures-cover (`periodMonthsOf`),
 * the same cover Ratios and Collections use for DSO. A year-to-date span
 * must not replace that cover.
 *
 * This module does not score pillars and does not supply a sign-off, a firm
 * name, or a timezone. `ZA_MARKET` is only the number-format default when a
 * caller omits a market. Overview export and Reports studio pass the client
 * market. Pillar and overall scores come from `scorecardHealthFromFinancials`.
 */
import { withCanonicalDebtorCreditorDays } from "@/lib/deliverable-input-config";
import { reportScalarInputs } from "@/lib/equity-coherence";
import { PILLAR_RATIO_NAMES, pillarForRatioName, scoreRatio, type HealthPillarId } from "@/lib/health-score";
import { formatReportAmount, ZA_MARKET, type ResolvedMarket } from "@/lib/market";
import { computeRatios, periodMonthsOf, scoreTier, type HealthTier, type RatioInputs } from "@/lib/ratios";
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
  return formatReportAmount(val, ZA_MARKET, { style: "percent" });
}

/**
 * Ratio map the scorecard and the other studio reports print.
 * Annualisation uses the stored figures cover (`periodMonthsOf`), the same
 * cover as debtor and creditor days. A September year-end must not turn a
 * stored 12-month file into a 9-month annualisation.
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
    periodMonths: String(periodMonthsOf(raw)),
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
    industry?: string | null;
  },
): ScorecardRatioRow[] {
  const rows: ScorecardRatioRow[] = [];
  const pushRow = (name: string, val: number, presented: ReturnType<typeof presentScorecardRatio>) => {
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
  };
  for (const [name, val] of Object.entries(rawRatios)) {
    const presented = presentScorecardRatio({
      name,
      value: val,
      equity: context?.equity,
      currency: market.currency,
      periodMonths: context?.periodMonths,
      partMonth: context?.partMonth,
      cashFlowKnown: context?.cashFlowKnown,
      industry: context?.industry,
    });
    if (!presented.include) continue;
    pushRow(name, val, presented);
  }
  const printed = new Set(rows.map((row) => row.ratio_name));
  const seen = new Set(Object.keys(rawRatios));
  for (const id of Object.keys(PILLAR_RATIO_NAMES) as HealthPillarId[]) {
    for (const name of PILLAR_RATIO_NAMES[id]) {
      if (printed.has(name) || seen.has(name)) continue;
      pushRow(name, Number.NaN, {
        include: true,
        text: "Not scored",
        headline: "Not scored",
        scoredValue: null,
        note: null,
        unscored: true,
      });
    }
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
