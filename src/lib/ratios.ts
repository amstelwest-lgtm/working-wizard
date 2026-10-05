export type HealthTier = "critical" | "at_risk" | "healthy";

export type HealthBandLabel = "Critical" | "Watch" | "Healthy";

/**
 * One band table for Overview, Health, the PDFs, the Bot, and the Scorecard
 * legend. Do not hardcode 40 / 65 / 70 anywhere else.
 *
 * #272 scored cash runway as healthy only from 12 weeks (score 85), watch
 * from 4 weeks (score 45) through 8 weeks (score 65), and critical below
 * 4 weeks (score 25). A healthy floor of 65 labelled that 8-week runway,
 * and this client's overall of 71, as Healthy on some surfaces and Watch
 * on others. Healthy therefore starts at 80: 71 is Watch, a 12-week runway
 * (85) stays Healthy, and critical remains below 40.
 *
 * Playbook step packs were written on the older 65 healthy floor. Tier
 * selection uses this table, so a score of 65–79 opens the Watch pack.
 */
/**
 * How a metric moves when the business gets healthier, plus the native-unit
 * range that scores as the healthy band. Reports, the scorecard, and
 * Playbooks read this — they do not keep a private higher-is-better flag.
 *
 * `sweet_spot` is not monotone: creditor days of 30–60 score 100, and a
 * figure past the top of that range (329 days) is paying slowly.
 */
export type MetricDirection = "higher_is_better" | "lower_is_better" | "sweet_spot";

export type MetricDirectionSpec = {
  key: string;
  /** `computeRatios` name, when the metric has one. */
  name: string;
  direction: MetricDirection;
  /** Inclusive native-unit healthy band. A null side is open. */
  healthyMin: number | null;
  healthyMax: number | null;
  /** Lower-is-better linear score hits 0 at this value (debtor days: 90). */
  zeroAt?: number;
};

export const METRIC_DIRECTIONS: readonly MetricDirectionSpec[] = [
  { key: "grossMargin", name: "Gross Margin", direction: "higher_is_better", healthyMin: 0.32, healthyMax: null },
  { key: "operatingMargin", name: "Operating Margin", direction: "higher_is_better", healthyMin: 0.16, healthyMax: null },
  { key: "netMargin", name: "Net Margin", direction: "higher_is_better", healthyMin: 0.12, healthyMax: null },
  { key: "roa", name: "Return on Assets", direction: "higher_is_better", healthyMin: 0.096, healthyMax: null },
  { key: "roe", name: "Return on Equity", direction: "higher_is_better", healthyMin: 0.16, healthyMax: null },
  { key: "assetTurnover", name: "Asset Turnover", direction: "higher_is_better", healthyMin: 1.2, healthyMax: null },
  { key: "gpToLabor", name: "Gross Profit / Labor", direction: "higher_is_better", healthyMin: 0.48, healthyMax: null },
  { key: "salesPerEmployee", name: "Sales-per-Employee Ratio", direction: "higher_is_better", healthyMin: null, healthyMax: null },
  { key: "ocfToEbitda", name: "OCF / EBITDA", direction: "higher_is_better", healthyMin: 0.8, healthyMax: null },
  { key: "interestBurden", name: "Interest Burden", direction: "higher_is_better", healthyMin: 0.8, healthyMax: null },
  { key: "taxBurden", name: "Tax Burden", direction: "higher_is_better", healthyMin: 0.8, healthyMax: null },
  { key: "currentRatio", name: "Current Ratio", direction: "higher_is_better", healthyMin: 1.6, healthyMax: null },
  { key: "revenueGrowth", name: "Revenue Growth", direction: "higher_is_better", healthyMin: 0.16, healthyMax: null },
  { key: "fixedCostRatio", name: "Fixed Cost Ratio", direction: "lower_is_better", healthyMin: null, healthyMax: 0.1, zeroAt: 0.5 },
  { key: "customerConcentration", name: "Top-5 Customer Share", direction: "lower_is_better", healthyMin: null, healthyMax: 0.16, zeroAt: 0.8 },
  { key: "debtorDays", name: "Debtor Days", direction: "lower_is_better", healthyMin: null, healthyMax: 18, zeroAt: 90 },
  { key: "inventoryDays", name: "Inventory Days", direction: "lower_is_better", healthyMin: null, healthyMax: 18, zeroAt: 90 },
  { key: "wipDays", name: "WIP Days", direction: "lower_is_better", healthyMin: null, healthyMax: 18, zeroAt: 90 },
  { key: "workingCapitalDays", name: "Working Capital Days", direction: "lower_is_better", healthyMin: null, healthyMax: 18, zeroAt: 90 },
  { key: "equityMultiplier", name: "Equity Multiplier", direction: "lower_is_better", healthyMin: null, healthyMax: 1.6 },
  { key: "debtToEquity", name: "Debt-to-Equity", direction: "lower_is_better", healthyMin: null, healthyMax: 0.4 },
  { key: "debtToAssets", name: "Debt-to-Assets", direction: "lower_is_better", healthyMin: null, healthyMax: 0.14 },
  { key: "creditorDays", name: "Creditor Days", direction: "sweet_spot", healthyMin: 30, healthyMax: 60 },
];

