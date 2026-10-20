/** This budget year against a prior period. Missing prior figures stay blank. */

import { statementNetProfit } from "@/lib/period-profit";

export type BudgetYearMoney = {
  revenue: number | null;
  cogs: number | null;
  grossProfit: number | null;
  netProfit: number | null;
  expenses: number | null;
};

export type BudgetYearKey = keyof BudgetYearMoney;

export type BudgetYearSignal = "favourable" | "adverse" | null;

export type BudgetYearRow = {
  key: BudgetYearKey;
  label: string;
  thisYear: number | null;
  lastYear: number | null;
  change: number | null;
  changePct: number | null;
  direction: "up" | "down" | "flat";
  /** Cost lines only. A fall is favourable. A rise in COGS or expenses is adverse. */
  signal: BudgetYearSignal;
};

const LINES: { key: BudgetYearKey; label: string }[] = [
  { key: "revenue", label: "Revenue" },
  { key: "cogs", label: "COGS" },
  { key: "grossProfit", label: "Gross profit" },
  { key: "netProfit", label: "Net profit" },
  { key: "expenses", label: "Expenses" },
];

function finite(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

function directionOf(change: number | null): "up" | "down" | "flat" {
  if (change == null || Math.abs(change) < 1) return "flat";
  return change > 0 ? "up" : "down";
}

function yearChangeSignal(
  key: BudgetYearKey,
  direction: "up" | "down" | "flat",
): BudgetYearSignal {
  if (key !== "cogs" && key !== "expenses") return null;
  if (direction === "down") return "favourable";
  if (direction === "up") return "adverse";
  return null;
}

export function yearMoneyFromFinancials(
  financials: Record<string, unknown> | null | undefined,
): BudgetYearMoney | null {
  if (!financials) return null;
  const revenue = numberField(financials, "revenue");
  const cogs = numberField(financials, "cogs") ?? numberField(financials, "cost_of_sales");
  const expenses =
    numberField(financials, "fixedCosts") ?? numberField(financials, "operating_expenses");
  const snakeNet = numberField(financials, "net_income");
  const netProfit = statementNetProfit(
    numberField(financials, "netIncome") == null && snakeNet != null
      ? { ...financials, netIncome: snakeNet }
      : financials,
  );
  const grossProfit = finite(revenue) && finite(cogs) ? revenue - cogs : null;
  const money = { revenue, cogs, grossProfit, netProfit, expenses };
  return LINES.some((line) => finite(money[line.key])) ? money : null;
}

function numberField(financials: Record<string, unknown>, key: string): number | null {
  const value = financials[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export const NO_FIGURES_THIS_YEAR =
  "No figures for this year yet. Your accountant will update this.";

export const YEAR_MONTHS_DIFFER =
  "Last year covers a different number of months, so it is not compared with this year-to-date.";

export function hasPriorYearFigures(money: BudgetYearMoney | null | undefined): boolean {
  return hasMeasuredFigures(money);
}

/** Owner "how the budget is built". It must not claim a prior year that is not on file. */
export function ownerBudgetHowBuilt(priorOnFile: boolean): string {
  if (!priorOnFile) return "Built from the statement on file. No prior year to compare.";
  return "Your accountant built this from last year's actuals plus the growth you agreed.";
}

function hasMeasuredFigures(money: BudgetYearMoney | null | undefined): money is BudgetYearMoney {
  if (!money) return false;
  return LINES.some((line) => {
    const value = money[line.key];
    return finite(value) && Math.abs(value) >= 1;
  });
}

/** Statement window the header already scored. A $0 plan is not this year. */
export function ownerYearFromStatement(
  actuals: {
    revenue: number;
    cogs: number;
    fixedCosts: number;
    ebit?: number | null;
    /** Canonical net profit. Operating profit is not a stand-in. */
    netProfit?: number | null;
  } | null | undefined,
): BudgetYearMoney | null {
  if (!actuals) return null;
  const revenue = finite(actuals.revenue) ? actuals.revenue : null;
  const cogs = finite(actuals.cogs) ? actuals.cogs : null;
  const expenses = finite(actuals.fixedCosts) ? actuals.fixedCosts : null;
  const netProfit = finite(actuals.netProfit) ? actuals.netProfit : null;
  const grossProfit = revenue != null && cogs != null ? revenue - cogs : null;
  const money = { revenue, cogs, grossProfit, netProfit, expenses };
  return hasMeasuredFigures(money) ? money : null;
}

function blankRows(thisYear: BudgetYearMoney | null): BudgetYearRow[] {
  return LINES.flatMap((line) => {
    const current = thisYear && finite(thisYear[line.key]) ? thisYear[line.key] : null;
    if (line.key === "expenses" && current == null) return [];
    return [
      {
        key: line.key,
        label: line.label,
        thisYear: current,
        lastYear: null,
        change: null,
        changePct: null,
        direction: "flat" as const,
        signal: null,
      },
    ];
  });
}

function monthCount(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const months = Math.round(value);
  return months >= 1 && months <= 12 ? months : null;
}

/**
 * Owner year strip. This year is the statement window, compared only with
 * the same number of months last year. A missing or all-zero year never
 * becomes "down 100%".
 */
export type OwnerYearMode = "empty" | "partial" | "compared";

export function compareOwnerYear(
  thisYear: BudgetYearMoney | null,
  thisMonths: number | null | undefined,
  lastYear: BudgetYearMoney | null,
  lastMonths: number | null | undefined,
): { empty: boolean; mode: OwnerYearMode; summary: string; rows: BudgetYearRow[] } {
  if (!hasMeasuredFigures(thisYear)) {
    return { empty: true, mode: "empty", summary: NO_FIGURES_THIS_YEAR, rows: blankRows(thisYear) };
  }
  if (!hasMeasuredFigures(lastYear)) {
    return { empty: true, mode: "empty", summary: "No prior year on file.", rows: blankRows(thisYear) };
  }
  const currentMonths = monthCount(thisMonths);
  const priorMonths = monthCount(lastMonths);
  if (currentMonths == null || priorMonths == null || currentMonths !== priorMonths) {
    return { empty: false, mode: "partial", summary: YEAR_MONTHS_DIFFER, rows: blankRows(thisYear) };
  }
  return { ...budgetYearCompare(thisYear, lastYear), mode: "compared" };
}

export function budgetYearCompare(
  thisYear: BudgetYearMoney,
  lastYear: BudgetYearMoney | null,
): { empty: boolean; summary: string; rows: BudgetYearRow[] } {
  const rows = LINES.flatMap((line) => {
    const current = finite(thisYear[line.key]) ? thisYear[line.key] : null;
    const prior = lastYear && finite(lastYear[line.key]) ? lastYear[line.key] : null;
    if (line.key === "expenses" && current == null && prior == null) return [];
    const change = current != null && prior != null ? current - prior : null;
    const changePct =
      change != null && prior != null && Math.abs(prior) >= 1 ? (change / Math.abs(prior)) * 100 : null;
    return [
      {
        key: line.key,
        label: line.label,
        thisYear: current,
        lastYear: prior,
        change,
        changePct,
        direction: directionOf(change),
        signal: yearChangeSignal(line.key, directionOf(change)),
      },
    ];
  });
  const hasPrior = rows.some((row) => row.lastYear != null);
  if (!hasPrior) {
    return { empty: true, summary: "No prior year on file.", rows };
  }
  const revenue = rows.find((row) => row.key === "revenue");
  const summary =
    revenue?.changePct != null
      ? revenue.direction === "flat"
        ? "Revenue is in line with last year."
        : `Revenue is ${revenue.direction} ${Math.abs(Math.round(revenue.changePct))}% on last year.`
      : "Last year's figures are on file.";
  return { empty: false, summary, rows };
}
