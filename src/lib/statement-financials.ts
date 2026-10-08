/**
 * Map an extracted statement (trial balance or full accounts) onto the
 * period financials blob the grid, ratios, budget, and bot all read.
 *
 * The extractor records operating expenses and cash, and leaves profit lines
 * null when the document does not print them. Those derived lines are filled
 * here so a later save does not drop them.
 */

import type { BalanceSheet, ExtractionResult, IncomeStatement, Money } from "./financialSchema.ts";
import { coherentEquity } from "./equity-coherence.ts";
import type { RatioInputs } from "./ratios.ts";
import { currentPeriodProfit } from "./statement-balance.ts";
import type { StatementKind } from "./statement-parse.ts";

export type PeriodFinancials = RatioInputs & {
  cash: string;
  equityDerived: string;
  /** Printed total liabilities. Blank when the statement has none. */
  totalLiabilities: string;
  currentLiabilities: string;
  currentAssets: string;
  nonCurrentLiabilities: string;
  hasCashFlow: string;
  periodProfitInEquity: string;
};

/** Shown wherever a plugged equity total appears, so it is not read as reported equity. */
export const DERIVED_EQUITY_LABEL = "Derived (assets − liabilities)";

/**
 * Equity at read time. Blank equity plugs assets − liabilities (that residual
 * already includes unclosed profit). A typed pre-close total is equity lines
 * plus current-period net income when an explicit liability total is on the
 * blob. A typed figure with no liability total, including zero, stays.
 */
export function readTimeEquity(fields: Record<string, unknown> | null | undefined): {
  equity: string;
  derived: boolean;
} {
  const resolved = coherentEquity(fields);
  return { equity: resolved.equity, derived: resolved.derived };
}

/** Grid scalars with coherent equity. A typed closed-sheet figure stays. */
export function scalarsWithReadTimeEquity(scalars: Record<string, string>): Record<string, string> {
  const resolved = coherentEquity(scalars);
  let next = scalars;
  const current = String(scalars.equity ?? "").trim();
  if (resolved.equity !== "" && (resolved.derived || resolved.preClose || resolved.equity !== current)) {
    next = { ...next, equity: resolved.equity };
    if (resolved.derived) next = { ...next, [EQUITY_DERIVED_KEY]: "1" };
    if (resolved.preClose) next = { ...next, periodProfitInEquity: String(resolved.profitIncluded) };
  }
  return next;
}

/** Blob key. "1" means `equity` was plugged, not reported or typed. */
export const EQUITY_DERIVED_KEY = "equityDerived";

const EQUITY_LINE_KEYS = ["share_capital", "retained_earnings", "other_reserves"] as const;

function hasEquityLines(equity: BalanceSheet["equity"]): boolean {
  return EQUITY_LINE_KEYS.some((key) => finiteMoney(equity[key]) != null);
}

function money(v: number | null | undefined): string {
  return v != null && Number.isFinite(v) ? String(v) : "";
}

type LooseIncome = IncomeStatement & {
  labor_cost?: number | null;
  labour_cost?: number | null;
};

function finiteMoney(v: Money): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Sum only lines that are actually on the sheet. Null components are skipped, not treated as zero. */
function sumPresent(values: Money[]): number | null {
  const nums = values.map(finiteMoney).filter((n): n is number => n != null);
  if (!nums.length) return null;
  return nums.reduce((sum, n) => sum + n, 0);
}

function withComponentTotal<T extends { total: Money }>(group: T, keys: Array<keyof T>): T {
  if (finiteMoney(group.total) != null) return group;
  const total = sumPresent(keys.map((key) => group[key] as Money));
  if (total == null) return group;
  return { ...group, total };
}

export type FilledBalanceSheet = {
  sheet: BalanceSheet;
  /** True when at least one blank total was filled from component lines. */
  filled: boolean;
};

/**
 * Trial-balance lines often arrive without printed totals because the reader
 * is told not to calculate. Fill equity, liability, and asset totals from the
 * lines that are present. A printed total is left as printed. When the sheet
 * has asset and liability totals and no equity lines at all, total equity is
 * assets minus liabilities and marked derived — never written over a typed total.
 */