const METRIC_BY_KEY = new Map(METRIC_DIRECTIONS.map((spec) => [spec.key, spec]));
const METRIC_BY_NAME = new Map(METRIC_DIRECTIONS.map((spec) => [spec.name, spec]));

/** Direction row for a playbook key or a `computeRatios` name. */
export function metricDirection(keyOrName: string): MetricDirectionSpec | null {
  return METRIC_BY_KEY.get(keyOrName) ?? METRIC_BY_NAME.get(keyOrName) ?? null;
}

/** Distance outside the healthy band. Inside the band the distance is 0. */
export function outsideHealthyBand(
  value: number,
  healthyMin: number | null,
  healthyMax: number | null,
): number {
  if (!Number.isFinite(value)) return Number.POSITIVE_INFINITY;
  if (healthyMin != null && value < healthyMin) return healthyMin - value;
  if (healthyMax != null && value > healthyMax) return value - healthyMax;
  return 0;
}

/**
 * The peer percentile that is the healthy end of the band.
 * Higher-is-better uses p75. Lower-is-better uses p25 — p75 is the worse tail
 * (debtor days 60 vs a median of 40, fixed costs 60% vs 45%). A sweet spot
 * uses whichever percentile sits closer to the healthy range.
 */
export function benchmarkHealthyEnd(
  spec: MetricDirectionSpec,
  p25: number,
  p75: number,
): { top: number; lowerIsBetter: boolean } {
  if (spec.direction === "lower_is_better") return { top: p25, lowerIsBetter: true };
  if (spec.direction === "higher_is_better") return { top: p75, lowerIsBetter: false };
  const d25 = outsideHealthyBand(p25, spec.healthyMin, spec.healthyMax);
  const d75 = outsideHealthyBand(p75, spec.healthyMin, spec.healthyMax);
  if (d25 < d75) return { top: p25, lowerIsBetter: true };
  return { top: p75, lowerIsBetter: false };
}

export type BenchmarkPosition = "top_quartile" | "above_median" | "below_median";

/** Where a value sits versus the median and the healthy-end quartile. */
export function benchmarkPosition(input: {
  value: number;
  median: number;
  top: number;
  direction: MetricDirection;
  healthyMin?: number | null;
  healthyMax?: number | null;
}): BenchmarkPosition {
  if (input.direction === "sweet_spot") {
    const dist = (v: number) =>
      outsideHealthyBand(v, input.healthyMin ?? null, input.healthyMax ?? null);
    const valueDist = dist(input.value);
    const medianDist = dist(input.median);
    const topDist = dist(input.top);
    if (valueDist <= topDist && valueDist <= medianDist) return "top_quartile";
    if (valueDist <= medianDist) return "above_median";
    return "below_median";
  }
  const better =
    input.direction === "lower_is_better"
      ? (a: number, b: number) => a <= b
      : (a: number, b: number) => a >= b;
  if (better(input.value, input.top)) return "top_quartile";
  if (better(input.value, input.median)) return "above_median";
  return "below_median";
}

