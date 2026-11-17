/**
 * One Chill Pepper-shaped plan, counted the same way on every surface.
 * Run: pnpm test:action-counts-surfaces
 */
import { readFileSync } from "node:fs";
import { actionCountClassFromDisplay } from "../src/lib/action-handoff.ts";
import {
  actionCounts,
  actionDisplayClass,
  countActionPlan,
  formatActionPlanCounts,
} from "../src/lib/action-plan-counts.ts";
import { deriveActionHealth, type ActionItemHealth } from "../src/lib/action-item-health.ts";
import { formatActionHealthSummary } from "../src/components/action-plan.tsx";
import { homeActionNeeds } from "../src/lib/owner-needs.ts";
import { planAutomation } from "../src/lib/action-plan-automation.ts";
import { practiceAgentWork } from "../src/lib/agent-work.ts";
import { presentGuardedRatioCopy } from "../src/lib/ratios.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const today = "2026-11-17";
const doneBy = "Done by Financial Manager · 27 Oct. See result.";
const rows = [
  {
    id: "2",
    title: "Send the bank letter",
    status: "in_progress",
    dueDate: "2026-10-01",
    createdAt: "2026-09-01",
    pickupLabel: doneBy,
    draftId: "finding-2",
  },
  {
    id: "3",
    title: "File the VAT pack",
    status: "in_progress",
    dueDate: "2026-10-02",
    createdAt: "2026-09-01",
    pickupLabel: doneBy,
    draftId: "finding-3",
  },
  {
    id: "4",
    title: "Call the supplier",
    status: "not_started",
    dueDate: "2026-10-03",
    createdAt: "2026-09-01",
  },
];

const counts = actionCounts(rows, today);
assert(counts.done === 2 && counts.overdue === 1 && counts.open === 1, `shared counts ${JSON.stringify(counts)}`);
assert(counts.awaitingSignOff === 0, "the fixture has no sign-off row");

const summary = formatActionPlanCounts(countActionPlan(rows, today));
assert(summary === "3 actions · 1 open, including 1 overdue · 2 done", `plan summary ${summary}`);

const health: Record<ActionItemHealth, number> = {
  on_track: 0,
  at_risk: 0,
  off_track: 0,
  overdue: 0,
  not_started: 0,
  complete: 0,
  awaiting_sign_off: 0,
};
for (const row of rows) {
  const bucket = deriveActionHealth(
    {
      status: row.status,
      due_date: row.dueDate,
      progress_pct: 0,
      created_at: row.createdAt,
      pickupLabel: row.pickupLabel,
      draftId: row.draftId,
      title: row.title,
    },
    new Date("2026-11-17T12:00:00Z"),
  );
  health[bucket] += 1;
}
const widget = formatActionHealthSummary(health);
assert(widget === summary, `action health ${widget}`);

const openTitles = rows
  .filter((row) => {
    const klass = actionDisplayClass(row, today);
    return klass === "open" || klass === "overdue";
  })
  .map((row) => row.title);
const home = homeActionNeeds({ known: true, titles: openTitles, overdue: counts.overdue });
assert(home.heading === "1 open, 1 overdue", `home ${home.heading}`);

const suggested = planAutomation(
  rows.map((row) => ({
    id: row.id,
    title: row.title,
    ownerId: "e1",
    ownerName: "Sam",
    dueDate: row.dueDate,
    status: row.status,
    createdAt: row.createdAt,
    pickupLabel: row.pickupLabel,
    draftId: row.draftId,
  })),
  [],
  today,
);
assert(
  suggested.rows.filter((row) => row.followUp === "done").length === 2,
  "suggested treats the 100% rows as done",
);
assert(
  suggested.rows.filter((row) => row.overdue).map((row) => row.title).join("|") === "Call the supplier",
  "suggested names only the overdue row",
);

const listed = actionCounts(rows, today);
assert(listed.done === counts.done && listed.overdue === counts.overdue, "list counters share actionCounts");
const work = practiceAgentWork("advisor", {
  loading: false,
  clients: [],
  attention: [],
  followUps: [
    {
      clientId: "79c4c485",
      name: "Chill Pepper",
      overdueActions: listed.overdue,
      openActions: listed.open,
    },
  ],
});
assert(work.items[0]?.detail === "1 overdue", `agent work ${work.items[0]?.detail}`);

for (const file of [
  "src/components/practice-board.tsx",
  "src/lib/portfolio.functions.ts",
  "src/lib/next-step.functions.ts",
  "src/lib/advisory-pack.functions.ts",
  "src/routes/_authenticated/clients.$clientId.tsx",
]) {
  const source = readFileSync(file, "utf8");
  assert(source.includes("actionCounts("), `${file} does not count with actionCounts`);
}

const signOff = actionDisplayClass(
  {
    status: "in_progress",
    dueDate: "2026-10-01",
    createdAt: "2026-09-01",
    title: "Sign off the pack",
    pickupLabel: doneBy,
    draftId: "finding-9",
  },
  today,
);
assert(signOff === "awaiting_sign_off", `sign-off class ${signOff}`);
const signOffCounts = actionCounts(
  [
    ...rows,
    {
      status: "in_progress",
      dueDate: "2026-10-01",
      title: "Sign off the pack",
      pickupLabel: doneBy,
    },
  ],
  today,
);
assert(
  signOffCounts.awaitingSignOff === 1 && signOffCounts.done === 2 && signOffCounts.overdue === 1,
  `sign-off stays its own count ${JSON.stringify(signOffCounts)}`,
);
assert(
  actionCountClassFromDisplay({
    status: "in_progress",
    title: "Sign off the pack",
    pickupLabel: doneBy,
    display: { progressPct: 100, overdue: false },
  }) === "awaiting_sign_off",
  "the display rule is what the counter uses",
);

const reason = presentGuardedRatioCopy(
  "The stored ratios contradict each other. gross margin is 95.4%, creditor days are -248 days and inventory days are -93 days",
);
assert(reason.includes("Not enough data for creditor days"), reason);
assert(reason.includes("Not enough data for inventory days"), reason);
assert(!/stored ratios contradict/i.test(reason), reason);
assert(!reason.includes("-248") && !reason.includes("-93"), reason);

console.log("action-counts-surfaces ok");
