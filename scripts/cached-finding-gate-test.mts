/**
 * Cached findings are checked against the live ratio validator.
 * Home, the FM hand-off, and the email body each go through their call site.
 * Run: pnpm test:cached-finding-gate
 */
import assert from "node:assert/strict";
import { describeActionHandoff } from "../src/lib/action-handoff.ts";
import { presentCachedFinding, REFRESHED_FROM_FIGURES } from "../src/lib/cached-finding-gate.ts";
import type { HealthScoreSnapshot } from "../src/lib/health-snapshot.ts";
import { findingSentence } from "../src/lib/milon-team-activity.ts";
import { AGENT_DISPLAY_NAME } from "../src/lib/milon-team-names.ts";
import { computeRatios, validateRatioInputs } from "../src/lib/ratios.ts";
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

console.log("cached-finding-gate-test: ok");
