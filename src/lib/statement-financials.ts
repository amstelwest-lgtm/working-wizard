/**
 * Map an extracted statement (trial balance or full accounts) onto the
 * period financials blob the grid, ratios, budget, and bot all read.
 *
 * The extractor records operating expenses and cash, and leaves profit lines
 * null when the document does not print them. Those derived lines are filled
 * here so a later save does not drop them.
 */

import type { ExtractionResult, IncomeStatement } from "./financialSchema.ts";
import type { RatioInputs } from "./ratios.ts";

export type PeriodFinancials = RatioInputs & { cash: string };

function money(v: number | null | undefined): string {
  return v != null && Number.isFinite(v) ? String(v) : "";
}

type LooseIncome = IncomeStatement & {
  labor_cost?: number | null;
  labour_cost?: number | null;
};

/**
 * Persisted period figures from one extraction.
 * Operating expenses land on fixed costs (and labour when the document splits it).
 * EBIT, EBT, and net profit are derived when the statement has the ingredients
 * but not the subtotal. Cash comes from the bank / cash line, then cash at end.
 */
export function periodFinancialsFromExtraction(result: ExtractionResult): PeriodFinancials {
  const income = result.current_period.figures.income_statement as LooseIncome;
  const balance = result.current_period.figures.balance_sheet;
  const cashFlow = result.current_period.figures.cash_flow;

  const revenue = income.revenue;
  const cogs = income.cost_of_sales;
  const gross =
    income.gross_profit ?? (revenue != null && cogs != null ? revenue - cogs : null);
  const opex = income.operating_expenses;
  const depreciation = income.depreciation_amortisation;
  const ebit =
    income.operating_profit ??
    (gross != null && opex != null ? gross - opex - (depreciation ?? 0) : null);
  const ebt =
    income.profit_before_tax ??
    (ebit != null ? ebit - (income.finance_costs ?? 0) + (income.finance_income ?? 0) : null);
  const net =
    income.profit_after_tax ?? (ebt != null ? ebt - (income.income_tax ?? 0) : null);
  const ebitda =
    ebit != null && depreciation != null ? ebit + depreciation : ebit;
  const labor = income.labor_cost ?? income.labour_cost ?? null;
  const cash =
    balance.current_assets.cash_and_cash_equivalents ?? cashFlow?.cash_at_end ?? null;

  return {
    revenue: money(revenue),
    cogs: money(cogs),
    ebit: money(ebit),
    ebt: money(ebt),
    netIncome: money(net),
    ebitda: money(ebitda),
    operatingCashflow: money(cashFlow?.cash_from_operating),
    totalAssets: money(balance.total_assets),
    equity: money(balance.equity.total),
    receivables: money(balance.current_assets.trade_and_other_receivables),
    inventory: money(balance.current_assets.inventories),
    payables: money(balance.current_liabilities.trade_and_other_payables),
    fixedCosts: money(opex),
    variableCosts: "",
    top5Revenue: "",
    laborCost: money(labor),
    employees: "",
    founderHours: "",
    cash: money(cash),
  };
}
