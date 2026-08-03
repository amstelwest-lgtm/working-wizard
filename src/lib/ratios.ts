export type HealthTier = "critical" | "at_risk" | "healthy";

/**
 * Single source of truth for score -> tier classification.
 * Thresholds match the playbook data ranges (critical 0-40, at_risk 40-65,
 * healthy 65-100) — previously several report files independently
 * hardcoded a >=70 healthy cutoff, which disagreed with the playbook data's
 * 65 cutoff and could show the wrong tier's interventions for scores 65-69.
 */
export function scoreTier(score?: number | null): HealthTier {
  if (score == null) return "at_risk";
  if (score >= 65) return "healthy";
  if (score >= 40) return "at_risk";
  return "critical";
}

export type RatioInputs = {
  netIncome: string;
  ebt: string;
  ebit: string;
  revenue: string;
  totalAssets: string;
  equity: string;
  cogs: string;
  receivables: string;
  inventory: string;
  payables: string;
  fixedCosts: string;
  variableCosts: string;
  top5Revenue: string;
  laborCost: string;
  employees: string;
  operatingCashflow: string;
  ebitda: string;
  founderHours: string;
};

export const BUSINESS_TYPE_TO_BENCHMARK: Record<string, string> = {
  service: "services",
  agency: "services",
  product: "other",
  saas: "saas",
  marketplace: "other",
  asset_heavy: "other",
  distribution: "other",
  retail: "retail",
  manufacturing: "manufacturing",
  project: "professional",
  franchise: "retail",
  subscription: "saas",
  logistics: "other",
  hospitality: "hospitality",
  healthcare: "professional",
  construction: "construction",
  hybrid: "other",
};

export function computeRatios(v: RatioInputs): Record<string, number> {
  // A blank field means "no data", not "zero" — parsing it to NaN lets that
  // distinction flow through every formula below (arithmetic on NaN yields
  // NaN), instead of silently becoming 0 and looking like confident,
  // real data. Consumers should treat non-finite ratio values as
  // "insufficient data" rather than 0.
  const num = (s: string) => (s === "" ? NaN : parseFloat(s));
  const n = Object.fromEntries(
    Object.entries(v).map(([k, val]) => [k, num(val as string)]),
  ) as Record<keyof RatioInputs, number>;
  // b === 0 still short-circuits to 0 for a genuine zero denominator from a
  // real (non-blank) input — e.g. a service business with R0 COGS is a
  // true "no cost" case, not missing data. NaN inputs propagate naturally
  // since NaN !== 0 and any arithmetic on NaN yields NaN.
  const safe = (a: number, b: number) => (b === 0 ? 0 : a / b);

  const operatingMargin = safe(n.ebit, n.revenue);
  const netMargin = safe(n.netIncome, n.revenue);
  const grossMargin = safe(n.revenue - n.cogs, n.revenue);
  const assetTurnover = safe(n.revenue, n.totalAssets);
  const equityMultiplier = safe(n.totalAssets, n.equity);
  const roa = netMargin * assetTurnover;
  // ROE, Interest Burden, and Tax Burden are only meaningful when their
  // base (equity / EBIT / EBT) is positive. A negative base can cancel a
  // negative numerator and produce a misleadingly positive ratio — e.g. a
  // loss-making, negative-equity business showing a spectacular positive
  // ROE. Force these to NaN ("n/m" — not meaningful) instead.
  const roe = n.equity > 0 ? roa * equityMultiplier : NaN;
  const debtorDays = safe(n.receivables, n.revenue) * 365;
  const inventoryDays = safe(n.inventory, n.cogs) * 365;
  const creditorDays = safe(n.payables, n.cogs) * 365;
  const wcDays = debtorDays + inventoryDays - creditorDays;
  const fcr = safe(n.fixedCosts, n.revenue);
  const cm = n.revenue - n.variableCosts;
  const dol = safe(cm, n.ebit);
  const cc = safe(n.top5Revenue, n.revenue);
  const gpToLabor = safe(n.revenue - n.cogs, n.laborCost);
  const spe = safe(n.revenue, n.employees);
  const ocfEbitda = safe(n.operatingCashflow, n.ebitda);
  const interestBurden = n.ebit > 0 ? safe(n.ebt, n.ebit) : NaN;
  const taxBurden = n.ebt > 0 ? safe(n.netIncome, n.ebt) : NaN;

  return {
    "Net Margin": netMargin,
    "Operating Margin": operatingMargin,
    "Gross Margin": grossMargin,
    "Return on Equity": roe,
    "Return on Assets": roa,
    "Asset Turnover": assetTurnover,
    "Equity Multiplier": equityMultiplier,
    "Interest Burden": interestBurden,
    "Tax Burden": taxBurden,
    "Debtor Days": debtorDays,
    "Inventory Days": inventoryDays,
    "Creditor Days": creditorDays,
    "Working Capital Days": wcDays,
    "Fixed Cost Ratio": fcr,
    "Degree of Operating Leverage": dol,
    "Top-5 Customer Share": cc,
    "Gross Profit / Labor": gpToLabor,
    "Sales-per-Employee Ratio": spe,
    "OCF / EBITDA": ocfEbitda,
  };
}
