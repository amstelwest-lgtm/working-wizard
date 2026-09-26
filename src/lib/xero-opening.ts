import { CASH_FORECAST_WEEKS } from "@/lib/cash-runway";

/**
 * Starting cash and a weekly run-rate for the 13-week forecast after a Xero sync.
 * Pure — safe for the cash-forecast screen and the server sync.
 *
 * Bank-summary closing balances (or the balance-sheet cash line) fill an
 * empty opening. A figure the accountant typed is left alone. Openings this
 * module wrote are marked `openingBalanceSource: "xero"` and refresh on the
 * next sync.
 *
 * Cash received and cash spent are one total for the whole Bank Summary
 * window. When the forecast has no typed amounts, they become two weekly
 * lines (total ÷ 13). Typed amounts are not overwritten. Lines this module
 * wrote are marked `forecastLinesSource: "xero-bank-summary"` and refresh
 * until someone edits them.
 */

export type XeroOpeningApplyReason =
  | "applied"
  | "unchanged"
  | "typed_opening"
  | "zero_balance"
  | "invalid";

export type XeroOpeningCashSource = "bank_summary" | "balance_sheet";

export const XERO_BANK_LINES_SOURCE = "xero-bank-summary";
export const XERO_BANK_RECEIVED_LINE_ID = "xero-bank-received";
export const XERO_BANK_SPENT_LINE_ID = "xero-bank-spent";

export type XeroForecastLineSeedStatus = "seeded" | "refreshed" | "unchanged" | "skipped";

export type XeroBankFlowSeed = {
  accountCount: number;
  cashReceived: number;
  cashSpent: number;
  from: string;
  to: string;
};

type ForecastLine = {
  id: string;
  name: string;
  amount: string;
  frequency: string;
  startWeek: number;
  splitCount: number;
};

function moneyString(n: number): string {
  return String(Math.round(n * 100) / 100);
}

export function applyXeroOpeningCash(
  existing: unknown,
  cash: number,
  startDate: string,
): { cashflow: Record<string, unknown>; changed: boolean; reason: XeroOpeningApplyReason } {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  if (!Number.isFinite(cash)) return { cashflow: base, changed: false, reason: "invalid" };

  const currentRaw = base.openingBalance;
  const current =
    typeof currentRaw === "number" ? currentRaw : parseFloat(String(currentRaw ?? ""));
  const empty =
    currentRaw == null || currentRaw === "" || !Number.isFinite(current) || current === 0;
  const xeroOwned = base.openingBalanceSource === "xero";
  // A typed opening wins over a zero reading and over a new bank total.
  if (!empty && !xeroOwned) return { cashflow: base, changed: false, reason: "typed_opening" };
  // A zero bank reading must not invent an opening. A later sync can still
  // move an opening we own to zero.
  if (cash === 0 && !xeroOwned) return { cashflow: base, changed: false, reason: "zero_balance" };

  const next = moneyString(cash);
  if (
    String(currentRaw ?? "") === next &&
    xeroOwned &&
    typeof base.startDate === "string" &&
    base.startDate
  ) {
    return { cashflow: base, changed: false, reason: "unchanged" };
  }
  base.openingBalance = next;
  base.openingBalanceSource = "xero";
  if (typeof base.startDate !== "string" || !base.startDate) base.startDate = startDate;
  return { cashflow: base, changed: true, reason: "applied" };
}

/** Sentence for the Xero card and the client briefing after Sync. */
export function describeXeroOpeningCash(
  reason: XeroOpeningApplyReason,
  amount: number,
  source: XeroOpeningCashSource,
): string {
  const figure = moneyString(amount);
  if (reason === "applied") {
    return source === "bank_summary"
      ? `Opening cash applied from Bank Summary (${figure}).`
      : `Opening cash applied from the balance sheet (${figure}). Bank Summary had no closing balances.`;
  }
  if (reason === "unchanged") {
    return source === "bank_summary"
      ? `Opening cash already matched Bank Summary (${figure}).`
      : `Opening cash already matched the balance sheet (${figure}).`;
  }
  if (reason === "typed_opening") {
    return "Opening cash skipped — the forecast already has a typed opening.";
  }
  if (reason === "zero_balance") {
    return "Opening cash skipped — the closing balance is zero.";
  }
  return "Opening cash skipped — Xero did not return a cash balance.";
}

function asLines(value: unknown): ForecastLine[] {
  if (!Array.isArray(value)) return [];
  const out: ForecastLine[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const line = row as Partial<ForecastLine>;
    out.push({
      id: typeof line.id === "string" ? line.id : "",
      name: typeof line.name === "string" ? line.name : "",
      amount: line.amount == null ? "" : String(line.amount),
      frequency: typeof line.frequency === "string" ? line.frequency : "recurring-monthly",
      startWeek: typeof line.startWeek === "number" ? line.startWeek : 1,
      splitCount: typeof line.splitCount === "number" ? line.splitCount : 1,
    });
  }
  return out;
}

function lineAmount(line: ForecastLine): number {
  const n = parseFloat(line.amount);
  return Number.isFinite(n) ? n : 0;
}

function isXeroBankLine(line: ForecastLine): boolean {
  return line.id === XERO_BANK_RECEIVED_LINE_ID || line.id === XERO_BANK_SPENT_LINE_ID;
}

function weeklyLine(id: string, name: string, total: number): ForecastLine {
  return {
    id,
    name,
    amount: moneyString(total / CASH_FORECAST_WEEKS),
    frequency: "recurring-weekly",
    startWeek: 1,
    splitCount: 1,
  };
}

