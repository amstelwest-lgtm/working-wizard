/**
 * Balance-sheet check for an unclosed trial balance.
 *
 * A mid-year TB keeps current-period profit on the P&L. Debits still equal
 * credits, but Assets = Liabilities + Equity only after that profit is added
 * to equity. A statement whose retained earnings already include the profit
 * already balances and must not be adjusted again.
 */

import type { FinancialFigures, IncomeStatement, Money } from "./financialSchema";

function num(v: Money): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function sumPresent(values: Money[]): number | null {
  const nums = values.map(num).filter((n): n is number => n != null);
  if (!nums.length) return null;
  return nums.reduce((sum, n) => sum + n, 0);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Current-period profit from P&L lines (income minus expenses).
 * Uses the bottom line when the document prints one. Returns null when there
 * is not enough of a P&L to know the profit.
 */
export function currentPeriodProfit(income: IncomeStatement): number | null {
  const pat = num(income.profit_after_tax);
  if (pat != null) return pat;
  const pbt = num(income.profit_before_tax);
  if (pbt != null) return round2(pbt - (num(income.income_tax) ?? 0));
  const operating = num(income.operating_profit);
  if (operating != null) {
    return round2(
      operating -
        (num(income.finance_costs) ?? 0) +
        (num(income.finance_income) ?? 0) -
        (num(income.income_tax) ?? 0),
    );
  }
  const incomeParts = [income.revenue, income.other_income, income.finance_income];
  const expenseParts = [
    income.cost_of_sales,
    income.operating_expenses,
    income.depreciation_amortisation,
    income.finance_costs,
    income.income_tax,
  ];
  if (!incomeParts.some((v) => num(v) != null) || !expenseParts.some((v) => num(v) != null)) {
    return null;
  }
  return round2((sumPresent(incomeParts) ?? 0) - (sumPresent(expenseParts) ?? 0));
}

export type BalanceSheetCheck = {
  /**
   * Profit added to equity for the check. Null when the sheet already
   * balances without it, or when there is no P&L profit to add.
   * Display only — not written into retained earnings.
   */
  currentPeriodProfit: number | null;
  /** Equity + liabilities − assets, after unclosed profit. Null if a side is missing. */
  gap: number | null;
};

/**
 * Assets = Liabilities + Equity, adding unclosed current-period profit when
 * that is what makes a trial balance agree. A closer raw gap is left as-is
 * so a genuinely unbalanced sheet still warns.
 */
export function balanceSheetCheck(figures: FinancialFigures): BalanceSheetCheck {
  const profit = currentPeriodProfit(figures.income_statement);
  const bs = figures.balance_sheet;
  const equity = num(bs.equity.total);
  const liab = num(bs.total_liabilities);
  const assets = num(bs.total_assets);
  if (equity == null || liab == null || assets == null) {
    return { currentPeriodProfit: null, gap: null };
  }
  const tol = Math.max(Math.abs(assets) * 0.005, 1);
  const raw = equity + liab - assets;
  // Plugged equity is already assets − liabilities. That residual includes
  // unclosed profit, so the profit must not be added a second time.
  if (bs.equity_derived === true) {
    return { currentPeriodProfit: null, gap: round2(raw) };
  }
  // Profit already folded into equity.total. Do not add it again.
  if (bs.period_profit_in_equity != null && Math.abs(bs.period_profit_in_equity) > 0.005) {
    return { currentPeriodProfit: null, gap: round2(raw) };
  }
  const adjusted = raw + (profit ?? 0);
  const include =
    profit != null &&
    Math.abs(profit) > 0.005 &&
    Math.abs(raw) > tol &&
    Math.abs(adjusted) < Math.abs(raw);
  return {
    currentPeriodProfit: include ? round2(profit) : null,
    gap: round2(include ? adjusted : raw),
  };
}
