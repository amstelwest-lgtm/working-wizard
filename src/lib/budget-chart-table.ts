/**
 * Display copy for the Budget chart and table.
 * Figures come from computeBudgetMonths and varianceLine. This file does not
 * recalculate a budget or write actuals.
 */
import type { BudgetDocument, BudgetMonthResult } from "@/lib/budget.types";
import { computeBudgetMonths } from "@/lib/budget.compute";
import { fyMonths } from "@/lib/budget.months";
import {
  normalizeTaxonomyTotals,
  varianceLine,
  type TaxonomyTotals,
  type VarianceLine,
  type VarianceSignal,
} from "@/lib/budget.variance";

export type BudgetLens = "chart" | "table";

export function budgetLensFromSearch(value: unknown): BudgetLens {
  return value === "table" ? "table" : "chart";
}

export type BudgetActualMonth = {
  month: string;
  totals: Partial<TaxonomyTotals>;
};

export type BudgetMonthView = {
  month: string;
  budget: BudgetMonthResult;
  actual: TaxonomyTotals | null;
  revenue: VarianceLine | null;
};

/** A drafted plan has no month of revenue. Sub-dollar noise does not count. */
export function budgetPlanIsSet(views: readonly { budget: { revenue: number } }[]): boolean {
  return views.some((row) => Math.abs(row.budget.revenue) >= 1);
}

/**
 * Chart axis for the larger of budget and actual. A zero series stays unset
 * so a drafted plan is not drawn as $0–$4.
 */
