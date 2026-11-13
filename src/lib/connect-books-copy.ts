/**
 * Accountant Home connect card, and the Xero / QuickBooks dialog sentences.
 *
 * Xero consent is the read scopes in XERO_DEFAULT_SCOPES. QuickBooks uses
 * com.intuit.quickbooks.accounting, which can write. A ledger post still
 * needs a named approval and does not run from Connect.
 * Bank Summary reads account name, opening, cash received, cash spent, and
 * closing. It does not read the bank-transaction list.
 */

/** The buttons name each ledger, so the heading does not list them. */
export const CONNECT_BOOKS_TITLE = "Connect this client's books";

export const CONNECT_BOOKS_BODY =
  "Milōn reads the figures straight from the ledger. Read-only. Nothing is posted without your approval.";

export const QBO_CONNECT_SUBCOPY = "Connect QuickBooks Online to sync this client's books.";

export const XERO_BANK_RECONNECT =
  "Existing connections need a reconnect to read bank balances and cash in and out (read-only).";

export type ConnectBooksLedger = {
  xero: unknown;
  qbo: unknown;
  sage: unknown;
};

/** True when this client has no Xero, QuickBooks, or Sage connection row. */
export function connectBooksHomeVisible(ledgers: ConnectBooksLedger): boolean {
  return !ledgers.xero && !ledgers.qbo && !ledgers.sage;
}

export const HOME_BOOKS_CHECKING = "Checking this client's books.";

export type HomeLedgerChip = {
  /** Status calls have not settled. Not "no ledger". */
  pending: boolean;
  ledger: "QuickBooks" | "Xero" | "Sage" | null;
  /** The connect card. False while pending, so Home does not say none early. */
  booksMissing: boolean;
};

/**
 * Home connect chip. Unknown stays pending. A settled miss is the connect
 * card. QuickBooks wins, then Xero, then Sage, matching the home title.
 */
export function homeLedgerChip(input: {
  known: boolean;
  xero: unknown;
  qbo: unknown;
  sage: unknown;
}): HomeLedgerChip {
  if (!input.known) return { pending: true, ledger: null, booksMissing: false };
  const ledger = input.qbo ? "QuickBooks" : input.xero ? "Xero" : input.sage ? "Sage" : null;
  return {
    pending: false,
    ledger,
    booksMissing: connectBooksHomeVisible(input),
  };
}

type HomeCardLines = {
  financial_manager: readonly string[];
  analyst: readonly string[];
  advisor: readonly string[];
};

function isConnectHeadline(line: string): boolean {
  return line.startsWith("Connect QuickBooks");
}

/**
 * While ledger status is still out, a connect headline is not "no books".
 * A real cash line is left alone. A connect headline does not blank the
 * other two cards.
 */
export function homeLinesWhileLedgerPending<T extends HomeCardLines>(lines: T, pending: boolean): T {
  if (!pending) return lines;
  const swap = (line: string) => (isConnectHeadline(line) ? HOME_BOOKS_CHECKING : line);
  if (!lines.financial_manager.some(isConnectHeadline)) {
    return {
      ...lines,
      financial_manager: lines.financial_manager.map(swap),
      analyst: lines.analyst.map(swap),
      advisor: lines.advisor.map(swap),
    };
  }
  return {
    ...lines,
    financial_manager: [HOME_BOOKS_CHECKING],
    analyst: [HOME_BOOKS_CHECKING],
    advisor: [HOME_BOOKS_CHECKING],
  };
}

/** Sage sync is a stub (docs/SAGE_SA.md). Say so wherever Sage sits next to Xero and QuickBooks. */
export const SAGE_NOT_SYNCED_HINT =
  "Sage figures are not synced yet. Connecting checks the login only.";
