/**
 * Cashflow and period financials for one known client.
 * Both selects start together. Neither waits on role resolution.
 */
import { forecastOpeningIsKnown, OPENING_CASH_UNKNOWN } from "@/lib/client-metrics";
import { OPENING_BALANCE_MISSING } from "@/lib/cash-forecast-parity";
import { formatMoney, type MoneyMarket } from "@/lib/market/format";
import { ownerAnswerTiles, type OwnerBooks } from "@/lib/owner-answers";
import type { SavedCashflowLike } from "@/lib/cash-runway";

export async function beginOwnerClientReads<C, F>(
  readCashflow: () => Promise<C>,
  readFinancials: () => Promise<F>,
): Promise<[C, F]> {
  return Promise.all([readCashflow(), readFinancials()]);
}

/**
 * Cash sentence for the boot shell. The stored opening is enough.
 * Financials, the cash pillar, and ownerBoardReady are not.
 */
export function bootShellCashLine(
  cashflow: SavedCashflowLike | null | undefined,
  market: MoneyMarket,
): string | null {
  if (!cashflow) return null;
  const books: OwnerBooks = {
    hasBooks: true,
    ledger: null,
    revenue: null,
    priorRevenue: null,
    cogs: null,
    receivables: null,
    cashflow,
    hasEvidence: true,
    cashOnFile: true,
    openingMissing: false,
    cashPillarStatus: null,
    openAction: null,
    actionsReady: true,
    signedBy: null,
    signedOn: null,
    market,
  };
  const sentence = ownerAnswerTiles(books).find((tile) => tile.id === "cash")?.sentence ?? "";
  if (
    sentence &&
    sentence !== "The 13-week line is not on file yet." &&
    sentence !== OPENING_CASH_UNKNOWN &&
    sentence !== `${OPENING_BALANCE_MISSING}.`
  ) {
    return sentence;
  }
  if (!forecastOpeningIsKnown(cashflow)) return null;
  const raw = (cashflow as { openingBalance?: unknown }).openingBalance;
  const opening = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(opening)) return null;
  return `Cash is ${formatMoney(opening, market)}.`;
}

/** Drop the previous client's cash line as soon as the workspace changes. */
export function cashflowOnClientSwitch<T extends { cashflow?: unknown }>(
  meta: T | null,
  previousClientId: string | null,
  nextClientId: string | null,
): T | null {
  if (previousClientId === nextClientId) return meta;
  if (!meta) return null;
  return { ...meta, cashflow: null };
}
