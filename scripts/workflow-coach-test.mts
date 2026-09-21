/**
 * Accountant reading-path coach — step order and Continue targets.
 * Run: pnpm test:workflow-coach
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkflowArrival, WorkflowCoachStrip } from "../src/components/workflow-coach.tsx";
import {
  COACH_STEPS,
  coachPageForTab,
  coachView,
  deliverableHandoff,
  evidenceForPillar,
  nextCoachStep,
  pillarIsWeak,
} from "../src/lib/workflow-coach.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(
  COACH_STEPS.map((s) => s.label).join(" → ") ===
    "Health → Pillars → Profitability → Cash → Budget → Actions",
  "spine order",
);

const none = {};
assert(nextCoachStep("health", none)?.id === "pillars", "health continues to pillars");
assert(nextCoachStep("pillars", none)?.id === "profit", "pillars continue to profitability");
assert(nextCoachStep("profit", none)?.id === "cash", "profit continues to cash");
assert(nextCoachStep("cash", none)?.id === "budget", "cash continues to budget");
assert(nextCoachStep("budget", none)?.id === "actions", "budget continues to actions");
assert(nextCoachStep("actions", none) === null, "actions stays to assign");

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
assert(fromBot.because.includes("Milōn Bot asked"), "bot intent is on the landing line");
assert(fromBot.because.includes("gross margin"), "the question is kept");
assert(fromBot.because.includes("waterfall"), "margin intent explains the page");

const stale = coachView({ page: "cash", intent: "margin", why: "margin", done: none });
assert(!stale.because.includes("Milōn Bot asked"), "a margin intent does not stick on Cash");
assert(stale.because.includes("liquidity"), "cash uses its own reason");
assert(stale.cta === "Continue → Budget", `cash CTA, got ${stale.cta}`);

const overview = coachView({ page: null, done: { health: true } });
assert(overview.currentId === null, "overview highlights no step");
assert(
  overview.cta === "Continue → Pillars",
  `overview with a score continues to pillars, got ${overview.cta}`,
);

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
assert(
  deliverableHandoff("Draft an advisory pack from the brain") === null,
  "unrelated questions do not route",
);

const arrivalHtml = renderToStaticMarkup(
  createElement(WorkflowArrival, {
    page: "profit",
    intent: "margin",
    why: "What's our gross margin?",
    done: none,
    onOpen: () => {},
  }),
);
assert(arrivalHtml.includes("here because"), "arrival says why you are here");
assert(arrivalHtml.includes("Next:"), "arrival names what is next");
assert(arrivalHtml.includes("Continue → Cash"), `arrival CTA, got ${arrivalHtml}`);
assert(arrivalHtml.includes("data-coach-continue"), "arrival has the primary continue control");

const stripHtml = renderToStaticMarkup(
  createElement(WorkflowCoachStrip, {
    page: "profit",
    done: none,
    onOpen: () => {},
  }),
);
assert(stripHtml.includes("Reading path"), "strip names the reading path");
assert(stripHtml.includes('data-current="true"'), "current step is highlighted");
assert(stripHtml.includes("Profitability"), "profit step is on the spine");
assert(stripHtml.includes("Continue → Cash"), "strip continue matches the arrival");

const studio = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
assert(studio.includes("<WorkflowCoachStrip"), "client shell mounts the sticky coach");
assert(studio.includes("onOpenDeliverable"), "Milōn Bot can open a deliverable with intent");
assert(studio.includes('className="deliverable-rail"'), "left rail stays");
assert(studio.includes("evidenceForPillar"), "weak pillars link to evidence");

const widget = readFileSync(resolve("src/lib/ask-ai.js"), "utf8");
assert(widget.includes("deliverableHandoff"), "bot answers offer the deliverable handoff");
assert(widget.includes("ask-ai-handoff"), "handoff is a button, not only prose");

const css = readFileSync(resolve("src/styles/accountant-portal.css"), "utf8");
assert(css.includes("color:#1b1608"), "coach copy is dark text");
assert(css.includes("background:#fffdf6"), "coach sits on a light surface");
assert(css.includes("color:#1b1300"), "continue button uses dark text on gold");

console.log("workflow-coach-test: all assertions passed");
