import { CASH_FORECAST_WEEKS } from "@/lib/cash-runway";

/**
 * Starting cash and a weekly run-rate for the 13-week forecast after a
 * Xero or QuickBooks sync. Pure — safe for the cash-forecast screen and
 * the server sync.
 *
 * Bank closing balances (or the balance-sheet cash line) fill an empty
 * opening. A figure the accountant typed is left alone. Openings this
 * module wrote are marked `openingBalanceSource` and refresh on the next
 * sync, including when the other ledger takes the file.
 *
 * QuickBooks with no bank accounts still seeds the 13-week forecast from
 * balance-sheet cash. A typed opening is not overwritten; empty forecast
 * lines are. Cash received and cash spent, when the activity report has
 * them, stay the weekly lines even if the chart of accounts listed no banks.
 *
 * Cash received and cash spent are one total for the window. When the
 * forecast has no typed amounts, they become two weekly lines (total ÷ 13).
 * Typed amounts are not overwritten. Lines this module wrote refresh until
 * someone edits them.
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

export const QBO_BANK_LINES_SOURCE = "qbo-bank-activity";
export const QBO_BANK_RECEIVED_LINE_ID = "qbo-bank-received";
export const QBO_BANK_SPENT_LINE_ID = "qbo-bank-spent";

const LEDGER_OPENING_SOURCES = new Set(["xero", "qbo"]);
const LEDGER_LINE_SOURCES = new Set([XERO_BANK_LINES_SOURCE, QBO_BANK_LINES_SOURCE]);
const LEDGER_SEED_LINE_IDS = new Set([
  XERO_BANK_RECEIVED_LINE_ID,
  XERO_BANK_SPENT_LINE_ID,
  QBO_BANK_RECEIVED_LINE_ID,
  QBO_BANK_SPENT_LINE_ID,
]);

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

function applyLedgerOpeningCash(
  existing: unknown,
  cash: number,
  startDate: string,
  source: "xero" | "qbo",
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
  const ledgerOwned = LEDGER_OPENING_SOURCES.has(String(base.openingBalanceSource ?? ""));
  // A typed opening wins over a zero reading and over a new bank total.
  if (!empty && !ledgerOwned) return { cashflow: base, changed: false, reason: "typed_opening" };
  // A zero bank reading must not invent an opening. A later sync can still
  // move an opening we own to zero.
  if (cash === 0 && !ledgerOwned) return { cashflow: base, changed: false, reason: "zero_balance" };

  const next = moneyString(cash);
  if (
    String(currentRaw ?? "") === next &&
    base.openingBalanceSource === source &&
    typeof base.startDate === "string" &&
    base.startDate
  ) {
    return { cashflow: base, changed: false, reason: "unchanged" };
  }
  base.openingBalance = next;
  base.openingBalanceSource = source;
  if (typeof base.startDate !== "string" || !base.startDate) base.startDate = startDate;
  return { cashflow: base, changed: true, reason: "applied" };
}

export function applyXeroOpeningCash(
  existing: unknown,
  cash: number,
  startDate: string,
): { cashflow: Record<string, unknown>; changed: boolean; reason: XeroOpeningApplyReason } {
  return applyLedgerOpeningCash(existing, cash, startDate, "xero");
}

export function applyQboOpeningCash(
  existing: unknown,
  cash: number,
  startDate: string,
): { cashflow: Record<string, unknown>; changed: boolean; reason: XeroOpeningApplyReason } {
  return applyLedgerOpeningCash(existing, cash, startDate, "qbo");
}

/** A non-zero opening the accountant typed. Ledger-owned openings refresh. */
export function isTypedForecastOpening(existing: unknown): boolean {
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) return false;
  const base = existing as Record<string, unknown>;
  const raw = base.openingBalance;
  const current = typeof raw === "number" ? raw : parseFloat(String(raw ?? ""));
  const empty = raw == null || raw === "" || !Number.isFinite(current) || current === 0;
  if (empty) return false;
  return !LEDGER_OPENING_SOURCES.has(String(base.openingBalanceSource ?? ""));
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

export type QboOpeningCashSource = "bank_accounts" | "balance_sheet";

