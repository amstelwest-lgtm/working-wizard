/**
 * Action Plan tab: chunk/render failures must not white-screen /app.
 * Run: pnpm test:action-plan-tab
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ActionPlan, {
  allocateActionSeqs,
  buildStrategicMoveImportRows,
  driverHealthLabel,
  healthMeta,
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

const clientSrc = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
assert(clientSrc.includes('lazyPanel(() => import("@/components/action-plan")'), "client board uses lazyPanel");
assert(clientSrc.includes('<TabErrorBoundary label="Action Plan">'), "client board wraps Action Plan");
assert(
  clientSrc.includes('{activeTab === "plan" && ('),
  "accountant remounts Action Plan when the tab is opened so owner edits are not stale",
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
assert(planSrc.includes('onClick={(e) => { e.stopPropagation(); setAdding(true); }}'), "Add employee does not open the task drawer");
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

console.log("action-plan-tab-test: ok");
