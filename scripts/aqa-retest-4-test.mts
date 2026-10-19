/**
 * AQA retest #4. The floor is four weeks of the live Chill series.
 * The Home card and the brief read that series, not a passed floor.
 * Run: pnpm test:aqa-retest-4
 */
import { interestOfRevenue, interestOfRevenueSentence } from "../src/lib/cash-interest-note.ts";
import {
  forecastMinimumCash,
  rollForwardForecast,
  storedSeriesReading,
} from "../src/lib/client-metrics.ts";
import { buildFinancialManagerBrief } from "../src/lib/financial-manager-brief.ts";
import { formatMoney } from "../src/lib/market/format.ts";
import { ZA_MARKET } from "../src/lib/market/resolve.ts";
import {
  ownerAnswerTiles,
  ownerHomeLines,
  practiceHomeLines,
  type OwnerBooks,
} from "../src/lib/owner-answers.ts";
import { isDisplayOnceOff } from "../src/lib/cash-forecast-rows.ts";
import {
  chillCashflow,
  chillFinancials,
  chillHarnessPartial,
} from "./rail-studio-harness/chill-pepper-lines.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const money = (amount: number) => formatMoney(amount, ZA_MARKET);
const live = storedSeriesReading(chillCashflow);
assert(live != null, "the live series rolls forward");
const outflows = live!.outflow;
const sum = outflows.reduce((total, week) => total + week, 0);
const floor = forecastMinimumCash({ weeklyOutflows: outflows });
assert(floor === Math.round((sum / outflows.length) * 4), `floor ${floor} is not average weekly outflow × 4`);
assert(live!.floor === floor, `stored series floor ${live!.floor} left the cash-screen floor`);
assert(outflows.length === 13, `horizon ${outflows.length}`);
const lowestAt = live!.closing.reduce(
  (best, balance, index) => (balance < best.balance ? { balance, index } : best),
  { balance: live!.closing[0] ?? 0, index: 0 },
);
assert(lowestAt.index === 12, `low is week ${lowestAt.index + 1}, not week 13`);
assert(isDisplayOnceOff("Fuji SA", "once-off", { side: "expenses", singleMonth: true }), "Fuji stays a purchase");
assert(
  !outflows.slice(1).some((week) => Math.abs(week - (outflows[0]! - 9200)) < 0.5 && week > outflows[4]! + 1),
  "Fuji is not added again after week 1",
);

const partial = rollForwardForecast(chillHarnessPartial);
assert(partial != null, "the old harness lines roll forward");
const partialFloor = forecastMinimumCash({ weeklyOutflows: partial!.outflow });
assert(partialFloor !== floor, "the partial harness is a different floor");

const staleFloor = 34_903;
const staleOpening = 201_159;
const books: OwnerBooks = {
  hasBooks: true,
  ledger: "Xero",
  revenue: chillFinancials.revenue,
  priorRevenue: null,
  cogs: chillFinancials.cogs,
  priorCogs: null,
  receivables: null,
  cashflow: chillCashflow,
  cashOutlook: {
    opening: staleOpening,
    closing: [staleOpening],
    floor: staleFloor,
    dipsBelowFloorWeek: null,
  },
  openAction: null,
  actionsReady: true,
  signedBy: null,
  signedOn: null,
  market: ZA_MARKET,
};
const card = ownerHomeLines(ownerAnswerTiles(books), null).financial_manager[0] ?? "";
assert(!card.includes("34 903") && !card.includes("34903") && !card.includes("201"), card);
assert(card.includes("93") && card.includes("334"), card);
assert(card.includes("below"), card);

const brief = buildFinancialManagerBrief({
  clientName: "Chill Pepper Boutique Hotel",
  currentFinancials: chillFinancials,
  snapshots: [],
  cashflow: chillCashflow,
  cashOpening: staleOpening,
  cashFloor: staleFloor,
  cashClosing: [staleOpening],
  market: ZA_MARKET,
  formatMoney: money,
});
const plain = (line: string) => line.replace(/\u00a0/g, " ");
assert(plain(brief.cashFloorLine ?? "") === plain(card), `brief ${brief.cashFloorLine} / card ${card}`);
assert(brief.healthCue?.includes("93"), brief.healthCue ?? "no health cue");

const interest = interestOfRevenue(chillFinancials);
assert(interest != null, "interest is a P&L fact");
assert(interest!.interest === 19_800, `interest ${interest!.interest}`);
assert(interest!.percent.toFixed(1) === "1.6", interest!.percent.toFixed(1));
const interestSentence = interestOfRevenueSentence(chillFinancials, money);
assert(interestSentence === `Interest on the P&L is 1.6% of revenue (${money(19_800)}).`, interestSentence ?? "");
assert(interestOfRevenue({ revenue: 100, ebit: 10 }) == null, "a missing interest fact stays hidden");

const waiting = practiceHomeLines({
  clientCount: 4,
  avgHealth: 60,
  needAttention: 1,
  reviewNow: 0,
  openQueries: 0,
  followUps: 0,
  countsReady: false,
});
assert(waiting.financial_manager[1] === "Checking open queries.", waiting.financial_manager.join(" | "));
const quiet = practiceHomeLines({
  clientCount: 4,
  avgHealth: 60,
  needAttention: 0,
  reviewNow: 0,
  openQueries: 0,
  followUps: 0,
});
assert(quiet.financial_manager[1] === "No open queries.", quiet.financial_manager[1] ?? "");
const one = practiceHomeLines({
  clientCount: 4,
  avgHealth: 60,
  needAttention: 1,
  reviewNow: 0,
  openQueries: 1,
  followUps: 0,
  countsReady: true,
});
assert(one.financial_manager[1] === "1 open query.", one.financial_manager[1] ?? "");

console.log(
  JSON.stringify({
    weeklyOutflows: outflows,
    sum,
    average: sum / outflows.length,
    floor,
    lowestWeek: lowestAt.index + 1,
    lowest: lowestAt.balance,
    opening: live!.opening,
    partialFloor,
    card,
    interest: interestSentence,
  }),
);
console.log("aqa retest 4 ok");