/** Sentence for the QuickBooks card after Sync. */
export function describeQboOpeningCash(
  reason: XeroOpeningApplyReason,
  amount: number,
  source: QboOpeningCashSource,
): string {
  const figure = moneyString(amount);
  if (reason === "applied") {
    return source === "bank_accounts"
      ? `Opening cash applied from QuickBooks bank accounts (${figure}).`
      : `Opening cash applied from the balance sheet (${figure}). QuickBooks bank accounts had no closing balances.`;
  }
  if (reason === "unchanged") {
    return source === "bank_accounts"
      ? `Opening cash already matched QuickBooks bank accounts (${figure}).`
      : `Opening cash already matched the balance sheet (${figure}).`;
  }
  if (reason === "typed_opening") {
    return "Opening cash skipped — the forecast already has a typed opening.";
  }
  if (reason === "zero_balance") {
    return "Opening cash skipped — the closing balance is zero.";
  }
  return "Opening cash skipped — QuickBooks did not return a cash balance.";
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

function isLedgerBankLine(line: ForecastLine): boolean {
  return LEDGER_SEED_LINE_IDS.has(line.id);
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

function sectionWithSeed(existing: ForecastLine[], seed: ForecastLine | null): ForecastLine[] {
  if (seed) return [seed];
  // A zero side drops both ledgers' seed lines so a Xero line cannot survive a QuickBooks sync.
  return existing.filter((line) => !LEDGER_SEED_LINE_IDS.has(line.id));
}

type ForecastSeedVoice = {
  source: string;
  receivedId: string;
  spentId: string;
  receivedName: string;
  spentName: string;
  /** "Bank Summary" or "QuickBooks bank activity" — used in the skip sentences. */
  reportLabel: string;
  /** "Xero" or "QuickBooks" — the edited-line sentence. */
  providerName: string;
  /** "Xero Bank Summary" — the note and the line titles' report. */
  noteLabel: string;
};

const XERO_SEED_VOICE: ForecastSeedVoice = {
  source: XERO_BANK_LINES_SOURCE,
  receivedId: XERO_BANK_RECEIVED_LINE_ID,
  spentId: XERO_BANK_SPENT_LINE_ID,
  receivedName: "Cash received (Xero Bank Summary)",
  spentName: "Cash spent (Xero Bank Summary)",
  reportLabel: "Bank Summary",
  providerName: "Xero",
  noteLabel: "Xero Bank Summary",
};

const QBO_SEED_VOICE: ForecastSeedVoice = {
  source: QBO_BANK_LINES_SOURCE,
  receivedId: QBO_BANK_RECEIVED_LINE_ID,
  spentId: QBO_BANK_SPENT_LINE_ID,
  receivedName: "Cash received (QuickBooks)",
  spentName: "Cash spent (QuickBooks)",
  reportLabel: "QuickBooks bank activity",
  providerName: "QuickBooks",
  noteLabel: "QuickBooks bank activity",
};

/**
 * Even weekly run-rate from cash received / cash spent.
 * `flows` is null when the report was not returned.
 * A non-zero line that is not a ledger seed line blocks the write.
 * Seed lines that were edited (source flag cleared) are left alone.
 * Lines the other ledger seeded are replaced — the sync that just succeeded owns the file.
 */
function seedLedgerBankForecastLines(
  existing: Record<string, unknown>,
  flows: XeroBankFlowSeed | null,
  voice: ForecastSeedVoice,
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
      reason: `Forecast lines skipped — ${voice.reportLabel} was not returned, so cash received and cash spent were not added.`,
    };
  }
  if (flows.accountCount <= 0) {
    return {
      cashflow: existing,
      changed: false,
      status: "skipped",
      reason: `Forecast lines skipped — ${voice.reportLabel} listed no bank accounts.`,
    };
  }
  const received = Number.isFinite(flows.cashReceived) ? flows.cashReceived : 0;
  const spent = Number.isFinite(flows.cashSpent) ? flows.cashSpent : 0;
  if (received === 0 && spent === 0) {
    return {
      cashflow: existing,
      changed: false,
      status: "skipped",
      reason: `Forecast lines skipped — ${voice.reportLabel} cash received and cash spent are both zero.`,
    };
  }

  const revenue = asLines(existing.revenue);
  const expenses = asLines(existing.expenses);
  const other = asLines(existing.other);
  const ownedByThis = existing.forecastLinesSource === voice.source;
  const ownedByLedger = LEDGER_LINE_SOURCES.has(String(existing.forecastLinesSource ?? ""));
  const foreignTyped = [...revenue, ...expenses, ...other].some(
    (line) => lineAmount(line) !== 0 && !isLedgerBankLine(line),
  );
  if (foreignTyped) {
    return {
      cashflow: existing,
      changed: false,
      status: "skipped",
      reason: `Forecast lines skipped — the 13-week forecast already has typed amounts. ${voice.reportLabel} cash received and cash spent were not written over them.`,
    };
  }
  const seedTyped = [...revenue, ...expenses].some(
    (line) => lineAmount(line) !== 0 && isLedgerBankLine(line),
  );
  if (seedTyped && !ownedByLedger) {
    return {
      cashflow: existing,
      changed: false,
      status: "skipped",
      reason: `Forecast lines skipped — the ${voice.providerName} cash lines on the forecast were edited, so this Sync left them as they are.`,
    };
  }

  const receivedLine =
    received !== 0 ? weeklyLine(voice.receivedId, voice.receivedName, received) : null;
  const spentLine = spent !== 0 ? weeklyLine(voice.spentId, voice.spentName, spent) : null;
  const nextRevenue = sectionWithSeed(revenue, receivedLine);
  const nextExpenses = sectionWithSeed(expenses, spentLine);
  const note = `Weekly run-rate from ${voice.noteLabel} ${flows.from} to ${flows.to}: cash received ${moneyString(received)} and cash spent ${moneyString(spent)}, spread evenly over ${CASH_FORECAST_WEEKS} weeks. Editing a line keeps your figures on the next Sync.`;
  const same =
    JSON.stringify(revenue) === JSON.stringify(nextRevenue) &&
    JSON.stringify(expenses) === JSON.stringify(nextExpenses) &&
    existing.forecastLinesNote === note &&
    ownedByThis;
  if (same) {
    return {
      cashflow: existing,
      changed: false,
      status: "unchanged",
      reason: `Forecast lines already match the ${voice.reportLabel} weekly run-rate (cash received ${moneyString(received)}, cash spent ${moneyString(spent)}).`,
    };
  }

  const next: Record<string, unknown> = {
    ...existing,
    revenue: nextRevenue,
    expenses: nextExpenses,
    forecastLinesSource: voice.source,
    forecastLinesNote: note,
  };
  const refreshed = ownedByLedger || seedTyped;
  return {
    cashflow: next,
    changed: true,
    status: refreshed ? "refreshed" : "seeded",
    reason: refreshed
      ? `Forecast lines refreshed from ${voice.reportLabel} — cash received ${moneyString(received)} and cash spent ${moneyString(spent)} as a weekly run-rate over ${CASH_FORECAST_WEEKS} weeks.`
      : `Forecast lines seeded from ${voice.reportLabel} — cash received ${moneyString(received)} and cash spent ${moneyString(spent)} as a weekly run-rate over ${CASH_FORECAST_WEEKS} weeks. Lines with no amount were replaced. A typed amount would have been kept.`,
  };
}

