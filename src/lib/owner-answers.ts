/**
 * Owner home tiles. Every figure is passed in. A missing book, forecast,
 * action, or sign-off becomes an empty sentence. Nothing here is a sample.
 */
import {
  cashComfortThreshold,
  closingBalancesFromCashflow,
  type SavedCashflowLike,
} from "@/lib/cash-runway";
import { formatMoney, formatMoneyCompact, type MoneyMarket } from "@/lib/market/format";
import type { AgentKey } from "@/lib/milon-team-feed";
import { OPENING_BALANCE_MISSING, forecastLowestPoint } from "@/lib/cash-forecast-parity";
import { periodProfitBridge, statedNetIsUsable } from "@/lib/period-profit";
import { actionDisplayTitle } from "@/lib/strategic-moves";

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
  /** Stated gross profit on the statement. The waterfall uses this when it is in range. */
  grossProfit?: number | null;
  priorGrossProfit?: number | null;
  /** Stated net profit. Shown only when it does not exceed operating profit. */
  netIncome?: number | null;
  /** Operating profit from the same bridge as the waterfall. */
  operatingProfit?: number | null;
  /** Blank or zero opening with no source. Not cash under the floor. */
  openingMissing?: boolean;
  receivables: number | null;
  /** Aged overdue balance. Null when the collections snapshot is not loaded. */
  overdueReceivables?: number | null;
  cashflow: SavedCashflowLike | null;
  /**
   * The same 13-week outlook Health and Cash use. When it is set, the Home
   * cash line and the Critical chip use this opening and floor.
   */
  cashOutlook?: {
    opening: number;
    closing: number[];
    floor: number;
    dipsBelowFloorWeek: number | null;
  } | null;
  /**
   * Cash pillar band from the same health score as the ring.
   * The card chip follows Watch and Critical. Omit it and the floor chip stays.
   */
  cashPillarStatus?: "healthy" | "at_risk" | "critical" | null;
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

function finite(n: number | null | undefined): n is number {
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
          sentence: actionDisplayTitle(books.openAction),
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
  if (sentence.startsWith("Cash is ")) return guardOwnerLine(sentence);
  const amounts = amountsIn(sentence);
  if (sentence.includes("stays above") && amounts.length >= 2) {
    const [floor, low] = amounts;
    return `Cash stays above your ${floor} minimum. The low point is ${low}.`;
  }
  if (sentence.includes("under the") && amounts.length >= 3) {
    const [balance, under, floor] = amounts;
    return `Cash ${balance}, ${under} below your ${floor} minimum.`;
  }
  return guardOwnerLine(sentence);
}

/** Home profit copy. Labels stay Gross profit and Net profit, the same words as the waterfall. */
function profitHomeLine(sentence: string): string {
  if (sentence === CONNECT || sentence === "Profit is not on file yet.") return sentence;
  const amounts = amountsIn(sentence);
  const [gross, net] = amounts;
  if (!gross) return guardOwnerLine(sentence);
  const netBit = sentence.includes("Net profit") && net ? ` Net profit is ${net}.` : "";
  let head = `Gross profit is ${gross}.`;
  if (sentence.includes("more than the prior")) head = `Gross profit is ${gross}, up on last period.`;
  else if (sentence.includes("less than the prior")) head = `Gross profit is ${gross}, down on last period.`;
  else if (sentence.includes("the same as the prior")) head = `Gross profit is ${gross}, the same as last period.`;
  return `${head}${netBit}`;
}

/** Gross profit the waterfall prints: stated gross profit when it is in range, otherwise revenue minus the cost. */
function waterfallGross(
  revenue: number,
  cogs: number,
  stated: number | null | undefined,
): number {
  const fields: Record<string, unknown> = { revenue, cogs };
  if (stated != null && Number.isFinite(stated)) fields.grossProfit = stated;
  return periodProfitBridge(fields).grossProfit;
}

export type OwnerStatusTone = "attention" | "critical";

export type OwnerCardStatus = {
  tone: OwnerStatusTone;
  word: string;
};

/**
 * Floor alert on an agent card. The health pillar keeps its own band
 * (Watch, Healthy), so this chip does not say Critical.
 */
export const CASH_FLOOR_ALERT = "Below your minimum";

/**
 * The Financial Manager chip follows the cash pillar.
 * Watch and Critical use the pillar word. Healthy stays quiet.
 * When the pillar is omitted, a floor alert keeps its own chip.
 */
export function ownerCashStatusChip(
  pillar: "healthy" | "at_risk" | "critical" | null | undefined,
  floorChip: string | null,
): OwnerCardStatus | null {
  if (pillar === "at_risk") return { tone: "attention", word: "Watch" };
  if (pillar === "critical") return { tone: "critical", word: "Critical" };
  if (pillar === "healthy") return null;
  if (floorChip) return { tone: "attention", word: floorChip };
  return null;
}

