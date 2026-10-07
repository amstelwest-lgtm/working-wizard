/**
 * Weekly P&L inputs stored on clients.financials.weeklyInputs.
 * Shared by the owner Profit tab and the accountant Profit tab so both
 * waterfalls read the same week aggregates.
 */

import { periodProfitBridge } from "@/lib/period-profit";

export type WeeklyRow = {
  revenue: number;
  costOfSales: number;
  fixedCosts: number;
  cashMovements: number;
  interest: number;
  tax: number;
};

export type WeeklyInputs = {
  weeks: Record<string, WeeklyRow>;
};

export const DEFAULT_WEEKLY_ROW: WeeklyRow = {
  revenue: 0,
  costOfSales: 0,
  fixedCosts: 0,
  cashMovements: 0,
  interest: 0,
  tax: 0,
};

export function emptyWeeklyInputs(): WeeklyInputs {
  return { weeks: {} };
}

/** ISO week key used by the Profit tab weekly P&L grid (`2026-W37`). */
export function getISOWeekKey(date = new Date()): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const week =
    1 + Math.round(((d.getTime() - jan4.getTime()) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
}

function parseRow(raw: unknown): WeeklyRow {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_WEEKLY_ROW };
  const r = raw as Record<string, unknown>;
  return {
    revenue: num(r.revenue),
    costOfSales: num(r.costOfSales),
    fixedCosts: num(r.fixedCosts),
    cashMovements: num(r.cashMovements),
    interest: num(r.interest),
    tax: num(r.tax),
  };
}

/** Coerce a financials.weeklyInputs blob into a typed week map. */
export function parseWeeklyInputs(raw: unknown): WeeklyInputs {
  if (!raw || typeof raw !== "object") return emptyWeeklyInputs();
  const obj = raw as Record<string, unknown>;
  const weeksRaw = obj.weeks;
  if (!weeksRaw || typeof weeksRaw !== "object" || Array.isArray(weeksRaw)) {
    return emptyWeeklyInputs();
  }
  const weeks: Record<string, WeeklyRow> = {};
  for (const [key, value] of Object.entries(weeksRaw as Record<string, unknown>)) {
    if (!key) continue;
    weeks[key] = parseRow(value);
  }
  return { weeks };
}

export function aggregateWeeklyInputs(weekly: WeeklyInputs): Omit<WeeklyRow, "cashMovements"> {
  return Object.values(weekly.weeks).reduce(
    (acc, w) => ({
      revenue: acc.revenue + (w.revenue || 0),
      costOfSales: acc.costOfSales + (w.costOfSales || 0),
      fixedCosts: acc.fixedCosts + (w.fixedCosts || 0),
      interest: acc.interest + (w.interest || 0),
      tax: acc.tax + (w.tax || 0),
    }),
    { revenue: 0, costOfSales: 0, fixedCosts: 0, interest: 0, tax: 0 },
  );
}

export function hasWeeklyProfitFigures(weekly: WeeklyInputs): boolean {
  const agg = aggregateWeeklyInputs(weekly);
  return agg.revenue > 0 || agg.costOfSales > 0;
}

export type WaterfallFallback = {
  revenue: number;
  cogs: number;
  fixedCosts: number;
  /** Non-cash D&A kept off the operating-expense step. Absent means zero. */
  depreciation?: number;
  interest: number;
  tax: number;
};

/** Period P&L → waterfall fallback. Same bridge on owner and accountant. */
export function derivePeriodWaterfallFallback(fields: Record<string, unknown>): WaterfallFallback {
  const bridge = periodProfitBridge(fields);
  return {
    revenue: bridge.revenue,
    cogs: bridge.cogs,
    fixedCosts: bridge.operatingExpenses,
    depreciation: bridge.depreciation,
    interest: bridge.interest,
    tax: bridge.tax,
  };
}

export type ResolvedWaterfallFigures = {
  revenue: number;
  costOfSales: number;
  fixedCosts: number;
  depreciation: number;
  interest: number;
  tax: number;
  source: "weekly" | "period";
};

/**
 * Single figure path for both portals.
 * Weekly totals win once any week has revenue or COGS, unless a ledger
 * statement (Xero) is the source of truth — then the statement period wins
 * so an older week grid cannot hide the synced month.
 */
export function resolveWaterfallFigures(
  weekly: WeeklyInputs,
  fallback?: WaterfallFallback,
  opts?: { preferPeriod?: boolean },
): ResolvedWaterfallFigures {
  const agg = aggregateWeeklyInputs(weekly);
  const hasWeekly = hasWeeklyProfitFigures(weekly) && !opts?.preferPeriod;
  return {
    revenue: hasWeekly ? agg.revenue : (fallback?.revenue ?? 0),
    costOfSales: hasWeekly ? agg.costOfSales : (fallback?.cogs ?? 0),
    fixedCosts: hasWeekly ? agg.fixedCosts : (fallback?.fixedCosts ?? 0),
    depreciation: hasWeekly ? 0 : (fallback?.depreciation ?? 0),
    interest: hasWeekly ? agg.interest : (fallback?.interest ?? 0),
    tax: hasWeekly ? agg.tax : (fallback?.tax ?? 0),
    source: hasWeekly ? "weekly" : "period",
  };
}

export function hasWeeklyActivity(weekly: WeeklyInputs): boolean {
  return Object.values(weekly.weeks).some(
    (w) =>
      (w.revenue || 0) !== 0 ||
      (w.costOfSales || 0) !== 0 ||
      (w.fixedCosts || 0) !== 0 ||
      (w.cashMovements || 0) !== 0 ||
      (w.interest || 0) !== 0 ||
      (w.tax || 0) !== 0,
  );
}

/** Overlay weeks onto an existing financials blob without wiping period scalars or debt. */
export function overlayWeeklyInputs(
  existing: Record<string, unknown> | null | undefined,
  weekly: WeeklyInputs,
): Record<string, unknown> {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing) ? { ...existing } : {};
  base.weeklyInputs = weekly;
  return base;
}
