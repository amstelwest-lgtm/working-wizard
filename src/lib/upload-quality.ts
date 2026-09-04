/**
 * Low-bar quality gate for financial-statement uploads.
 * Plug-and-play: messy management accounts are fine. Unreadable / empty /
 * unrelated files are sent back so garbage-in cannot become a score.
 */

export const UPLOAD_QUALITY_DISCLAIMER =
  "The quality of the financial information we produce depends on the accuracy of the information you upload.";

export const UPLOAD_QUALITY_REJECT =
  "We couldn't read enough figures from this file to be useful. Please upload a clearer income statement or balance sheet. Blurry scans, password-protected PDFs, and unrelated documents usually fail.";

export const UPLOAD_BANK_STATEMENT_REJECT =
  "This looks like a bank statement, not an income statement or balance sheet. Use the bank-statement upload instead, or send a P&L / annual financials.";

/** Need any two of these for the extraction to be useful. */
export const ANCHOR_LABELS = [
  "revenue",
  "gross_profit",
  "operating_profit",
  "profit_after_tax",
  "total_assets",
  "equity",
  "total_liabilities",
  "cash",
] as const;

export const MIN_ANCHOR_COUNT = 2;
export const MIN_FLAT_FIELD_COUNT = 2;
export const MIN_FILE_BYTES = 400;

function isMoney(v: unknown): boolean {
  return typeof v === "number" && Number.isFinite(v);
}

export function countAnchors(values: Array<unknown>): number {
  return values.filter(isMoney).length;
}

export type Usability =
  | { ok: true; anchors: number }
  | { ok: false; reason: string; anchors: number };

export function assessPortalFigures(figures: {
  income_statement: {
    revenue: unknown;
    gross_profit: unknown;
    operating_profit: unknown;
    profit_after_tax: unknown;
  };
  balance_sheet: {
    total_assets: unknown;
    equity: { total: unknown };
    total_liabilities: unknown;
    current_assets: { cash_and_cash_equivalents: unknown };
  };
}): Usability {
  const is = figures.income_statement;
  const bs = figures.balance_sheet;
  const anchors = countAnchors([
    is.revenue,
    is.gross_profit,
    is.operating_profit,
    is.profit_after_tax,
    bs.total_assets,
    bs.equity.total,
    bs.total_liabilities,
    bs.current_assets.cash_and_cash_equivalents,
  ]);
  if (anchors < MIN_ANCHOR_COUNT) {
    return { ok: false, reason: UPLOAD_QUALITY_REJECT, anchors };
  }
  return { ok: true, anchors };
}

export function assessMergedExtraction(result: {
  document_metadata?: {
    document_type?: string | null;
    contains_income_statement?: boolean;
    contains_balance_sheet?: boolean;
  };
  current_period?: {
    income_statement?: Record<string, unknown> | null;
    balance_sheet?: Record<string, unknown> | null;
  };
}): Usability {
  const meta = result.document_metadata;
  const is = result.current_period?.income_statement ?? {};
  const bs = result.current_period?.balance_sheet ?? {};
  const looksLikeBank =
    meta?.document_type === "bank_statement" &&
    meta.contains_income_statement !== true &&
    meta.contains_balance_sheet !== true;
  if (looksLikeBank) {
    return { ok: false, reason: UPLOAD_BANK_STATEMENT_REJECT, anchors: 0 };
  }
  const anchors = countAnchors([
    is.revenue,
    is.gross_profit,
    is.ebit,
    is.net_income,
    bs.total_assets,
    bs.equity,
    bs.total_liabilities,
    bs.cash,
  ]);
  if (anchors < MIN_ANCHOR_COUNT) {
    return { ok: false, reason: UPLOAD_QUALITY_REJECT, anchors };
  }
  return { ok: true, anchors };
}

export function assessFlatExtraction(fieldCount: number): Usability {
  if (fieldCount < MIN_FLAT_FIELD_COUNT) {
    return { ok: false, reason: UPLOAD_QUALITY_REJECT, anchors: fieldCount };
  }
  return { ok: true, anchors: fieldCount };
}

export function assertUsable(result: Usability): void {
  if (!result.ok) throw new Error(result.reason);
}

export function preflightUploadFile(file: File): string | null {
  if (!file || file.size === 0) {
    return "That file is empty. Please upload the actual statement.";
  }
  if (file.size < MIN_FILE_BYTES) {
    return "That file is too small to be a financial statement.";
  }
  return null;
}
