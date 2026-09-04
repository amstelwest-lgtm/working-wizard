/**
 * Action Plan tab: chunk/render failures must not white-screen /app.
 * Run: pnpm test:action-plan-tab
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ActionPlan, {
  allocateActionSeqs,
  buildStrategicMoveImportRows,
  chaseEmailType,
  chaseableItems,
  driverHealthLabel,
  healthMeta,
  parseActionPlanFilter,
  toActionItemWrite,
} from "../src/components/action-plan";
import { lazyPanel, TabErrorBoundary } from "../src/components/lazy-panel";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(typeof ActionPlan === "function", "action-plan default export loads");
assert(typeof lazyPanel === "function", "lazyPanel export");
assert(typeof TabErrorBoundary.getDerivedStateFromError === "function", "error boundary hook");

const derived = TabErrorBoundary.getDerivedStateFromError(new Error("boom"));
assert(derived.error instanceof Error && derived.error.message === "boom", "boundary captures error");

assert(driverHealthLabel(67.4) === 67, "finite health rounds");
assert(driverHealthLabel(Number.NaN) === null, "NaN health is blank, not a crash");
assert(driverHealthLabel(Number.POSITIVE_INFINITY) === null, "Infinity health is blank");
assert(healthMeta("at_risk").label === "At risk", "known health");
assert(healthMeta("nope").label === "On track", "unknown health falls back");
assert(healthMeta(undefined).label === "On track", "missing health falls back");

const appSrc = readFileSync(resolve("src/routes/app.tsx"), "utf8");
assert(appSrc.includes('lazyPanel(() => import("@/components/action-plan")'), "founder board uses lazyPanel");
assert(appSrc.includes('void import("@/components/action-plan")'), "founder board preloads Action Plan chunk");
assert(appSrc.includes('<TabErrorBoundary label="Action Plan">'), "founder board wraps Action Plan");
assert(appSrc.includes('<TabErrorBoundary label="Cash Forecast">'), "founder board wraps Cash Forecast");
assert(appSrc.includes('<TabErrorBoundary label="Budget">'), "founder board wraps Budget");
assert(
  appSrc.includes('["today", "cash", "budget", "next"].includes(activeTab)'),
  "owner view-mode toggle only renders on tabs that actually change",
);
{
  const toggleGate = appSrc.match(/\[["']today["'],\s*["']cash["'],\s*["']budget["'],\s*["']next["']\]\.includes\(activeTab\)/);
  assert(!!toggleGate, "view-mode toggle gate lists Health, Cash, Budget, Next moves");
  assert(!toggleGate![0].includes("waterfall"), "Profit tab is not in the view-mode toggle gate");
  assert(!toggleGate![0].includes("tasks"), "Action Plan tab is not in the view-mode toggle gate");
}

const clientSrc = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
assert(clientSrc.includes('lazyPanel(() => import("@/components/action-plan")'), "client board uses lazyPanel");
assert(clientSrc.includes('<TabErrorBoundary label="Action Plan">'), "client board wraps Action Plan");
assert(!clientSrc.includes('label: "Staff tasks"'), "accountant portal no longer has a Staff tasks tab");
assert(!clientSrc.includes("TasksPanel"), "accountant portal no longer mounts the staff tasks panel");
assert(clientSrc.includes('if (tab === "tasks") return "plan"'), "old staff-tasks links open Action Plan");
assert(
  !clientSrc.includes('["today", "cash", "budget", "next"].includes(activeTab)'),
  "accountant portal view-mode toggle is not gated by owner-board tabs",
);
assert(
  clientSrc.includes('{activeTab === "plan" && ('),
  "accountant remounts Action Plan when the tab is opened so owner edits are not stale",
);
assert(
  !/id="pane-plan"[\s\S]{0,1200}className="dark"/.test(clientSrc),
  "accountant Action Plan is not forced into a Tailwind dark island (light-mode copy would vanish)",
);

const portalCss = readFileSync(resolve("src/styles/accountant-portal.css"), "utf8");
assert(
  portalCss.includes(".accountant-portal #wizard-action-plan"),
  "portal isolates Action Plan --card from glass token",
);
assert(
  portalCss.includes("html.dark .accountant-portal #wizard-action-plan"),
  "dark portal still gives Action Plan a solid navy card token",
);

const wizardSrc = readFileSync(resolve("src/components/walkthrough-wizard.tsx"), "utf8");
assert(wizardSrc.includes("if (!s) return"), "walkthrough guards missing steps");

assert(JSON.stringify(allocateActionSeqs([], 3)) === "[1,2,3]", "empty plan starts at seq 1");
assert(JSON.stringify(allocateActionSeqs([{ seq: 2 }, { seq: 5 }], 2)) === "[6,7]", "bulk seqs continue past current max");
assert(allocateActionSeqs([{ seq: 1 }], 0).length === 0, "zero count allocates nothing");
{
  const seqs = allocateActionSeqs([{ seq: 4 }], 4);
  assert(new Set(seqs).size === 4, "allocated seqs are unique");
}

const moves = [
  { key: "cash", title: "Collect receivables", ratioName: "Cash", impactLine: "Frees cash.", health: 40 },
  { key: "gp", title: "Raise prices", ratioName: "Gross profit", health: 55 },
];
const bulk = buildStrategicMoveImportRows({
  keys: ["cash", "gp", "cash", "unknown"],
  moves,
  alreadyImported: new Set(["gp"]),
  planId: "plan-1",
  clientId: "client-1",
  existing: [{ seq: 3 }],
});
assert(bulk.length === 1, "skips already-imported, unknown, and duplicate keys");
assert(bulk[0].seq === 4 && bulk[0].source_move_key === "cash", "imported row gets next unique seq");
assert(bulk[0].source === "strategic_move", "imported rows are tagged as strategic moves");

const two = buildStrategicMoveImportRows({
  keys: ["cash", "gp"],
  moves,
  alreadyImported: new Set(),
  planId: "plan-1",
  clientId: "client-1",
  existing: [],
});
assert(two.length === 2 && two[0].seq === 1 && two[1].seq === 2, "multi-import assigns consecutive unique seqs");
assert(two[0].seq !== two[1].seq, "two imported rows never share seq");

const planSrc = readFileSync(resolve("src/components/action-plan.tsx"), "utf8");
assert(planSrc.includes("buildStrategicMoveImportRows"), "import uses unique-seq row builder");
assert(!/for \(const k of keys\)[\s\S]{0,200}await addItem/.test(planSrc), "import does not loop addItem with a stale seq");
assert(planSrc.includes("Team members"), "Action Plan has a team members control");
assert(planSrc.includes("function TeamPanel"), "team list panel exists");
assert(/All owners[\s\S]{0,800}Team members/.test(planSrc), "team list sits next to the owner filter");
assert(planSrc.includes("onManageTeam"), "owner picker can open the team list");
assert(
  /onClick=\{\(e\) => \{\s*e\.stopPropagation\(\);\s*setAdding\(true\);/.test(planSrc),
  "Add employee does not open the task drawer",
);
assert(planSrc.includes("onClick={pickOwner ? undefined : onOpen}"), "row click is disabled while the owner picker is open");
assert(planSrc.includes("toActionItemWrite(patch)"), "owner patches strip view-only columns before writing");
assert(planSrc.includes("toActionItemWrite(extra ?? {})"), "inserts also strip view-only columns");
assert(planSrc.includes("visibilitychange"), "plan refetches when the window is focused again");
assert(planSrc.includes("The other side may have created the active plan first"), "concurrent plan create reloads the shared row");

const ownerWrite = toActionItemWrite({
  owner_id: "emp-1",
  owner_name: "Thabo Nkosi",
  owner_email: "thabo@x.co",
  sent_at: null,
  health: "on_track",
  days_remaining: 4,
});
assert(ownerWrite.owner_id === "emp-1", "write keeps owner_id");
assert(ownerWrite.sent_at === null, "write keeps sent_at");
assert(!("owner_name" in ownerWrite), "write drops view column owner_name");
assert(!("owner_email" in ownerWrite), "write drops view column owner_email");
assert(!("health" in ownerWrite), "write drops derived health");
assert(!("days_remaining" in ownerWrite), "write drops derived days_remaining");

assert(parseActionPlanFilter("overdue") === "overdue", "parses overdue filter");
assert(parseActionPlanFilter("nope") === undefined, "rejects unknown filter");
assert(chaseEmailType("overdue") === "overdue", "overdue items use overdue email");
assert(chaseEmailType("at_risk") === "nudge", "open items use nudge email");
{
  const emails = { "emp-1": "a@x.co", "emp-2": null };
  const rows = [
    { status: "in_progress", owner_id: "emp-1", health: "overdue" },
    { status: "in_progress", owner_id: "emp-2", health: "overdue" },
    { status: "done", owner_id: "emp-1", health: "complete" },
    { status: "in_progress", owner_id: "emp-1", health: "on_track" },
    { status: "blocked", owner_id: null, health: "overdue" },
  ];
  assert(chaseableItems(rows, emails, true).length === 1, "batch chase is overdue + email only");
  assert(chaseableItems(rows, emails).length === 2, "open chase includes non-overdue with email");
}

assert(planSrc.includes('sendAssignment(drawerItem, type)'), "drawer chase uses nudge/overdue not assignment");
assert(planSrc.includes("Chase {overdueChaseReady.length} overdue"), "batch chase overdue control");
assert(planSrc.includes("Chase overdue"), "per-item overdue chase label");
assert(planSrc.includes("Send nudge"), "per-item nudge label");
assert(planSrc.includes("initialFilter"), "Action Plan accepts dashboard filter deep-link");

console.log("action-plan-tab-test: ok");