/**
 * A chip only when the card's figures are a problem.
 * Cash uses the pillar band, including Watch. An omitted pillar keeps the floor alert.
 * A profit decline, or overdue debtors above zero, is Attention.
 */
export function ownerCardStatuses(books: OwnerBooks): Record<AgentKey, OwnerCardStatus | null> {
  const floor = cashFloorForHome({
    openingMissing: books.openingMissing,
    cashOutlook: books.cashOutlook,
    cashflow: books.cashflow,
    market: books.market,
    money: (amount) => ownerAmount(amount, books.market),
  });
  const cash = ownerCashStatusChip(books.cashPillarStatus, floor?.chip ?? null);

  const gross =
    finite(books.revenue) && finite(books.cogs)
      ? waterfallGross(books.revenue, books.cogs, books.grossProfit)
      : null;
  const prior =
    finite(books.priorRevenue) && finite(books.priorCogs)
      ? waterfallGross(books.priorRevenue, books.priorCogs, books.priorGrossProfit)
      : null;
  const profitDown = gross != null && prior != null && gross < prior;
  const overdue = finite(books.overdueReceivables ?? null) && (books.overdueReceivables ?? 0) > 0;
  const analyst: OwnerCardStatus | null =
    profitDown || overdue ? { tone: "attention", word: "Attention" } : null;

  return { financial_manager: cash, analyst, advisor: null };
}

const HOME_ANSWER_ON_MANAGER = new Set([
  "Nothing is waiting on you.",
  "Checking action points.",
  "Open actions aren't available yet.",
]);

/** One or two short lines under each bot. Sign-off stays off this page. */
export function ownerHomeLines(
  tiles: readonly OwnerTile[],
  topMove: string | null,
  assignedAgent: AgentKey | null = null,
  handedTitle: string | null = null,
): OwnerHomeLines {
  const sentence = (id: OwnerTileId) => tiles.find((tile) => tile.id === id)?.sentence ?? "";
  const cash = sentence("cash");
  const move = actionDisplayTitle(topMove?.replace(/\s+/g, " "));
  const answer = guardOwnerLine(sentence("answer"));
  const handed = guardOwnerLine(handedTitle ?? "");
  const routed =
    assignedAgent &&
    assignedAgent !== "financial_manager" &&
    (handed.length > 0 || (answer.length > 0 && !HOME_ANSWER_ON_MANAGER.has(answer)))
      ? assignedAgent
      : null;
  const financialManager = [cashHomeLine(cash)].filter((line) => line.length > 0);
  const analyst = [profitHomeLine(sentence("profit")), guardOwnerLine(sentence("owes"))].filter(
    (line) => line.length > 0,
  );
  const advisor = [guardOwnerLine(move || (cash === CONNECT ? CONNECT : "No next move yet."))].filter(
    (line) => line.length > 0,
  );
  if (handed && routed === "analyst" && !analyst.includes(handed)) analyst.push(handed);
  else if (handed && routed === "advisor" && !advisor.includes(handed)) advisor.push(handed);
  if (answer && answer !== handed) {
    if (!handed && routed === "analyst") analyst.push(answer);
    else if (!handed && routed === "advisor") {
      if (!advisor.includes(answer)) advisor.push(answer);
    } else financialManager.push(answer);
  }
  return {
    financial_manager: financialManager,
    analyst,
    advisor,
  };
}

/** $50.0k and R 50.0k read as $50k and R 50k on the short health line. */
export function shortFloorAmount(amount: number, market: MoneyMarket): string {
  return formatMoneyCompact(amount, market).replace(/\.0(?=[km])/i, "");
}

export type CashFloorCopy = {
  sentence: string;
  /** The agent-card chip. Null when cash is not under the minimum and the forecast does not dip. */
  chip: string | null;
  /**
   * One line under the Health cash pillar whenever the card chip is set.
   * The pillar score and band stay on their own inputs.
   */
  healthCue: string | null;
};

/**
 * One cash-floor reading for the owner home, the accountant brief, and Health.
 * Below the minimum names the balance and the gap. A dip while cash is still
 * above the minimum says the forecast crosses it. The health score is untouched.
 */
