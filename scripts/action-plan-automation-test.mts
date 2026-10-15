/**
 * Suggested owner, due date, follow-up, and de-duplication.
 * Run: pnpm test:action-plan-automation
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ActionPlanAutomation } from "../src/components/action-plan-automation";
import {
  addDays,
  planAutomation,
  suggestOwner,
  type AutomationItem,
} from "../src/lib/action-plan-automation";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const TODAY = "2026-10-15";
const TEAM = [
  { id: "p1", name: "Ann" },
  { id: "p2", name: "Naledi Khumalo" },
];

function item(partial: Partial<AutomationItem> & Pick<AutomationItem, "id" | "title">): AutomationItem {
  return {
    ownerId: null,
    ownerName: null,
    dueDate: null,
    status: "not_started",
    createdAt: "2026-10-01T08:00:00.000Z",
    ...partial,
  };
}

const teamOwner = suggestOwner("Ask Naledi Khumalo to review the payroll", TEAM);
assert(teamOwner.kind === "team" && teamOwner.id === "p2", "named team member is the suggested owner");
assert(suggestOwner("Ask Ann to call", TEAM).kind === "bot", "a name shorter than 4 characters is not a match");
assert(suggestOwner("Chase the overdue invoices", TEAM).id === "financial_manager", "cash work goes to the Financial Manager");
assert(suggestOwner("Explain the margin variance", TEAM).id === "analyst", "margin work goes to the Analyst");
assert(suggestOwner("Raise price on the advisory retainer", TEAM).id === "advisor", "pricing work goes to the Advisor");
assert(suggestOwner("Call the landlord", TEAM).id === "financial_manager", "unmatched work defaults to the Financial Manager");

assert(addDays("2026-10-01T08:00:00.000Z", 14) === "2026-10-15", "a stored created date plus 14 days is the suggested due date");
assert(addDays("not-a-date", 14) === null, "an unreadable created date does not invent a due date");

const plan = planAutomation(
  [
    item({ id: "cash", title: "Chase the overdue invoices" }),
    item({
      id: "dated",
      title: "File the VAT return",
      ownerId: "p2",
      ownerName: "Naledi Khumalo",
      dueDate: "2026-10-01",
      createdAt: "2026-09-01T00:00:00.000Z",
    }),
    item({
      id: "future",
      title: "Book the board pack",
      ownerName: "Naledi Khumalo",
      dueDate: "2026-11-01",
    }),
    item({
      id: "nudged",
      title: "Send the management pack",
      ownerName: "Naledi Khumalo",
      dueDate: "2026-11-01",
      lastNudgeAt: "2026-10-10T00:00:00.000Z",
    }),
    item({ id: "done", title: "Chase the overdue invoices", status: "done", dueDate: "2026-09-01" }),
    item({ id: "dup-old", title: "Raise price on the retainer", createdAt: "2026-09-01T00:00:00.000Z" }),
    item({ id: "dup-new", title: "Raise price on the retainer!", createdAt: "2026-10-02T00:00:00.000Z" }),
    item({ id: "cut", title: "Cut price on the workshop", createdAt: "2026-10-03T00:00:00.000Z" }),
    item({ id: "bad-date", title: "Review the lease", createdAt: "soon" }),
  ],
  TEAM,
  TODAY,
);

const byId = Object.fromEntries(plan.rows.map((row) => [row.id, row]));
assert(byId.cash?.ownerSuggested && byId.cash.owner?.name === "Financial Manager", "an unowned action suggests a bot");
assert(byId.cash?.dueSuggested && byId.cash.dueDate === "2026-10-15", "a missing due date is suggested from the created date");
assert(byId.cash?.overdue === false, "a suggested date is not treated as overdue");
assert(byId.dated?.ownerSuggested === false && byId.dated?.dueSuggested === false, "stored owner and date are not overwritten");
assert(byId.dated?.overdue === true && byId.dated.followUp === "overdue", "a stored past due date is overdue");
assert(byId.future?.followUp === "waiting", "an owned action that is not overdue is waiting");
assert(byId.nudged?.followUp === "nudged", "a recorded nudge is the follow-up state");
assert(byId.done?.followUp === "done" && byId.done.overdue === false, "a finished action is not overdue");
assert(byId["bad-date"]?.dueDate === null && byId["bad-date"]?.dueSuggested === false, "no due date is invented");

assert(plan.duplicates.length === 1, "one duplicate group");
assert(plan.duplicates[0]?.keepId === "dup-old", "the oldest copy is kept");
assert(plan.duplicates[0]?.dropIds.join() === "dup-new", "the later copy is the one to drop");
assert(
  plan.contradictions.some((pair) => pair.leftId === "dup-old" && pair.rightId === "cut"),
  "a price rise and a price cut are flagged",
);
assert(
  !plan.contradictions.some((pair) => pair.leftId === "dup-new" || pair.rightId === "dup-new"),
  "a duplicate is not also scored as a contradiction",
);

const markup = renderToStaticMarkup(
  createElement(ActionPlanAutomation, {
    rows: plan.rows,
    duplicates: plan.duplicates,
    contradictions: plan.contradictions,
    canEdit: true,
    onConfirm: () => {},
    onDrop: () => {},
  }),
);
assert(markup.includes("Suggested — confirm"), "the panel asks the accountant to confirm");
assert(markup.includes("Overdue"), "overdue work is flagged");
assert(markup.includes("Drop duplicate"), "duplicates are dropped only by a button");
assert(markup.includes("Keep the first"), "a contradiction is resolved by a button");
assert(!markup.includes("supabase"), "the panel does not post anywhere");

const empty = renderToStaticMarkup(
  createElement(ActionPlanAutomation, {
    rows: [],
    duplicates: [],
    contradictions: [],
    canEdit: true,
    onConfirm: () => {},
    onDrop: () => {},
  }),
);
assert(empty === "", "an empty plan renders nothing");

console.log("action-plan-automation ok");
