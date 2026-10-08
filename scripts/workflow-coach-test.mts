/**
 * Accountant reading-path targets. The horizontal strip is gone; these
 * tests lock tab resolution and the left rail without rendering that chrome.
 * Run: pnpm test:workflow-coach
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { dataSectionStatus } from "../src/lib/data-requests.ts";
import {
  COACH_STEPS,
  coachPageForTab,
  coachView,
  dataFreshnessLine,
  dataStepDone,
  deliverableHandoff,
  evidenceForPillar,
  nextCoachStep,
  pillarIsWeak,
  syncSucceeded,
} from "../src/lib/workflow-coach.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(
  COACH_STEPS.map((s) => s.label).join(" → ") ===
    "Data → Health → Pillars → Profitability → Cash → Budget → Actions",
  "spine order",
);
assert(
  COACH_STEPS[0].id === "data" &&
    COACH_STEPS[0].tab === "overview" &&
    COACH_STEPS[0].section === "books",
  "data lands on Overview Books",
);

const none = {};
assert(nextCoachStep("data", none)?.id === "health", "data continues to health");
assert(nextCoachStep("health", none)?.id === "pillars", "health continues to pillars");
assert(nextCoachStep("pillars", none)?.id === "profit", "pillars continue to profitability");
assert(nextCoachStep("profit", none)?.id === "cash", "profit continues to cash");
assert(nextCoachStep("cash", none)?.id === "budget", "cash continues to budget");
assert(nextCoachStep("budget", none)?.id === "actions", "budget continues to actions");
assert(nextCoachStep("actions", none) === null, "actions stays to assign");

const fromData = coachView({ page: "data", done: none });
assert(fromData.cta === "Continue → Health", `data CTA, got ${fromData.cta}`);
assert(
  fromData.destination.tab === "overview" &&
    fromData.destination.section === "health" &&
    fromData.destination.focus === "health",
  "data opens health",
);
assert(fromData.nextCue.includes("health score"), "next cue names the health score");

const cashDone = { cash: true };
assert(nextCoachStep("profit", cashDone)?.id === "budget", "signed-off cash skips to budget");
const evidenceDone = { cash: true, budget: true };
assert(
  nextCoachStep("profit", evidenceDone)?.id === "actions",
  "profit with cash and budget done continues to actions",
);
assert(
  nextCoachStep("profit", { cash: true, budget: true, actions: true })?.id === "cash",
  "when later steps are done, profit still continues to the next page",
);

const fromBot = coachView({
  page: "profit",
  intent: "margin",
  why: "What's our gross margin?",
  done: none,
});
assert(fromBot.cta === "Continue → Cash", `bot profitability CTA, got ${fromBot.cta}`);
assert(fromBot.nextCue.includes("13-week"), "next cue names cash");
assert(fromBot.because.includes("Milōn Bot asked"), "bot intent stays on the step");
assert(fromBot.because.includes("gross margin"), "the question is kept");
assert(fromBot.because.includes("waterfall"), "margin intent explains the page");

const stale = coachView({ page: "cash", intent: "margin", why: "margin", done: none });
assert(!stale.because.includes("Milōn Bot asked"), "a margin intent does not stick on Cash");
assert(stale.because.includes("liquidity"), "cash uses its own reason");
assert(stale.cta === "Continue → Budget", `cash CTA, got ${stale.cta}`);

const freshOverview = coachView({ page: null, done: {} });
assert(freshOverview.currentId === null, "overview highlights no step");
assert(
  freshOverview.cta === "Continue → Data",
  `a new file continues to data, got ${freshOverview.cta}`,
);
assert(
  freshOverview.destination.tab === "overview" && freshOverview.destination.section === "books",
  "overview continue opens Books",
);

const overview = coachView({ page: null, done: { data: true, health: true } });
assert(
  overview.cta === "Continue → Pillars",
  `overview with data and a score continues to pillars, got ${overview.cta}`,
);
const dataIn = coachView({ page: null, done: { data: true } });
assert(
  dataIn.cta === "Continue → Health",
  `books already in continue to health, got ${dataIn.cta}`,
);

assert(coachPageForTab("summary", null) === "data", "Client Brain is the data step");
assert(coachPageForTab("ratios", null) === "health", "ratios tab is the health step");
assert(coachPageForTab("ratios", "pillars") === "pillars", "focus=pillars is the pillar step");
assert(coachPageForTab("plan", null) === "actions", "action plan is the actions step");
assert(coachPageForTab("overview", null) === null, "overview is not a spine step");

assert(pillarIsWeak(40) === true, "40 is a weak pillar");
assert(pillarIsWeak(65) === true, "65 is Watch, so the pillar is weak");
assert(pillarIsWeak(80) === false, "80 is healthy");
assert(pillarIsWeak(Number.NaN) === false, "missing pillar is not a false weak");
const cashEvidence = evidenceForPillar("cash");
assert(
  cashEvidence?.tab === "overview" &&
    cashEvidence.section === "cash" &&
    cashEvidence.coach === "liquidity",
  "liquidity → cash",
);
const marginEvidence = evidenceForPillar("profit");
assert(
  marginEvidence?.tab === "overview" &&
    marginEvidence.section === "profit" &&
    marginEvidence.coach === "margin",
  "margin → profitability",
);

const margin = deliverableHandoff("What's our gross margin versus peers?");
assert(
  margin?.tab === "overview" && margin.section === "profit" && margin.coach === "margin",
  "bot routes margin to profitability",
);
assert(margin?.why.includes("gross margin"), "handoff keeps the question");
const cashQ = deliverableHandoff("Will the 13-week cash forecast go negative?");
assert(
  cashQ?.tab === "overview" && cashQ.section === "cash" && cashQ.coach === "liquidity",
  "bot routes cash to the forecast",
);
const drag = deliverableHandoff("What's the biggest drag on this client's score vs peers?");
assert(
  drag?.tab === "overview" && drag.section === "pillars" && drag.focus === "pillars",
  "a drag question opens pillars",
);
const healthQ = deliverableHandoff("What's the health score?");
assert(
  healthQ?.tab === "overview" && healthQ.section === "health" && healthQ.focus === "health",
  "a health question still opens Health",
);
const syncQ = deliverableHandoff("Has Xero synced this period?");
assert(
  syncQ?.tab === "overview" &&
    syncQ.section === "books" &&
    syncQ.coach === "data" &&
    syncQ.label === "Open Data",
  "bot routes sync to Data",
);
const uploadQ = deliverableHandoff("Can we upload the statements?");
assert(
  uploadQ?.tab === "overview" && uploadQ.section === "books" && uploadQ.coach === "data",
  "bot routes an upload to Data",
);
assert(
  deliverableHandoff("Draft an advisory pack from the brain") === null,
  "unrelated questions do not route",
);

const synced = {
  lastSyncedAt: "2026-09-01T12:00:00.000Z",
  syncStatus: "idle",
  periodLabel: "Sep 2026",
};
assert(syncSucceeded(synced) === true, "an idle sync with a timestamp counts");
assert(
  syncSucceeded({ lastSyncedAt: synced.lastSyncedAt, syncStatus: "error" }) === false,
  "an error is not a success",
);
assert(
  syncSucceeded({ lastSyncedAt: null, syncStatus: "idle" }) === false,
  "never synced does not count",
);
assert(
  dataStepDone({ xero: null, qbo: null, snapshotCount: 0 }) === false,
  "empty books are not done",
);
assert(
  dataStepDone({ xero: synced, qbo: null, snapshotCount: 0 }) === true,
  "a Xero sync marks Data done",
);
assert(
  dataStepDone({
    xero: null,
    qbo: { lastSyncedAt: "2026-08-01T12:00:00.000Z", syncStatus: "idle" },
    snapshotCount: 0,
  }) === true,
  "a QuickBooks sync marks Data done",
);
assert(
  dataStepDone({ xero: null, qbo: null, snapshotCount: 1 }) === true,
  "a snapshot (upload) marks Data done",
);
assert(
  dataStepDone({
    xero: { lastSyncedAt: "2026-09-01T12:00:00.000Z", syncStatus: "error" },
    qbo: null,
    snapshotCount: 0,
  }) === false,
  "a failed sync with no snapshot does not mark Data done",
);

const freshLine = dataFreshnessLine({ xero: synced, qbo: null, snapshotPeriod: "Aug 2026" });
assert(freshLine.includes("Xero"), "freshness names Xero");
assert(freshLine.includes("Sep 2026"), "freshness keeps the period");
assert(freshLine.startsWith("Last sync"), "freshness leads with the last sync");
const snapLine = dataFreshnessLine({ xero: null, qbo: null, snapshotPeriod: "Aug 2026" });
assert(snapLine.includes("Aug 2026"), "a snapshot period stands in when nothing has synced");
const emptyLine = dataFreshnessLine({ xero: null, qbo: null, snapshotPeriod: null });
assert(emptyLine.includes("No sync yet"), "empty data says so");

assert(
  !existsSync(resolve("src/components/workflow-coach.tsx")),
  "reading path strip component is not in the client shell",
);

const studio = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
assert(
  !studio.includes("WorkflowCoachStrip"),
  "client shell does not mount the reading path strip",
);
assert(!studio.includes('aria-label="Reading path"'), "no reading path landmark in the shell");
assert(!studio.includes("data-workflow-coach"), "no reading path coach marker in the shell");
assert(!studio.includes("data-coach-continue"), "no Continue reading-path button in the shell");
assert(!studio.includes("WorkflowArrival"), "client shell does not mount the arrival bar");
assert(!studio.includes("You're here because"), "client shell has no duplicate landing line");
assert(!studio.includes("coachArrival"), "no per-deliverable arrival helper remains");
assert(studio.includes("<DataUpToDate"), "Client Brain opens with the data section");
assert(studio.includes("onOpenDeliverable"), "Milōn Bot can open a deliverable with intent");
assert(studio.includes('className="deliverable-rail"'), "left rail stays the one nav");
assert(studio.includes('{ id: "ask", label: "Bot"'), "left rail reaches Bot");
assert(studio.includes('{ id: "overview", label: "Overview"'), "left rail reaches Overview");
assert(
  studio.includes('{ id: "deliverables", label: "Deliverables"'),
  "left rail reaches Deliverables",
);
assert(studio.includes('{ id: "books", label: "Books" }'), "Overview sections reach Books");
assert(studio.includes('{ id: "health", label: "Health" }'), "Overview sections reach Health");
assert(studio.includes('{ id: "profit", label: "Profit" }'), "Overview sections reach Profit");
assert(studio.includes('{ id: "cash", label: "Cash" }'), "Overview sections reach Cash");
assert(studio.includes('{ id: "budget", label: "Budget" }'), "Overview sections reach Budget");
assert(
  studio.includes('{ id: "plan", label: "Action plan" }'),
  "Deliverables sections reach Actions",
);
assert(studio.includes("evidenceForPillar"), "weak pillars link to evidence");
assert(
  studio.includes("canonicalizeAccountantSearch"),
  "?tab= aliases still resolve before the studio paints",
);
assert(
  studio.includes('resolveAccountantTab(search) ?? "overview"'),
  "a deep link still selects its panel on first paint",
);
for (const step of COACH_STEPS) {
  assert(
    studio.includes(`"${step.tab}"`),
    `${step.label} still resolves to a studio tab (${step.tab})`,
  );
}

const dataSection = readFileSync(resolve("src/components/data-up-to-date.tsx"), "utf8");
assert(
  dataSection.includes("dataSectionStatus({ freshness, openKinds })"),
  "section title comes from the shared data status",
);
assert(
  dataSection.includes('<h2 className="data-fresh__title">{status.title}</h2>'),
  "section title",
);
assert(dataSection.includes("aria-label={status.title}"), "section title is the accessible name");
assert(
  dataSectionStatus({
    freshness: "Last sync · Xero · Sep 2026",
    openKinds: ["aged_debtors", "aged_creditors"],
  }).title === "Data up to date",
  "section title stays Data up to date when only ageing reports are open",
);
assert(
  dataSectionStatus({
    freshness: "Last sync · Xero · Sep 2026",
    openKinds: ["management_accounts"],
  }).title === "Data is not up to date",
  "section title leaves Data up to date when a statement is missing",
);
assert(dataSection.includes("XeroConnectCard"), "reuses the Xero connect card");
assert(dataSection.includes("QboConnectCard"), "reuses the QuickBooks connect card");
assert(dataSection.includes("Upload statements"), "upload CTA is on the data section");
assert(dataSection.includes("data-data-freshness"), "last sync line is marked");

const widget = readFileSync(resolve("src/lib/ask-ai.js"), "utf8");
assert(widget.includes("deliverableHandoff"), "bot answers offer the deliverable handoff");
assert(widget.includes("ask-ai-handoff"), "handoff is a button, not only prose");

const css = readFileSync(resolve("src/styles/accountant-portal.css"), "utf8");
assert(!css.includes("workflow-arrival"), "arrival bar styles are gone");
assert(!css.includes(".workflow-coach"), "reading path strip styles are gone");
assert(css.includes(".ask-ai-handoff{"), "bot handoff button keeps its styles");
assert(css.includes("color:#1b1300"), "handoff button uses dark text on gold");
assert(css.includes(".accountant-portal .data-fresh{"), "data section is styled");
assert(css.includes("#data-up-to-date"), "data section anchor still clears the top bar");
assert(!css.includes("scroll-margin-top:150px"), "scroll offset no longer reserves the strip");

console.log("workflow-coach-test: all assertions passed");
