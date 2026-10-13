/**
 * Owner home tiles. Every figure is passed in. A missing book, forecast,
 * action, or sign-off becomes an empty sentence. Nothing here is a sample.
 */
import {
  cashComfortThreshold,
  closingBalancesFromCashflow,
  type SavedCashflowLike,
} from "@/lib/cash-runway";
import { formatMoney, type MoneyMarket } from "@/lib/market/format";
import type { AgentKey } from "@/lib/milon-team-feed";

export type OwnerHomeLines = Record<AgentKey, readonly string[]>;

export type OwnerTileId = "cash" | "owes" | "profit" | "answer" | "signed";

export type OwnerTile = {
  id: OwnerTileId;
  heading: string;
  sentence: string;
  source: string;
  step: string;
  ask: AgentKey | null;
  signed: boolean;
  empty: boolean;
};

export type OwnerBooks = {
  hasBooks: boolean;
  ledger: "QuickBooks" | "Xero" | null;
  revenue: number | null;
  priorRevenue: number | null;
  cogs: number | null;
  priorCogs: number | null;
  receivables: number | null;
  /** Aged overdue balance. Null when the collections snapshot is not loaded. */
  overdueReceivables?: number | null;
  cashflow: SavedCashflowLike | null;
  openAction: string | null;
  /** False until the action-point read has finished. */
  actionsReady: boolean;
  signedBy: string | null;
  signedOn: string | null;
  market: MoneyMarket;
  /**
   * Cash and floor from the same outlook Health uses.
   * When set, the home card does not use the $50,000 comfort line.
   */
  cashPosition?: { cash: number; floor: number } | null;
};

export function ownerAmount(n: number, market: MoneyMarket): string {
  return formatMoney(n, market).replace(/ /g, "\u00a0");
}

function finite(n: number | null): n is number {
  return n != null && Number.isFinite(n);
}

const CONNECT = "Connect QuickBooks or Xero.";
const CONNECT_STEP = "Connect your books";

export function ownerAnswerTiles(books: OwnerBooks): OwnerTile[] {
  const money = (n: number) => ownerAmount(n, books.market);
  const booksSource = books.ledger ? `From the books in ${books.ledger}` : "From the books";

  const cash = cashTile(books, money, booksSource);
  const owes = finite(books.receivables)
    ? {
        id: "owes" as const,
        heading: "Who owes you",
        sentence: `Customers owe ${money(books.receivables)}.`,
        source: booksSource,
        step: "Ask",
        ask: "analyst" as const,
        signed: false,
        empty: false,
      }
    : {
        id: "owes" as const,
        heading: "Who owes you",
        sentence: books.hasBooks ? "Debtor balances are not on file yet." : CONNECT,
        source: books.hasBooks ? booksSource : "No books connected",
        step: books.hasBooks ? "Ask" : CONNECT_STEP,
        ask: books.hasBooks ? ("analyst" as const) : null,
        signed: false,
        empty: true,
      };

  const profit = profitTile(books, money, booksSource);
  const answer = !books.actionsReady
    ? {
        id: "answer" as const,
        heading: "What needs your answer",
        sentence: "Checking action points.",
        source: "Action points",
        step: "Open action points",
        ask: null,
        signed: false,
        empty: true,
      }
    : books.openAction
      ? {
          id: "answer" as const,
          heading: "What needs your answer",
          sentence: books.openAction,
          source: "Open action point",
          step: "Open action points",
          ask: null,
          signed: false,
          empty: false,
        }
      : {
          id: "answer" as const,
          heading: "What needs your answer",
          sentence: "Nothing is waiting on you.",
          source: "Action points",
          step: "Open action points",
          ask: null,
          signed: false,
          empty: true,
        };

  const signed = books.signedBy
    ? {
        id: "signed" as const,
        heading: "What your accountant signed",
        sentence: books.signedOn
          ? `${books.signedBy} signed off on ${books.signedOn}.`
          : `${books.signedBy} signed off.`,
        source: "Accountant sign-off",
        step: "See what they signed",
        ask: null,
        signed: true,
        empty: false,
      }
    : {
        id: "signed" as const,
        heading: "What your accountant signed",
        sentence: "Invite your accountant to sign off.",
        source: "No accountant sign-off yet",
        step: "Invite your accountant",
        ask: null,
        signed: false,
        empty: true,
      };

  return [cash, owes, profit, answer, signed];
}

