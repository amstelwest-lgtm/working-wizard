/**
 * Pre-metric-layer trial-balance imports stored a flattened financials blob
 * with operating expenses and cash left blank. The current importer does not
 * keep the raw trial-balance lines, the extraction JSON, or the uploaded file
 * (a staged PDF is deleted after it is read), and financial_submissions is
 * not written on confirm. Those snapshots cannot be recomputed in place.
 *
 * When the latest statement import is still missing operating expenses or
 * cash, and the live figures have not been filled in by hand, ask for a
 * re-import. A typed value is never treated as missing.
 */

export const TRIAL_BALANCE_REFRESH_COPY =
  "Re-import the trial balance to refresh operating profit and runway";

/** Sources written when a statement or trial balance is confirmed. */
const STATEMENT_IMPORT_SOURCES = new Set(["pdf_upload", "upload", "financial_statement"]);

const OPEX_KEYS = ["fixedCosts", "fixed_costs", "operating_expenses"] as const;
const CASH_KEYS = ["cash", "cash_and_cash_equivalents"] as const;

export type TrialBalanceSnapshot = {
  source?: string | null;
  period_date?: string | null;
  financials?: Record<string, unknown> | null;
};

function isBlankMoney(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "number") return !Number.isFinite(value);
  const text = String(value).trim();
  if (!text) return true;
  const n = parseFloat(text.replace(/[^0-9.-]/g, ""));
  return !Number.isFinite(n);
}

function hasMoney(fin: Record<string, unknown> | null | undefined, keys: readonly string[]): boolean {
  if (!fin) return false;
  return keys.some((key) => !isBlankMoney(fin[key]));
}

function latestStatementImport(snapshots: TrialBalanceSnapshot[]): TrialBalanceSnapshot | null {
  const imports = snapshots.filter(
    (row) => row.source && STATEMENT_IMPORT_SOURCES.has(row.source) && row.financials,
  );
  if (!imports.length) return null;
  return imports.sort((a, b) => (b.period_date ?? "").localeCompare(a.period_date ?? ""))[0] ?? null;
}

/**
 * True when the current statement import left operating expenses or cash
 * blank and the live board still has that same gap.
 */
export function needsTrialBalanceRefresh(opts: {
  live: Record<string, unknown> | null | undefined;
  snapshots: TrialBalanceSnapshot[] | null | undefined;
}): boolean {
  const live = opts.live;
  if (!live) return false;
  const hasFigures =
    hasMoney(live, ["revenue"]) || hasMoney(live, ["cogs"]) || hasMoney(live, ["netIncome"]);
  if (!hasFigures) return false;

  const imported = latestStatementImport(opts.snapshots ?? []);
  if (!imported?.financials) return false;

  const opexGap = !hasMoney(imported.financials, OPEX_KEYS) && !hasMoney(live, OPEX_KEYS);
  const cashGap = !hasMoney(imported.financials, CASH_KEYS) && !hasMoney(live, CASH_KEYS);
  return opexGap || cashGap;
}
