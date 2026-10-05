/**
 * Map an extracted statement (trial balance or full accounts) onto the
 * period financials blob the grid, ratios, budget, and bot all read.
 *
 * The extractor records operating expenses and cash, and leaves profit lines
 * null when the document does not print them. Those derived lines are filled
 * here so a later save does not drop them.
 */

import type { BalanceSheet, ExtractionResult, IncomeStatement, Money } from "./financialSchema.ts";
import type { RatioInputs } from "./ratios.ts";

export type PeriodFinancials = RatioInputs & { cash: string; equityDerived: string };

/** Shown wherever a plugged equity total appears, so it is not read as reported equity. */
export const DERIVED_EQUITY_LABEL = "Derived (assets − liabilities)";

function finiteField(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw.replace(/[,\s]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Liabilities on a stored financials blob. A printed total wins. Otherwise
 * current plus non-current. Payables are the only liability line on the grid,
 * so they are the liability side when nothing else was stored.
 */
function liabilitySide(fields: Record<string, unknown>): number | null {
  const total = finiteField(fields.totalLiabilities);
  if (total != null) return total;
  const current = finiteField(fields.currentLiabilities);
  const nonCurrent = finiteField(fields.nonCurrentLiabilities);
  if (current != null || nonCurrent != null) return (current ?? 0) + (nonCurrent ?? 0);
  return finiteField(fields.payables);
}

/**
 * Equity at read time. Import plugs a missing total, and a hand-entered
 * figure (including zero) is left alone. A blob saved before that plug —
 * assets and liabilities present, equity blank — gets the same plug here.
 */
export function readTimeEquity(fields: Record<string, unknown> | null | undefined): {
  equity: string;
  derived: boolean;
} {
  const source = fields ?? {};
  const equity = source.equity == null ? "" : String(source.equity).trim();
  const alreadyDerived = String(source[EQUITY_DERIVED_KEY] ?? "") === "1";
  if (equity !== "") return { equity, derived: alreadyDerived };
  const assets = finiteField(source.totalAssets);
  const liabilities = liabilitySide(source);
  if (assets == null || liabilities == null) return { equity: "", derived: false };
  const plugged = Math.round((assets - liabilities) * 100) / 100;
  return { equity: String(plugged), derived: true };
}

/** Grid scalars with blank equity filled. A typed equity, including zero, stays. */
export function scalarsWithReadTimeEquity(scalars: Record<string, string>): Record<string, string> {
  const resolved = readTimeEquity(scalars);
  if (!resolved.derived) return scalars;
  return { ...scalars, equity: resolved.equity, [EQUITY_DERIVED_KEY]: "1" };
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

/** Fill blank balance-sheet totals on an extraction. Does not invent a period end. */
export function applyBalanceSheetTotals(result: ExtractionResult): ExtractionResult {
  const current = fillBalanceSheetTotals(result.current_period.figures.balance_sheet);
  const comparative = result.comparative_period
    ? fillBalanceSheetTotals(result.comparative_period.figures.balance_sheet)
    : null;
  const filled = current.filled || comparative?.filled === true;
  return {
    ...result,
    extraction_notes: filled ? dropUncomputedTotalNotes(result.extraction_notes) : result.extraction_notes,
    current_period: {
      ...result.current_period,
      figures: { ...result.current_period.figures, balance_sheet: current.sheet },
    },
    comparative_period:
      result.comparative_period && comparative
        ? {
            ...result.comparative_period,
            figures: { ...result.comparative_period.figures, balance_sheet: comparative.sheet },
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
