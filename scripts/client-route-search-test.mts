/**
 * Accountant client search. Every old ?tab= value and alias lands on the
 * canonical rail tab + section. Run: pnpm test:client-route-search
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  accountantClientTabSearch,
  accountantValidatedSearch,
  canonicalizeAccountantSearch,
  clientNavSearch,
  clientRailSelection,
  drafterSectionForHash,
  legacyHashDestination,
  railSearchForHash,
  routerHash,
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

lands("ask", { tab: "home" }, "?tab=ask opens Home");
lands("bot", { tab: "home" }, "?tab=bot opens Home");
lands("milon-bot", { tab: "home" }, "?tab=milon-bot opens Home");
lands("desk", { tab: "home" }, "?tab=desk opens Home");
lands("overview", { tab: "home" }, "?tab=overview opens Home");
assert(
  canonicalizeAccountantSearch({}).tab === "home" &&
    canonicalizeAccountantSearch({}).section === undefined,
  "an omitted tab is Home",
);

lands("ratios", { tab: "health", focus: "health" }, "?tab=ratios opens Health");
lands("health", { tab: "health", focus: "health" }, "?tab=health opens Health");
lands("today", { tab: "health", focus: "health" }, "?tab=today opens Health");
lands("today-complex", { tab: "health", focus: "health" }, "?tab=today-complex opens Health");
lands(
  "ratios",
  { tab: "health", section: "pillars", focus: "pillars" },
  "?tab=ratios&focus=pillars opens Pillars",
  { focus: "pillars" },
);
lands(
  "pillars",
  { tab: "health", section: "pillars", focus: "pillars" },
  "?tab=pillars opens Pillars",
);

lands("profit", { tab: "profit" }, "?tab=profit opens Profit");
lands("waterfall", { tab: "profit" }, "?tab=waterfall opens Profit");
lands("profitability", { tab: "profit" }, "?tab=profitability opens Profit");
lands("cash", { tab: "cash" }, "?tab=cash opens Cash flow");
lands("forecast", { tab: "cash" }, "?tab=forecast opens Cash flow");
lands("cash-forecast", { tab: "cash" }, "?tab=cash-forecast opens Cash flow");
lands(
  "collections",
  { tab: "cash", section: "collections" },
  "?tab=collections opens Cash flow collections",
);
lands("payables", { tab: "cash", section: "payables" }, "?tab=payables opens Cash flow payables");
lands("budget", { tab: "budget" }, "?tab=budget opens Budget");

lands("summary", { tab: "portal" }, "?tab=summary opens Client portal");
lands("data", { tab: "portal" }, "?tab=data opens Client portal");
lands("brain", { tab: "portal" }, "?tab=brain opens Client portal");
lands("client-brain", { tab: "portal" }, "?tab=client-brain opens Client portal");
lands("moves", { tab: "moves" }, "?tab=moves opens Next moves");
lands("strategic-moves", { tab: "moves" }, "?tab=strategic-moves opens Next moves");

lands("reports", { tab: "reports" }, "?tab=reports opens Reports");
lands("report", { tab: "reports" }, "?tab=report opens Reports");
lands("advisory", { tab: "reports", section: "drafts" }, "?tab=advisory opens Reports drafts");
lands("pack", { tab: "reports", section: "drafts" }, "?tab=pack opens Reports drafts");
lands("drafter", { tab: "reports", section: "drafts" }, "?tab=drafter opens Reports drafts");
lands("reports", { tab: "plan" }, "?tab=reports&section=plan opens Action plan", { section: "plan" });

function routerSearch(raw: Record<string, unknown>) {
  return { ...raw, ...accountantValidatedSearch(raw) };
}
const planAlias = routerSearch({ tab: "reports", section: "plan", report: "scorecard", action: "preview" });
assert(planAlias.tab === "plan", "the plan alias tab is plan");
assert(planAlias.section === undefined, "the plan alias drops section=plan");
assert(planAlias.report === undefined && planAlias.action === undefined, "a report link does not stick to Action plan");
const draftsAlias = routerSearch({ tab: "advisory" });
assert(
  draftsAlias.tab === "reports" && draftsAlias.section === "drafts",
  "advisory still opens Reports drafts",
);
const reportLink = routerSearch({
  tab: "reports",
  section: "drafts",
  report: "scorecard",
  action: "preview",
  filter: "overdue",
});
assert(reportLink.section === "drafts" && reportLink.report === "scorecard", "a Reports deep link stays on Drafts");
assert(reportLink.action === "preview", "preview stays on Reports");
assert(reportLink.filter === undefined, "an Action Plan filter does not stay on Reports");
const planFilter = routerSearch({ tab: "reports", section: "plan", filter: "overdue" });
assert(planFilter.tab === "plan" && planFilter.filter === "overdue", "an overdue filter stays once the alias is Action plan");
const bareReport = routerSearch({ report: "scorecard", action: "download" });
assert(bareReport.report === "scorecard" && bareReport.action === "download", "a report param with no tab is kept");
assert(!("section" in bareReport), "a report param with no tab does not invent a section");
lands("plan", { tab: "plan" }, "?tab=plan opens Action Plan");
lands("actions", { tab: "plan" }, "?tab=actions opens Action Plan");
lands("action", { tab: "plan" }, "?tab=action opens Action Plan");
lands("action-plan", { tab: "plan" }, "?tab=action-plan opens Action Plan");
lands("tasks", { tab: "plan" }, "?tab=tasks opens Action Plan");
lands("deliverables", { tab: "plan" }, "Deliverables plan section opens Action Plan", {
  section: "plan",
});

lands("overview", { tab: "cash" }, "old overview cash opens Cash flow", {
  section: "cash",
});
assert(
  canonicalizeAccountantSearch({ section: "pack" }).tab === "reports" &&
    canonicalizeAccountantSearch({ section: "pack" }).section === "drafts",
  "?section=pack opens Reports drafts",
);
assert(
  canonicalizeAccountantSearch({ tab: "overview", section: "pack" }).section === "drafts" &&
    canonicalizeAccountantSearch({ tab: "overview", section: "pack" }).tab === "reports",
  "the overview default does not swallow section=pack",
);
assert(
  canonicalizeAccountantSearch({ section: "advisory" }).section === "drafts",
  "?section=advisory opens Reports drafts",
);
assert(
  canonicalizeAccountantSearch({ section: "cash" }).tab === "cash" &&
    canonicalizeAccountantSearch({ section: "cash" }).section === undefined,
  "?section=cash opens Cash flow",
);
assert(
  canonicalizeAccountantSearch({ section: "budget" }).tab === "budget",
  "?section=budget opens Budget",
);
assert(
  canonicalizeAccountantSearch({ tab: "home", section: "pack" }).tab === "home" &&
    canonicalizeAccountantSearch({ tab: "home", section: "pack" }).section === undefined,
  "an explicit Home tab wins over section=pack",
);
assert(
  canonicalizeAccountantSearch({ tab: "ask", section: "pack" }).tab === "home" &&
    canonicalizeAccountantSearch({ tab: "ask", section: "pack" }).section === undefined,
  "an explicit Ask tab lands on Home",
);
assert(
  canonicalizeAccountantSearch({ tab: "deliverables", section: "reports" }).tab === "reports" &&
    canonicalizeAccountantSearch({ tab: "deliverables", section: "reports" }).section === undefined,
  "a reports section on Deliverables opens Reports",
);
assert(
  railSearchForHash("#cash")?.tab === "cash" && railSearchForHash("#cash")?.section === undefined,
  "#cash opens Cash flow",
);
assert(
  railSearchForHash("#budget")?.tab === "budget" && railSearchForHash("#budget")?.section === undefined,
  "#budget opens Budget",
);
assert(
  railSearchForHash("#advisory")?.tab === "reports" &&
    railSearchForHash("#advisory")?.section === "drafts",
  "#advisory opens Reports drafts",
);
assert(
  legacyHashDestination({ tab: "ask" }, "#budget") === null,
  "an explicit Bot tab wins over #budget",
);
assert(
  legacyHashDestination({ tab: "overview" }, "#advisory") === null,
  "an explicit Overview tab wins over #advisory",
);
assert(
  legacyHashDestination({}, "#budget")?.tab === "budget",
  "a bare #budget opens Budget",
);
assert(
  legacyHashDestination({ tab: "home" }, "#budget") === null,
  "an explicit Home tab wins over #budget",
);
assert(
  legacyHashDestination({ tab: "deliverables", section: "pack" }, "#drafter")?.section === "drafts",
  "pack#drafter scrolls to Drafts",
);
lands("deliverables", { tab: "reports", section: "drafts" }, "a bare Deliverables tab opens Reports drafts");
lands(
  "overview",
  { tab: "health", section: "pillars", focus: "pillars" },
  "canonical pillars keep focus on Health",
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
assert(kept.tab === "reports" && kept.section === undefined, "opening Reports is the Reports item");
assert(kept.onboard === "1" && kept.qbo === "connected", "onboard and unrelated params stay");
assert(
  kept.report === "movement" && kept.action === "preview",
  "report and action stay on Reports",
);
assert(!("filter" in kept), "an Action Plan filter does not stick to Reports");

const plan = accountantClientTabSearch({ tab: "reports", filter: "overdue" }, "plan");
assert(plan.tab === "plan" && plan.section === undefined, "opening the plan is the plan rail item");
assert(plan.filter === "overdue", "opening Action Plan keeps an overdue filter");
const planRail = clientRailSelection({ tab: "plan", filter: "overdue" });
assert(
  planRail.headingId === "plan" && planRail.subId === "overdue",
  "an overdue plan link marks the Overdue sub-item",
);
const oldPlan = clientRailSelection({ tab: "deliverables", section: "plan" });
assert(oldPlan.headingId === "plan" && oldPlan.subId === "open", "the old plan section marks Action plan");

const route =
  readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8") +
  readFileSync(resolve("src/components/client-studio-chrome.tsx"), "utf8");
assert(
  route.includes("validateSearch: accountantClientRouteSearch"),
  "the client route validates search through the shared parser",
);
const searchSrc = readFileSync(resolve("src/lib/client-route-search.ts"), "utf8");
assert(
  searchSrc.includes("Object.assign(out, accountantValidatedSearch(search))"),
  "alias runs inside validateSearch",
);
assert(
  searchSrc.includes("out.section = canonical.section"),
  "an absent section is written as undefined so the router drops it",
);
assert(
  route.includes('resolveAccountantTab(search) ?? "overview"'),
  "the first paint uses the parsed tab and section",
);
const railSource = readFileSync(resolve("src/components/client-studio-chrome.tsx"), "utf8");
const railOrder = ["home", "health", "cash", "profit", "budget", "moves", "plan", "reports", "books"];
let railAt = -1;
for (const id of railOrder) {
  const at = railSource.indexOf(`id: "${id}"`);
  assert(at > railAt, `rail item ${id} is in order`);
  railAt = at;
}
assert(route.includes('label: "Team"'), "Team is a rail kicker");
assert(route.includes('label: "Numbers"'), "Numbers is a rail kicker");
assert(route.includes('label: "Work"'), "Work is a rail kicker");
assert(route.includes('label: "File"'), "File is a rail kicker");
assert(route.includes('{ id: "home", label: "Home" }'), "Home is a rail item");
assert(route.includes('label: "Action plan"'), "Action plan is a rail item");
assert(route.includes('label: "Books"'), "Books is a rail item");
const drafts = clientNavSearch({ tab: "home" }, "reports", "drafts");
assert(drafts.tab === "reports" && drafts.section === "drafts", "Drafts opens Reports drafts");
const draftsRail = clientRailSelection({ tab: "reports", section: "drafts" });
assert(
  draftsRail.headingId === "reports" && draftsRail.subId === "drafts",
  "Drafts is the Reports sub-item",
);
const sent = clientRailSelection({ tab: "reports", section: "sent" });
assert(sent.headingId === "reports" && sent.subId === "sent", "Sent stays under Reports");
const scorecard = clientRailSelection({ tab: "reports", report: "scorecard" });
assert(scorecard.subId === "scorecard", "the health scorecard is the Reports sub-item");
assert(!route.includes("<SectionTabList"), "the horizontal section row is gone");
assert(routerHash("#drafter") === "drafter", "a single hash is not doubled");
assert(routerHash("##drafter") === "drafter", "a doubled hash is collapsed");
assert(routerHash("") === undefined, "an empty hash is omitted");
assert(drafterSectionForHash("pack", "##drafter") === "drafts", "a doubled drafter hash opens Drafts");
assert(drafterSectionForHash("pack", "#drafter") === "drafts", "pack#drafter opens Drafts");
assert(drafterSectionForHash("pack", "#sent-history") === "sent", "sent history hash opens Sent");
assert(drafterSectionForHash("drafter", "#drafter") === null, "a drafter hash stays on Drafts");
assert(drafterSectionForHash("sent", "#sent") === null, "a sent hash stays on Sent");
assert(drafterSectionForHash("reports", "#nope") === null, "other hashes stay put");
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