/**
 * Even weekly run-rate from Bank Summary cash received / cash spent.
 * `flows` is null when the report was not returned (missing scope or error).
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
  return seedLedgerBankForecastLines(existing, flows, XERO_SEED_VOICE);
}

/** Sentence stored on the cash forecast when bank accounts are missing. */
export function qboBalanceSheetHoldNote(amount: number): string {
  return `Forecast lines seeded from the balance sheet (${moneyString(amount)}). QuickBooks listed no bank accounts, so the 13-week forecast holds that cash.`;
}

export function isQboBalanceSheetHoldNote(note: string | null | undefined): boolean {
  if (typeof note !== "string") return false;
  return /balance sheet/i.test(note) && /no bank accounts/i.test(note) && /13-week/i.test(note);
}

function forecastLineKind(existing: Record<string, unknown>): "foreign" | "edited" | "empty" {
  const revenue = asLines(existing.revenue);
  const expenses = asLines(existing.expenses);
  const other = asLines(existing.other);
  const ownedByLedger = LEDGER_LINE_SOURCES.has(String(existing.forecastLinesSource ?? ""));
  const all = [...revenue, ...expenses, ...other];
  if (all.some((line) => lineAmount(line) !== 0 && !isLedgerBankLine(line))) return "foreign";
  if (all.some((line) => lineAmount(line) !== 0 && isLedgerBankLine(line)) && !ownedByLedger) {
    return "edited";
  }
  return "empty";
}

/**
 * No bank accounts and no cash-in / cash-out. Hold balance-sheet cash for
 * 13 weeks instead of leaving the cash tab with no forecast. A typed opening
 * stays; empty lines are filled with a QuickBooks hold the next sync can replace.
 */