const MONEY_TOKEN =
  /\$(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|R[\u00a0 ](?:\d{1,3}(?:[,\u00a0 ]\d{3})+|\d+)(?:\.\d+)?/g;

function amountsIn(sentence: string): string[] {
  return sentence.match(MONEY_TOKEN) ?? [];
}

/** A displayed line is one sentence: capital letter, one space run, closing stop. */
export function guardOwnerLine(line: string): string {
  const collapsed = line.replace(/[^\S\u00a0]+/g, " ").trim();
  if (!collapsed) return "";
  const capped = collapsed.charAt(0).toUpperCase() + collapsed.slice(1);
  return /[.!?]$/.test(capped) ? capped : `${capped}.`;
}

/** Home cash copy. The tile sentence stays long for the hold screen. */
function cashHomeLine(sentence: string): string {
  if (sentence === CONNECT || sentence === "The 13-week line is not on file yet.") return sentence;
  if (sentence.startsWith("Cash is ") && sentence.includes(" floor")) return guardOwnerLine(sentence);
  const amounts = amountsIn(sentence);
  if (sentence.includes("stays above") && amounts.length >= 2) {
    const [floor, low] = amounts;
    return `Cash stays above your ${floor} minimum. The low point is ${low}.`;
  }
  if (sentence.includes("under the") && amounts.length >= 3) {
    const [, under, floor] = amounts;
    return `Cash is ${under} below your ${floor} minimum.`;
  }
  return guardOwnerLine(sentence);
}

/** Home profit copy. The tile sentence stays long for the hold screen. */
function profitHomeLine(sentence: string): string {
  if (sentence === CONNECT || sentence === "Profit is not on file yet.") return sentence;
  const [amount] = amountsIn(sentence);
  if (!amount) return guardOwnerLine(sentence);
  if (sentence.includes("more than the prior")) return `Profit is ${amount}, up on last period.`;
  if (sentence.includes("less than the prior")) return `Profit is ${amount}, down on last period.`;
  if (sentence.includes("the same as the prior")) return `Profit is ${amount}, the same as last period.`;
  return `Profit is ${amount}.`;
}

export type OwnerStatusTone = "attention" | "critical";

export type OwnerCardStatus = {
  tone: OwnerStatusTone;
  word: "Attention" | "Critical";
};

function forecastLow(books: OwnerBooks): number | null {
  const balances = closingBalancesFromCashflow(books.cashflow);
  if (!balances || balances.length === 0) return null;
  let low = balances[0];
  for (const value of balances) if (value < low) low = value;
  return low;
}

/**
 * A chip only when the card's figures are a problem.
 * Cash under the 13-week floor is Critical. A profit decline, or overdue
 * debtors above zero, is Attention. The stronger tone wins on the analyst card.
 */
export function ownerCardStatuses(books: OwnerBooks): Record<AgentKey, OwnerCardStatus | null> {
  const positioned = canonicalCash(books);
  const low = positioned ? positioned.cash : forecastLow(books);
  const floor = positioned ? positioned.floor : cashComfortThreshold(books.market.currency);
  const cash: OwnerCardStatus | null =
    low != null && low < floor ? { tone: "critical", word: "Critical" } : null;

  const gross =
    finite(books.revenue) && finite(books.cogs) ? books.revenue - books.cogs : null;
  const prior =
    finite(books.priorRevenue) && finite(books.priorCogs)
      ? books.priorRevenue - books.priorCogs
      : null;
  const profitDown = gross != null && prior != null && gross < prior;
  const overdue = finite(books.overdueReceivables ?? null) && (books.overdueReceivables ?? 0) > 0;
  const analyst: OwnerCardStatus | null =
    profitDown || overdue ? { tone: "attention", word: "Attention" } : null;

  return { financial_manager: cash, analyst, advisor: null };
}

/** One or two short lines under each bot. Sign-off stays off this page. */
export function ownerHomeLines(
  tiles: readonly OwnerTile[],
  topMove: string | null,
): OwnerHomeLines {
  const sentence = (id: OwnerTileId) => tiles.find((tile) => tile.id === id)?.sentence ?? "";
  const cash = sentence("cash");
  const move = topMove?.replace(/\s+/g, " ").trim() ?? "";
  return {
    financial_manager: [cashHomeLine(cash), guardOwnerLine(sentence("answer"))].filter((line) => line.length > 0),
    analyst: [profitHomeLine(sentence("profit")), guardOwnerLine(sentence("owes"))].filter(
      (line) => line.length > 0,
    ),
    advisor: [guardOwnerLine(move || (cash === CONNECT ? CONNECT : "No next move yet."))],
  };
}

function canonicalCash(books: OwnerBooks): { cash: number; floor: number } | null {
  const position = books.cashPosition;
  if (!position || !finite(position.cash) || !finite(position.floor)) return null;
  return position;
}

function cashTile(books: OwnerBooks, money: (n: number) => string, booksSource: string): OwnerTile {
  const base = {
    id: "cash" as const,
    heading: "Cash over the next 13 weeks",
    ask: "financial_manager" as const,
  };
  const positioned = canonicalCash(books);
  if (positioned) {
    const under = positioned.floor - positioned.cash;
    const sentence =
      under > 0
        ? `Cash is ${money(under)} below the ${money(positioned.floor)} floor.`
        : `Cash is ${money(positioned.cash)}, above the ${money(positioned.floor)} floor.`;
    return {
      ...base,
      sentence,
      source: `${booksSource}, 13-week forecast`,
      step: "Ask",
      signed: false,
      empty: false,
    };
  }
  const balances = closingBalancesFromCashflow(books.cashflow);
  if (!balances || balances.length === 0) {
    return {
      ...base,
      sentence: books.hasBooks
        ? "The 13-week line is not on file yet."
        : "Connect QuickBooks or Xero.",
      source: books.hasBooks ? "13-week forecast" : "No books connected",
      step: books.hasBooks ? "Ask" : "Connect your books",
      signed: false,
      empty: true,
    };
  }
  let low = balances[0];
  for (const value of balances) if (value < low) low = value;
  const floor = cashComfortThreshold(books.market.currency);
  const under = floor - low;
  const sentence =
    under > 0
      ? `The low point on the 13-week line is ${money(low)}, ${money(under)} under the ${money(floor)} floor.`
      : `The 13-week line stays above the ${money(floor)} floor. The low point is ${money(low)}.`;
  return {
    ...base,
    sentence,
    source: `${booksSource}, 13-week forecast`,
    step: "Ask",
    signed: false,
    empty: false,
  };
}

function profitTile(
  books: OwnerBooks,
  money: (n: number) => string,
  booksSource: string,
): OwnerTile {
  const base = {
    id: "profit" as const,
    heading: "Am I making money",
    ask: "analyst" as const,
    signed: false,
  };
  if (!finite(books.revenue) || !finite(books.cogs)) {
    return {
      ...base,
      sentence: books.hasBooks ? "Profit is not on file yet." : "Connect QuickBooks or Xero.",
      source: books.hasBooks ? booksSource : "No books connected",
      step: books.hasBooks ? "Ask" : "Connect your books",
      empty: true,
    };
  }
  const gross = books.revenue - books.cogs;
  let sentence = `Gross profit is ${money(gross)}.`;
  if (finite(books.priorRevenue) && finite(books.priorCogs)) {
    const prior = books.priorRevenue - books.priorCogs;
    sentence =
      gross < prior
        ? `Gross profit is ${money(gross)}, less than the prior period.`
        : gross > prior
          ? `Gross profit is ${money(gross)}, more than the prior period.`
          : `Gross profit is ${money(gross)}, the same as the prior period.`;
  }
  return {
    ...base,
    sentence,
    source: booksSource,
    step: "Ask",
    empty: false,
  };
}

export type PracticeBook = {
  clientCount: number;
  avgHealth: number | null;
  needAttention: number;
  /** Clients whose attention row is "review now", the stronger of the two tones. */
  reviewNow: number;
  openQueries: number;
  followUps: number;
  /**
   * True while the client query has not returned. An empty array during that
   * wait is not an empty book.
   */
  loading?: boolean;
};

/** Book-level lines for practice Home. Same shape as the owner cards. */
export function practiceHomeLines(book: PracticeBook): OwnerHomeLines {
  const clients =
    book.loading && book.clientCount === 0
      ? "Loading the book."
      : book.clientCount === 1
        ? "1 client on the book."
        : `${book.clientCount} clients on the book.`;
  const queries =
    book.openQueries === 0
      ? "No open queries."
      : book.openQueries === 1
        ? "1 open query."
        : `${book.openQueries} open queries.`;
  const health =
    book.avgHealth == null ? "No scored clients yet." : `Average health is ${book.avgHealth} out of 100.`;
  const attention =
    book.needAttention === 0
      ? "No client needs attention."
      : book.needAttention === 1
        ? "1 client needs attention."
        : `${book.needAttention} clients need attention.`;
  const follow =
    book.followUps === 0
      ? "No follow-up waiting."
      : book.followUps === 1
        ? "1 client to follow up."
        : `${book.followUps} clients to follow up.`;
  return {
    financial_manager: [clients, queries],
    analyst: [health, attention],
    advisor: [follow],
  };
}

/** A chip only when the book has a problem. Review-now is Critical. */
export function practiceCardStatuses(book: PracticeBook): Record<AgentKey, OwnerCardStatus | null> {
  return {
    financial_manager: book.openQueries > 0 ? { tone: "attention", word: "Attention" } : null,
    analyst:
      book.reviewNow > 0
        ? { tone: "critical", word: "Critical" }
        : book.needAttention > 0
          ? { tone: "attention", word: "Attention" }
          : null,
    advisor: book.followUps > 0 ? { tone: "attention", word: "Attention" } : null,
  };
}

/** Button copy. Agent names come from the caller, never from a hardcoded title. */
export function ownerTileLabel(tile: OwnerTile, shortName: (agent: AgentKey) => string): string {
  if (tile.step === "Ask" && tile.ask) return `Ask ${shortName(tile.ask)}`;
  return tile.step;
}

export function parseOwnerNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}
