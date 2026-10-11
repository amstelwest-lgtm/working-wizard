/** This budget year against a prior period. Missing prior figures stay blank. */

export type BudgetYearMoney = {
  revenue: number | null;
  cogs: number | null;
  grossProfit: number | null;
  netProfit: number | null;
  expenses: number | null;
};

export type BudgetYearKey = keyof BudgetYearMoney;

export type BudgetYearRow = {
  key: BudgetYearKey;
  label: string;
  thisYear: number | null;
  lastYear: number | null;
  change: number | null;
  changePct: number | null;
  direction: "up" | "down" | "flat";
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

export function yearMoneyFromFinancials(
  financials: Record<string, unknown> | null | undefined,
): BudgetYearMoney | null {
  if (!financials) return null;
  const revenue = numberField(financials, "revenue");
  const cogs = numberField(financials, "cogs") ?? numberField(financials, "cost_of_sales");
  const expenses =
    numberField(financials, "fixedCosts") ?? numberField(financials, "operating_expenses");
  const netProfit = numberField(financials, "netIncome") ?? numberField(financials, "net_income");
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
