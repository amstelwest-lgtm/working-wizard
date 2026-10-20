/**
 * A P&L with no balance sheet does not invent cash of $0 or a minimum.
 * Run: pnpm test:pl-only-cash
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OwnerHome } from "../src/components/owner-door/owner-home.tsx";
import { emptyAgentActivity } from "../src/lib/milon-team-activity.ts";
import { ownerPresence } from "../src/lib/owner-presence.ts";
import { buildFinancialManagerBrief } from "../src/lib/financial-manager-brief.ts";
import {
  cashPillarFollowsForecast,
  scorecardHealthFromFinancials,
} from "../src/lib/health-score.ts";
import { assessClientMetrics } from "../src/lib/client-metrics.ts";
import { clientListStatusWord } from "../src/lib/cash-forecast-parity.ts";
import {
  CASH_NOT_ON_FILE,
  ownerAnswerTiles,
  ownerCardStatuses,
  ownerHomeLines,
  type OwnerBooks,
} from "../src/lib/owner-answers.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const us = {
  currency: "USD" as const,
  locale: "en-US",
  country: "US" as const,
  copyPack: "us" as const,
};

const plOnly = {
  revenue: "412000",
  cogs: "120000",
  ebit: "180000",
  netIncome: "150000",
  periodMonths: "12",
};

const assessed = assessClientMetrics({ financials: plOnly, cashflow: null });
assert(assessed.cash.amount == null, "P&L revenue is not a cash balance");
assert(assessed.outlook.cashOnFile === false, "the forecast marks cash as missing");
assert(assessed.outlook.floor === 0, `the minimum was derived from missing cash (${assessed.outlook.floor})`);
assert(assessed.outlook.dipsBelowFloorWeek == null, "a missing balance does not dip under a floor");
assert(assessed.outlook.totalOutflow === 0, "the P&L was not turned into a cash series");

const books = {
  hasBooks: true,
  ledger: null,
  revenue: 412000,
  priorRevenue: null,
  cogs: 120000,
  receivables: null,
  cashflow: null,
  hasEvidence: true,
  cashOnFile: false,
  openingMissing: false,
  cashOutlook: null,
  cashPillarStatus: null,
  openAction: null,
  actionsReady: true,
  signedBy: null,
  signedOn: null,
  market: us,
} satisfies OwnerBooks;

const cashSentence = ownerAnswerTiles(books).find((tile) => tile.id === "cash")?.sentence ?? "";
assert(cashSentence === CASH_NOT_ON_FILE, cashSentence);
assert(cashSentence === "Cash not on file yet, upload a balance sheet.", cashSentence);
assert(!/\$0|Critical|below your minimum/i.test(cashSentence), cashSentence);

const status = ownerCardStatuses(books);
assert(status.financial_manager == null, status.financial_manager?.word ?? "chip should be absent");
const lines = ownerHomeLines(ownerAnswerTiles(books), null);
assert(lines.financial_manager[0] === CASH_NOT_ON_FILE, lines.financial_manager.join(" | "));
assert(!lines.financial_manager.some((line) => /\$0|Critical|below your/i.test(line)), lines.financial_manager.join(" | "));

const health = cashPillarFollowsForecast(
  scorecardHealthFromFinancials({
    financials: plOnly,
    cashBalance: null,
    cashRunwayWeeks: null,
    market: us,
  }),
  {
    hasEvidence: true,
    cashOnFile: false,
    opening: assessed.outlook.opening,
    closings: assessed.outlook.closing,
    floor: assessed.outlook.floor,
  },
);
const cashPillar = health.pillars.find((pillar) => pillar.id === "cash");
assert(cashPillar?.score == null, `cash pillar was scored (${cashPillar?.score})`);
assert(!health.pillars.some((pillar) => pillar.id === "cash" && pillar.score != null), "cash with no data is not in the score");
const statusWord = clientListStatusWord({
  healthLabel: health.displayLabel,
  healthOverall: health.overall,
  source: assessed.outlook.source,
  opening: assessed.outlook.opening,
  floor: assessed.outlook.floor,
  dipsBelowFloorWeek: assessed.outlook.dipsBelowFloorWeek,
  totalInflow: assessed.outlook.totalInflow,
  totalOutflow: assessed.outlook.totalOutflow,
  cashOnFile: false,
});
assert(!statusWord.startsWith("Critical"), statusWord);

const brief = buildFinancialManagerBrief({
  clientName: "AQA Gate Throwaway 1020B",
  currentFinancials: plOnly,
  snapshots: [],
  cashOpening: 0,
  cashFloor: 36923,
  cashClosing: assessed.outlook.closing,
  cashDipWeek: 1,
  market: us,
  openingMissing: false,
  cashOnFile: false,
  actionsReady: true,
  draftsReady: true,
  formatMoney: (amount) => `$${amount}`,
});
assert(brief.cashFloorLine === CASH_NOT_ON_FILE, brief.cashFloorLine ?? "missing cash line");
assert(brief.cashFloorChip == null, brief.cashFloorChip ?? "chip");
assert(brief.healthCue == null, brief.healthCue ?? "strip");
assert(!brief.actions.some((row) => row.id === "cash-floor"), "no below-minimum action");

const html = renderToStaticMarkup(
  createElement(OwnerHome, {
    variant: "character",
    audience: "accountant",
    showInvite: false,
    title: "Your whole finance team",
    marketCountry: "US",
    sampleClient: false,
    cardPhase: "ready",
    presence: ownerPresence(emptyAgentActivity()),
    lines,
    status,
    needs: {
      actionsHeading: "Actions",
      actionLines: ["Nothing is waiting."],
      draftsHeading: "Drafts",
      draftLines: ["No draft waiting."],
      deliverablesHeading: "Reports",
      deliverableLines: [],
      syncHeading: "Books",
      syncLines: ["Books are on file."],
    },
    onOpen: () => undefined,
    onAsk: () => undefined,
    onMoves: () => undefined,
    onDeliverables: () => undefined,
  }),
);
assert(html.includes("Cash not on file yet, upload a balance sheet"), "home renders the missing-cash line");
assert(!html.includes("Critical"), "home does not render Critical");
assert(!/below your minimum/i.test(html), "home does not render the minimum strip");
assert(!html.includes("$0"), "home does not render $0");

const realZero = assessClientMetrics({
  financials: {
    revenue: "412000",
    cogs: "120000",
    cash: "0",
    totalAssets: "100000",
    equity: "80000",
    receivables: "20000",
    periodMonths: "12",
  },
});
assert(realZero.cash.amount === 0, `a balance-sheet zero was dropped (${realZero.cash.amount})`);
assert(realZero.outlook.cashOnFile !== false, "a written zero stays on file");
assert(realZero.outlook.floor > 0, "a real zero can still sit under a minimum");

console.log("pl-only-cash-test: all assertions passed");
