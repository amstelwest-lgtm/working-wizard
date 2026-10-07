/**
 * A successful Xero, QuickBooks, or Sage sync owns the live figures.
 *
 * Merging `{ ...previous, ...sync }` left the previous statement's identity
 * and any figure the new report omitted (a zero cash line, Xero current
 * assets, a year-to-date companion). Overview then kept calling the board a
 * saved statement, and the other ledger card said the sync was not this file.
 *
 * An empty dated report is not a success. QuickBooks can return a month with
 * every P&L and balance-sheet total at zero (a quiet company, or a report that
 * did not parse). That must not replace a live non-zero statement or get
 * stamped as owned by the ledger.
 *
 * Autosave of a form that was opened before the sync must not put that
 * statement back.
 */

import { isDatedLedgerSource, readStatementMeta, STATEMENT_YTD_FIELD_KEYS } from "@/lib/statement-period";

export type LedgerSyncProvider = "qbo" | "xero" | "sage";

export function ledgerSyncProviderName(provider: LedgerSyncProvider): string {
  if (provider === "qbo") return "QuickBooks";
  if (provider === "xero") return "Xero";
  return "Sage";
}

/** Period identity a dated sync replaces outright. */
export const LEDGER_STATEMENT_KEYS = [
  "statementSource",
  "periodStart",
  "periodEnd",
  "periodLabel",
  "periodMonths",
  ...STATEMENT_YTD_FIELD_KEYS,
] as const;

/**
 * Figures the ledger mapper writes. Omitted keys are deleted so a previous
 * statement cannot keep a number the new sync did not return. Hand-entered
 * fields (labour, headcount, weekly inputs) are not in this list.
 */
export const LEDGER_FIGURE_KEYS = [
  "revenue",
  "cogs",
  "ebit",
  "ebt",
  "netIncome",
  "ebitda",
  "fixedCosts",
  "operatingCashflow",
  "totalAssets",
  "equity",
  "receivables",
  "inventory",
  "payables",
  "cash",
  "currentAssets",
  "currentLiabilities",
] as const;

function blank(value: unknown): boolean {
  return value == null || value === "";
}

const LIVE_FIGURE_KEYS = [...LEDGER_FIGURE_KEYS, "ytdRevenue", "ytdNetIncome"] as const;

function ledgerFigureNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** True when every P&L and balance-sheet figure is missing or zero. */
export function ledgerSyncReportIsEmpty(fields: Record<string, unknown>): boolean {
  return LIVE_FIGURE_KEYS.every((key) => {
    if (!(key in fields) || blank(fields[key])) return true;
    const n = ledgerFigureNumber(fields[key]);
    return n == null || n === 0;
  });
}

/** True when the live blob still has a non-zero ledger figure worth keeping. */
export function ledgerBlobHasLiveFigures(prev: unknown): boolean {
  if (!prev || typeof prev !== "object" || Array.isArray(prev)) return false;
  const blob = prev as Record<string, unknown>;
  return LIVE_FIGURE_KEYS.some((key) => {
    const n = ledgerFigureNumber(blob[key]);
    return n != null && n !== 0;
  });
}

/**
 * A dated sync whose P&L and balance sheet are all zero must not replace a
 * live statement. A blank file can still accept that sync.
 */
export function ledgerSyncWouldWipe(prev: unknown, fields: Record<string, unknown>): boolean {
  const dated = Boolean(fields.periodStart && fields.periodEnd);
  return dated && ledgerSyncReportIsEmpty(fields) && ledgerBlobHasLiveFigures(prev);
}

/** Shown on the connection card and the sync toast. Figures on file stay. */
export function emptyLedgerSyncError(provider: LedgerSyncProvider): string {
  const name = ledgerSyncProviderName(provider);
  return `${name} returned an empty statement (revenue, cash, assets and equity are all zero). Overview figures were left unchanged.`;
}

/**
 * Overlay a successful sync onto the live financials blob.
 * A dated sync sets `statementSource` to this provider and drops the previous
 * statement's period and any ledger figure this sync did not send.
 */
export function applyLedgerSyncFinancials(
  prev: unknown,
  fields: Record<string, string | number>,
  provider: LedgerSyncProvider,
): Record<string, unknown> {
  const base =
    prev && typeof prev === "object" && !Array.isArray(prev)
      ? { ...(prev as Record<string, unknown>) }
      : {};
  if (ledgerSyncWouldWipe(base, fields)) return base;
  const dated = Boolean(fields.periodStart && fields.periodEnd);
  if (dated) {
    for (const key of LEDGER_STATEMENT_KEYS) {
      if (!(key in fields) || blank(fields[key])) delete base[key];
    }
    for (const key of LEDGER_FIGURE_KEYS) {
      if (!(key in fields) || blank(fields[key])) delete base[key];
    }
    base.statementSource = provider;
  }
  for (const [key, value] of Object.entries(fields)) {
    if (blank(value)) {
      delete base[key];
      continue;
    }
    base[key] = value;
  }
  if (dated) base.statementSource = provider;
  return base;
}

/**
 * Autosave of an open form. When the server blob is a dated ledger and the
 * form still carries a different statement, keep the sync. Weekly inputs,
 * product mix, and the debt schedule from the form still overlay.
 */
export function autosaveKeepsLedgerSync(
  server: unknown,
  local: Record<string, unknown>,
): Record<string, unknown> {
  if (!server || typeof server !== "object" || Array.isArray(server)) return local;
  const serverBlob = server as Record<string, unknown>;
  const serverSource = readStatementMeta(serverBlob).statementSource;
  if (!isDatedLedgerSource(serverSource)) return local;
  const localSource = readStatementMeta(local).statementSource;
  if (localSource === serverSource) return local;
  const kept: Record<string, unknown> = { ...serverBlob };
  if ("weeklyInputs" in local) kept.weeklyInputs = local.weeklyInputs;
  if ("productMix" in local) kept.productMix = local.productMix;
  if ("debt_schedule" in local) kept.debt_schedule = local.debt_schedule;
  return kept;
}