export function cashFloorCopy(input: {
  opening: number;
  floor: number;
  dipsBelowFloorWeek?: number | null;
  /** Week closings. A dip quotes the low point, the same way the owner card does. */
  closing?: readonly number[] | null;
  money: (amount: number) => string;
  market?: MoneyMarket;
}): CashFloorCopy {
  const { opening, floor, money } = input;
  const low = input.closing?.length
    ? forecastLowestPoint(opening, input.closing).amount
    : null;
  const lowUnder = low != null && Number.isFinite(low) && low < floor;
  const dip = (input.dipsBelowFloorWeek != null && input.dipsBelowFloorWeek > 0) || lowUnder;
  const belowNow = opening < floor;
  const quoted = belowNow ? opening : lowUnder ? low! : opening;
  const gap = Math.abs(floor - quoted);
  const under = belowNow || lowUnder;
  const sentence = under
    ? `Cash ${money(quoted)}, ${money(gap)} below your ${money(floor)} minimum.`
    : `Cash is ${money(opening)}, above the ${money(floor)} floor.`;
  const alert = under || dip;
  return {
    sentence,
    chip: alert ? CASH_FLOOR_ALERT : null,
    healthCue:
      alert && input.market
        ? `Below your ${shortFloorAmount(floor, input.market)} minimum · see FM`
        : null,
  };
}

/**
 * The cash reading the owner Financial Manager card shows.
 * Health uses this same result, so the pillar line appears whenever the card
 * says below the minimum.
 */
export function cashFloorForHome(input: {
  openingMissing?: boolean;
  cashOutlook?: {
    opening: number;
    closing: readonly number[];
    floor: number;
    dipsBelowFloorWeek: number | null;
  } | null;
  cashflow?: SavedCashflowLike | null;
  market: MoneyMarket;
  money: (amount: number) => string;
}): CashFloorCopy | null {
  if (input.openingMissing) return null;
  const outlook = input.cashOutlook;
  if (outlook && finite(outlook.opening) && finite(outlook.floor)) {
    return cashFloorCopy({
      opening: outlook.opening,
      floor: outlook.floor,
      dipsBelowFloorWeek: outlook.dipsBelowFloorWeek,
      closing: outlook.closing,
      money: input.money,
      market: input.market,
    });
  }
  const balances = closingBalancesFromCashflow(input.cashflow ?? null);
  if (!balances || balances.length === 0) return null;
  let low = balances[0];
  for (const value of balances) if (value < low) low = value;
  const floor = cashComfortThreshold(input.market.currency);
  return cashFloorCopy({
    opening: low,
    floor,
    dipsBelowFloorWeek: low < floor ? 1 : null,
    money: input.money,
    market: input.market,
  });
}

/** Same cash-floor sentence on the owner home and the accountant client brief. */
export function cashFloorSentence(input: {
  opening: number;
  floor: number;
  dipsBelowFloorWeek?: number | null;
  money: (amount: number) => string;
}): string {
  return cashFloorCopy(input).sentence;
}

function cashTile(books: OwnerBooks, money: (n: number) => string, booksSource: string): OwnerTile {
  const base = {
    id: "cash" as const,
    heading: "Cash over the next 13 weeks",
    ask: "financial_manager" as const,
  };
  if (books.openingMissing) {
    return {
      ...base,
      sentence: `${OPENING_BALANCE_MISSING}.`,
      source: books.hasBooks ? "13-week forecast" : "No books connected",
      step: "Ask",
      signed: false,
      empty: false,
    };
  }
  const outlook = books.cashOutlook;
  const pillarAgrees =
    books.cashPillarStatus === "healthy" || books.cashPillarStatus === "at_risk";
  if (pillarAgrees && outlook && finite(outlook.opening)) {
    return {
      ...base,
      sentence: `Cash is ${money(outlook.opening)}.`,
      source: `${booksSource}, 13-week forecast`,
      step: "Ask",
      signed: false,
      empty: false,
    };
  }
  const shared = cashFloorForHome({
    openingMissing: books.openingMissing,
    cashOutlook: books.cashOutlook,
    cashflow: books.cashflow,
    market: books.market,
    money,
  });
  if (shared && outlook && finite(outlook.opening) && finite(outlook.floor)) {
    return {
      ...base,
      sentence: shared.sentence,
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
  const gross = waterfallGross(books.revenue, books.cogs, books.grossProfit);
  const operating = finite(books.operatingProfit) ? books.operatingProfit : null;
  const netIncome = finite(books.netIncome) ? books.netIncome : null;
  const netOk = netIncome != null && (operating == null || statedNetIsUsable(operating, netIncome));
  const profitBit = netOk && netIncome != null
    ? ` Net profit is ${money(netIncome)}.`
    : operating != null
      ? ` Operating profit is ${money(operating)}.`
      : "";
  let sentence = `Gross profit is ${money(gross)}.${profitBit}`;
  if (finite(books.priorRevenue) && finite(books.priorCogs)) {
    const prior = waterfallGross(books.priorRevenue, books.priorCogs, books.priorGrossProfit);
    const compared =
      gross < prior
        ? `Gross profit is ${money(gross)}, less than the prior period.`
        : gross > prior
          ? `Gross profit is ${money(gross)}, more than the prior period.`
          : `Gross profit is ${money(gross)}, the same as the prior period.`;
    sentence = `${compared}${profitBit}`;
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
