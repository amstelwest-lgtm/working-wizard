/**
 * Stored cash and budget figures for the background runners.
 * Closings use the same saved-cashflow reading as the cash tab.
 * Budget tax fields are left out. Nothing here is a bank balance.
 */
import { CASH_FORECAST_WEEKS, closingBalancesFromCashflow, type SavedCashflowLike } from "./cash-runway.ts";

export const SAVED_CASHFLOW_PERIOD = "saved cashflow";

export type SavedBookFigures = {
  empty: boolean;
  periodLabel: string | null;
  figures: Record<string, number>;
  note: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function savedCashflowFigures(raw: unknown): SavedBookFigures {
  const note = "Closings are the saved cashflow on file. They are not a bank feed and not bank-verified cash.";
  const record = asRecord(raw);
  if (!record) {
    return { empty: true, periodLabel: null, figures: {}, note };
  }
  const closings = closingBalancesFromCashflow(record as SavedCashflowLike);
  if (!closings || closings.length === 0) {
    return { empty: true, periodLabel: null, figures: {}, note };
  }
  const figures: Record<string, number> = { horizon_weeks: CASH_FORECAST_WEEKS };
  const opening = Number.parseFloat(typeof record.openingBalance === "string" ? record.openingBalance : "");
  if (Number.isFinite(opening)) figures.opening_balance = opening;
  let lowest = closings[0] ?? 0;
  let lowestWeek = 1;
  closings.forEach((value, index) => {
    if (!Number.isFinite(value)) return;
    figures[`week_${index + 1}_closing`] = value;
    if (value < lowest) {
      lowest = value;
      lowestWeek = index + 1;
    }
  });
  figures.lowest_closing = lowest;
  figures.lowest_week = lowestWeek;
  return { empty: false, periodLabel: SAVED_CASHFLOW_PERIOD, figures, note };
}

/** Budget inputs already stored on the document. Tax rates are not returned. */
export function savedBudgetFigures(raw: unknown): SavedBookFigures {
  const note = "Budget inputs on file. Not a tax figure and not a bank balance.";
  const doc = asRecord(raw);
  if (!doc) return { empty: true, periodLabel: null, figures: {}, note };
  const figures: Record<string, number> = {};
  const opening = finite(doc.openingCash);
  if (opening != null) figures.opening_cash = opening;
  const gp = finite(doc.gpPct);
  if (gp != null) figures.gp_pct = gp;
  const wc = asRecord(doc.wc);
  if (wc) {
    const debtor = finite(wc.debtorDays);
    const creditor = finite(wc.creditorDays);
    const inventory = finite(wc.inventoryDays);
    if (debtor != null) figures.debtor_days = debtor;
    if (creditor != null) figures.creditor_days = creditor;
    if (inventory != null) figures.inventory_days = inventory;
  }
  if (Object.keys(figures).length === 0) {
    return { empty: true, periodLabel: null, figures: {}, note };
  }
  const fy = typeof doc.fyStart === "string" && doc.fyStart.trim() ? doc.fyStart.trim() : "saved budget";
  return { empty: false, periodLabel: fy, figures, note };
}

export function booksQualityFigures(input: {
  qboConnected: boolean;
  xeroConnected: boolean;
  sageConnected: boolean;
  hasUpload: boolean;
  statementTotals: Record<string, number>;
}): Record<string, number> {
  return {
    ...input.statementTotals,
    connected_ledgers:
      Number(input.qboConnected) + Number(input.xeroConnected) + Number(input.sageConnected),
    has_upload: input.hasUpload ? 1 : 0,
  };
}
