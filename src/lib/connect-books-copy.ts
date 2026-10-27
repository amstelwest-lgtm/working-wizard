/**
 * Accountant Home connect card, and the Xero / QuickBooks dialog sentences.
 *
 * Xero consent is the read scopes in XERO_DEFAULT_SCOPES. QuickBooks uses
 * com.intuit.quickbooks.accounting, which can write. A ledger post still
 * needs a named approval and does not run from Connect.
 * Bank Summary reads account name, opening, cash received, cash spent, and
 * closing. It does not read the bank-transaction list.
 */

export const CONNECT_BOOKS_TITLE = "Connect Xero or QuickBooks";

export const CONNECT_BOOKS_TITLE_WITH_SAGE = "Connect Xero, QuickBooks or Sage";

export const CONNECT_BOOKS_BODY =
  "Connect your client's books so Milōn can read their numbers. Read-only. Nothing is posted without your approval.";

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

/** Sage sync is a stub (docs/SAGE_SA.md). Say so wherever Sage sits next to Xero and QuickBooks. */
export const SAGE_NOT_SYNCED_HINT =
  "Sage figures are not synced yet. Connecting checks the login only.";
