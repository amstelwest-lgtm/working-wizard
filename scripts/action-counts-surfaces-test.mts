/**
 * Every surface loads Chill Pepper rows from the database, then the hand-off,
 * and only then counts. The raw rows have no pickup caption.
 * Run: pnpm test:action-counts-surfaces
 */
import { formatActionHealthSummary } from "../src/components/action-plan.tsx";
import {
  loadActionCountInputs,
  loadActionHealthCounts,
  loadHomeActionCounts,
  loadPracticeBoardActionMaps,
  loadPortfolioActionMaps,
} from "../src/lib/action-count-load.ts";
import { judgedActionCounts } from "../src/lib/action-count-load.ts";
import { loadOpenActionRows } from "../src/lib/next-step.functions.ts";
import { loadPackActionCounts } from "../src/lib/advisory-pack.functions.ts";
import { planAutomation } from "../src/lib/action-plan-automation.ts";
import { practiceAgentWork } from "../src/lib/agent-work.ts";
import { formatActionPlanCounts } from "../src/lib/action-plan-counts.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const CLIENT = "79c4c485-9fa7-4499-9139-e1bb7cb40649";
const today = "2026-11-17";

const rawActions = [
  {
    id: "action-2",
    client_id: CLIENT,
    status: "in_progress",
    due_date: "2026-10-01",
    created_at: "2026-09-01",
    title: "Send the bank letter",
    owner_name: "Financial Manager",
  },
  {
    id: "action-3",
    client_id: CLIENT,
    status: "in_progress",
    due_date: "2026-10-02",
    created_at: "2026-09-01",
    title: "File the VAT pack",
    owner_name: "Financial Manager",
  },
  {
    id: "action-4",
    client_id: CLIENT,
    status: "not_started",
    due_date: "2026-10-03",
    created_at: "2026-09-01",
    title: "Call the supplier",
    owner_name: "Sam",
  },
];

for (const row of rawActions) {
  assert(!("pickupLabel" in row), "the stored action has no caption");
}

function query(table: string) {
  const source =
    table === "action_items" || table === "action_items_v"
      ? rawActions
      : table === "action_plans"
        ? [{ client_id: CLIENT, target_date: "2026-12-31", is_active: true }]
        : table === "agent_runs"
          ? [
              {
                id: "run-2",
                action_item_id: "action-2",
                agent: "financial_manager",
                status: "succeeded",
                queued_at: "2026-10-27T08:00:00.000Z",
              },
              {
                id: "run-3",
                action_item_id: "action-3",
                agent: "financial_manager",
                status: "succeeded",
                queued_at: "2026-10-27T09:00:00.000Z",
              },
            ]
          : table === "agent_findings"
            ? [
                { id: "finding-2", run_id: "run-2", status: "approved", superseded_by: null, dismissed_reason: null },
                { id: "finding-3", run_id: "run-3", status: "approved", superseded_by: null, dismissed_reason: null },
              ]
            : [];
  let current = source.map((row) => ({ ...row }));
  const api = {
    select() {
      return api;
    },
    eq(column: string, value: unknown) {
      current = current.filter((row) => (row as Record<string, unknown>)[column] === value);
      return api;
    },
    neq(column: string, value: unknown) {
      current = current.filter((row) => (row as Record<string, unknown>)[column] !== value);
      return api;
    },
    in(column: string, values: readonly unknown[]) {
      const allowed = new Set(values);
      current = current.filter((row) => allowed.has((row as Record<string, unknown>)[column]));
      return api;
    },
    order() {
      return api;
    },
    limit() {
      return api;
    },
    then(resolve: (value: { data: unknown; error: null }) => unknown, reject?: (err: unknown) => unknown) {
      return Promise.resolve({ data: current.slice(), error: null }).then(resolve, reject);
    },
  };
  return api;
}

const db = { from: query };

function expectCounts(label: string, counts: { done?: number; overdue?: number }) {
  assert(counts.done === 2 && counts.overdue === 1, `${label} ${JSON.stringify(counts)}`);
}

const loaded = (await loadActionCountInputs(db, [CLIENT])).get(CLIENT) ?? [];
assert(loaded.length === 3, "three raw rows");
assert(loaded.filter((row) => (row.pickupLabel ?? "").startsWith("Done by")).length === 2, "two captions were loaded");
const shared = judgedActionCounts(loaded, today);
expectCounts("shared", shared);
assert(formatActionPlanCounts(shared) === "3 actions · 1 open, including 1 overdue · 2 done", formatActionPlanCounts(shared));

const board = await loadPracticeBoardActionMaps(db, [CLIENT], today);
expectCounts("practice board", { done: board.doneActionsMap[CLIENT], overdue: board.overdueActionsMap[CLIENT] });

const portfolio = await loadPortfolioActionMaps(db, [CLIENT], today);
expectCounts("portfolio", { done: portfolio.doneAct.get(CLIENT), overdue: portfolio.overdueAct.get(CLIENT) });

const nextRows = await loadOpenActionRows(db, CLIENT);
expectCounts("next step", judgedActionCounts(nextRows, today));

const pack = await loadPackActionCounts(db, CLIENT, today);
expectCounts("pack", pack);

const home = await loadHomeActionCounts(db, CLIENT, today);
expectCounts("home", home.counts);
assert(home.titles.length === 1 && home.titles[0] === "Call the supplier", `home titles ${home.titles.join("|")}`);

const health = await loadActionHealthCounts(db, CLIENT, today);
expectCounts("action health", health.counts);
assert(
  formatActionHealthSummary(health.buckets) === "3 actions · 1 open, including 1 overdue · 2 done",
  formatActionHealthSummary(health.buckets),
);

const suggested = planAutomation(
  loaded.map((row, index) => ({
    id: rawActions[index]!.id,
    title: row.title ?? "",
    ownerId: null,
    ownerName: index === 2 ? "Sam" : "Financial Manager",
    dueDate: row.dueDate ?? null,
    status: row.status ?? "not_started",
    createdAt: row.createdAt ?? "",
    pickupLabel: row.pickupLabel,
    draftId: row.draftId,
  })),
  [],
  today,
);
assert(suggested.rows.filter((row) => row.followUp === "done").length === 2, "suggested marks the bot rows done");
assert(suggested.rows.filter((row) => row.overdue).length === 1, "suggested names one overdue row");

const work = practiceAgentWork("advisor", {
  loading: false,
  clients: [],
  attention: [],
  followUps: [
    {
      clientId: CLIENT,
      name: "Chill Pepper",
      overdueActions: board.overdueActionsMap[CLIENT] ?? 0,
      openActions: board.openActionsMap[CLIENT] ?? 0,
    },
  ],
});
assert(work.items[0]?.detail === "1 overdue", `agent work ${work.items[0]?.detail}`);

console.log("action-counts-surfaces ok");