/** Step of 1, 2 or 5 × 10^n. Same rule as a d3 nice scale. */
function niceStep(rough: number): number {
  if (!Number.isFinite(rough) || rough <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const n = rough / pow;
  const base = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return base * pow;
}

/**
 * Evenly spaced axis. $20k / $40k / $70k is what an auto scale prints when
 * the top tick is the data max. These ticks share one step.
 */
export function niceBudgetAxis(
  values: readonly (number | null | undefined)[],
  count = 4,
): { domain: [number, number]; ticks: number[] } | null {
  const nums = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (nums.length === 0) return null;
  const peak = Math.max(...nums.map((value) => Math.abs(value)));
  if (peak < 1) return null;
  const dataMin = Math.min(0, ...nums);
  const dataMax = Math.max(0, ...nums);
  const span = Math.max(dataMax - dataMin, peak);
  const step = niceStep(span / Math.max(1, count));
  const lo = Math.floor(dataMin / step + 1e-9) * step;
  let hi = Math.ceil(dataMax / step - 1e-9) * step;
  if (hi <= dataMax) hi += step;
  if (hi <= lo) hi = lo + step;
  const ticks: number[] = [];
  const places = Math.min(6, Math.max(0, -Math.floor(Math.log10(step))));
  const factor = 10 ** places;
  for (let i = 0; i < 12; i++) {
    const raw = lo + i * step;
    const tick = Math.round(raw * factor) / factor;
    ticks.push(tick);
    if (raw >= hi - step * 1e-6) break;
  }
  const top = ticks[ticks.length - 1] ?? hi;
  const bottom = ticks[0] ?? lo;
  return { domain: [bottom, top], ticks };
}

export function budgetChartDomain(
  values: readonly (number | null | undefined)[],
): [number, number] | undefined {
  const nums = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (nums.length === 0) return undefined;
  const peak = Math.max(...nums.map((value) => Math.abs(value)));
  if (peak < 1) return undefined;
  const padded = peak * 1.1;
  const exp = 10 ** Math.floor(Math.log10(padded));
  const nice = Math.ceil(padded / exp) * exp;
  const floor = Math.min(0, ...nums);
  return [floor < 0 ? -nice : 0, nice];
}

export function budgetMonthViews(
  doc: BudgetDocument,
  actuals: readonly BudgetActualMonth[],
): BudgetMonthView[] {
  const results = computeBudgetMonths(doc, doc.activeScenario);
  const byMonth = new Map(
    actuals.map((row) => [row.month, normalizeTaxonomyTotals(row.totals)]),
  );
  return results.map((budget) => {
    const actual = byMonth.get(budget.month) ?? null;
    return {
      month: budget.month,
      budget,
      actual,
      revenue: actual
        ? varianceLine("revenue", "Revenue", budget.revenue, actual.revenue, true)
        : null,
    };
  });
}

/**
 * Revenue year-to-date colour. Higher revenue is favourable, so "under" is
 * adverse (red) and "over" is favourable (green). Null when there are no actuals.
 */
export function budgetYtdSignal(input: { budget: number; actual: number | null }): VarianceSignal | null {
  if (input.actual == null) return null;
  return varianceLine("revenue", "Revenue", input.budget, input.actual, true).signal;
}

/**
 * Overview Budget tile. Callers pass the same compact money formatter as Cash.
 * Seeded or no actual: "R 426k budget". Compared: "R 420k vs R 426k budget".
 * No budget stays blank.
 */
export function overviewBudgetTileFigure(input: {
  budgetRevenue?: number | null;
  actualRevenue?: number | null;
  seeded?: boolean;
  money: (n: number) => string;
}): string | null {
  const budget = input.budgetRevenue;
  if (typeof budget !== "number" || !Number.isFinite(budget) || Math.abs(budget) < 1) return null;
  const budgetText = input.money(budget);
  const actual = input.actualRevenue;
  if (input.seeded || typeof actual !== "number" || !Number.isFinite(actual)) {
    return `${budgetText} budget`;
  }
  return `${input.money(actual)} vs ${budgetText} budget`;
}

/** Revenue year-to-date. Months without actuals stay out of the comparison. */
/** Month rows are the only actual. A full-year statement figure is not YTD. */
export function budgetYtdWithStatement(
  ytd: { budget: number; actual: number | null },
  _statement?: { chip?: string | null; revenue?: number | null; budgetRevenue?: number | null } | null,
): { budget: number; actual: number | null } {
  return ytd;
}

export function budgetYtdSentence(input: {
  budget: number;
  actual: number | null;
  money: (n: number) => string;
}): string {
  if (input.actual == null) return "No monthly actuals yet";
  const budget = input.money(input.budget);
  const actual = input.money(input.actual);
  const delta = input.actual - input.budget;
  if (Math.abs(delta) < 1) {
    return `YTD: actual ${actual} vs budget ${budget} · in line.`;
  }
  const word = delta > 0 ? "over" : "under";
  return `YTD: actual ${actual} vs budget ${budget} · ${input.money(Math.abs(delta))} ${word}.`;
}

export function revenueYtd(views: readonly BudgetMonthView[], throughMonth: string): {
  budget: number;
  actual: number | null;
} {
  const ytd = views.filter((row) => row.month <= throughMonth);
  const compared = ytd.filter((row) => row.actual);
  if (compared.length === 0) {
    return {
      budget: ytd.reduce((sum, row) => sum + row.budget.revenue, 0),
      actual: null,
    };
  }
  return {
    budget: compared.reduce((sum, row) => sum + row.budget.revenue, 0),
    actual: compared.reduce((sum, row) => sum + (row.actual?.revenue ?? 0), 0),
  };
}

export type BudgetRangeTotals = {
  revenue: number;
  expenses: number;
  net: number;
};

/** Revenue, expenses (cost of sales + overheads + depreciation) and net for the months on screen. */
export function budgetRangeTotals(views: readonly BudgetMonthView[]): BudgetRangeTotals {
  let revenue = 0;
  let expenses = 0;
  let net = 0;
  for (const row of views) {
    revenue += row.budget.revenue;
    expenses += row.budget.cogs + row.budget.overheads + row.budget.depreciation;
    net += row.budget.ebit;
  }
  return { revenue, expenses, net };
}

/**
 * Period column. Budget is the visible range. Variance uses only months that
 * have an actual, so a later budget-only month is not scored as a miss.
 */
export function budgetPeriodTotalCell(
  cells: readonly BudgetTableCell[],
  key: VarianceLine["key"],
  label: string,
  higherIsBetter: boolean,
): BudgetTableCell {
  let budget = 0;
  let actual = 0;
  let budgetCompared = 0;
  let hasActual = false;
  for (const item of cells) {
    budget += item.budget;
    if (item.actual != null) {
      hasActual = true;
      actual += item.actual;
      budgetCompared += item.budget;
    }
  }
  if (!hasActual) return { budget, actual: null, variance: null };
  return {
    budget,
    actual,
    variance: varianceLine(key, label, budgetCompared, actual, higherIsBetter),
  };
}

export type BudgetTableKind = "line" | "subtotal" | "total";

export type BudgetTableCell = {
  budget: number;
  actual: number | null;
  variance: VarianceLine | null;
};

export type BudgetTableRow = {
  id: string;
  label: string;
  kind: BudgetTableKind;
  higherIsBetter: boolean;
  cells: BudgetTableCell[];
};

function cell(
  budget: number,
  actual: number | null,
  key: VarianceLine["key"],
  label: string,
  higherIsBetter: boolean,
): BudgetTableCell {
  if (actual == null) return { budget, actual: null, variance: null };
  return {
    budget,
    actual,
    variance: varianceLine(key, label, budget, actual, higherIsBetter),
  };
}

/**
 * Category rows × month. Actuals stay blank where the month has none.
 * `revenueLabel` only renames or hides a revenue line. Amounts stay on the stored line.
 */
export function budgetTableRows(
  doc: BudgetDocument,
  views: readonly BudgetMonthView[],
  revenueLabel?: (name: string, index: number) => string | null,
): BudgetTableRow[] {
  const months = fyMonths(doc.fyStart);
  const viewByMonth = new Map(views.map((row) => [row.month, row]));
  const ordered = months.map((month) => viewByMonth.get(month)).filter((row): row is BudgetMonthView => Boolean(row));

  const revenueLines = doc.revenueLines.flatMap((line, index) => {
    const label = revenueLabel ? revenueLabel(line.name, index) : line.name.trim() || "Revenue line";
    if (!label) return [];
    return [{
      id: `rev-${line.id}`,
      label,
      kind: "line" as const,
      higherIsBetter: true,
      cells: ordered.map((row) => {
        const raw = line.months[row.month] ?? { volume: 0, price: 0 };
        return cell(raw.volume * raw.price, null, "revenue", line.name, true);
      }),
    }];
  });

  const overheadLines = doc.overheads.map((line) => ({
    id: `oh-${line.id}`,
    label: line.name.trim() || "Overhead",
    kind: "line" as const,
    higherIsBetter: false,
    cells: ordered.map((row) =>
      cell(line.months[row.month] ?? 0, null, "overheads_total", line.name, false),
    ),
  }));

  const across = (
    id: string,
    label: string,
    kind: BudgetTableKind,
    higherIsBetter: boolean,
    key: VarianceLine["key"],
    budgetOf: (row: BudgetMonthView) => number,
    actualOf: (totals: TaxonomyTotals) => number,
  ): BudgetTableRow => ({
    id,
    label,
    kind,
    higherIsBetter,
    cells: ordered.map((row) =>
      cell(
        budgetOf(row),
        row.actual ? actualOf(row.actual) : null,
        key,
        label,
        higherIsBetter,
      ),
    ),
  });

  return [
    ...revenueLines,
    across("revenue", "Revenue", "subtotal", true, "revenue", (row) => row.budget.revenue, (totals) => totals.revenue),
    across("cogs", "Cost of sales", "line", false, "cogs", (row) => row.budget.cogs, (totals) => totals.cogs),
    across(
      "gross",
      "Gross profit",
      "subtotal",
      true,
      "gross_profit",
      (row) => row.budget.grossProfit,
      (totals) => totals.grossProfit,
    ),
    ...overheadLines,
    across(
      "overheads",
      "Overheads",
      "subtotal",
      false,
      "overheads_total",
      (row) => row.budget.overheads,
      (totals) => totals.overheadsTotal,
    ),
    across(
      "depreciation",
      "Depreciation",
      "line",
      false,
      "depreciation",
      (row) => row.budget.depreciation,
      (totals) => totals.depreciation,
    ),
    across(
      "profit",
      "Operating profit",
      "total",
      true,
      "ebit",
      (row) => row.budget.ebit,
      (totals) => totals.ebit,
    ),
  ];
}
