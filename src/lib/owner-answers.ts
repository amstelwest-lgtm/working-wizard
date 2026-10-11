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
  cashflow: SavedCashflowLike | null;
  openAction: string | null;
  /** False until the action-point read has finished. */
  actionsReady: boolean;
  signedBy: string | null;
  signedOn: string | null;
  market: MoneyMarket;
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

/** Home cash copy. The tile sentence stays long for the hold screen. */
function cashHomeLine(sentence: string): string {
  if (sentence === CONNECT || sentence === "The 13-week line is not on file yet.") return sentence;
  const amounts = amountsIn(sentence);
  if (sentence.includes("stays above") && amounts.length >= 2) {
    const [floor, low] = amounts;
    return `Above the ${floor} floor. Low ${low}.`;
  }
  if (sentence.includes("under the") && amounts.length >= 3) {
    const [low, under, floor] = amounts;
    return `Low ${low}. ${under} under ${floor}.`;
  }
  return sentence;
}

/** Home profit copy. The tile sentence stays long for the hold screen. */
function profitHomeLine(sentence: string): string {
  if (sentence === CONNECT || sentence === "Profit is not on file yet.") return sentence;
  const [amount] = amountsIn(sentence);
  if (!amount) return sentence;
  if (sentence.includes("more than the prior")) return `Profit ${amount}, up on last period.`;
  if (sentence.includes("less than the prior")) return `Profit ${amount}, down on last period.`;
  if (sentence.includes("the same as the prior")) return `Profit ${amount}, same as last period.`;
  return `Profit ${amount}.`;
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
    financial_manager: [cashHomeLine(cash), sentence("answer")].filter((line) => line.length > 0),
    analyst: [profitHomeLine(sentence("profit")), sentence("owes")].filter((line) => line.length > 0),
    advisor: [move || (cash === CONNECT ? CONNECT : "No next move yet.")],
  };
}

function cashTile(books: OwnerBooks, money: (n: number) => string, booksSource: string): OwnerTile {
  const base = {
    id: "cash" as const,
    heading: "Cash over the next 13 weeks",
    ask: "financial_manager" as const,
  };
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
