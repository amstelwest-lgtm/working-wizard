/**
 * Period figures for ProfitabilityWaterfallPDF.
 * The advisory pack freezes these same fields. Do not recompute the bridge
 * anywhere else.
 */
import { scoreRatio } from "@/lib/health-score";
import { periodProfitBridge } from "@/lib/period-profit";
import { interestBurdenRatio, scoreTier, taxBurdenRatio } from "@/lib/ratios";
import { priorFiguresAreCopy } from "@/lib/report-coherence";

export type PeriodData = {
  revenue: number;
  gross_profit: number;
  gross_margin_pct: number;
  gross_margin_score?: number;
  gross_margin_tier?: string;
  operating_profit: number;
  operating_margin_pct: number;
  operating_margin_score?: number;
  operating_margin_tier?: string;
  ebt: number;
  interest_burden_pct?: number;
  interest_burden_score?: number;
  tax: number;
  tax_burden_pct?: number;
  tax_burden_score?: number;
  net_profit: number;
  net_margin_pct: number;
  net_margin_score?: number;
  net_margin_tier?: string;
  /** Non-cash D&A between operating expenses and operating profit. */
  depreciation?: number;
};

export type ProfitabilityData = PeriodData & {
  prior_period?: PeriodData;
};

function getNum(fin: Record<string, string>, key: string): number {
  const v = fin[key];
  return v && v.trim() !== "" ? parseFloat(v) : NaN;
}

export function buildProfitabilityData(
  fin: Record<string, string>,
  priorFin?: Record<string, string> | null,
): ProfitabilityData | null {
  const revenue = getNum(fin, "revenue");
  const cogs = getNum(fin, "cogs");
  const ebit = getNum(fin, "ebit");
  const ebt = getNum(fin, "ebt");
  const net = getNum(fin, "netIncome");
  if (!Number.isFinite(revenue) || !Number.isFinite(ebit) || !Number.isFinite(net)) return null;
  // Never invent GP from 50% of revenue — COGS required for gross margin.
  if (!Number.isFinite(cogs)) return null;
  const gp = revenue - cogs;
  const gmPct = gp / revenue;
  const omPct = ebit / revenue;
  const depreciation = periodProfitBridge(fin).depreciation;
  const ebtVal = Number.isFinite(ebt) ? ebt : ebit;
  const interestBurden = interestBurdenRatio(ebit, ebtVal);
  const taxBurden = taxBurdenRatio(ebtVal, net);
  const tax = Math.max(0, ebtVal - net);
  const nmPct = net / revenue;
  const current = {
    revenue,
    gross_profit: gp,
    gross_margin_pct: gmPct,
    gross_margin_score: Math.round(scoreRatio("Gross Margin", gmPct)),
    gross_margin_tier: scoreTier(Math.round(scoreRatio("Gross Margin", gmPct))),
    operating_profit: ebit,
    operating_margin_pct: omPct,
    operating_margin_score: Math.round(scoreRatio("Operating Margin", omPct)),
    operating_margin_tier: scoreTier(Math.round(scoreRatio("Operating Margin", omPct))),
    ebt: ebtVal,
    interest_burden_pct: Number.isFinite(interestBurden) ? interestBurden : undefined,
    interest_burden_score: Number.isFinite(interestBurden)
      ? Math.round(scoreRatio("Interest Burden", interestBurden))
      : 0,
    tax,
    tax_burden_pct: Number.isFinite(taxBurden) ? taxBurden : undefined,
    tax_burden_score: Number.isFinite(taxBurden)
      ? Math.round(scoreRatio("Tax Burden", taxBurden))
      : 0,
    net_profit: net,
    net_margin_pct: nmPct,
    net_margin_score: Math.round(scoreRatio("Net Margin", nmPct)),
    net_margin_tier: scoreTier(Math.round(scoreRatio("Net Margin", nmPct))),
    depreciation,
  };

  let prior_period: ProfitabilityData["prior_period"] | undefined;
  if (priorFin) {
    const pRev = getNum(priorFin, "revenue");
    const pCogs = getNum(priorFin, "cogs");
    const pEbit = getNum(priorFin, "ebit");
    const pEbt = getNum(priorFin, "ebt");
    const pNet = getNum(priorFin, "netIncome");
    if (
      Number.isFinite(pRev) &&
      Number.isFinite(pEbit) &&
      Number.isFinite(pNet) &&
      Number.isFinite(pCogs)
    ) {
      const pGp = pRev - pCogs;
      const pDepreciation = periodProfitBridge(priorFin).depreciation;
      const pEbtVal = Number.isFinite(pEbt) ? pEbt : pEbit;
      const pInterest = interestBurdenRatio(pEbit, pEbtVal);
      const pTaxBurden = taxBurdenRatio(pEbtVal, pNet);
      const pTax = Math.max(0, pEbtVal - pNet);
      prior_period = {
        revenue: pRev,
        gross_profit: pGp,
        gross_margin_pct: pGp / pRev,
        gross_margin_score: Math.round(scoreRatio("Gross Margin", pGp / pRev)),
        gross_margin_tier: scoreTier(Math.round(scoreRatio("Gross Margin", pGp / pRev))),
        operating_profit: pEbit,
        operating_margin_pct: pEbit / pRev,
        operating_margin_score: Math.round(scoreRatio("Operating Margin", pEbit / pRev)),
        operating_margin_tier: scoreTier(Math.round(scoreRatio("Operating Margin", pEbit / pRev))),
        ebt: pEbtVal,
        interest_burden_pct: Number.isFinite(pInterest) ? pInterest : undefined,
        interest_burden_score: Number.isFinite(pInterest)
          ? Math.round(scoreRatio("Interest Burden", pInterest))
          : 0,
        tax: pTax,
        tax_burden_pct: Number.isFinite(pTaxBurden) ? pTaxBurden : undefined,
        tax_burden_score: Number.isFinite(pTaxBurden)
          ? Math.round(scoreRatio("Tax Burden", pTaxBurden))
          : 0,
        net_profit: pNet,
        net_margin_pct: pNet / pRev,
        net_margin_score: Math.round(scoreRatio("Net Margin", pNet / pRev)),
        net_margin_tier: scoreTier(Math.round(scoreRatio("Net Margin", pNet / pRev))),
        depreciation: pDepreciation,
      };
    }
  }

  if (
    prior_period &&
    priorFiguresAreCopy(
      { revenue, netIncome: net },
      { revenue: prior_period.revenue, netIncome: prior_period.net_profit },
    )
  ) {
    prior_period = undefined;
  }

  return { ...current, prior_period };
}

/** String map `buildProfitabilityData` already reads. Numbers stringify. */
export function profitabilityStringRecord(
  fin: Record<string, unknown> | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fin) return out;
  for (const [key, value] of Object.entries(fin)) {
    if (typeof value === "number" && Number.isFinite(value)) out[key] = String(value);
    else if (typeof value === "string") out[key] = value;
  }
  return out;
}
