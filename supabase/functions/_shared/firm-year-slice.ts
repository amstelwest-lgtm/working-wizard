/**
 * Firm-year overlap for ask-ai and milon-bot.
 * The month filter and the scale match `fiscalStatementSlice` in
 * `src/lib/budget-period.ts`. The label is `proratedPeriodLabel` from the
 * Deno twin, not a second sentence built here.
 * Relative imports only, so the Deno check does not load the market barrel.
 */

import { statementNetProfit } from "../../../src/lib/period-profit.ts";
import { statementPeriodBasis } from "../../../src/lib/statement-cover.ts";
import { proratedPeriodLabel } from "./firm-year-label.ts";

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

export type FirmYearSlice = {
  label: string | null;
  prorated: boolean;
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

function fyMonths(fyStart: string): string[] {
  const [y0, m0] = fyStart.split("-").map(Number);
  const out: string[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(y0, m0 - 1 + i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

function firmFyContaining(fyStartMonth: number, ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const startYear = m >= fyStartMonth ? y : y - 1;
  return `${startYear}-${String(fyStartMonth).padStart(2, "0")}`;
}

function presentAmount(fin: Record<string, unknown>, key: string): number | null {
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

function overlapOf(
  fin: Record<string, unknown>,
  fyStartMonth: number,
): { keys: string[]; statementKeys: string[]; statementMonths: number; scale: number } | null {
  const basis = statementPeriodBasis(fin);
  if (basis.kind === "unknown") return null;
  if (basis.kind === "stored") {
    return { keys: [], statementKeys: [], statementMonths: basis.months, scale: 1 };
  }
  const end = basis.keys[basis.keys.length - 1];
  if (!end) return null;
  const fy = fyMonths(firmFyContaining(clampFy(fyStartMonth), end));
  const keys = basis.keys.filter((month) => fy.includes(month));
  if (!keys.length) {
    return { keys: [], statementKeys: basis.keys, statementMonths: basis.keys.length, scale: 1 };
  }
  return {
    keys,
    statementKeys: basis.keys,
    statementMonths: basis.keys.length,
    scale: keys.length / basis.keys.length,
  };
}

function scalePresentFinancials(fin: Record<string, unknown>, scale: number): Record<string, unknown> {
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

/** Statement flows for the firm-year overlap. A missing line stays null. */
export function firmYearSlice(
  fin: Record<string, unknown> | null | undefined,
  fyStartMonth: number,
): FirmYearSlice | null {
  if (!fin) return null;
  const overlap = overlapOf(fin, fyStartMonth);
  if (!overlap) return null;
  const scale = overlap.scale;
  const revenue = scaleAmount(presentAmount(fin, "revenue"), scale);
  const cogs = scaleAmount(presentAmount(fin, "cogs") ?? presentAmount(fin, "cost_of_sales"), scale);
  const statedGross = scaleAmount(presentAmount(fin, "grossProfit"), scale);
  const grossProfit =
    statedGross != null ? statedGross : revenue != null && cogs != null ? revenue - cogs : null;
  const operatingExpenses = scaleAmount(
    presentAmount(fin, "fixedCosts") ?? presentAmount(fin, "operating_expenses"),
    scale,
  );
  const operatingProfit = scaleAmount(presentAmount(fin, "ebit"), scale);
  const prorated = overlap.keys.length > 0 && overlap.keys.length < overlap.statementMonths;
  return {
    label: prorated ? proratedPeriodLabel(overlap.keys, overlap.statementKeys) : null,
    prorated,
    months: overlap.keys.length > 0 ? overlap.keys.length : overlap.statementMonths,
    revenue,
    cogs,
    grossProfit,
    operatingExpenses,
    operatingProfit,
    netProfit: scaleAmount(statementNetProfit(fin), scale),
  };
}

/**
 * Scaled statement when the firm-year slice is applied.
 * The original statement otherwise.
 */
export function firmYearStatement(
  fin: Record<string, unknown> | null | undefined,
  fyStartMonth: number,
): { slice: FirmYearSlice; financials: Record<string, unknown>; applied: boolean } | null {
  const slice = firmYearSlice(fin, fyStartMonth);
  if (!slice || !fin) return null;
  const overlap = overlapOf(fin, fyStartMonth);
  const applied = slice.prorated;
  const financials = applied && overlap ? scalePresentFinancials(fin, overlap.scale) : fin;
  return { slice, financials, applied };
}
