/**
 * AQA follow-up after #570. One check per finding. Figures come from the inputs.
 * Run: pnpm test:aqa-followup
 */
import { buildPrompt } from "../supabase/functions/ask-ai/prompt.ts";
import { summarizeCashForecast } from "../supabase/functions/ask-ai/deliverable-summaries.ts";
import { buildOverviewBrief, overviewFactLines } from "../supabase/functions/ask-ai/overview-brief.ts";
import { deriveActionHealth } from "../src/lib/action-item-health.ts";
import { planAutomation, type AutomationItem } from "../src/lib/action-plan-automation.ts";
import { clientListRunwayHeadline, forecastChatFacts } from "../src/lib/cash-forecast-parity.ts";
import { collapseDuplicateClientShells } from "../src/lib/client-display-name.ts";
import { plBankDisagreement } from "../src/lib/client-metrics.ts";
import { buildFinancialManagerBrief } from "../src/lib/financial-manager-brief.ts";
import { actionPreviewLine, homeActionNeeds, openActionSentence } from "../src/lib/owner-needs.ts";
import { mergePackDataGaps, packScoreProse, packSectionsForPdf } from "../src/lib/advisory-pack.ts";
import { preferLiveHealthProse } from "../src/lib/score-prose.ts";
import { statementGrossMarginFraction } from "../src/lib/period-profit.ts";
import { trendColumnVisible } from "../src/lib/portfolio-dashboard.ts";
import { buildVarianceChips } from "../src/lib/prior-period.ts";
import { formatQuotedDays } from "../src/lib/ratios.ts";
import { budgetSignoffIsStale } from "../src/lib/signoff-status.ts";
import { strategicMovePillar } from "../src/lib/move-pillars.ts";
import { rankStrategicMoves } from "../src/lib/strategic-moves.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const titles = ["Collect the deposit", "File the VAT return"];
const needs = homeActionNeeds({ known: true, titles, overdue: 1 });
assert(needs.heading === "2 open, 1 overdue", needs.heading);
assert(needs.lines.join(" | ") === titles.join(" | "), needs.lines.join(" | "));
const five = homeActionNeeds({
  known: true,
  titles: ["One", "Two", "Three", "Four", "Five"],
  overdue: 0,
});
assert(five.heading === "5 open", five.heading);
assert(five.lines.length === 3 && five.lines[0] === "One" && five.lines[2] === "Three", five.lines.join(" | "));
const fiveOverdue = homeActionNeeds({
  known: true,
  titles: ["One", "Two", "Three", "Four", "Five"],
  overdue: 2,
});
assert(fiveOverdue.heading === "5 open, 2 overdue", fiveOverdue.heading);
assert(!needs.lines.includes("No open work."), "open rows are not no open work");
assert(openActionSentence(titles) === "2 open actions.", openActionSentence(titles) ?? "");
assert(openActionSentence([]) === null, "no open rows stay empty");
const checking = homeActionNeeds({ known: false, titles: [], overdue: 0 });
assert(checking.lines[0] === "Checking the action plan.", checking.lines[0] ?? "");

const brief = buildFinancialManagerBrief({
  clientName: "Chill Pepper",
  currentFinancials: {},
  snapshots: [],
  openActionTitles: titles,
  actionsReady: true,
  draftsReady: true,
  formatMoney: (amount) => String(amount),
});
assert(
  brief.actions.filter((row) => row.id.startsWith("open-action")).map((row) => row.title).join(" | ") ===
    titles.join(" | "),
  "the brief lists the same open actions",
);

const now = new Date("2026-10-15T12:00:00.000Z");
assert(
  deriveActionHealth(
    { status: "not_started", due_date: "2026-09-29", progress_pct: 0, created_at: "2026-09-01T00:00:00.000Z" },
    now,
  ) === "overdue",
  "0% with a past due date is overdue",
);
assert(
  deriveActionHealth(
    { status: "not_started", due_date: null, progress_pct: 0, created_at: "2026-10-01T00:00:00.000Z" },
    now,
  ) === "not_started",
  "0% with an empty due date is not on track",
);

