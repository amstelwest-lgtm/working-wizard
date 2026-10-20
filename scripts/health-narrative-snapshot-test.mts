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
  badgeMonthFromPeriod,
  healthSnapshotHash,
  healthSnapshotPromptBlock,
  presentHealthNarrative,
  renderHealthNarrative,
  snapshotEvidenceFields,
  type HealthScoreSnapshot,
} from "../src/lib/health-snapshot.ts";
import { figuresCheckedLine, findingSentence } from "../src/lib/milon-team-activity.ts";
import { ownerPresence } from "../src/lib/owner-presence.ts";
import { presentHomeDraftTitle } from "../src/lib/owner-needs.ts";
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

assert(analystShown === rebuilt, analystShown);
assert(!analystShown.includes(FIGURES_CHANGED_REGENERATE), analystShown);
assert(analystCard === `${rebuilt}`, analystCard);
assert(!analystCard.includes(FIGURES_CHANGED_REGENERATE), analystCard);
assert(packBody === rebuilt, packBody);
assert(homeShown === FIGURES_CHANGED_REGENERATE, homeShown);
assert(briefTitle === FIGURES_CHANGED_REGENERATE, briefTitle);
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

console.log("health-narrative-snapshot ok");