function sectionWithSeed(
  existing: ForecastLine[],
  seed: ForecastLine | null,
  seedId: string,
): ForecastLine[] {
  if (seed) return [seed];
  return existing.filter((line) => line.id !== seedId);
}

/**
 * Even weekly run-rate from Bank Summary cash received / cash spent.
 * `flows` is null when the report was not returned (missing scope or error).
 * A non-zero line that is not one of the two Xero seed lines blocks the write.
 * Seed lines that were edited (source flag cleared) are also left alone.
 */
export function seedXeroBankForecastLines(
  existing: Record<string, unknown>,
  flows: XeroBankFlowSeed | null,
): {
  cashflow: Record<string, unknown>;
  changed: boolean;
  status: XeroForecastLineSeedStatus;
  reason: string;
} {
  if (!flows) {
    return {
      cashflow: existing,
      changed: false,
      status: "skipped",
      reason:
        "Forecast lines skipped — Bank Summary was not returned, so cash received and cash spent were not added.",
    };
  }
  if (flows.accountCount <= 0) {
    return {
      cashflow: existing,
      changed: false,
      status: "skipped",
      reason: "Forecast lines skipped — Bank Summary listed no bank accounts.",
    };
  }
  const received = Number.isFinite(flows.cashReceived) ? flows.cashReceived : 0;
  const spent = Number.isFinite(flows.cashSpent) ? flows.cashSpent : 0;
  if (received === 0 && spent === 0) {
    return {
      cashflow: existing,
      changed: false,
      status: "skipped",
      reason: "Forecast lines skipped — Bank Summary cash received and cash spent are both zero.",
    };
  }

  const revenue = asLines(existing.revenue);
  const expenses = asLines(existing.expenses);
  const other = asLines(existing.other);
  const owned = existing.forecastLinesSource === XERO_BANK_LINES_SOURCE;
  const foreignTyped = [...revenue, ...expenses, ...other].some(
    (line) => lineAmount(line) !== 0 && !isXeroBankLine(line),
  );
  if (foreignTyped) {
    return {
      cashflow: existing,
      changed: false,
      status: "skipped",
      reason:
        "Forecast lines skipped — the 13-week forecast already has typed amounts. Bank Summary cash received and cash spent were not written over them.",
    };
  }
  const seedTyped = [...revenue, ...expenses].some(
    (line) => lineAmount(line) !== 0 && isXeroBankLine(line),
  );
  if (seedTyped && !owned) {
    return {
      cashflow: existing,
      changed: false,
      status: "skipped",
      reason:
        "Forecast lines skipped — the Xero cash lines on the forecast were edited, so this Sync left them as they are.",
    };
  }

  const receivedLine =
    received !== 0
      ? weeklyLine(XERO_BANK_RECEIVED_LINE_ID, "Cash received (Xero Bank Summary)", received)
      : null;
  const spentLine =
    spent !== 0
      ? weeklyLine(XERO_BANK_SPENT_LINE_ID, "Cash spent (Xero Bank Summary)", spent)
      : null;
  const nextRevenue = sectionWithSeed(revenue, receivedLine, XERO_BANK_RECEIVED_LINE_ID);
  const nextExpenses = sectionWithSeed(expenses, spentLine, XERO_BANK_SPENT_LINE_ID);
  const note = `Weekly run-rate from Xero Bank Summary ${flows.from} to ${flows.to}: cash received ${moneyString(received)} and cash spent ${moneyString(spent)}, spread evenly over ${CASH_FORECAST_WEEKS} weeks. Editing a line keeps your figures on the next Sync.`;
  const same =
    JSON.stringify(revenue) === JSON.stringify(nextRevenue) &&
    JSON.stringify(expenses) === JSON.stringify(nextExpenses) &&
    existing.forecastLinesNote === note &&
    owned;
  if (same) {
    return {
      cashflow: existing,
      changed: false,
      status: "unchanged",
      reason: `Forecast lines already match the Bank Summary weekly run-rate (cash received ${moneyString(received)}, cash spent ${moneyString(spent)}).`,
    };
  }

  const next: Record<string, unknown> = {
    ...existing,
    revenue: nextRevenue,
    expenses: nextExpenses,
    forecastLinesSource: XERO_BANK_LINES_SOURCE,
    forecastLinesNote: note,
  };
  const refreshed = owned || seedTyped;
  return {
    cashflow: next,
    changed: true,
    status: refreshed ? "refreshed" : "seeded",
    reason: refreshed
      ? `Forecast lines refreshed from Bank Summary — cash received ${moneyString(received)} and cash spent ${moneyString(spent)} as a weekly run-rate over ${CASH_FORECAST_WEEKS} weeks.`
      : `Forecast lines seeded from Bank Summary — cash received ${moneyString(received)} and cash spent ${moneyString(spent)} as a weekly run-rate over ${CASH_FORECAST_WEEKS} weeks. Lines with no amount were replaced. A typed amount would have been kept.`,
  };
}

/**
 * When the saved forecast opening is still empty, use the cash figure already
 * on the financials blob (Xero sync or a statement upload).
 * Returns null when the forecast already has its own opening.
 */
export function forecastOpeningFromStored(
  openingBalance: string | number | null | undefined,
  financialsCash: string | number | null | undefined,
): string | null {
  const opening =
    typeof openingBalance === "number" ? openingBalance : parseFloat(String(openingBalance ?? ""));
  if (Number.isFinite(opening) && opening !== 0) return null;
  const cash =
    typeof financialsCash === "number" ? financialsCash : parseFloat(String(financialsCash ?? ""));
  if (!Number.isFinite(cash) || cash === 0) return null;
  return String(Math.round(cash * 100) / 100);
}