const suggested = planAutomation(
  [
    {
      id: "old",
      title: "Review the lease",
      ownerId: null,
      ownerName: null,
      dueDate: null,
      status: "not_started",
      createdAt: "2026-09-01T00:00:00.000Z",
    } satisfies AutomationItem,
  ],
  [],
  "2026-10-15",
);
assert(
  suggested.rows[0]?.dueDate === "2026-10-29" && suggested.rows[0]?.dueSuggested === true,
  "a past created+14 is replaced by today plus 14 days",
);
assert(suggested.rows[0]?.overdue === false, "the suggested date is not overdue");
assert(suggested.rows[0]?.owner?.name === "Financial Manager", "an unowned action suggests the Financial Manager");

const underFloor = Array.from({ length: 13 }, () => -35100);
const chatFacts = forecastChatFacts({ closings: underFloor, floor: 50000, plCashGenerative: true });
assert(chatFacts.cashGenerative === false, "a floor dip is not cash generative");
assert(chatFacts.weeksBelowFloor === 13, `weeks below ${chatFacts.weeksBelowFloor}`);
const cash = summarizeCashForecast(
  {
    openingBalance: "80000",
    revenue: [{ amount: "20000", frequency: "recurring-weekly", startWeek: 1 }],
    expenses: [{ amount: "50000", frequency: "recurring-weekly", startWeek: 1 }],
  },
  null,
  { cashGenerative: true },
);
assert(cash?.cashGenerative === false, "the answer path drops cash generative when closings dip");
assert((cash?.weeksBelowFloor ?? 0) > 0, "weeks below the floor are counted");
assert((cash?.negativeWeeks ?? 0) > 0, "negative closings are counted");
const prompt = buildPrompt("How is cash?", {
  profile: null,
  profileQuestions: [],
  scores: null,
  ratios: [],
  playbook: [],
  copyPack: "za",
  waterfall: null,
  cashForecast: {
    hasData: true,
    runwayWeeks: null,
    cashGenerative: false,
    horizonWeeks: 13,
    shortfall: true,
    lowestWeek: 1,
    negativeWeeks: 0,
    weeksBelowFloor: 6,
    trajectory: "down",
    closingVsOpening: "lower",
  },
  productLines: [],
  nextSteps: [],
  actionPlan: null,
  deliverables: [],
}, "full");
assert(prompt.user.includes("6 of 13 weeks below the floor"), prompt.user);
assert(!prompt.user.includes("Cash runway: cash generative"), "the dipped forecast is not called cash generative");
assert(!prompt.user.includes("In the black"), "a dipped forecast is not in the black");
assert(!prompt.user.includes("Negative weeks: 0"), "weeks under the floor are not quoted as 0 negative weeks");

const scoredUnderFloor = clientListRunwayHeadline({
  source: "derived",
  opening: 1000,
  closings: underFloor,
  floor: 50000,
  totalOutflow: 12000,
  healthOverall: 67,
});
assert(scoredUnderFloor === "Below zero now", scoredUnderFloor);
const emptySketch = clientListRunwayHeadline({
  source: "derived",
  opening: 0,
  closings: Array.from({ length: 13 }, () => 0),
  floor: 50000,
  totalOutflow: 0,
  healthOverall: 67,
});
assert(emptySketch === "—", emptySketch);

const shells = collapseDuplicateClientShells([
  { id: "a", name: "Theo van der Westhuizen", created_at: "2026-01-02", financials: null, cashflow: null },
  { id: "b", name: "Theo van der Westhuizen", created_at: "2026-01-05", financials: {}, cashflow: {} },
  { id: "c", name: "Theo van der Westhuizen", created_at: "2026-01-01", financials: null, cashflow: null },
  { id: "d", name: "Theo van der Westhuizen", created_at: "2026-02-01", financials: null, cashflow: null },
  { id: "e", name: "Theo van der Westhuizen", created_at: "2026-03-01", financials: null, cashflow: null },
  { id: "books", name: "Theo van der Westhuizen", created_at: "2026-04-01", financials: { revenue: 1000 }, cashflow: null },
]);
assert(shells.map((row) => row.id).join() === "books", shells.map((row) => row.id).join());
const onlyEmpty = collapseDuplicateClientShells([
  { id: "new", name: "Theo van der Westhuizen", created_at: "2026-03-01" },
  { id: "old", name: "Theo van der Westhuizen", created_at: "2026-01-01" },
]);
assert(onlyEmpty.map((row) => row.id).join() === "old", "empty shells keep the oldest");

