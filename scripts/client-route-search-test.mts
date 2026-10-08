/**
 * Accountant client search. Every old ?tab= value and alias lands on the
 * canonical rail tab + section. Run: pnpm test:client-route-search
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  accountantClientTabSearch,
  canonicalizeAccountantSearch,
  type CanonicalClientSearch,
} from "../src/lib/client-route-search";
import { STRATEGIC_MOVE_CATALOG, rankStrategicMoves } from "../src/lib/strategic-moves";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function lands(
  tab: string,
  expected: CanonicalClientSearch,
  msg: string,
  extra?: { section?: string; focus?: string },
) {
  const got = canonicalizeAccountantSearch({ tab, ...extra });
  assert(got.tab === expected.tab, `${msg}: tab ${got.tab}`);
  assert(got.section === expected.section, `${msg}: section ${got.section ?? "(none)"}`);
  assert(got.focus === expected.focus, `${msg}: focus ${got.focus ?? "(none)"}`);
  const again = canonicalizeAccountantSearch(got);
  assert(
    again.tab === got.tab && again.section === got.section && again.focus === got.focus,
    `${msg}: rewrite is idempotent`,
  );
}

lands("ask", { tab: "ask" }, "?tab=ask is Bot");
lands("bot", { tab: "ask" }, "?tab=bot opens Bot");
lands("milon-bot", { tab: "ask" }, "?tab=milon-bot opens Bot");
lands("overview", { tab: "overview" }, "?tab=overview is the briefing");
assert(
  canonicalizeAccountantSearch({}).tab === "overview" &&
    canonicalizeAccountantSearch({}).section === undefined,
  "an omitted tab is the Overview briefing",
);

lands(
  "ratios",
  { tab: "overview", section: "health", focus: "health" },
  "?tab=ratios opens Health",
);
lands(
  "health",
  { tab: "overview", section: "health", focus: "health" },
  "?tab=health opens Health",
);
lands("today", { tab: "overview", section: "health", focus: "health" }, "?tab=today opens Health");
lands(
  "today-complex",
  { tab: "overview", section: "health", focus: "health" },
  "?tab=today-complex opens Health",
);
lands(
  "ratios",
  { tab: "overview", section: "pillars", focus: "pillars" },
  "?tab=ratios&focus=pillars opens Pillars",
  { focus: "pillars" },
);
lands(
  "pillars",
  { tab: "overview", section: "pillars", focus: "pillars" },
  "?tab=pillars opens Pillars",
);

lands("profit", { tab: "overview", section: "profit" }, "?tab=profit opens Profit");
lands("waterfall", { tab: "overview", section: "profit" }, "?tab=waterfall opens Profit");
lands("profitability", { tab: "overview", section: "profit" }, "?tab=profitability opens Profit");
lands("cash", { tab: "overview", section: "cash" }, "?tab=cash opens Cash");
lands("forecast", { tab: "overview", section: "cash" }, "?tab=forecast opens Cash");
lands("cash-forecast", { tab: "overview", section: "cash" }, "?tab=cash-forecast opens Cash");
lands(
  "collections",
  { tab: "overview", section: "collections" },
  "?tab=collections opens Collections",
);
lands("payables", { tab: "overview", section: "payables" }, "?tab=payables opens Payables");
lands("budget", { tab: "overview", section: "budget" }, "?tab=budget opens Budget");

lands("summary", { tab: "overview", section: "books" }, "?tab=summary opens Books");
lands("data", { tab: "overview", section: "books" }, "?tab=data opens Books");
lands("brain", { tab: "overview", section: "books" }, "?tab=brain opens Books");
lands("client-brain", { tab: "overview", section: "books" }, "?tab=client-brain opens Books");
lands("moves", { tab: "overview", section: "moves" }, "?tab=moves opens Moves");
lands("strategic-moves", { tab: "overview", section: "moves" }, "?tab=strategic-moves opens Moves");

lands("reports", { tab: "deliverables", section: "reports" }, "?tab=reports opens Reports");
lands("report", { tab: "deliverables", section: "reports" }, "?tab=report opens Reports");
lands("advisory", { tab: "deliverables", section: "pack" }, "?tab=advisory opens the pack");
lands("plan", { tab: "deliverables", section: "plan" }, "?tab=plan opens Action Plan");
lands("actions", { tab: "deliverables", section: "plan" }, "?tab=actions opens Action Plan");
lands("action", { tab: "deliverables", section: "plan" }, "?tab=action opens Action Plan");
lands(
  "action-plan",
  { tab: "deliverables", section: "plan" },
  "?tab=action-plan opens Action Plan",
);
lands("tasks", { tab: "deliverables", section: "plan" }, "?tab=tasks opens Action Plan");

lands("overview", { tab: "overview", section: "cash" }, "canonical cash stays cash", {
  section: "cash",
});
lands("deliverables", { tab: "deliverables", section: "pack" }, "canonical pack stays pack", {
  section: "pack",
});
lands(
  "overview",
  { tab: "overview", section: "pillars", focus: "pillars" },
  "canonical pillars keep focus",
  { section: "pillars" },
);

const kept = accountantClientTabSearch(
  {
    tab: "plan",
    onboard: "1",
    report: "movement",
    action: "preview",
    filter: "overdue",
    qbo: "connected",
  },
  "reports",
);
assert(
  kept.tab === "deliverables" && kept.section === "reports",
  "opening Reports is deliverables/reports",
);
assert(kept.onboard === "1" && kept.qbo === "connected", "onboard and unrelated params stay");
assert(
  kept.report === "movement" && kept.action === "preview",
  "report and action stay on Reports",
);
assert(!("filter" in kept), "an Action Plan filter does not stick to Reports");

const plan = accountantClientTabSearch({ tab: "reports", filter: "overdue" }, "plan");
assert(
  plan.tab === "deliverables" && plan.section === "plan",
  "opening the plan keeps the plan section",
);
assert(plan.filter === "overdue", "opening Action Plan keeps an overdue filter");

const route =
  readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8") +
  readFileSync(resolve("src/components/client-studio-chrome.tsx"), "utf8");
const parser = route.slice(
  route.indexOf("validateSearch:"),
  route.indexOf("component: ClientView"),
);
assert(parser.includes("canonicalizeAccountantSearch"), "alias runs inside validateSearch");
assert(parser.includes("out.section = canonical.section"), "section is written onto the search");
assert(
  route.includes('resolveAccountantTab(search) ?? "overview"'),
  "the first paint uses the parsed tab and section",
);
assert(route.includes('{ id: "ask", label: "Bot"'), "Bot is a rail item");
assert(route.includes('{ id: "overview", label: "Overview"'), "Overview is a rail item");
assert(
  route.includes('{ id: "deliverables", label: "Deliverables"'),
  "Deliverables is a rail item",
);
assert(route.includes("aria-label={label}"), "section strip is a named tablist");
const overviewStrip = route.slice(
  route.indexOf("const OVERVIEW_SECTION_TABS"),
  route.indexOf("const DELIVERABLE_SECTION_TABS"),
);
const overviewOrder = [
  "health",
  "pillars",
  "cash",
  "profit",
  "collections",
  "payables",
  "budget",
  "moves",
  "books",
];
let overviewAt = -1;
for (const id of overviewOrder) {
  const at = overviewStrip.indexOf(`id: "${id}"`);
  assert(at > overviewAt, `Overview section ${id} is in order`);
  overviewAt = at;
}
const deliverableStrip = route.slice(
  route.indexOf("const DELIVERABLE_SECTION_TABS"),
  route.indexOf("function railGroup"),
);
const deliverableOrder = ["reports", "pack", "plan"];
let deliverableAt = -1;
for (const id of deliverableOrder) {
  const at = deliverableStrip.indexOf(`id: "${id}"`);
  assert(at > deliverableAt, `Deliverables section ${id} is in order`);
  deliverableAt = at;
}
assert(route.includes('id: "pack", label: "Advisory pack"'), "Deliverables keeps the stacked pack");
assert(route.includes('id="pane-moves"'), "Moves has its own pane");
assert(route.includes("StrategicMovesPanel"), "Moves pane shows Strategic Moves");
assert(route.includes("rankStrategicMoves"), "Moves and Action Plan share the ranked list");
assert(route.includes('id="ask-ai-accountant"'), "Bot mount stays on the ask pane");
assert(!route.includes("WorkflowCoachStrip"), "the section strip is not the old reading path");
assert(!route.includes('aria-label="Reading path"'), "no reading-path landmark");

const app = readFileSync(resolve("src/routes/app.tsx"), "utf8");
assert(app.includes("rankStrategicMoves"), "owner next moves use the shared ranker");
for (const entry of STRATEGIC_MOVE_CATALOG) {
  assert(app.includes(entry.title), `playbook still contains the ${entry.key} move`);
}
const ranked = rankStrategicMoves({
  healthByKey: { grossMargin: 20, operatingMargin: 90 },
  limit: 2,
  entries: STRATEGIC_MOVE_CATALOG.filter(
    (entry) => entry.key === "grossMargin" || entry.key === "operatingMargin",
  ),
});
assert(ranked[0]?.key === "grossMargin", "weaker health ranks above a healthy lever");
assert(ranked.length === 2, "ranker keeps one row per move");

console.log("client-route-search-test: all assertions passed");
