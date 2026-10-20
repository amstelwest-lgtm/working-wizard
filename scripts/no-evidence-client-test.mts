/**
 * A client with no books and no parsed statement does not invent numbers.
 * Run: pnpm test:no-evidence
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OwnerHome } from "../src/components/owner-door/owner-home.tsx";
import { buildFinancialManagerBrief } from "../src/lib/financial-manager-brief.ts";
import {
  NOT_SCORED_YET_LABEL,
  cashPillarFollowsForecast,
  computeOverallHealth,
  healthWithoutEvidence,
} from "../src/lib/health-score.ts";
import {
  assessClientMetrics,
  connectBooksHeadline,
  hasFinancialEvidence,
} from "../src/lib/client-metrics.ts";
import { emptyAgentActivity } from "../src/lib/milon-team-activity.ts";
import { ZA_MARKET } from "../src/lib/market/resolve.ts";
import { homeActionNeeds, ownerNeedsView } from "../src/lib/owner-needs.ts";
import {
  ownerAnswerTiles,
  ownerCardStatuses,
  ownerHomeLines,
  type OwnerBooks,
  type OwnerHomeLines,
} from "../src/lib/owner-answers.ts";
import { ownerPresence } from "../src/lib/owner-presence.ts";
import { rankStrategicMoves } from "../src/lib/strategic-moves.ts";
import { buildOverviewBrief } from "../supabase/functions/ask-ai/overview-brief.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const us = { currency: "USD" as const, locale: "en-US", country: "US" as const, copyPack: "us" as const };
const emptyFinancials = { cash: "0" };

assert(hasFinancialEvidence({ financials: null, cashflow: null }) === false, "a blank file has no evidence");
assert(hasFinancialEvidence({ financials: emptyFinancials }) === false, "a lone cash 0 is not evidence");
assert(hasFinancialEvidence({ financials: { cash: 0 } }) === false, "numeric cash 0 is not evidence");
assert(
  hasFinancialEvidence({ financials: { revenue: 120000, cash: 0 } }) === true,
  "a statement with revenue is evidence",
);
assert(
  hasFinancialEvidence({
    cashflow: { revenue: [{ amount: "1500", frequency: "once", startWeek: 1 }] },
  }) === true,
  "a parsed forecast line is evidence",
);
assert(
  connectBooksHeadline(us) === "Connect QuickBooks / Xero or upload statements.",
  "US connect copy leaves Sage off",
);
assert(
  connectBooksHeadline(ZA_MARKET) === "Connect QuickBooks / Xero / Sage or upload statements.",
  "ZA connect copy names Sage",
);

const metrics = assessClientMetrics({ financials: emptyFinancials, cashflow: null });
assert(metrics.cash.amount == null, "the $0 default is not cash on file");

const bare = computeOverallHealth({ ratios: {} });
assert(bare.overall == null, "no ratios is a null score");
assert(bare.pillars.every((pillar) => pillar.score == null), "no ratios leaves every pillar null");

const floored = cashPillarFollowsForecast(bare, {
  opening: metrics.outlook.opening,
  closings: metrics.outlook.closing,
  floor: metrics.outlook.floor,
});
assert(floored.overall == null, "the fallback floor does not mint an overall score");
assert(
  floored.pillars.every((pillar) => pillar.score == null),
  "the fallback floor does not mint Cash 25",
);
assert(floored.hasCriticalPillar === false, "an empty file is not Critical");

const hidden = healthWithoutEvidence(floored);
assert(hidden.overall == null && hidden.displayLabel === NOT_SCORED_YET_LABEL, "the ring says Not scored yet");
assert(hidden.pillars.every((pillar) => pillar.score == null && pillar.note === NOT_SCORED_YET_LABEL), "pillars say Not scored yet");
assert(hidden.hasCriticalPillar === false, "Not scored yet is not a Critical flag");

const books = {
  hasBooks: false,
  ledger: null,
  revenue: null,
  priorRevenue: null,
  cogs: null,
  receivables: null,
  cashflow: null,
  hasEvidence: false,
  cashOutlook: {
    opening: 0,
    closing: metrics.outlook.closing,
    floor: 50000,
    dipsBelowFloorWeek: 1,
  },
  openAction: null,
  actionsReady: true,
  signedBy: null,
  signedOn: null,
  market: us,
} satisfies OwnerBooks;

const tiles = ownerAnswerTiles(books);
const cashSentence = tiles.find((tile) => tile.id === "cash")?.sentence ?? "";
assert(cashSentence === connectBooksHeadline(us), cashSentence);
assert(!/\$\d/.test(cashSentence), "the cash card does not quote a figure");
assert(!/50,000|minimum/.test(cashSentence), "the cash card does not quote a minimum gap");

const lines = ownerHomeLines(tiles, "Refinance high-interest loans at lower rates");
assert(lines.financial_manager.length === 1, "home has one headline");
assert(lines.financial_manager[0] === connectBooksHeadline(us), lines.financial_manager.join(" | "));
assert(!lines.financial_manager.some((line) => line.includes("Nothing is waiting")), "nothing-waiting is not the headline");
assert(lines.analyst.length === 0, "the analyst card does not repeat connect");
assert(lines.advisor.length === 0, "a generic move is not the next action");

const needs = homeActionNeeds({
  known: true,
  titles: [],
  overdue: 0,
  nextAction: connectBooksHeadline(us),
});
assert(needs.lines.length === 1 && needs.lines[0] === connectBooksHeadline(us), needs.lines.join(" | "));
assert(!needs.lines.some((line) => /No open work/.test(line)), "an empty file does not say no open work");

const moves = rankStrategicMoves({ hasEvidence: false, market: us, healthByKey: {} });
assert(moves.length === 1 && moves[0]?.key === "connectBooks", `moves ${moves.map((move) => move.title).join(", ")}`);
assert(!/refinanc|Net-60|raise price/i.test(moves.map((move) => move.title).join(" ")), "the catalogue stays off an empty file");

const brief = buildFinancialManagerBrief({
  clientName: "New York Test company",
  currentFinancials: emptyFinancials,
  snapshots: [],
  cashDipWeek: 1,
  cashOpening: 0,
  cashFloor: 50000,
  cashClosing: metrics.outlook.closing,
  market: us,
  actionsReady: true,
  draftsReady: true,
  formatMoney: (amount) => `$${amount}`,
});
assert(!brief.actions.some((row) => row.id === "cash-floor"), "no forecast banner without lines");
assert(brief.cashFloorLine == null, brief.cashFloorLine ?? "cash floor line should be empty");

const agent = buildOverviewBrief({
  financials: emptyFinancials,
  cash: 0,
  runwayWeeks: 0,
  copyPack: "us",
  shortfallWeek: 1,
});
assert(agent.health == null, "the agent does not score an empty file");
assert(agent.cash == null, "the agent does not quote cash 0");
assert(agent.pillars.every((pillar) => pillar.score == null), "the agent leaves pillars unscored");

// Prod (no-books US client) showed these. The predicate has to keep them off both homes.
const KILLED = [
  "Critical / Cash $0, $50,000 below your $50,000 minimum.",
  "Cash $0, $50,000 below your $50,000 minimum.",
  "Get customers to pay faster (deposits, autopay)",
  "Cash goes under the floor in week 1",
  "Connect QuickBooks or Xero. / Connect QuickBooks or Xero.",
];

const connect = connectBooksHeadline(us);
const status = ownerCardStatuses(books);
const topMove = moves[0]?.title ?? "Get customers to pay faster (deposits, autopay)";
const homeLines = ownerHomeLines(tiles, topMove);

function reported(agent: keyof OwnerHomeLines): string {
  const chip = status[agent]?.word ?? "";
  const body = homeLines[agent].join(" / ");
  if (chip && body) return `${chip} / ${body}`;
  return chip || body;
}

const ownerNeeds = ownerNeedsView({
  ownerEmail: null,
  actionsReady: true,
  actionsUnavailable: false,
  actions: [],
  draftsReady: true,
  draftsUnavailable: false,
  draftTitles: [],
  deliverablesReady: true,
  deliverablesUnavailable: false,
  deliverableCount: 0,
  advisoryTitles: [],
  quickBooks: { state: "absent" },
  xero: { state: "absent" },
  when: (iso) => iso,
  nextAction: connect,
  statementSpan: null,
});
const accountantNeeds = {
  actionsHeading: needs.heading,
  actionLines: needs.lines,
  draftsHeading: "Drafts",
  draftLines: ["No drafts need your OK."],
  deliverablesHeading: "Reports",
  deliverableLines: ["Nothing ready to send."],
  syncHeading: "Books",
  syncLines: ["Books are not connected yet."],
};

function homeHtml(audience: "owner" | "accountant"): string {
  return renderToStaticMarkup(
    createElement(OwnerHome, {
      variant: "character",
      audience,
      showInvite: audience === "owner",
      title: audience === "owner" ? "Your finance team" : "Your whole finance team",
      marketCountry: "US",
      sampleClient: false,
      presence: ownerPresence(emptyAgentActivity()),
      lines: homeLines,
      status,
      needs: audience === "owner" ? ownerNeeds : accountantNeeds,
      onOpen: () => undefined,
      onAsk: () => undefined,
      onMoves: () => undefined,
      onDeliverables: () => undefined,
    }),
  );
}

function sliceBetween(html: string, start: string, end: string): string {
  const from = html.indexOf(start);
  assert(from >= 0, `missing ${start}`);
  const to = html.indexOf(end, from + start.length);
  return html.slice(from, to === -1 ? undefined : to);
}

const briefText = [
  brief.cashFloorLine ?? "",
  brief.healthCue ?? "",
  ...brief.actions.map((row) => `${row.title} ${row.reason}`),
].join("\n");

for (const audience of ["owner", "accountant"] as const) {
  const html = homeHtml(audience);
  const agents = sliceBetween(html, 'class="owner-agents"', 'class="owner-needs"');
  const fm = sliceBetween(agents, 'data-agent-card="financial_manager"', 'data-agent-card="analyst"');
  const analyst = sliceBetween(agents, 'data-agent-card="analyst"', 'data-agent-card="advisor"');
  const advisor = sliceBetween(agents, 'data-agent-card="advisor"', "owner-ask");
  const visible = [html, reported("financial_manager"), reported("analyst"), reported("advisor"), briefText].join(
    "\n",
  );
  for (const banned of KILLED) {
    assert(!visible.includes(banned), `${audience} still shows ${banned}`);
  }
  assert(fm.includes(connect), `${audience} financial manager is missing the connect action`);
  assert((fm.match(/Connect QuickBooks/g) ?? []).length === 1, `${audience} connect action renders more than once`);
  assert(!analyst.includes("Connect QuickBooks"), `${audience} analyst repeats connect`);
  assert(!advisor.includes("Connect QuickBooks"), `${audience} advisor repeats connect`);
  assert(!advisor.includes("Get customers to pay faster"), `${audience} advisor still ranks a catalogue move`);
}

assert(ownerNeeds.actionLines.length === 1 && ownerNeeds.actionLines[0] === connect, ownerNeeds.actionLines.join(" | "));
assert(needs.lines.length === 1 && needs.lines[0] === connect, needs.lines.join(" | "));
assert(reported("financial_manager") === connect, reported("financial_manager"));
assert(reported("analyst") === "", reported("analyst"));
assert(reported("advisor") === "", reported("advisor"));

console.log("no-evidence-client-test: ok");