export function fillBalanceSheetTotals(balance: BalanceSheet): FilledBalanceSheet {
  const nonCurrentAssets = withComponentTotal(balance.non_current_assets, [
    "property_plant_equipment",
    "intangible_assets",
    "investments",
    "deferred_tax_asset",
    "other",
  ]);
  const currentAssets = withComponentTotal(balance.current_assets, [
    "inventories",
    "trade_and_other_receivables",
    "cash_and_cash_equivalents",
    "other",
  ]);
  let equity = withComponentTotal(balance.equity, [
    "share_capital",
    "retained_earnings",
    "other_reserves",
  ]);
  const nonCurrentLiabilities = withComponentTotal(balance.non_current_liabilities, [
    "borrowings",
    "deferred_tax_liability",
    "other",
  ]);
  const currentLiabilities = withComponentTotal(balance.current_liabilities, [
    "trade_and_other_payables",
    "borrowings",
    "current_tax",
    "bank_overdraft",
    "other",
  ]);

  let totalAssets = balance.total_assets;
  if (finiteMoney(totalAssets) == null) {
    const summed = sumPresent([nonCurrentAssets.total, currentAssets.total]);
    if (summed != null) totalAssets = summed;
  }
  let totalLiabilities = balance.total_liabilities;
  if (finiteMoney(totalLiabilities) == null) {
    const summed = sumPresent([nonCurrentLiabilities.total, currentLiabilities.total]);
    if (summed != null) totalLiabilities = summed;
  }
  // No equity lines at all: plug total equity from the two sides. A printed
  // total, a typed total, or any equity line (including zero) is left alone.
  let equityDerived = false;
  if (!hasEquityLines(balance.equity)) {
    const assets = finiteMoney(totalAssets);
    const liabilities = finiteMoney(totalLiabilities);
    const reportedTotal = finiteMoney(equity.total);
    if (assets != null && liabilities != null && (reportedTotal == null || balance.equity_derived === true)) {
      equity = { ...equity, total: assets - liabilities };
      equityDerived = true;
    }
  }
  let totalEquityAndLiabilities = balance.total_equity_and_liabilities;
  if (finiteMoney(totalEquityAndLiabilities) == null) {
    const equityTotal = finiteMoney(equity.total);
    const liabilityTotal = finiteMoney(totalLiabilities);
    if (equityTotal != null && liabilityTotal != null) {
      totalEquityAndLiabilities = equityTotal + liabilityTotal;
    }
  }

  const sheet: BalanceSheet = {
    non_current_assets: nonCurrentAssets,
    current_assets: currentAssets,
    total_assets: totalAssets,
    equity,
    non_current_liabilities: nonCurrentLiabilities,
    current_liabilities: currentLiabilities,
    total_liabilities: totalLiabilities,
    total_equity_and_liabilities: totalEquityAndLiabilities,
    ...(equityDerived ? { equity_derived: true } : {}),
  };

  const filled =
    sheet.non_current_assets.total !== balance.non_current_assets.total ||
    sheet.current_assets.total !== balance.current_assets.total ||
    sheet.total_assets !== balance.total_assets ||
    sheet.equity.total !== balance.equity.total ||
    sheet.non_current_liabilities.total !== balance.non_current_liabilities.total ||
    sheet.current_liabilities.total !== balance.current_liabilities.total ||
    sheet.total_liabilities !== balance.total_liabilities ||
    sheet.total_equity_and_liabilities !== balance.total_equity_and_liabilities;

  return { sheet, filled };
}

