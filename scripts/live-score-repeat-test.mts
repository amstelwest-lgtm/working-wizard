/**
 * J4 repeat. A Test Co book scores the same overall and pillars from the
 * raw list blob and the Score-tab scalars. A stored hand-off does not
 * render "stored … vs live". A sign-off warns when the live score differs
 * from the signed score, including a numeric column that arrives as text.
 *
 * Run: pnpm test:live-score-repeat
 */
import { readFileSync } from "node:fs";
import { liveHealthFromBooks, type HealthPillarId } from "../src/lib/health-score.ts";
import { scalarsWithReadTimeEquity } from "../src/lib/statement-financials.ts";
import { ZA_MARKET } from "../src/lib/market/resolve.ts";
import { healthSignoffIsStale } from "../src/lib/signoff-status.ts";
import { ownerPresence } from "../src/lib/owner-presence.ts";
import { resolvePriorSnapshot } from "../src/lib/prior-period.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

/** QA Test Co (39af35c1) as stored. Equity is blank. */
const raw: Record<string, string> = {
  ebt: "33000",
  cash: "25000",
  cogs: "45000",
  ebit: "33000",
  ebitda: "33000",
  equity: "",
  revenue: "120000",
  payables: "10000",
  employees: "",
  inventory: "",
  laborCost: "",
  netIncome: "33000",
  fixedCosts: "42000",
  receivables: "18000",
  top5Revenue: "",
  totalAssets: "43000",
  founderHours: "",
  periodMonths: "12",
  variableCosts: "",
  operatingCashflow: "",
};

const cashflow = {
  openingBalance: "25000",
  startDate: "2026-10-19",
  seededFromBanksAt: "2026-10-05T19:04:22.019Z",
  revenue: [{ id: "r", name: "Primary", amount: "10000", frequency: "recurring-monthly", startWeek: 1 }],
  expenses: [
    { id: "e1", name: "COGS", amount: "3750", frequency: "recurring-monthly", startWeek: 1 },
    { id: "e2", name: "People", amount: "1925", frequency: "recurring-monthly", startWeek: 1 },
    { id: "e3", name: "Premises", amount: "934.5", frequency: "recurring-monthly", startWeek: 1 },
    { id: "e4", name: "Ops", amount: "1557.5", frequency: "recurring-monthly", startWeek: 1 },
    { id: "e5", name: "Marketing", amount: "623", frequency: "recurring-monthly", startWeek: 1 },
  ],
};

const prior = resolvePriorSnapshot(
  [
    {
      period_label: "Oct 2026",
      period_date: "2026-10-05",
      created_at: "2026-10-05T17:05:32.225Z",
      financials: {
        revenue: "120000",
        cogs: "45000",
        payables: "10000",
        receivables: "18000",
        equity: "",
        netIncome: "",
        totalAssets: "",
      },
    },
    {
      period_label: "Sep 2026",
      period_date: "2026-09-30",
      created_at: "2026-10-05T19:04:21.243Z",
      financials: { ...raw },
    },
  ],
  new Date("2026-10-20T12:00:00.000Z"),
  { periodEnd: null, financials: raw },
);

const common = {
  cashflow,
  financialsUpdatedAt: "2026-10-05T19:04:22.018Z",
  fyStartMonth: 3,
  market: ZA_MARKET,
  industry: "Professional services",
  timeZone: "Africa/Johannesburg",
  now: new Date("2026-10-20T12:00:00.000Z"),
};

const list = liveHealthFromBooks({ ...common, financials: raw });
const score = liveHealthFromBooks({
  ...common,
  financials: scalarsWithReadTimeEquity(raw),
  priorFinancials: prior?.financials ?? null,
});

function pillar(id: HealthPillarId) {
  return {
    list: list.pillars.find((row) => row.id === id)?.score,
    score: score.pillars.find((row) => row.id === id)?.score,
  };
}

assert(list.overall === score.overall, `overall list ${list.overall} score ${score.overall}`);
assert(list.overall === 83, `Test Co overall is 83, got ${list.overall}`);
for (const id of ["profit", "assets", "financing", "cash"] as const) {
  const row = pillar(id);
  assert(row.list === row.score, `${id} list ${row.list} score ${row.score}`);
}
assert(pillar("profit").list === 83, "Profit 83");
assert(pillar("assets").list === 100, "Assets stays on the score");
assert(pillar("financing").list === 97, `Financing follows plugged equity, got ${pillar("financing").list}`);
assert(pillar("cash").list === 52, "Cash 52");

const presence = ownerPresence(
  {
    runs: [],
    findings: [],
    messages: [
      {
        id: "826e45c7",
        client_id: "3cc31b6a-10a6-4202-bec7-ebb32a4e1f7a",
        from_agent: "advisor",
        to_agent: "financial_manager",
        type: "handoff",
        payload: {
          title:
            "Profit Drivers is the weak pillar (50); stored health 69 vs live 67. Margin and pricing review for accountant",
        },
        created_at: "2026-10-11T10:02:15.000Z",
      },
    ],
    market: ZA_MARKET,
  },
  null,
  { overall: 67, weakestLabel: "Profit", weakestScore: 50 },
);
const sentence = presence.handoff?.sentence ?? "";
assert(sentence.startsWith("Advisor → Financial Manager:"), sentence);
assert(!/\bstored\b[\s\S]{0,48}\bvs\s+live\b/i.test(sentence), sentence);
assert(!/\bstored\s+health\b/i.test(sentence), sentence);
assert(sentence.includes("health 67"), sentence);

const signedAt = "2026-10-06T16:29:11.666Z";
const updatedBeforeSignoff = "2026-10-05T19:04:22.018Z";
assert(
  healthSignoffIsStale({
    signoff: { signed_off_at: signedAt },
    dataUpdatedAt: updatedBeforeSignoff,
    liveHealth: list.overall,
    scoreHistory: [{ period_date: "2026-10-05", score: 84 }],
  }),
  "a numeric signed score that the live score has left is stale",
);
assert(
  healthSignoffIsStale({
    signoff: { signed_off_at: signedAt },
    dataUpdatedAt: updatedBeforeSignoff,
    liveHealth: list.overall,
    scoreHistory: [{ period_date: "2026-10-05", score: "84" }],
  }),
  "a numeric column stored as text still warns",
);
assert(
  healthSignoffIsStale({
    signoff: { signed_off_at: signedAt },
    dataUpdatedAt: updatedBeforeSignoff,
    liveHealth: 84,
    scoreHistory: [{ period_date: "2026-10-05", score: "84" }],
  }) === false,
  "an unchanged score stays signed when the books were saved first",
);

const owner = readFileSync("src/routes/app.tsx", "utf8");
const accountant = readFileSync("src/routes/_authenticated/clients.$clientId.tsx", "utf8");
const reports = readFileSync("src/routes/_authenticated/reports-studio.tsx", "utf8");
const home = readFileSync("src/components/owner-door/owner-home.tsx", "utf8");
assert(owner.includes("healthSignoffIsStale"), "owner Health uses the shared stale helper");
assert(accountant.includes("healthSignoffIsStale"), "accountant Score uses the shared stale helper");
assert(home.includes("quoteLiveScoreOnly(handoff.sentence)"), "the home beam strips a stored-versus-live note");
assert(reports.includes("liveHealthFromBooks("), "the scorecard quotes liveHealthFromBooks");
assert(!readFileSync("src/routes/_authenticated.gate.tsx", "utf8").includes("healthSignoffIsStale"));

console.log(
  `live-score-repeat ok ${list.overall} Assets ${pillar("assets").list} Financing ${pillar("financing").list}`,
);
