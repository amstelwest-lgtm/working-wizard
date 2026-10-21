/**
 * One period for the Budget page and the profit waterfall.
 *
 * A ZA firm year starts in March. A statement that opens in January still
 * contains February of the previous year. The page quotes the months that
 * sit in the firm year, and scales a flat statement by that overlap.
 * A US firm year starts in January, so a January–September statement is
 * already the whole period and is not clipped.
 *
 * A blank line stays null. It is not stored as 0.
 */

import { budgetCoverWindowLabel, statementPeriodBasis } from "@/lib/budget.bridges";
import { firmFyContaining, fyMonths } from "@/lib/budget.months";
import { statementNetProfit } from "@/lib/period-profit";
import { derivePeriodWaterfallFallback, type WaterfallFallback } from "@/lib/weekly-inputs";

const SCALE_KEYS = [
  "revenue",
  "cogs",
  "cost_of_sales",
  "grossProfit",
  "fixedCosts",
  "operating_expenses",
  "laborCost",
  "labourCost",
  "ebit",
  "ebitda",
  "ebt",
  "netIncome",
  "interestExpense",
  "interest",
  "tax",
  "otherIncome",
  "depreciation",
] as const;

export type FiscalStatementSlice = {
  /** "Mar 2026 – Sep 2026, prorated". Null when the statement has no months. */
  label: string | null;
  /** True when the statement was scaled onto a shorter firm-year overlap. */
  prorated: boolean;
  /** Months of the firm year the statement covers. */
  months: number | null;
  revenue: number | null;
  cogs: number | null;
  grossProfit: number | null;
  operatingExpenses: number | null;
  operatingProfit: number | null;
  netProfit: number | null;
};

function clampFy(fyStartMonth: number): number {
  if (!Number.isFinite(fyStartMonth)) return 1;
  return Math.min(12, Math.max(1, Math.round(fyStartMonth)));
}

/** A stored amount. Blank and non-numeric stay null — never 0. */
export function presentAmount(fin: Record<string, unknown>, key: string): number | null {
  const value = fin[key];
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function scaleAmount(value: number | null, scale: number): number | null {
  if (value == null) return null;
  return value * scale;
}

/**
 * Months of this firm year inside the statement.
 * No dates: the stored cover is the period, with no March clip.
 * A dated statement that ends inside the firm year keeps only that overlap.
 */
export function fiscalOverlap(
  fin: Record<string, unknown> | null | undefined,
  fyStartMonth: number,
): { keys: string[]; statementMonths: number; scale: number } | null {
  if (!fin) return null;
  const basis = statementPeriodBasis(fin);
  if (basis.kind === "unknown") return null;
  if (basis.kind === "stored") {
    return { keys: [], statementMonths: basis.months, scale: 1 };
  }
  const end = basis.keys[basis.keys.length - 1];
  if (!end) return null;
  const fy = fyMonths(firmFyContaining(clampFy(fyStartMonth), end));
  const keys = basis.keys.filter((month) => fy.includes(month));
  if (!keys.length) return { keys: [], statementMonths: basis.keys.length, scale: 1 };
  return {
    keys,
    statementMonths: basis.keys.length,
    scale: keys.length / basis.keys.length,
  };
}

export function fiscalPeriodLabel(keys: readonly string[]): string | null {
  if (!keys.length) return null;
  const range = budgetCoverWindowLabel([...keys]);
  if (!range || range === "Statement") return null;
  return `${range}, prorated`;
}

/**
 * Statement flows for the firm-year overlap.
 * Revenue and operating profit are the same numbers the year strip and the
 * waterfall quote. Missing lines stay null.
 */
export function fiscalStatementSlice(
  fin: Record<string, unknown> | null | undefined,
  fyStartMonth: number,
): FiscalStatementSlice | null {
  if (!fin) return null;
  const overlap = fiscalOverlap(fin, fyStartMonth);
  if (!overlap) return null;
  const scale = overlap.scale;
  const revenue = scaleAmount(presentAmount(fin, "revenue"), scale);
  const cogs = scaleAmount(
    presentAmount(fin, "cogs") ?? presentAmount(fin, "cost_of_sales"),
    scale,
  );
  const statedGross = scaleAmount(presentAmount(fin, "grossProfit"), scale);
  const grossProfit =
    statedGross != null ? statedGross : revenue != null && cogs != null ? revenue - cogs : null;
  const operatingExpenses = scaleAmount(
    presentAmount(fin, "fixedCosts") ?? presentAmount(fin, "operating_expenses"),
    scale,
  );
  const operatingProfit = scaleAmount(presentAmount(fin, "ebit"), scale);
  const net = statementNetProfit(fin);
  return {
    label: fiscalPeriodLabel(overlap.keys),
    prorated: overlap.keys.length > 0 && overlap.keys.length < overlap.statementMonths,
    months: overlap.keys.length > 0 ? overlap.keys.length : overlap.statementMonths,
    revenue,
    cogs,
    grossProfit,
    operatingExpenses,
    operatingProfit,
    netProfit: scaleAmount(net, scale),
  };
}

function scalePresentFinancials(
  fin: Record<string, unknown>,
  scale: number,
): Record<string, unknown> {
  if (scale === 1) return fin;
  const out: Record<string, unknown> = { ...fin };
  for (const key of SCALE_KEYS) {
    const amount = presentAmount(fin, key);
    if (amount == null) continue;
    const scaled = amount * scale;
    out[key] = typeof fin[key] === "number" ? scaled : String(scaled);
  }
  return out;
}

export type FiscalWaterfall = {
  slice: FiscalStatementSlice;
  fallback: WaterfallFallback;
  /** Operating profit the waterfall draws. Null when EBIT is not on the statement. */
  operatingProfit: number | null;
};

/**
 * Waterfall fallback for the same firm-year slice as the Budget cards.
 * Stated EBIT is the operating profit. A missing EBIT stays null and is
 * not filled with revenue.
 */
export function fiscalWaterfallFallback(
  fin: Record<string, unknown> | null | undefined,
  fyStartMonth: number,
): FiscalWaterfall | null {
  const slice = fiscalStatementSlice(fin, fyStartMonth);
  if (!slice || !fin) return null;
  const overlap = fiscalOverlap(fin, fyStartMonth);
  const scaled = overlap ? scalePresentFinancials(fin, overlap.scale) : fin;
  const fallback = derivePeriodWaterfallFallback(scaled);
  return {
    slice,
    fallback,
    operatingProfit: slice.operatingProfit,
  };
}

/** Headline revenue and operating profit. The slice wins over the seeded plan. */
export function budgetHeadlineFigures(
  period: FiscalStatementSlice | null | undefined,
  plan?: { revenue?: number | null; operatingProfit?: number | null },
): { revenue: number | null; operatingProfit: number | null; label: string | null } {
  if (period) {
    return {
      revenue: period.revenue,
      operatingProfit: period.operatingProfit,
      label: period.label,
    };
  }
  return {
    revenue: plan?.revenue ?? null,
    operatingProfit: plan?.operatingProfit ?? null,
    label: null,
  };
}
