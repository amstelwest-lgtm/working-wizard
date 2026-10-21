/**
 * 1020B: one live score snapshot. Stored prose that names a different pillar,
 * overall, weakest, or period is not shown. The period badge uses the
 * statement period's end month.
 * Run: pnpm test:health-narrative-snapshot
 */
import { packSectionsForPdf } from "../src/lib/advisory-pack.ts";
import { buildFinancialManagerBrief } from "../src/lib/financial-manager-brief.ts";
import {
  FIGURES_CHANGED_REGENERATE,
  SCORE_ENGINE_VERSION,
  badgeMonthFromPeriod,
  healthSnapshotHash,
  healthSnapshotPromptBlock,
  presentHealthNarrative,
  renderHealthNarrative,
  renderHealthNarrativeLead,
  snapshotEvidenceFields,
  staleHealthNarrative,
  type HealthScoreSnapshot,
} from "../src/lib/health-snapshot.ts";
import { figuresCheckedLine, findingSentence } from "../src/lib/milon-team-activity.ts";
import { presentLiveDraft } from "../src/lib/draft-figures.ts";
import { ownerPresence } from "../src/lib/owner-presence.ts";
import { presentHomeDraftTitle } from "../src/lib/owner-needs.ts";
import { booksPeriodPillLabel } from "../src/lib/statement-period.ts";
import { healthAnswerSentence } from "../src/lib/overview-insights.ts";
import { ZA_MARKET } from "../src/lib/market/resolve.ts";
import { healthNarrative } from "../src/reports/narrative.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const PERIOD = "1 Jan 2026 – 30 Sep 2026";

const live: HealthScoreSnapshot = {
  overall: 63,
  pillars: [
    { id: "profit", label: "Profit", score: 75 },
    { id: "assets", label: "Assets", score: 63 },
    { id: "financing", label: "Financing", score: 81 },
    { id: "cash", label: "Cash", score: 34 },
  ],
  weakestLabel: "Cash",
  weakestScore: 34,
  periodLabel: PERIOD,
};

const analyst =
  "Cash is the weakest pillar at 34, against an overall health score of 63. Assets scores 83, Financing 81 and Cash 78, so Profit pulls the overall score down.";
const homeDraft =
  "Review pricing on top-selling lines to lift Profit, the weakest pillar at 58 against an overall health score of 63";

const analystShown = findingSentence({
  title: analyst,
  liveHealth: live,
});
const homeShown = presentHomeDraftTitle(homeDraft, null, { health: live, overall: live.overall }).text;
const presence = ownerPresence(
  {
    runs: [],
    findings: [
      {
        id: "finding-1020b",
        agent: "analyst",
        client_id: "7b111d2a",
        title: analyst,
        detail: null,
        evidence: null,
        as_of: "2026-01-31",
        created_at: "2026-10-20T08:00:00.000Z",
      },
    ],
    messages: [],
    market: ZA_MARKET,
  },
  null,
  live,
);
const analystCard = presence.agents.find((agent) => agent.agent === "analyst")?.sentence ?? "";
const brief = buildFinancialManagerBrief({
  clientName: "1020B",
  currentFinancials: {},
  snapshots: [],
  drafts: [{ id: "draft-1", title: homeDraft, storedHealth: null }],
  draftsReady: true,
  actionsReady: true,
  healthSnapshot: live,
  formatMoney: (amount) => String(amount),
});
const briefTitle = brief.drafts[0]?.title ?? "";
const pack = packSectionsForPdf(
  [{ key: "state_of_business", title: "Where the business stands", body: analyst }],
  { liveHealth: live },
);
const packBody = pack[0]?.body ?? "";
const rebuilt = renderHealthNarrative(live);
const healthTab = healthAnswerSentence({
  score: live.overall,
  bandLabel: "Watch",
  pillars: live.pillars.map((pillar) => ({ label: pillar.label, score: pillar.score })),
});
const scorecard = healthNarrative(
  live.overall,
  live.pillars.map((pillar) => ({ id: pillar.id, label: pillar.label, score: pillar.score })),
  { weakLever: null, weakLeverLabel: "", sentence: "The ROE levers cannot be scored from the figures on file." },
  null,
  ZA_MARKET,
  "at_risk",
  "1020B",
);

const rendered = [analystShown, homeShown, analystCard, briefTitle, packBody, healthTab, scorecard];
for (const text of rendered) {
  assert(!text.includes("58"), `stale weakest 58: ${text}`);
  assert(!text.includes("83"), `stale assets 83: ${text}`);
  assert(!text.includes("78"), `stale cash 78: ${text}`);
  assert(!/profit[^.]{0,40}weakest pillar/i.test(text), `profit is not weakest: ${text}`);
  assert(!/profit pulls the (?:overall )?score down/i.test(text), text);
}

