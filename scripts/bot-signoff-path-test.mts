/**
 * Milōn Bot → Action Plan / pack sign-off. Route helpers only.
 * Run: pnpm test:bot-signoff-path
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  botSignoffCtas,
  botSignoffDestination,
  botSignoffHref,
  botSignoffStateLine,
} from "../src/lib/bot-signoff-path.ts";
import { normalizeAccountantClientTab } from "../src/lib/client-route-search.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const plan = botSignoffCtas({
  tools: [{ name: "propose_next_steps", status: "ok" }],
});
assert(plan.length === 1, "a proposed step is one CTA");
assert(plan[0].label === "Review Action Plan", `plan label, got ${plan[0].label}`);
assert(plan[0].tab === "plan" && plan[0].coach === "actions", "plan CTA opens Actions");
assert(plan[0].state.includes("approval"), "recommendations say they are waiting");

const href = botSignoffHref("client 1", plan[0], "Propose next steps from what's on file.");
const url = new URL(href, "https://milon.test");
assert(url.pathname === "/clients/client%201", "href keeps the client id");
assert(normalizeAccountantClientTab(url.searchParams.get("tab") ?? "") === "plan", "tab=plan survives the route alias");
assert(url.searchParams.get("coach") === "actions", "coach intent is actions");
assert(normalizeAccountantClientTab("actions") === "plan", "legacy ?tab=actions still opens the plan");

const tasks = botSignoffCtas({
  created: { items: [{ title: "Chase debtors" }], actionItemIds: ["a1"] },
});
assert(tasks.length === 1 && tasks[0].label === "Open for sign-off", "items open for sign-off");
assert(tasks[0].tab === "plan", "items land on the Action Plan");

const pack = botSignoffCtas({
  created: { packId: "p1", draftInserted: true },
  tools: [{ name: "draft_deliverable", status: "ok" }],
});
assert(pack.length === 1 && pack[0].tab === "advisory", "a pack opens advisory review");
assert(pack[0].label === "Open for sign-off", "pack CTA is sign-off");
assert(pack[0].coach === undefined, "pack does not reuse the actions coach");

const both = botSignoffCtas({
  created: { packId: "p1", items: [{ title: "Chase" }] },
  tools: [
    { name: "create_action_plan", status: "ok" },
    { name: "advisory_pack", status: "ok" },
  ],
});
assert(
  both.map((c) => `${c.label}@${c.tab}`).join("|") === "Review Action Plan@plan|Open for sign-off@advisory",
  `two surfaces, got ${both.map((c) => c.label).join("|")}`,
);
assert(botSignoffStateLine(both).includes("Action Plan") && botSignoffStateLine(both).includes("Advisory pack"), "state names both");

const human = botSignoffCtas({
  run: {
    trace: [{ tool: "create_task_from_recommendation", status: "needs_human", happened: false }],
  },
});
assert(human[0]?.label === "Review Action Plan" && human[0].state.includes("approval"), "needs-human stays on review");

const drafted = botSignoffCtas({
  run: { trace: [{ tool: "draft_deliverable", status: "ok", happened: true }] },
});
assert(drafted[0]?.tab === "advisory", "an objective that saved a draft opens the pack");

const openDraft = botSignoffCtas({ created: { draftAlreadyOpen: true, draftId: "d1" } });
assert(openDraft[0]?.tab === "advisory", "an already-open draft still offers sign-off");

assert(botSignoffCtas({ tools: [{ name: "answer_from_brain", status: "ok" }] }).length === 0, "a read is not sign-off work");
assert(botSignoffCtas({ tools: [{ name: "propose_next_steps", status: "empty" }] }).length === 0, "empty propose is not a CTA");
assert(botSignoffCtas({ tools: [{ name: "draft_deliverable", status: "error" }] }).length === 0, "a failed draft is not a CTA");
assert(botSignoffCtas({ created: { draftInserted: false, items: [], actionItemIds: [] } }).length === 0, "a create that wrote nothing is not a CTA");
assert(botSignoffCtas(null).length === 0, "missing evidence is not a CTA");

const clipped = botSignoffDestination(plan[0], "x".repeat(200));
assert(clipped.why && clipped.why.length <= 140 && clipped.why.endsWith("…"), "why is clipped for the route");
assert(clipped.tab === "plan" && clipped.coach === "actions", "destination keeps the plan route");

const widget = readFileSync(resolve("src/lib/ask-ai.js"), "utf8");
const studio = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
const portfolio = readFileSync(resolve("src/lib/portfolio.ts"), "utf8");
assert(widget.includes("botSignoffCtas"), "the bot panel asks for sign-off CTAs");
assert(widget.includes("dataset.signoff"), "the CTA is a button the thread can find");
assert(widget.includes("botSignoffDestination"), "the click uses the route helper");
assert(widget.includes("lastQuestion"), "the link keeps the question that produced the draft");
assert(widget.includes('err.role = "alert"'), "reply failures stay visible");
assert(studio.includes("data-ask-bot"), "Overview has a Bot entry");
assert(studio.includes("Ask Milōn Bot"), "the entry is labelled Ask Milōn Bot");
assert(studio.includes('selectRail("ask")'), "the entry opens the Bot tab for this client");
assert(studio.includes("data-bot-entry"), "the entry is marked");
assert(studio.includes("onOpenDeliverable"), "Bot still deep-links through the existing coach");
assert(
  portfolio.includes("waiting for your sign-off"),
  "dashboard pack sign-off rows stay",
);
assert(!studio.includes("trial-ended") || studio.includes("TrialEndedPlanBlock"), "paywall block is untouched");

console.log("bot-signoff-path-test: ok");
