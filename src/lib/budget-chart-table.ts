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
export function budgetYtdSentence(input: {
  budget: number;
  actual: number | null;
  money: (n: number) => string;
}): string {
  const budget = input.money(input.budget);
  if (input.actual == null) return `YTD: budget ${budget} · no actuals yet.`;
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

/** Category rows × month. Actuals stay blank where the month has none. */
export function budgetTableRows(doc: BudgetDocument, views: readonly BudgetMonthView[]): BudgetTableRow[] {
  const months = fyMonths(doc.fyStart);
  const viewByMonth = new Map(views.map((row) => [row.month, row]));
  const ordered = months.map((month) => viewByMonth.get(month)).filter((row): row is BudgetMonthView => Boolean(row));

  const revenueLines = doc.revenueLines.map((line) => ({
    id: `rev-${line.id}`,
    label: line.name.trim() || "Revenue line",
    kind: "line" as const,
    higherIsBetter: true,
    cells: ordered.map((row) => {
      const raw = line.months[row.month] ?? { volume: 0, price: 0 };
      return cell(raw.volume * raw.price, null, "revenue", line.name, true);
    }),
  }));

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
    across("profit", "Profit", "total", true, "ebit", (row) => row.budget.ebit, (totals) => totals.ebit),
  ];
}
