/**
 * Accountant reading-path coach — step order and Continue targets.
 * Run: pnpm test:workflow-coach
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkflowCoachStrip } from "../src/components/workflow-coach.tsx";
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
  COACH_STEPS[0].id === "data" && COACH_STEPS[0].tab === "summary",
  "data lands on Client Brain",
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
  fromData.destination.tab === "ratios" && fromData.destination.focus === "health",
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
assert(freshOverview.destination.tab === "summary", "overview continue opens Client Brain");

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
assert(pillarIsWeak(65) === false, "65 is healthy");
assert(pillarIsWeak(Number.NaN) === false, "missing pillar is not a false weak");
const cashEvidence = evidenceForPillar("cash");
assert(cashEvidence?.tab === "cash" && cashEvidence.coach === "liquidity", "liquidity → cash");
const marginEvidence = evidenceForPillar("profit");
assert(
  marginEvidence?.tab === "profit" && marginEvidence.coach === "margin",
  "margin → profitability",
);

const margin = deliverableHandoff("What's our gross margin versus peers?");
assert(margin?.tab === "profit" && margin.coach === "margin", "bot routes margin to profitability");
assert(margin?.why.includes("gross margin"), "handoff keeps the question");
const cashQ = deliverableHandoff("Will the 13-week cash forecast go negative?");
assert(cashQ?.tab === "cash" && cashQ.coach === "liquidity", "bot routes cash to the forecast");
const drag = deliverableHandoff("What's the biggest drag on this client's score vs peers?");
assert(drag?.tab === "ratios" && drag.focus === "pillars", "a drag question opens pillars");
const healthQ = deliverableHandoff("What's the health score?");
assert(
  healthQ?.tab === "ratios" && healthQ.focus === "health",
  "a health question still opens Health",
);
const syncQ = deliverableHandoff("Has Xero synced this period?");
assert(
  syncQ?.tab === "summary" && syncQ.coach === "data" && syncQ.label === "Open Data",
  "bot routes sync to Data",
);
const uploadQ = deliverableHandoff("Can we upload the statements?");
assert(uploadQ?.tab === "summary" && uploadQ.coach === "data", "bot routes an upload to Data");
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

const stripHtml = renderToStaticMarkup(
  createElement(WorkflowCoachStrip, {
    page: "data",
    done: { data: true },
    onOpen: () => {},
  }),
);
assert(stripHtml.includes("Reading path"), "strip names the reading path");
assert(stripHtml.includes('data-current="true"'), "current step is highlighted");
assert(stripHtml.includes("Data"), "data is the first step on the strip");
assert(stripHtml.includes("Continue → Health"), "strip continue goes to Health");
assert((stripHtml.match(/data-coach-continue/g) ?? []).length === 1, "the strip has one Continue");
assert(!stripHtml.includes("here because"), "the strip does not repeat the landing line");
assert(!stripHtml.includes("data-coach-arrival"), "the strip is not the old arrival bar");

const coachUi = readFileSync(resolve("src/components/workflow-coach.tsx"), "utf8");
assert(!coachUi.includes("WorkflowArrival"), "arrival bar component is gone");
assert(!coachUi.includes("You're here because"), "arrival copy is gone");

const studio = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
assert(studio.includes("<WorkflowCoachStrip"), "client shell mounts the sticky coach");
assert(!studio.includes("WorkflowArrival"), "client shell does not mount the arrival bar");
assert(!studio.includes("You're here because"), "client shell has no duplicate landing line");
assert(!studio.includes("coachArrival"), "no per-deliverable arrival helper remains");
assert(studio.includes("<DataUpToDate"), "Client Brain opens with the data section");
assert(studio.includes("dataStepDone"), "Data done follows sync or snapshot");
assert(studio.includes("onOpenDeliverable"), "Milōn Bot can open a deliverable with intent");
assert(studio.includes('className="deliverable-rail"'), "left rail stays");
assert(studio.includes("evidenceForPillar"), "weak pillars link to evidence");

const dataSection = readFileSync(resolve("src/components/data-up-to-date.tsx"), "utf8");
assert(dataSection.includes("Data up to date"), "section title");
assert(dataSection.includes("XeroConnectCard"), "reuses the Xero connect card");
assert(dataSection.includes("QboConnectCard"), "reuses the QuickBooks connect card");
assert(dataSection.includes("Upload statements"), "upload CTA is on the data section");
assert(dataSection.includes("data-data-freshness"), "last sync line is marked");

const widget = readFileSync(resolve("src/lib/ask-ai.js"), "utf8");
assert(widget.includes("deliverableHandoff"), "bot answers offer the deliverable handoff");
assert(widget.includes("ask-ai-handoff"), "handoff is a button, not only prose");

const css = readFileSync(resolve("src/styles/accountant-portal.css"), "utf8");
assert(!css.includes("workflow-arrival"), "arrival bar styles are gone");
assert(css.includes(".accountant-portal .workflow-coach{"), "sticky strip styles stay");
assert(css.includes("color:#1b1608"), "coach copy is dark text");
assert(css.includes("background:#fffdf6"), "coach sits on a light surface");
assert(css.includes("color:#1b1300"), "continue button uses dark text on gold");
assert(css.includes(".accountant-portal .data-fresh{"), "data section is styled");
assert(css.includes("#data-up-to-date"), "data section can scroll under the sticky strip");

console.log("workflow-coach-test: all assertions passed");
