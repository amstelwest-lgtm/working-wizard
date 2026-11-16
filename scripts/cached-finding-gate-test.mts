/**
 * Cached Diagnose prose that cites a rejected ratio is not shown.
 * Run: pnpm test:cached-finding-gate
 */
import { computeRatios, dataSignIssue, operatingCycleDays, workingCapitalFromDayParts } from "../src/lib/ratios";
import {
  presentAnalystFinding,
  presentEmailFinding,
  presentHandoffFinding,
  presentHomeFinding,
  REFRESHED_FROM_FIGURES,
} from "../src/lib/cached-finding-gate";
import type { HealthScoreSnapshot } from "../src/lib/health-snapshot";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const chillText =
  "Full year on file show negative creditor and inventory days, which cannot be true. " +
  "Creditor Days of not meaningful and Inventory Days of not meaningful, yet Working Capital Days of 162. " +
  "Gross Margin is stored as 104.6%, above 100%.";

const live: HealthScoreSnapshot = {
  overall: 54,
  pillars: [
    { id: "profit", label: "Profit", score: 46 },
    { id: "cash", label: "Cash", score: 25 },
  ],
  weakestLabel: "Cash",
  weakestScore: 25,
  periodLabel: "Mar–Oct 2026",
};

const surfaces = [
  presentHomeFinding(chillText, { creditorDays: -248, inventoryDays: -93, grossMargin: 1.046 }, live),
  presentAnalystFinding(chillText, undefined, live),
  presentHandoffFinding(chillText, undefined, live),
  presentEmailFinding(chillText, undefined, live),
];

for (const shown of surfaces) {
  assert(shown.stale, "a rejected cached finding is stale");
  assert(shown.text.includes(REFRESHED_FROM_FIGURES), shown.text);
  assert(!/negative\s+\S+\s+days/i.test(shown.text), shown.text);
  assert(!shown.text.includes("Working Capital Days of 162"), shown.text);
  assert(!shown.text.includes("104.6%"), shown.text);
}

const valid = "Debtor days are 33 and cash is the weak spot.";
for (const present of [presentHomeFinding, presentAnalystFinding, presentHandoffFinding, presentEmailFinding]) {
  const kept = present(valid, { debtorDays: 33, creditorDays: 45, inventoryDays: 20, grossMargin: 0.4 }, live);
  assert(kept.text === valid, kept.text);
  assert(kept.stale === false, "a valid cached finding stays as stored");
}

const cycle = operatingCycleDays({
  revenue: 1_215_000,
  cogs: -56_000,
  receivables: (6.6 * 1_215_000) / 365,
  inventory: (93 * 56_000) / 365,
  payables: (248 * 56_000) / 365,
});
assert(Number.isNaN(cycle.workingCapitalDays), "negative cost is not a working-capital sum");
assert(
  Number.isNaN(workingCapitalFromDayParts(6.6, -93, -248)),
  "a signed day sum is not meaningful",
);
const ratios = computeRatios({
  revenue: "1215000",
  cogs: "-56000",
  ebit: "56800",
  ebt: "",
  netIncome: "27010",
  ebitda: "",
  operatingCashflow: "",
  totalAssets: "",
  equity: "",
  receivables: "22000",
  inventory: "14000",
  payables: "38000",
  fixedCosts: "",
  variableCosts: "",
  top5Revenue: "",
  laborCost: "",
  employees: "",
  founderHours: "",
  periodMonths: "12",
});
assert(Number.isNaN(ratios["Gross Margin"]), "a negative cost is not quoted as gross margin");
assert(dataSignIssue({ cogs: -56_000, grossMargin: 1.046 }), "the sign is flagged");
assert(!dataSignIssue({ cogs: 56_000, payables: 38_000, grossMargin: 0.954 }), "a normal margin stays quotable");

console.log("cached-finding-gate ok");
