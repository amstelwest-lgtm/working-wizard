// validateFinancials.ts
// Deterministic sanity checks on the extracted numbers. This is your safety net
// against a mis-read figure quietly poisoning the ratio engine. It does NOT trust
// the model — it re-checks the arithmetic that must hold in any real statement.

import { EQUITY_CROSSCHECK_WARNING } from "./equity-coherence";
import type { FinancialFigures, Money } from "./financialSchema";
import { balanceSheetCheck } from "./statement-balance";

export type Severity = "error" | "warning" | "info";

export interface ValidationIssue {
  check: string;
  message: string;
  expected: number | null;
  actual: number | null;
  difference: number | null;
  severity: Severity;
}

const num = (v: Money): number | null =>
  typeof v === "number" && !Number.isNaN(v) ? v : null;

// Tolerance for rounding: 0.5% of total assets, or 1 currency unit, whichever is larger.
function toleranceFor(totalAssets: number | null): number {
  const base = totalAssets ? Math.abs(totalAssets) * 0.005 : 0;
  return Math.max(base, 1);
}

function compare(
  check: string,
  message: string,
  expected: number | null,
  actual: number | null,
  tolerance: number,
  severity: Severity = "error"
): ValidationIssue | null {
  if (expected === null || actual === null) return null; // can't check missing data
  const difference = actual - expected;
  if (Math.abs(difference) <= tolerance) return null; // it reconciles
  return { check, message, expected, actual, difference, severity };
}

export function validateFigures(figures: FinancialFigures): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const bs = figures.balance_sheet;
  const is = figures.income_statement;

  const totalAssets = num(bs.total_assets);
  const tol = toleranceFor(totalAssets);

  // 1. The balance sheet must balance: Equity + Liabilities = Assets.
  // Unclosed trial-balance profit sits on the P&L, so it is added to equity
  // for this check only. It is not written into retained earnings.
  const sheetCheck = balanceSheetCheck(figures);
  const unclosedProfit = sheetCheck.currentPeriodProfit ?? 0;
  const equityPlusLiab =
    num(bs.equity.total) !== null && num(bs.total_liabilities) !== null
      ? (bs.equity.total as number) + unclosedProfit + (bs.total_liabilities as number)
      : null;
  push(
    issues,
    compare(
      "balance_sheet_balances",
      "Equity + Total liabilities should equal Total assets.",
      totalAssets,
      equityPlusLiab,
      tol,
      "error"
    )
  );

  // Soft cross-check: equity lines + unclosed profit versus assets − liabilities.
  // The reporting figure stays lines + profit when they disagree.
  const reportingEquity =
    num(bs.equity.total) != null ? (bs.equity.total as number) + unclosedProfit : null;
  const equityPlug =
    totalAssets != null && num(bs.total_liabilities) != null
      ? totalAssets - (bs.total_liabilities as number)
      : null;
  if (
    reportingEquity != null &&
    equityPlug != null &&
    bs.equity_derived !== true &&
    Math.abs(reportingEquity - equityPlug) / Math.max(Math.abs(equityPlug), 1) > 0.01
  ) {
    issues.push({
      check: "equity_cross_check",
      message: EQUITY_CROSSCHECK_WARNING,
      expected: Math.round(equityPlug * 100) / 100,
      actual: Math.round(reportingEquity * 100) / 100,
      difference: Math.round((reportingEquity - equityPlug) * 100) / 100,
      severity: "warning",
    });
  }

  // 2. Non-current + current assets = total assets.
  const assetsSum =
    num(bs.non_current_assets.total) !== null && num(bs.current_assets.total) !== null
      ? (bs.non_current_assets.total as number) + (bs.current_assets.total as number)
      : null;
  push(
    issues,
    compare(
      "asset_subtotals",
      "Non-current + current assets should equal Total assets.",
      totalAssets,
      assetsSum,
      tol,
      "error"
    )
  );

  // 3. Non-current + current liabilities = total liabilities.
  const liabSum =
    num(bs.non_current_liabilities.total) !== null && num(bs.current_liabilities.total) !== null
      ? (bs.non_current_liabilities.total as number) + (bs.current_liabilities.total as number)
      : null;
  push(
    issues,
    compare(
      "liability_subtotals",
      "Non-current + current liabilities should equal Total liabilities.",
      num(bs.total_liabilities),
      liabSum,
      tol,
      "error"
    )
  );

  // 4. Total equity and liabilities line = total assets.
  // A filled TB total is equity + liabilities without unclosed profit. Add that
  // profit only when it moves the total closer to assets.
  const tel = num(bs.total_equity_and_liabilities);
  const telWithProfit = tel != null ? tel + unclosedProfit : null;
  const telCompared =
    tel == null || telWithProfit == null || totalAssets == null
      ? tel
      : Math.abs(telWithProfit - totalAssets) < Math.abs(tel - totalAssets)
        ? telWithProfit
        : tel;
  push(
    issues,
    compare(
      "equity_and_liabilities_total",
      "Total equity and liabilities should equal Total assets.",
      totalAssets,
      telCompared,
      tol,
      "error"
    )
  );

  // 5. Gross profit = revenue - cost of sales (info only; layouts vary).
  const grossExpected =
    num(is.revenue) !== null && num(is.cost_of_sales) !== null
      ? (is.revenue as number) - (is.cost_of_sales as number)
      : null;
  push(
    issues,
    compare(
      "gross_profit",
      "Revenue - Cost of sales should equal Gross profit.",
      grossExpected,
      num(is.gross_profit),
      tol,
      "warning"
    )
  );

  return issues;
}

function push(list: ValidationIssue[], issue: ValidationIssue | null) {
  if (issue) list.push(issue);
}

/** True if nothing at "error" severity failed — safe to import automatically. */
export function isClean(issues: ValidationIssue[]): boolean {
  return !issues.some((i) => i.severity === "error");
}