assert(trendColumnVisible([[], [1]]) === false, "one point is not a trend");
assert(trendColumnVisible([[70, 67]]) === true, "two stored scores show the column");

const estimate = plBankDisagreement({
  financials: { revenue: 101250, cogs: 40000, fixedCosts: 0, periodMonths: "1" },
  cashflow: {
    seededFromBanksAt: "2026-10-01T00:00:00.000Z",
    forecastLinesSource: "pl-estimate",
    revenue: [{ amount: "1000", frequency: "recurring-weekly", startWeek: 1, name: "Receipts" }],
    expenses: [{ amount: "800", frequency: "recurring-weekly", startWeek: 1, name: "Payments" }],
  },
});
assert(estimate == null, "a P&L estimate is not a bank disagreement");
const genuine = plBankDisagreement({
  financials: { revenue: 50000, cogs: 20000, fixedCosts: 0, periodMonths: "1" },
  cashflow: {
    seededFromBanksAt: "2026-10-01T00:00:00.000Z",
    revenue: [{ amount: String((33500 * 12) / 52), frequency: "recurring-weekly", startWeek: 1, name: "Receipts" }],
    expenses: [{ amount: String((42000 * 12) / 52), frequency: "recurring-weekly", startWeek: 1, name: "Payments" }],
  },
});
assert(genuine != null && genuine.plRevenueMonthly === 50000, "a real bank gap stays");

const fields = { revenue: 100, cogs: -4.6, grossProfit: 60 };
const gm = statementGrossMarginFraction(fields);
assert(gm != null && Math.abs(gm - 0.6) < 0.0001, `waterfall GM is 60%, got ${gm}`);
const chips = buildVarianceChips({
  currentFinancials: fields,
  currentRatios: { "Gross Margin": 1.046 },
  prior: null,
});
assert(Math.abs((chips.find((chip) => chip.key === "gm")?.current ?? 0) - 0.6) < 0.0001, "overview uses the waterfall GM");

assert(formatQuotedDays("Creditor Days", -248) === "248 days", "creditor days are not negative");
assert(formatQuotedDays("Inventory Days", -93) === "93 days", "inventory days are not negative");
assert(
  formatQuotedDays("Working Capital Days", -149) === "Creditors fund the cycle · 149 days",
  "a negative cycle is flagged",
);
const dayBrief = buildOverviewBrief({
  ratios: {
    "Creditor Days": -248,
    "Inventory Days": -93,
    "Working Capital Days": -149,
    "Debtor Days": 6,
  },
});
const dayLines = overviewFactLines(dayBrief).join("\n");
assert(!dayLines.includes("-248") && !dayLines.includes("-93") && !dayLines.includes("-149"), dayLines);
assert(dayLines.includes("Creditors fund the cycle · 149 days"), dayLines);

const moves = rankStrategicMoves({ debtorDays: 6, healthByKey: { workingCapitalDays: 20 } });
assert(!moves.some((move) => /pay faster/i.test(move.title)), "short debtor days do not suggest pay faster");
assert(
  moves.every((move) => move.actions.every((action) => !/pay faster/i.test(action))),
  "pay-faster steps are dropped",
);
assert(
  moves.every(
    (move) =>
      !/tighten receivables|reduce debtor days|shorten debtor days|invoice the same day/i.test(move.title),
  ),
  "debtor days of 6 drop the other collection moves too",
);
const slow = rankStrategicMoves({ debtorDays: 40, healthByKey: { workingCapitalDays: 20 } });
assert(slow.some((move) => /pay faster/i.test(move.title)), "slow debtors still get the suggestion");

