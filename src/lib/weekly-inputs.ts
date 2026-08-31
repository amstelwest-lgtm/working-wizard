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

/** Waterfall prefers weekly totals once any week has revenue or COGS. */
export function hasWeeklyProfitFigures(weekly: WeeklyInputs): boolean {
  const agg = aggregateWeeklyInputs(weekly);
  return agg.revenue > 0 || agg.costOfSales > 0;
}