/** Drop the "totals were not computed" bullet once those totals have been filled. */
export function dropUncomputedTotalNotes(notes: string | null | undefined): string | null {
  if (!notes?.trim()) return notes ?? null;
  const parts = notes
    .split(/\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const kept = parts.filter(
    (part) => !/(balance sheet|totals?).{0,48}not computed|not computed.{0,48}(balance sheet|totals?)/i.test(part),
  );
  if (!kept.length) return null;
  if (kept.length === parts.length) return notes;
  return kept.join("\n");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Pre-close trial balance: add current-period profit to total equity.
 * Retained earnings is not rewritten. A derived plug and a closed sheet
 * (adding profit would not move the sheet closer to balance) are unchanged.
 */
export function withUnclosedProfit(sheet: BalanceSheet, income: IncomeStatement): BalanceSheet {
  if (sheet.equity_derived === true || sheet.period_profit_in_equity != null) return sheet;
  const equity = finiteMoney(sheet.equity.total);
  const assets = finiteMoney(sheet.total_assets);
  const liab = finiteMoney(sheet.total_liabilities);
  const profit = currentPeriodProfit(income);
  if (equity == null || assets == null || liab == null || profit == null || Math.abs(profit) <= 0.005) {
    return sheet;
  }
  const tol = Math.max(Math.abs(assets) * 0.005, 1);
  const raw = equity + liab - assets;
  const adjusted = raw + profit;
  if (!(Math.abs(raw) > tol && Math.abs(adjusted) < Math.abs(raw))) return sheet;
  const nextEquity = round2(equity + profit);
  let tel = sheet.total_equity_and_liabilities;
  const telNum = finiteMoney(tel);
  if (telNum == null || Math.abs(telNum - (equity + liab)) <= tol) {
    tel = round2(nextEquity + liab);
  }
  return {
    ...sheet,
    equity: { ...sheet.equity, total: nextEquity },
    total_equity_and_liabilities: tel,
    period_profit_in_equity: round2(profit),
  };
}

/** Fill blank balance-sheet totals on an extraction. Does not invent a period end. */
export function applyBalanceSheetTotals(result: ExtractionResult): ExtractionResult {
  const currentFilled = fillBalanceSheetTotals(result.current_period.figures.balance_sheet);
  const currentSheet = withUnclosedProfit(currentFilled.sheet, result.current_period.figures.income_statement);
  const comparativeFilled = result.comparative_period
    ? fillBalanceSheetTotals(result.comparative_period.figures.balance_sheet)
    : null;
  const comparativeSheet =
    result.comparative_period && comparativeFilled
      ? withUnclosedProfit(comparativeFilled.sheet, result.comparative_period.figures.income_statement)
      : null;
  const filled =
    currentFilled.filled ||
    comparativeFilled?.filled === true ||
    currentSheet.equity.total !== currentFilled.sheet.equity.total ||
    comparativeSheet?.equity.total !== comparativeFilled?.sheet.equity.total;
  return {
    ...result,
    extraction_notes: filled ? dropUncomputedTotalNotes(result.extraction_notes) : result.extraction_notes,
    current_period: {
      ...result.current_period,
      figures: { ...result.current_period.figures, balance_sheet: currentSheet },
    },
    comparative_period:
      result.comparative_period && comparativeSheet
        ? {
            ...result.comparative_period,
            figures: { ...result.comparative_period.figures, balance_sheet: comparativeSheet },
          }
        : result.comparative_period,
  };
}

/**
 * Persisted period figures from one extraction.
 * Operating expenses land on fixed costs (and labour when the document splits it).
 * EBIT, EBT, and net profit are derived when the statement has the ingredients
 * but not the subtotal. Cash comes from the bank / cash line, then cash at end.
 */
function sectionHasAmount(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (!value || typeof value !== "object") return false;
  return Object.values(value as Record<string, unknown>).some(sectionHasAmount);
}

/** Which statement the extraction actually contains. Nulls do not count. */
export function statementKindFromExtraction(result: ExtractionResult): StatementKind {
  const figures = result.current_period?.figures;
  const income = sectionHasAmount(figures?.income_statement);
  const balance = sectionHasAmount(figures?.balance_sheet);
  if (income && balance) return "mixed";
  if (balance) return "balance_sheet";
  if (income) return "income_statement";
  return "unknown";
}

export function periodFinancialsFromExtraction(result: ExtractionResult): PeriodFinancials {
  const prepared = applyBalanceSheetTotals(result);
  const income = prepared.current_period.figures.income_statement as LooseIncome;
  const balance = prepared.current_period.figures.balance_sheet;
  const cashFlow = prepared.current_period.figures.cash_flow;

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
  const operatingCash = cashFlow?.cash_from_operating;
  const hasCashFlow = typeof operatingCash === "number" && Number.isFinite(operatingCash) ? "1" : "";

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
    equityDerived: balance.equity_derived === true ? "1" : "",
    receivables: money(balance.current_assets.trade_and_other_receivables),
    inventory: money(balance.current_assets.inventories),
    payables: money(balance.current_liabilities.trade_and_other_payables),
    totalLiabilities: money(balance.total_liabilities),
    currentLiabilities: money(balance.current_liabilities.total),
    currentAssets: money(balance.current_assets.total),
    nonCurrentLiabilities: money(balance.non_current_liabilities.total),
    hasCashFlow,
    periodProfitInEquity:
      balance.period_profit_in_equity != null ? String(balance.period_profit_in_equity) : "",
    fixedCosts: money(opex),
    variableCosts: "",
    top5Revenue: "",
    laborCost: money(labor),
    employees: "",
    founderHours: "",
    cash: money(cash),
  };
}

/**
 * A trial balance with no equity lines must not replace a figure someone
 * typed. A previous plug (equityDerived "1") can be replaced by a new plug
 * or by equity that was actually on the sheet.
 */
export function preserveHandEnteredEquity(
  current: Record<string, string | undefined> | null | undefined,
  imported: { equity: string; equityDerived?: string },
): { equity: string; equityDerived: string } {
  const importedDerived = imported.equityDerived === "1";
  const currentEquity = String(current?.equity ?? "").trim();
  const currentDerived = String(current?.[EQUITY_DERIVED_KEY] ?? "") === "1";
  if (importedDerived && currentEquity !== "" && !currentDerived) {
    return { equity: String(current?.equity ?? ""), equityDerived: "" };
  }
  return { equity: imported.equity, equityDerived: importedDerived ? "1" : "" };
}