const lead = renderHealthNarrativeLead(live);
const staleLine = `${staleHealthNarrative(live)}.`;
assert(analystShown === staleLine, analystShown);
assert(analystShown.includes(FIGURES_CHANGED_REGENERATE), analystShown);
assert(analystCard === staleLine, analystCard);
assert(analystCard.includes(FIGURES_CHANGED_REGENERATE), analystCard);
assert(packBody === rebuilt, packBody);
assert(homeShown.includes(lead) && homeShown.includes(FIGURES_CHANGED_REGENERATE), homeShown);
assert(briefTitle.includes(lead) && briefTitle.includes(FIGURES_CHANGED_REGENERATE), briefTitle);
assert(brief.drafts[0]?.liveSentence === rebuilt, brief.drafts[0]?.liveSentence ?? "");

assert(rebuilt.includes("Cash is the weakest pillar at 34"), rebuilt);
assert(rebuilt.includes("overall health score of 63"), rebuilt);
assert(rebuilt.includes("Profit scores 75"), rebuilt);
assert(rebuilt.includes("Assets scores 63"), rebuilt);
assert(rebuilt.includes("Financing scores 81"), rebuilt);
assert(rebuilt.includes("Cash scores 34"), rebuilt);
assert(!rebuilt.includes("58") && !rebuilt.includes("83") && !rebuilt.includes("78"), rebuilt);

assert(healthTab.startsWith("Cash is the weakest pillar"), healthTab);
assert(scorecard.includes("At 63"), scorecard);
assert(/cash is critical at 34/i.test(scorecard), scorecard);
assert(scorecard.includes("Financing is the strongest pillar (81)"), scorecard);

const stored: HealthScoreSnapshot = {
  ...live,
  overall: 75,
  weakestLabel: "Profit",
  weakestScore: 58,
  periodLabel: "Jan 2026",
  pillars: live.pillars.map((pillar) =>
    pillar.id === "assets" ? { ...pillar, score: 83 } : pillar.id === "cash" ? { ...pillar, score: 78 } : pillar,
  ),
};
const quiet = presentHealthNarrative("Look at pricing on the top lines.", live, stored);
assert(quiet.text === "Look at pricing on the top lines.", quiet.text);
assert(quiet.regenerate === false, "prose with no score stays, even when the stored snapshot differs");

const freeform = presentHealthNarrative(
  "I would still tell the owner the score is 80 until they reload the books.",
  live,
);
assert(freeform.text === FIGURES_CHANGED_REGENERATE, freeform.text);
assert(freeform.regenerate === true, "free-form prose with a stale score asks to regenerate");
assert(!freeform.text.includes("80"), freeform.text);

const same = presentHealthNarrative("Look at pricing on the top lines.", live, live);
assert(same.text === "Look at pricing on the top lines.", same.text);
assert(same.regenerate === false, "a matching snapshot keeps the sentence");

const history = presentHealthNarrative("The overall health score fell from 80 to 64.", live, null);
assert(history.text === "The overall health score fell from 80 to 64.", history.text);

assert(badgeMonthFromPeriod(PERIOD) === "Sep", badgeMonthFromPeriod(PERIOD) ?? "none");
assert(badgeMonthFromPeriod("January 2026") === "Jan", "a single month stays that month");
const badge = figuresCheckedLine(PERIOD, "2026-10-20T08:00:00.000Z", new Date("2026-10-20T12:00:00.000Z"), ZA_MARKET);
assert(badge?.startsWith("Sep figures"), badge ?? "no badge");
assert(!badge?.includes("Jan"), badge ?? "");

const fields = snapshotEvidenceFields(live);
assert(fields.score_snapshot_hash === healthSnapshotHash(live), fields.score_snapshot_hash);
assert(fields.score_snapshot.weakestLabel === "Cash" && fields.score_snapshot.weakestScore === 34, "stored snapshot");

const prompt = healthSnapshotPromptBlock(live);
assert(prompt.includes("Profit 75") && prompt.includes("Assets 63"), prompt);
assert(prompt.includes("Financing 81") && prompt.includes("Cash 34"), prompt);
assert(prompt.includes(PERIOD), prompt);
assert(!prompt.includes("83") && !prompt.includes("78") && !prompt.includes("58"), prompt);
assert(healthSnapshotHash(live).startsWith(`e:${SCORE_ENGINE_VERSION}|`), healthSnapshotHash(live));
assert(booksPeriodPillLabel("2026-09-30", "Jan 1 – Sep 30, 2026") === "Sep 2026", "1020B header is Sep 2026");
assert(booksPeriodPillLabel(null, null) === null, "no books leaves the pill on the calendar month");

const evidence1020 = {
  snapshot_id: "89ff9abf-db98-4e19-8e72-b8c844d36041",
  period_label: "Jan 1 – Sep 30, 2026",
  figures: {
    overall: 75,
    live_overall: 75,
    stored_score: 75,
    "pillar:profit": 58,
    "pillar:assets": 83,
    "pillar:financing": 81,
    "pillar:cash": 78,
    "Gross Margin": 0.5849514537921812,
    "Net Margin": 0.0927184410965925,
  },
  metrics: [
    { metric: "pillar:profit", value: 58, unit: "count" },
    { metric: "pillar:assets", value: 83, unit: "count" },
    { metric: "pillar:financing", value: 81, unit: "count" },
    { metric: "pillar:cash", value: 78, unit: "count" },
    { metric: "overall", value: 75, unit: "count" },
  ],
};
const title1020 = "Profit is the weakest pillar at 58, against an overall health score of 75.";
const detail1020 =
  "Assets scores 83, Financing 81 and Cash 78, so Profit pulls the overall score down. Gross margin is 58.5% and net margin is 9.3% for Jan 1 – Sep 30, 2026. The books on file point to pricing as the main lever.";

