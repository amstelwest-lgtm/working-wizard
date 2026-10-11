/**
 * Budget redesign: both views open on the current month, and the verdict
 * is the first answer.
 * Run: pnpm test:budget-redesign
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { currentBudgetMonth, fyMonths } from "../src/lib/budget.months";
import {
  budgetYearCompare,
  compareOwnerYear,
  NO_FIGURES_THIS_YEAR,
  YEAR_MONTHS_DIFFER,
  yearMoneyFromFinancials,
} from "../src/lib/budget-year-compare";

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
assert(simple.includes("How the budget is built"), "the owner budget names how it is built");
assert(simple.includes("data-budget-how=\"short\""), "the long build sits behind More");
assert(simple.includes('title="Year detail"'), "the accountant year detail stays in the file");
assert(simple.includes("BudgetYearStrip"), "the owner budget compares this year with last year");
assert(read("src/lib/budget-year-compare.ts").includes("No prior year on file."), "a missing prior year is said plainly");
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

const compared = budgetYearCompare(
  { revenue: 120, cogs: 40, grossProfit: 80, netProfit: 30, expenses: 50 },
  { revenue: 100, cogs: 50, grossProfit: 50, netProfit: 20, expenses: 30 },
);
const revenue = compared.rows.find((row) => row.key === "revenue");
assert(compared.empty === false, "a prior year is a comparison");
assert(revenue?.change === 20, "revenue change is this year minus last year");
assert(revenue?.changePct === 20, "revenue change percent uses last year");
assert(revenue?.direction === "up", "a higher revenue points up");
assert(
  budgetYearCompare(
    { revenue: 120, cogs: 40, grossProfit: 80, netProfit: 30, expenses: null },
    null,
  ).summary === "No prior year on file.",
  "no prior year stays empty",
);
assert(
  yearMoneyFromFinancials({ revenue: "100", cogs: "40", netIncome: "10" })?.grossProfit === 60,
  "gross profit is revenue minus cost of sales",
);

const ytd = { revenue: 420000, cogs: 160000, grossProfit: 260000, netProfit: 120000, expenses: 140000 };
const priorYtd = { revenue: 390000, cogs: 150000, grossProfit: 240000, netProfit: 90000, expenses: 150000 };
const fullYear = { revenue: 980000, cogs: 390000, grossProfit: 590000, netProfit: 120000, expenses: 470000 };
const zeros = { revenue: 0, cogs: 0, grossProfit: 0, netProfit: 0, expenses: 0 };

const noActuals = compareOwnerYear(null, 7, fullYear, 12);
assert(noActuals.summary === NO_FIGURES_THIS_YEAR, "no actuals names the empty year exactly");
assert(noActuals.mode === "empty", "no actuals is an empty comparison");
assert(!noActuals.summary.includes("100%"), "no actuals never says 100%");
assert(!/down/i.test(noActuals.summary), "no actuals never says down");
assert(noActuals.rows.every((row) => row.change == null && row.changePct == null), "no actuals has no change");

const zeroPlan = compareOwnerYear(zeros, 12, fullYear, 12);
assert(zeroPlan.summary === NO_FIGURES_THIS_YEAR, "a zero plan is not down 100%");
assert(!/100%|down/i.test(zeroPlan.summary), "a zero plan does not quote a percent");

const partial = compareOwnerYear(ytd, 7, fullYear, 12);
assert(partial.mode === "partial", "seven months against twelve is not a full comparison");
assert(partial.summary === YEAR_MONTHS_DIFFER, "a different month count is said plainly");
assert(partial.rows.find((row) => row.key === "revenue")?.thisYear === 420000, "partial year still shows this year");
assert(
  partial.rows.every((row) => row.lastYear == null && row.change == null && row.changePct == null),
  "a partial year does not print last year or a percent",
);
assert(!/100%|down/i.test(partial.summary), "a partial year does not say down 100%");

const matched = compareOwnerYear(ytd, 7, priorYtd, 7);
const matchedRevenue = matched.rows.find((row) => row.key === "revenue");
assert(matched.mode === "compared", "the same month count is a comparison");
assert(matchedRevenue?.thisYear === 420000, "this year is the statement actual");
assert(matchedRevenue?.change === 30000, "matched revenue change is this year minus last year");
assert(Math.round(matchedRevenue?.changePct ?? 0) === 8, "matched revenue percent uses the same months");
assert(matched.summary === "Revenue is up 8% on last year.", matched.summary);
assert(matched.rows.find((row) => row.key === "expenses")?.signal === "favourable", "a fall in expenses is favourable");
assert(matched.rows.find((row) => row.key === "cogs")?.signal === "adverse", "a rise in COGS is adverse");
assert(matched.rows.find((row) => row.key === "revenue")?.signal === null, "revenue change stays uncoloured");
assert(read("src/components/budget/budget-verdict.tsx").includes("hideDraft"), "a priced budget hides the draft chip");

assert(simple.includes("ownerYearFromStatement"), "the owner strip uses the statement, not the plan");
const stripBlock = simple.slice(simple.indexOf("<BudgetYearStrip"));
assert(stripBlock.startsWith("<BudgetYearStrip"), "the owner year strip is rendered");
assert(!stripBlock.slice(0, 500).includes("fyTotals"), "the year strip does not read the plan totals");
const verdict = read("src/components/budget/budget-verdict.tsx");
assert(verdict.includes("\\u00A0"), "header amounts keep non-breaking spaces");
assert(verdict.includes("whitespace-nowrap"), "header amounts do not wrap mid-figure");

console.log("budget-redesign ok");
