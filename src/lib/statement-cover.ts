/**
 * Statement length and annualised pace shared by Budget and the 13-week forecast.
 * Relative imports only. The ask-ai Deno check loads the forecast through
 * client-metrics, and this file must not pull in browser modules.
 */
import {
  annualiseFinancials,
  FLOW_FIELD_KEYS,
  PERIOD_MONTHS_CHOSEN_KEY,
  PERIOD_MONTHS_KEY,
  periodMonthsOf,
} from "./ratios.ts";

/** Blank or missing P&L lines stay absent. They must not become a zero that forces 100% GP. */
export function presentNumber(...values: Array<string | number | null | undefined>): number | null {
  for (const v of values) {
    if (v == null || v === "") continue;
    const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.-]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Revenue or cost of sales above this multiple of the annualised actual
 * cannot be a growth plan. It is a bad scale (a short period treated as a
 * year, or a year multiplied again). Those plans are rebuilt.
 */
export const BUDGET_BROKEN_SCALE_MULTIPLE = 10;

/** Inclusive day count of a statement span. Null when either date is missing. */
export function inclusivePeriodDays(
  start: string | number | null | undefined,
  end: string | number | null | undefined,
): number | null {
  const fromIso = String(start ?? "").slice(0, 10);
  const toIso = String(end ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromIso) || !/^\d{4}-\d{2}-\d{2}$/.test(toIso)) return null;
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null;
  return Math.round((to - from) / 86_400_000) + 1;
}

function scaleFlowFields<T extends Record<string, unknown>>(fin: T, scale: number): T {
  if (scale === 1) return fin;
  const out: Record<string, unknown> = { ...fin };
  for (const key of FLOW_FIELD_KEYS) {
    const raw = fin[key];
    if (raw === "" || raw == null) continue;
    const n = typeof raw === "number" ? raw : parseFloat(String(raw));
    if (!Number.isFinite(n)) continue;
    const scaled = Math.round(n * scale * 100) / 100;
    out[key] = typeof raw === "number" ? scaled : String(scaled);
  }
  return out as T;
}

/** Stored period length, or null when the blob does not say. */
function explicitPeriodMonths(fin: Record<string, unknown>): number | null {
  const raw = fin[PERIOD_MONTHS_KEY];
  if (raw == null || String(raw).trim() === "") return null;
  const n = typeof raw === "number" ? raw : parseFloat(String(raw));
  if (!Number.isFinite(n) || n < 1 || n > 12) return null;
  return Math.round(n);
}

/** True when the accountant locked "Figures cover" rather than leaving the default. */
function figuresCoverChosen(fin: Record<string, unknown>): boolean {
  return String(fin[PERIOD_MONTHS_CHOSEN_KEY] ?? "").trim() === "1";
}

/**
 * Period P&L → a year, for the budget seed.
 * A dated span shorter than a year uses 365 / inclusive days, so 1–21 Sep
 * is not treated as one month or as a finished year. With no dates,
 * `periodMonths` scales the same way the ratio layer does (missing → 12).
 *
 * A locked Figures cover wins over the dates: 12 months stays a year, and
 * a stated shorter length uses 12 / months. An unlocked length whose day
 * scale is more than {@link BUDGET_BROKEN_SCALE_MULTIPLE} times the stated
 * months is not applied — a two-day label must not turn one month into
 * ~180× a year.
 */
export function annualiseBudgetFinancials<T extends Record<string, unknown>>(fin: T): T {
  // Ratios' stored cover, including an unlocked 9 months. A dated span must
  // not leave that total looking like a 12-month year.
  const cover = periodMonthsOf(fin);
  if (cover >= 2 && cover < 12) {
    return scaleFlowFields(fin, 12 / cover);
  }

  const months = explicitPeriodMonths(fin);
  if (figuresCoverChosen(fin) && months != null) {
    if (months === 12) return fin;
    return scaleFlowFields(fin, 12 / months);
  }

  const days = inclusivePeriodDays(
    fin.periodStart as string | null | undefined,
    fin.periodEnd as string | null | undefined,
  );
  if (days != null && days > 0 && days < 360) {
    const dayScale = 365 / days;
    if (months != null && months < 12) {
      const monthScale = 12 / months;
      if (dayScale > monthScale * BUDGET_BROKEN_SCALE_MULTIPLE) {
        return scaleFlowFields(fin, monthScale);
      }
    }
    return scaleFlowFields(fin, dayScale);
  }
  return annualiseFinancials(fin);
}