function assertCardNumbers(text: string, where: string) {
  const nums = text.match(/\d+(?:\.\d+)?/g) ?? [];
  for (const n of nums) {
    assert(n === "63" || n === "34", `${where} shows ${n}, which is not the page score card: ${text}`);
  }
  assert(text.includes("Cash is the weakest pillar at 34"), `${where} lead: ${text}`);
  assert(text.includes("overall health score of 63"), `${where} overall: ${text}`);
  assert(text.includes(FIGURES_CHANGED_REGENERATE), `${where} action: ${text}`);
  assert(!/profit[^.]{0,48}weakest/i.test(text), `${where} still says profit is weakest: ${text}`);
}

const accountant1020 = findingSentence({
  title: title1020,
  detail: detail1020,
  evidence: evidence1020,
  liveHealth: live,
  writtenAt: "2026-10-20T13:34:11.501Z",
  figuresUpdatedAt: "2026-10-20T13:23:11.753Z",
});
assertCardNumbers(accountant1020, "accountant");
const owner1020 = ownerPresence(
  {
    runs: [],
    findings: [
      {
        id: "0fb3a96d-a921-4563-bcfa-4d37c5465099",
        agent: "analyst",
        client_id: "7b111d2a-2339-4722-9596-13225801ec8f",
        title: title1020,
        detail: detail1020,
        evidence: evidence1020,
        as_of: null,
        created_at: "2026-10-20T13:34:11.501Z",
      },
    ],
    messages: [],
    market: ZA_MARKET,
  },
  null,
  live,
  "2026-10-20T13:23:11.753Z",
);
assertCardNumbers(owner1020.agents.find((agent) => agent.agent === "analyst")?.sentence ?? "", "owner");
const advisor1020 = presentLiveDraft(
  "Review pricing on top-selling lines to lift Profit, the weakest pillar at 58 against an overall health score of 75.",
  {
    health: live,
    overall: live.overall,
    evidence: evidence1020,
    writtenAt: "2026-10-20T17:13:38.779Z",
    figuresUpdatedAt: "2026-10-20T13:23:11.753Z",
  },
);
assert(advisor1020.regenerate === true, "advisor draft asks to regenerate");
assertCardNumbers(advisor1020.text, "advisor");

const matchingEvidence = {
  ...snapshotEvidenceFields(live),
  period_label: PERIOD,
};
const matching = findingSentence({
  title: "Pricing still needs a look. Cash is the weakest pillar at 34, against an overall health score of 63.",
  evidence: matchingEvidence,
  liveHealth: live,
  writtenAt: "2026-10-20T18:00:00.000Z",
  figuresUpdatedAt: "2026-10-20T13:23:11.753Z",
});
assert(matching.includes("Pricing still needs a look"), matching);
assert(!matching.includes(FIGURES_CHANGED_REGENERATE), matching);

const legacyMatch = findingSentence({
  title: "Cash is the weakest pillar at 34, against an overall health score of 63. The pricing note stays.",
  evidence: {
    period_label: PERIOD,
    figures: {
      overall: 63,
      "pillar:profit": 75,
      "pillar:assets": 63,
      "pillar:financing": 81,
      "pillar:cash": 34,
    },
    metrics: [
      { metric: "overall", value: 63 },
      { metric: "pillar:profit", value: 75 },
      { metric: "pillar:assets", value: 63 },
      { metric: "pillar:financing", value: 81 },
      { metric: "pillar:cash", value: 34 },
    ],
  },
  liveHealth: live,
  writtenAt: "2026-10-20T18:00:00.000Z",
  figuresUpdatedAt: "2026-10-20T13:23:11.753Z",
});
assert(legacyMatch.includes("The pricing note stays"), legacyMatch);
assert(!legacyMatch.includes(FIGURES_CHANGED_REGENERATE), legacyMatch);

const bumpedHash = healthSnapshotHash(live).replace(`e:${SCORE_ENGINE_VERSION}|`, "e:1|");
const bumped = findingSentence({
  title: "Cash is the weakest pillar at 34, against an overall health score of 63.",
  evidence: { score_snapshot_hash: bumpedHash, score_snapshot: live },
  liveHealth: live,
  writtenAt: "2026-10-20T18:00:00.000Z",
  figuresUpdatedAt: "2026-10-20T13:23:11.753Z",
});
assertCardNumbers(bumped, "engine bump");
assert(!bumped.includes("e:1"), bumped);

console.log("health-narrative-snapshot ok");
