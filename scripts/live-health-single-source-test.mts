/**
 * One fixture, one score. Home, the client list, notes, Analyst chat,
 * the agent-analyst run label, and the pack body all quote it.
 * Run: pnpm test:live-health-single-source
 */
import { labelHealthScore } from "../src/lib/agent-analyst.ts";
import { livePackMetrics, packSectionsForPdf } from "../src/lib/advisory-pack.ts";
import { liveHealthFromBooks } from "../src/lib/health-score.ts";
import { FIGURES_CHANGED_REGENERATE, healthSnapshotFromBooks, renderHealthNarrative } from "../src/lib/health-snapshot.ts";
import { diagnosisFromWorkspace } from "../src/lib/milon-team-feed.ts";
import { findingSentence } from "../src/lib/milon-team-activity.ts";
import { ownerPresence } from "../src/lib/owner-presence.ts";
import { ZA_MARKET } from "../src/lib/market/resolve.ts";
import { buildOverviewBrief } from "../supabase/functions/ask-ai/overview-brief.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const financials: Record<string, unknown> = {
  revenue: 1_200_000,
  cogs: 60_000,
  ebit: 180_000,
  ebt: 160_000,
  netIncome: 120_000,
  ebitda: 200_000,
  operatingCashflow: 80_000,
  totalAssets: 900_000,
  equity: 500_000,
  receivables: 20_000,
  inventory: 15_000,
  payables: 40_000,
  cash: 1_000,
  fixedCosts: 200_000,
  variableCosts: 400_000,
  laborCost: 180_000,
  employees: 12,
  top5Revenue: 300_000,
  currentAssets: 36_000,
  currentLiabilities: 80_000,
  periodMonths: 12,
  periodStart: "2025-10-01",
  periodEnd: "2026-09-30",
};

const cashflow = {
  openingBalance: "1000",
  openingBalanceSource: "xero",
};

const books = {
  financials,
  cashflow,
  financialsUpdatedAt: "2026-10-19T08:00:00.000Z",
  fyStartMonth: 3,
  market: { country: "ZA" as const, copyPack: "za" as const },
  industry: "Hotels & accommodation",
  timeZone: "Africa/Johannesburg",
};

const live = liveHealthFromBooks(books);
const overall = live.overall;
const weakest = live.weakestPillar;
assert(overall != null, "the fixture produces a score");
assert(weakest?.id === "cash" && weakest.score === 25, `cash floor is the weakest, got ${weakest?.id} ${weakest?.score}`);

const diagnosis = diagnosisFromWorkspace({
  financials,
  cashflow,
  financialsUpdatedAt: books.financialsUpdatedAt,
  lastForecastAt: null,
  fyStartMonth: books.fyStartMonth,
  market: ZA_MARKET,
  timeZone: books.timeZone,
  brainSummary: null,
  brainSummaryUpdatedAt: null,
  snapshotAsOf: null,
  proposals: [],
  industry: books.industry,
});

const pack = livePackMetrics({
  financials,
  cashflow,
  financialsUpdatedAt: books.financialsUpdatedAt,
  fyStartMonth: books.fyStartMonth,
  market: books.market,
  industry: books.industry,
  timeZone: books.timeZone,
});

const brief = buildOverviewBrief({
  financials,
  cashflow,
  financialsUpdatedAt: books.financialsUpdatedAt,
  fyStartMonth: books.fyStartMonth,
  copyPack: "za",
  industry: books.industry,
  timeZone: books.timeZone,
  clientName: "Chill Pepper",
});

const labeled = labelHealthScore({
  liveOverall: brief.health,
  storedScore: 74,
  storedAsOf: "2026-10-19",
});

const snapshot = healthSnapshotFromBooks({
  health: live,
  periodLabel: "1 Oct 2025 – 30 Sep 2026",
});
assert(snapshot != null, "the fixture produces a snapshot");

const note = findingSentence({
  title: "Health is 74, with Profit weakest at 60",
  detail: "Profit is the weakest pillar at 60 against an overall score of 74, tied with Financing at 60",
  liveHealth: snapshot,
});

const presence = ownerPresence(
  {
    runs: [],
    findings: [
      {
        id: "finding-1",
        agent: "analyst",
        client_id: "chill-pepper",
        title: "Health is 74, with Profit weakest at 60",
        detail: "Profit is the weakest pillar at 60 against an overall score of 74, tied with Financing at 60",
        evidence: null,
        as_of: null,
        created_at: "2026-10-19T10:39:00.000Z",
      },
    ],
    messages: [],
    market: ZA_MARKET,
  },
  null,
  snapshot,
);

const shown = packSectionsForPdf([
  {
    key: "state_of_business",
    title: "Where the business stands",
    body: "Chill Pepper scores 74 (watch). Strongest pillar: Cash Flow (93). Weakest: Profit Drivers (60). Profit Drivers is the weakest pillar.",
  },
]);
const packBody = shown[0]?.body ?? "";

const sameOverall = [
  ["client list and Home", live.overall],
  ["notes diagnosis", diagnosis.health?.score ?? null],
  ["Analyst chat", brief.health],
  ["agent-analyst run", labeled.overall],
  ["pack metrics", pack.health.overall],
] as const;

for (const [name, score] of sameOverall) {
  assert(score === overall, `${name} overall ${score} !== ${overall}`);
}

assert(diagnosis.health?.weakestLabel === weakest?.label, `notes weakest ${diagnosis.health?.weakestLabel}`);
assert(diagnosis.health?.weakestScore === weakest?.score, `notes weakest score ${diagnosis.health?.weakestScore}`);
assert(brief.weakest?.id === weakest?.id && brief.weakest?.score === weakest?.score, `analyst weakest ${brief.weakest?.id} ${brief.weakest?.score}`);
assert(pack.health.weakestPillar?.id === weakest?.id && pack.health.weakestPillar?.score === weakest?.score, "pack metrics weakest");
assert(labeled.overall_basis === "live" && labeled.stored_score === 74 && labeled.overall !== 74, "stored 74 does not replace the run");

const rebuilt = renderHealthNarrative(snapshot);
assert(note.includes(`${weakest?.label} is the weakest pillar at ${weakest?.score}`), note);
assert(note.includes(`overall health score of ${overall}`), note);
assert(note.includes(FIGURES_CHANGED_REGENERATE), note);
assert(!note.includes("74") && !note.includes("60"), note);
assert(!/tied with/i.test(note), note);
assert(rebuilt.includes(`${weakest?.label} is the weakest pillar at ${weakest?.score}`), rebuilt);
assert(rebuilt.includes(`overall health score of ${overall}`), rebuilt);
assert(!rebuilt.includes("74") && !/tied with/i.test(rebuilt), rebuilt);

const analystCard = presence.agents.find((agent) => agent.agent === "analyst");
assert(analystCard?.sentence === note, analystCard?.sentence ?? "no analyst card");
assert(!analystCard?.sentence.includes("74"), analystCard?.sentence ?? "");

assert(packBody.includes("scores 74 (watch)"), packBody);
assert(packBody.includes("Cash (93)"), packBody);
assert(packBody.includes("Weakest: Profit (60)"), packBody);
assert(packBody.includes("Profit is the weakest pillar"), packBody);
assert(!packBody.includes(`scores ${overall}`), `pack body must stay stored, got ${packBody}`);
assert(!packBody.includes("Cash Flow"), packBody);

console.log(`live-health-single-source ok ${overall} ${weakest?.label} ${weakest?.score}`);