export function withCostAliases(
  periodFinancials: Record<string, string | number | null | undefined>,
): Record<string, string | number | null | undefined> {
  const normalised: Record<string, string | number | null | undefined> = { ...periodFinancials };
  if (presentNumber(normalised.cogs) == null && presentNumber(normalised.cost_of_sales) != null) {
    normalised.cogs = normalised.cost_of_sales;
  }
  if (
    presentNumber(normalised.fixedCosts) == null &&
    presentNumber(normalised.operating_expenses) != null
  ) {
    normalised.fixedCosts = normalised.operating_expenses;
  }
  if (presentNumber(normalised.laborCost) == null && presentNumber(normalised.labourCost) != null) {
    normalised.laborCost = normalised.labourCost;
  }
  return normalised;
}

/** Inclusive YYYY-MM keys from a statement start through its end. */
export function statementMonthKeys(
  periodStart: string | null | undefined,
  periodEnd: string | null | undefined,
): string[] | null {
  if (!periodStart || !periodEnd) return null;
  const start = periodStart.slice(0, 7);
  const end = periodEnd.slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(start) || !/^\d{4}-\d{2}$/.test(end) || start > end) return null;
  const out: string[] = [];
  let year = Number(start.slice(0, 4));
  let month = Number(start.slice(5, 7));
  const endYear = Number(end.slice(0, 4));
  const endMonth = Number(end.slice(5, 7));
  for (let guard = 0; guard < 36; guard++) {
    out.push(`${year}-${String(month).padStart(2, "0")}`);
    if (year === endYear && month === endMonth) return out;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return null;
}

export type StatementPeriodBasis =
  | { kind: "dated"; keys: string[]; dayFraction: number | null }
  | { kind: "stored"; months: number }
  | { kind: "unknown" };

/**
 * How long the statement is, for a budget comparison.
 * A stored `periodMonths` is that cover, including 12. Dates are used only
 * when they describe the same length, or when no length is stored.
 * A dated year that only overlaps part of the plan stays that overlap.
 * No length and no dates are unknown — not 12 months.
 */
export function statementPeriodBasis(
  fin: Record<string, unknown> | null | undefined,
): StatementPeriodBasis {
  if (!fin) return { kind: "unknown" };
  const explicit = explicitPeriodMonths(fin);
  const start = typeof fin.periodStart === "string" ? fin.periodStart : null;
  const end = typeof fin.periodEnd === "string" ? fin.periodEnd : null;
  const dated = statementMonthKeys(start, end);
  const days = inclusivePeriodDays(start, end);
  const datesAgree =
    dated != null && dated.length > 0 && (explicit == null || explicit === dated.length);
  if (datesAgree && dated) {
    const partMonth =
      days != null && days < 28 && dated.length <= 1 && (explicit == null || explicit <= 1);
    return {
      kind: "dated",
      keys: dated,
      dayFraction: partMonth ? days / 30 : null,
    };
  }
  if (explicit != null) return { kind: "stored", months: explicit };
  return { kind: "unknown" };
}

/** Month count for a comparison. Null when the period is not on file — not 12. */
export function statementCoverMonthCount(
  fin: Record<string, unknown> | null | undefined,
): number | null {
  const basis = statementPeriodBasis(fin);
  if (basis.kind === "stored") return basis.months;
  if (basis.kind === "dated") return basis.keys.length;
  return null;
}