/**
 * Bar track, 0–1, with the right-hand side always the healthier end.
 * Sweet-spot metrics use distance from the healthy range, so 329 creditor
 * days sits to the left of a 30-day median.
 */
export function benchmarkTrack(input: {
  value: number;
  median: number;
  top: number;
  direction: MetricDirection;
  lowerIsBetter?: boolean;
  healthyMin?: number | null;
  healthyMax?: number | null;
}): { pos: number; bandStart: number; bandEnd: number } {
  const goodness = (v: number) => {
    if (input.direction === "sweet_spot") {
      return -outsideHealthyBand(v, input.healthyMin ?? null, input.healthyMax ?? null);
    }
    const lower = input.direction === "lower_is_better" || input.lowerIsBetter === true;
    return lower ? -v : v;
  };
  const vals = [goodness(input.value), goodness(input.median), goodness(input.top)];
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.25;
  lo -= pad;
  hi += pad;
  const span = hi - lo || 1;
  const t = (v: number) => (goodness(v) - lo) / span;
  return { pos: t(input.value), bandStart: t(input.median), bandEnd: t(input.top) };
}

/** Creditor-days healthy band from the shared table (30–60). Not the score Watch floor. */
export function creditorDaysHealthyBand(): { min: number; max: number } {
  const spec = metricDirection("creditorDays");
  return { min: spec?.healthyMin ?? 30, max: spec?.healthyMax ?? 60 };
}

/** True when creditor days are past the healthy band — paying slowly, not early. */
export function creditorDaysPaysSlowly(days: number): boolean {
  const max = creditorDaysHealthyBand().max;
  return Number.isFinite(days) && days > max;
}

/** Step 1 copy for #02 when creditor days are above the healthy band. */
export const SLOW_CREDITOR_DAYS_STEP = {
  step_title: "High creditor days — suppliers are being paid slowly",
  step_description:
    "Creditor days this high mean the business is paying suppliers slowly. That is a supplier-relationship and arrears risk: invoices are outstanding past a normal term. Separate agreed terms from overdue balances, agree a catch-up with the suppliers that can stop supply, and do not stretch payment any further.",
} as const;

export const HEALTH_BAND_TABLE = {
  /** Scores below this are Critical. */
  watchMin: 40 as const,
  /** Scores at or above this are Healthy. From watchMin up to here is Watch. */
  healthyMin: 80 as const,
  /** Per-metric direction and native healthy range. Same table as the score bands. */
  metrics: METRIC_DIRECTIONS,
};

const HEALTH_BAND_LABEL: Record<HealthTier, HealthBandLabel> = {
  critical: "Critical",
  at_risk: "Watch",
  healthy: "Healthy",
};

/** Chip / PDF / sphere label for a tier. Overview, Health, and the Bot share this. */
export function healthBandLabel(tier: HealthTier): HealthBandLabel {
  return HEALTH_BAND_LABEL[tier];
}

/** Score → tier. Null or non-finite scores are Watch, not a fake Healthy. */
export function scoreTier(score?: number | null): HealthTier {
  if (score == null || !Number.isFinite(score)) return "at_risk";
  if (score >= HEALTH_BAND_TABLE.healthyMin) return "healthy";
  if (score >= HEALTH_BAND_TABLE.watchMin) return "at_risk";
  return "critical";
}

/**
 * Pillar band from `HEALTH_BAND_TABLE`, then capped.
 * A rounded average can cross the healthy floor while every component
 * score is still Watch or Critical (79.6 and 79.6 round to 80). The pillar
 * must not read Healthy in that case. Overview, Health, and the Bot share this.
 */
export function bandedPillarStatus(
  score: number | null,
  componentScores: readonly number[],
): HealthTier {
  const fromScore = scoreTier(score);
  const tiers = componentScores
    .filter((n) => Number.isFinite(n))
    .map((n) => scoreTier(n));
  if (fromScore === "healthy" && tiers.length > 0 && tiers.every((t) => t !== "healthy")) {
    return "at_risk";
  }
  return fromScore;
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