const signed = { signed_off_at: "2026-10-01T00:00:00.000Z" };
assert(budgetSignoffIsStale(signed, null) === false, "no budget clock is not stale");
assert(budgetSignoffIsStale(signed, "2026-09-01T00:00:00.000Z") === false, "an older budget is not stale");
assert(
  budgetSignoffIsStale(signed, "2026-10-02T00:00:00.000Z") === false,
  "a newer budget clock without a figure change is not stale",
);
assert(
  budgetSignoffIsStale(signed, "2026-10-02T00:00:00.000Z", true) === true,
  "changed budget figures are stale",
);

const many = buildFinancialManagerBrief({
  clientName: "Chill Pepper",
  currentFinancials: {},
  snapshots: [],
  openActionTitles: ["One", "Two", "Three", "Four", "Five"],
  actionsReady: true,
  draftsReady: true,
  formatMoney: (amount) => String(amount),
});
assert(many.actions.length === 3, "Act on these still shows three");
assert(many.actionCount === 5, `the brief keeps the full count, got ${many.actionCount}`);
assert(actionPreviewLine(many.actions.length, many.actionCount) === "Showing 3 of 5", "Showing sits on Act on these");

const liveNote = preferLiveHealthProse(
  "Profit is the weakest pillar at 60 against an overall score of 74, tied with Financing at 60.",
  { overall: 54, weakestLabel: "Cash", weakestScore: 25 },
);
assert(liveNote.includes("Cash is the weakest pillar at 25"), liveNote);
assert(liveNote.includes("overall score of 54"), liveNote);
assert(!/tied with/i.test(liveNote), liveNote);
assert(
  preferLiveHealthProse("Health is 74, with profit drivers weakest at 60.", {
    overall: 54,
    weakestLabel: "Cash",
    weakestScore: 25,
  }).includes("Health is 54, with Cash weakest at 25"),
  "home sentence quotes the live pillar",
);
assert(
  preferLiveHealthProse("Health fell from 80 to 74.", {
    overall: 54,
    weakestLabel: "Cash",
    weakestScore: 25,
  }) === "Health fell from 80 to 74.",
  "a two-period note stays stored",
);

const cashFirst = rankStrategicMoves({
  weakestPillar: "cash",
  debtorDays: 6,
  healthByKey: { operatingMargin: 0, creditorDays: 90, currentRatio: 80 },
});
assert(cashFirst[0] && strategicMovePillar(cashFirst[0].key) === "cash", cashFirst[0]?.title ?? "none");
assert(cashFirst[0]?.key !== "operatingMargin", "a floored cash pillar outranks a weak profit ratio");

const gaps = mergePackDataGaps([], {
  receivables: 12000,
  payables: 8000,
  hasAgedDebtors: false,
  hasAgedCreditors: false,
});
assert(gaps.some((gap) => gap.title === "Aged debtors report"), "missing aged debtors stay on the list");
assert(gaps.some((gap) => gap.title === "Aged creditors report"), "missing aged creditors stay on the list");
const shown = packSectionsForPdf([
  {
    key: "data_gaps",
    title: "What MILŌN still needs",
    body: "Nothing outstanding. The figures in this pack are as complete as MILŌN can make them from what has been provided.",
  },
  {
    key: "state_of_business",
    title: "Where the business stands",
    body: "Chill Pepper scores 74/100. Strongest pillar: Cash Flow (93). Weakest: Profit Drivers (60).",
  },
]);
const gapSection = shown.find((section) => section.key === "data_gaps");
assert(/Nothing outstanding/i.test(gapSection?.body ?? ""), gapSection?.body ?? "");
assert(!gapSection?.body.includes("open request"), gapSection?.body ?? "");
assert(!(gapSection?.bullets ?? []).some((line) => line.includes("Aged debtors report")), "stored gaps stay stored");
const state = shown.find((section) => section.key === "state_of_business");
assert(state?.body.includes("scores 74"), state?.body ?? "");
assert(!state?.body.includes("/100"), state?.body ?? "");
assert(state?.body.includes("Cash (93)"), state?.body ?? "");
assert(state?.body.includes("Profit (60)"), state?.body ?? "");
assert(packScoreProse("profit drivers is the weakest pillar at 72") === "Profit is the weakest pillar at 72", "lowercase pillar names");

console.log("aqa-followup ok");
