/**
 * Cached findings are checked against the live ratio validator.
 * Home, the FM hand-off, and the email body each go through their call site.
 * Run: pnpm test:cached-finding-gate
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describeActionHandoff } from "../src/lib/action-handoff.ts";
import { presentCachedFinding, REFRESHED_FROM_FIGURES } from "../src/lib/cached-finding-gate.ts";
import type { HealthScoreSnapshot } from "../src/lib/health-snapshot.ts";
import { findingSentence, presentActionWhy } from "../src/lib/milon-team-activity.ts";
import { renderHealthNarrative } from "../src/lib/health-snapshot.ts";
import { AGENT_DISPLAY_NAME } from "../src/lib/milon-team-names.ts";
import { cachedFindingRejected, computeRatios, validateRatioInputs } from "../src/lib/ratios.ts";
import { advisoryOutboundBody } from "../src/components/advisory-drafter.tsx";

const chillText = [
  "The Sep 2026 books show negative creditor and inventory days, which cannot be true.",
  "Creditor Days of not meaningful and Inventory Days of not meaningful, yet Working Capital Days of 162.",
  "Gross Margin is stored as 104.6%, above 100%.",
].join(" ");

const live: HealthScoreSnapshot = {
  overall: 62,
  pillars: [
    { id: "profit", label: "Profit", score: 70 },
    { id: "assets", label: "Assets", score: 55 },
    { id: "financing", label: "Financing", score: 48 },
    { id: "cash", label: "Cash", score: 40 },
  ],
  weakestLabel: "Cash",
  weakestScore: 40,
  periodLabel: "Full year on file",
};

const chillRatios = computeRatios({
  revenue: "1215000",
  cogs: "-56000",
  grossProfit: "159000",
  opex: "158200",
  ebit: "56800",
  interest: "0",
  tax: "0",
  netIncome: "27010",
  cash: "1000",
  receivables: "1000",
  inventory: "1000",
  currentAssets: "3000",
  totalAssets: "3000",
  payables: "1000",
  currentLiabilities: "1000",
  totalLiabilities: "1000",
  equity: "2000",
});

assert.equal(Number.isNaN(chillRatios["Gross Margin"]), true);
assert.equal(Number.isNaN(chillRatios["Working Capital Days"]), true);
assert.equal(validateRatioInputs({ cogs: -56_000, grossMargin: 1.046 }).dataSign, true);

function noChillQuotes(text: string) {
  assert.equal(/negative\s+\S+\s+days/i.test(text), false, text);
  assert.equal(text.includes("Working Capital Days of 162"), false, text);
  assert.equal(text.includes("104.6%"), false, text);
  assert.equal(text.includes("Refreshed from current figures"), true, text);
  assert.equal(text.includes("Cash is the weakest pillar at 40"), true, text);
}

const home = findingSentence({
  title: chillText,
  figures: { cogs: -56_000, payables: 1000, grossMargin: 1.046 },
  canonicalRatios: chillRatios,
  liveHealth: live,
});
noChillQuotes(home);

const handoff = describeActionHandoff({
  actionItemId: "action-1",
  assignee: AGENT_DISPLAY_NAME.analyst,
  notes: [
    {
      note: `${AGENT_DISPLAY_NAME.analyst} finished: ${chillText}`,
      at: "2026-11-01T12:00:00.000Z",
    },
  ],
  storedRun: {
    id: "run-1",
    agent: "analyst",
    status: "succeeded",
    at: "2026-11-01T12:00:00.000Z",
  },
  runs: [],
  findings: [],
  findingsReady: true,
  ratios: chillRatios,
  liveHealth: live,
});
assert.ok(handoff.caption, "hand-off caption");
noChillQuotes(handoff.caption ?? "");

const mixed =
  "Please review the cash position. " +
  chillText +
  " See the Sep 2026 books before we meet on Tuesday.";
const email = advisoryOutboundBody(mixed, chillRatios, live);
noChillQuotes(email);
assert.equal(email.includes("Please review the cash position."), true, email);
assert.equal(email.includes("See the Full year on file before we meet on Tuesday."), true, email);
assert.equal(email.includes("Sep 2026 books"), false, email);

const valid = "Debtor days are 33.";
const validRatios: Record<string, number> = {
  "Debtor Days": 33,
  "Creditor Days": 40,
  "Inventory Days": 20,
  "Working Capital Days": 13,
  "Gross Margin": 0.4,
};
assert.equal(
  presentCachedFinding({ text: valid, ratios: validRatios, live }).text,
  valid,
);
assert.equal(
  findingSentence({ title: valid, canonicalRatios: validRatios, liveHealth: live }),
  valid,
);
assert.equal(
  advisoryOutboundBody(valid, validRatios, live),
  valid,
);
const validHandoff = describeActionHandoff({
  actionItemId: "action-2",
  assignee: AGENT_DISPLAY_NAME.analyst,
  notes: [
    {
      note: `${AGENT_DISPLAY_NAME.analyst} finished: ${valid}`,
      at: "2026-11-02T12:00:00.000Z",
    },
  ],
  storedRun: {
    id: "run-2",
    agent: "analyst",
    status: "succeeded",
    at: "2026-11-02T12:00:00.000Z",
  },
  runs: [],
  findings: [],
  findingsReady: true,
  ratios: validRatios,
  liveHealth: live,
});
assert.equal(validHandoff.caption?.includes("Debtor days are 33"), true, validHandoff.caption ?? "");
assert.equal(validHandoff.caption?.includes("Refreshed from current figures"), false, validHandoff.caption ?? "");

const paragraphs = [
  "Please review the cash position.",
  "",
  "Working Capital Days of 162.",
  "",
  "We meet on Tuesday.",
].join("\n");
const keptBreaks = presentCachedFinding({ text: paragraphs, ratios: chillRatios, live }).text;
assert.equal(keptBreaks.startsWith("Please review the cash position.\n\n"), true, keptBreaks);
assert.equal(keptBreaks.endsWith("\n\nWe meet on Tuesday."), true, keptBreaks);
assert.equal(keptBreaks.includes("Working Capital Days of 162"), false, keptBreaks);
const untouched = "Please review the cash position.\n\nDebtor days are 33.\n\nWe meet on Tuesday.";
assert.equal(
  presentCachedFinding({ text: untouched, ratios: validRatios, live }).text,
  untouched,
);

assert.equal(
  cachedFindingRejected(
    "Creditors improved. The close took two days.",
    undefined,
    chillRatios,
  ),
  false,
);
const analystLive: HealthScoreSnapshot = {
  overall: 54,
  pillars: [
    { id: "profit", label: "Profit", score: 70 },
    { id: "assets", label: "Assets", score: 55 },
    { id: "financing", label: "Financing", score: 48 },
    { id: "cash", label: "Cash", score: 25 },
  ],
  weakestLabel: "Cash",
  weakestScore: 25,
  periodLabel: "Full year on file",
};
const analystParagraph = renderHealthNarrative(analystLive);
const analystBlock = `${analystParagraph} ${REFRESHED_FROM_FIGURES} There is no prior period.`;
const analystShown = presentCachedFinding({
  text: `${analystBlock} ${analystBlock}`,
  live: analystLive,
}).text;
assert.equal(analystShown.split("Cash is the weakest pillar at 25").length - 1, 1, analystShown);
assert.equal((analystShown.match(/Refreshed from current figures/g) ?? []).length, 1, analystShown);
assert.equal((analystShown.match(/There is no prior period/g) ?? []).length, 1, analystShown);

const staleWhy = "Profit weakest at 60. Cash 93. Overall health is 74 (Watch).";
const actionWhy = presentActionWhy(staleWhy, null, analystLive);
assert.equal(actionWhy.includes("74"), false, actionWhy);
assert.equal(actionWhy.includes("Profit weakest at 60"), false, actionWhy);
assert.equal(actionWhy.includes("Cash is the weakest pillar at 25"), true, actionWhy);
assert.equal(
  readFileSync("src/components/action-plan.tsx", "utf8").includes("presentActionWhy(item.outcome_why"),
  true,
  "the action row and drawer quote the why through the live snapshot",
);

assert.equal(cachedFindingRejected("WC days 162.", undefined, undefined), false);
assert.equal(
  cachedFindingRejected("WC days 162.", undefined, { "Working Capital Days": Number.NaN }),
  true,
);

console.log("cached-finding-gate-test: ok");
