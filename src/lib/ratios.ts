export type HealthTier = "critical" | "at_risk" | "healthy";

/**
 * Single source of truth for score -> tier classification.
 * Thresholds match the playbook data ranges (critical 0-40, at_risk 40-65,
 * healthy 65-100) — previously several report files independently
 * hardcoded a >=70 healthy cutoff, which disagreed with the playbook data's
 * 65 cutoff and could show the wrong tier's interventions for scores 65-69.
 */
export function scoreTier(score?: number | null): HealthTier {
  if (score == null || !Number.isFinite(score)) return "at_risk";
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
  /**
   * Months the P&L / cash-flow figures cover (1–12). Absent or invalid means
   * 12 — the historical assumption. Balance-sheet fields are point-in-time
   * and are never scaled.
   */
  periodMonths?: string;
};

/** Blob key under which the period length is stored alongside the figures. */
export const PERIOD_MONTHS_KEY = "periodMonths";

export const PERIOD_MONTH_OPTIONS: { months: number; label: string }[] = [
  { months: 12, label: "12 months (annual)" },
  { months: 6, label: "6 months" },
  { months: 3, label: "3 months (quarter)" },
  { months: 1, label: "1 month" },
];

/** Flow fields that scale with the period length; stock fields do not. */
export const FLOW_FIELD_KEYS = [
  "revenue",
  "cogs",
  "ebit",
  "ebt",
  "netIncome",
  "ebitda",
  "operatingCashflow",
  "fixedCosts",
  "variableCosts",
  "top5Revenue",
  "laborCost",
] as const satisfies readonly (keyof RatioInputs)[];

/** Period length recorded on a financials blob; 12 when missing or invalid. */
export function periodMonthsOf(fin: Record<string, unknown> | null | undefined): number {
  const raw = fin?.[PERIOD_MONTHS_KEY];
  const n = typeof raw === "number" ? raw : parseFloat(String(raw ?? ""));
  return Number.isFinite(n) && n >= 1 && n <= 12 ? Math.round(n) : 12;
}

/**
 * Scale the flow fields of a period P&L up to a 12-month equivalent so days
 * ratios, returns and turnover read correctly for a quarter or a month of
 * actuals. Returns the input untouched when it already covers 12 months.
 */
export function annualiseFinancials<T extends Record<string, unknown>>(fin: T): T {
  const months = periodMonthsOf(fin);
  if (months === 12) return fin;
  const scale = 12 / months;
  const out: Record<string, unknown> = { ...fin };
  for (const key of FLOW_FIELD_KEYS) {
    const raw = fin[key];
    if (raw === "" || raw == null) continue;
    const n = typeof raw === "number" ? raw : parseFloat(String(raw));
    if (!Number.isFinite(n)) continue;
    const scaled = Math.round(n * scale * 100) / 100;
    out[key] = typeof raw === "number" ? scaled : String(scaled);
  }
  out[PERIOD_MONTHS_KEY] = "12";
  return out as T;
}

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
  // Flow figures are annualised first so a quarter of actuals is not read as a
  // (tiny) year — DIO/DSO would otherwise be 4× too long and returns 4× too low.
  const n = Object.fromEntries(
    Object.entries(annualiseFinancials(v)).map(([k, val]) => [k, num(String(val ?? ""))]),
  ) as Record<keyof RatioInputs, number>;
  // Genuine 0/0 from *entered* zeros still short-circuits to 0 — e.g. a
  // service business with R0 COGS and R0 inventory is a true "no stock"
  // case. A missing (NaN) numerator must not collapse to 0 just because
  // the denominator happens to be 0; that invented 0 then gets scored
  // and averaged into health orbs.
  const safe = (a: number, b: number) => {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
    return b === 0 ? 0 : a / b;
  };

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
