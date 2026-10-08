/**
 * Budget redesign: both views open on the current month, and the verdict
 * is the first answer.
 * Run: pnpm test:budget-redesign
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { currentBudgetMonth, fyMonths } from "../src/lib/budget.months";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const read = (path: string) => readFileSync(resolve(path), "utf8");

const months = fyMonths("2026-01");
assert(
  currentBudgetMonth(months, new Date("2026-10-08T12:00:00Z")) === "2026-10",
  "October 2026 opens on Oct 26, not January",
);
assert(
  currentBudgetMonth(fyMonths("2026-03"), new Date("2026-01-15T12:00:00Z")) === "2026-03",
  "a month outside the plan falls back to the first month",
);

const simple = read("src/components/budget/budget-simple-view.tsx");
const workspace = read("src/components/budget/budget-workspace.tsx");
assert(simple.includes("BudgetVerdictStrip"), "simplified opens with the verdict");
assert(workspace.includes("BudgetVerdictStrip"), "complex opens with the verdict");
assert(simple.includes("currentBudgetMonth") && workspace.includes("currentBudgetMonth"), "both views share the month");
assert(!simple.includes('title="Cash timing"'), "the collapsed cash timing card is gone");
assert(!simple.includes("FY revenue"), "simplified does not repeat FY revenue");
assert(!workspace.includes("BudgetYearOverviewChart"), "the year chart is not the opening");
assert(read("src/components/budget/budget-variance-panel.tsx").includes("currentBudgetMonth"), "the month picker uses the same month");
assert(
  read("src/components/budget/budget-advanced.tsx").includes('variant="outline"'),
  "seed and push are not a second gold primary",
);

console.log("budget-redesign ok");
