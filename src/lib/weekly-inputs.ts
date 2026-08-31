/**
 * Weekly P&L inputs stored on clients.financials.weeklyInputs.
 * Shared by the owner Profit tab and the accountant Profit tab so both
 * waterfalls read the same week aggregates.
 */

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
  interest: number;
  tax: number;
};

function fieldPresent(fields: Record<string, unknown>, key: string): boolean {
  const v = fields[key];
  return v != null && String(v) !== "";
}

function fieldNum(fields: Record<string, unknown>, key: string): number {
  const v = fields[key];
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

/** Period P&L → waterfall fallback. Same residual rules on owner and accountant. */
export function derivePeriodWaterfallFallback(
  fields: Record<string, unknown>,
): WaterfallFallback {
  const revenue = fieldNum(fields, "revenue");
  const cogs = fieldNum(fields, "cogs");
  const gross = revenue - cogs;
  const fixedCosts = fieldPresent(fields, "fixedCosts")
    ? fieldNum(fields, "fixedCosts")
    : fieldPresent(fields, "ebit")
      ? gross - fieldNum(fields, "ebit")
      : 0;
  const interest =
    fieldPresent(fields, "ebit") && fieldPresent(fields, "ebt")
      ? fieldNum(fields, "ebit") - fieldNum(fields, "ebt")
      : 0;
  const tax =
    fieldPresent(fields, "ebt") && fieldPresent(fields, "netIncome")
      ? fieldNum(fields, "ebt") - fieldNum(fields, "netIncome")
      : 0;
  return { revenue, cogs, fixedCosts, interest, tax };
}

export type ResolvedWaterfallFigures = {
  revenue: number;
  costOfSales: number;
  fixedCosts: number;
  interest: number;
  tax: number;
  source: "weekly" | "period";
};

/** Single figure path for both portals — weekly totals win once any week has revenue or COGS. */
export function resolveWaterfallFigures(
  weekly: WeeklyInputs,
  fallback?: WaterfallFallback,
): ResolvedWaterfallFigures {
  const agg = aggregateWeeklyInputs(weekly);
  const hasWeekly = hasWeeklyProfitFigures(weekly);
  return {
    revenue: hasWeekly ? agg.revenue : (fallback?.revenue ?? 0),
    costOfSales: hasWeekly ? agg.costOfSales : (fallback?.cogs ?? 0),
    fixedCosts: hasWeekly ? agg.fixedCosts : (fallback?.fixedCosts ?? 0),
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