function seedQboBalanceSheetHold(
  existing: Record<string, unknown>,
  flows: XeroBankFlowSeed | null,
  balanceSheetCash: number,
): {
  cashflow: Record<string, unknown>;
  changed: boolean;
  status: XeroForecastLineSeedStatus;
  reason: string;
} {
  const kind = forecastLineKind(existing);
  if (kind === "foreign") {
    return {
      cashflow: existing,
      changed: false,
      status: "skipped",
      reason: `Forecast lines skipped — the 13-week forecast already has typed amounts. ${QBO_SEED_VOICE.reportLabel} cash received and cash spent were not written over them.`,
    };
  }
  if (kind === "edited") {
    return {
      cashflow: existing,
      changed: false,
      status: "skipped",
      reason: `Forecast lines skipped — the ${QBO_SEED_VOICE.providerName} cash lines on the forecast were edited, so this Sync left them as they are.`,
    };
  }
  const note = qboBalanceSheetHoldNote(balanceSheetCash);
  const held: ForecastLine = {
    id: QBO_BANK_RECEIVED_LINE_ID,
    name: "Cash held (QuickBooks balance sheet)",
    amount: "0",
    frequency: "recurring-weekly",
    startWeek: 1,
    splitCount: 1,
  };
  const revenue = [held];
  const expenses = asLines(existing.expenses).filter((line) => !LEDGER_SEED_LINE_IDS.has(line.id));
  const same =
    existing.forecastLinesSource === QBO_BANK_LINES_SOURCE &&
    existing.forecastLinesNote === note &&
    JSON.stringify(asLines(existing.revenue)) === JSON.stringify(revenue) &&
    JSON.stringify(asLines(existing.expenses)) === JSON.stringify(expenses);
  if (same) {
    return {
      cashflow: existing,
      changed: false,
      status: "unchanged",
      reason: note,
    };
  }
  const next: Record<string, unknown> = {
    ...existing,
    revenue,
    expenses,
    forecastLinesSource: QBO_BANK_LINES_SOURCE,
    forecastLinesNote: note,
  };
  if ((typeof next.startDate !== "string" || !next.startDate) && flows?.to) {
    next.startDate = flows.to;
  }
  return {
    cashflow: next,
    changed: true,
    status: "seeded",
    reason: note,
  };
}

/** Same weekly run-rate as the Xero bank path, from QuickBooks bank activity. */
export function seedQboBankForecastLines(
  existing: Record<string, unknown>,
  flows: XeroBankFlowSeed | null,
  options?: { balanceSheetCash?: number | null },
): {
  cashflow: Record<string, unknown>;
  changed: boolean;
  status: XeroForecastLineSeedStatus;
  reason: string;
} {
  const sheetRaw = options?.balanceSheetCash;
  const sheet = typeof sheetRaw === "number" && Number.isFinite(sheetRaw) ? sheetRaw : null;
  const received = flows && Number.isFinite(flows.cashReceived) ? flows.cashReceived : 0;
  const spent = flows && Number.isFinite(flows.cashSpent) ? flows.cashSpent : 0;
  const noBanks = !flows || flows.accountCount <= 0;
  if (noBanks && flows && (received !== 0 || spent !== 0)) {
    return seedLedgerBankForecastLines(existing, { ...flows, accountCount: 1 }, QBO_SEED_VOICE);
  }
  if (noBanks && sheet != null && sheet !== 0) {
    return seedQboBalanceSheetHold(existing, flows, sheet);
  }
  return seedLedgerBankForecastLines(existing, flows, QBO_SEED_VOICE);
}

/**
 * Opening the forecast should show.
 * Returns the live cash string when the saved opening is empty or disagrees
 * with the cash Overview is using. Returns null when they already match.
 * A stale non-zero opening (an old snapshot) is replaced, not kept.
 */
export function forecastOpeningFromStored(
  openingBalance: string | number | null | undefined,
  financialsCash: string | number | null | undefined,
): string | null {
  const cash =
    typeof financialsCash === "number" ? financialsCash : parseFloat(String(financialsCash ?? ""));
  if (!Number.isFinite(cash)) return null;
  const opening =
    typeof openingBalance === "number" ? openingBalance : parseFloat(String(openingBalance ?? ""));
  const live = String(Math.round(cash * 100) / 100);
  if (Number.isFinite(opening) && Math.abs(opening - cash) < 0.5) return null;
  return live;
}
