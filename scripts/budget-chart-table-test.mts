/**
 * Budget chart and table sit under the answer strip.
 * Run: pnpm test:budget-chart-table
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { createBudgetDocument } from "../src/lib/budget.months";
import {
  budgetLensFromSearch,
  budgetMonthViews,
  budgetTableRows,
  budgetYtdSentence,
  budgetYtdSignal,
  revenueYtd,
} from "../src/lib/budget-chart-table";
import { formatMoney } from "../src/lib/market/format";
import { ZA_MARKET } from "../src/lib/market/resolve";

const money = (n: number) => formatMoney(n, ZA_MARKET);
const formattedOpening = money(128450);
assert(formattedOpening !== "128450", "opening cash is not a raw integer");
assert(formattedOpening.includes("128") && formattedOpening.includes("450"), "opening cash keeps the amount");
assert(!formattedOpening.includes("128450"), "grouped money does not paste the raw digits");

assert(budgetLensFromSearch(undefined) === "chart", "the chart is the default");
assert(budgetLensFromSearch("table") === "table", "table is linkable");
assert(budgetLensFromSearch("chart") === "chart", "chart stays chart");
assert(budgetLensFromSearch("nope") === "chart", "an unknown view falls back to the chart");

assert(
  budgetYtdSentence({ budget: 1000, actual: null, money }) === `YTD: budget ${money(1000)} · no actuals yet.`,
  "a year with no actuals names the budget only",
);
assert(
  budgetYtdSentence({ budget: 1000, actual: 1300, money }) ===
    `YTD: actual ${money(1300)} vs budget ${money(1000)} · ${money(300)} over.`,
  "revenue above budget is over",
);
assert(
  budgetYtdSentence({ budget: 1000, actual: 700, money }) ===
    `YTD: actual ${money(700)} vs budget ${money(1000)} · ${money(300)} under.`,
  "revenue below budget is under",
);
assert(
  budgetYtdSentence({ budget: 1000, actual: 1000, money }) ===
    `YTD: actual ${money(1000)} vs budget ${money(1000)} · in line.`,
  "a matched year is in line",
);
assert(budgetYtdSignal({ budget: 1000, actual: null }) === null, "no actuals have no colour");
assert(budgetYtdSignal({ budget: 1000, actual: 700 }) === "adverse", "revenue under budget is red");
assert(budgetYtdSignal({ budget: 1000, actual: 1300 }) === "favourable", "revenue over budget is green");
assert(budgetYtdSignal({ budget: 1000, actual: 1000 }) === "inline", "a matched year is not red");

const doc = createBudgetDocument({
  templateId: "services_hours",
  fyStart: "2026-03",
  fyStartMonth: 3,
  qualification: {
    payMotion: "time_delivery",
    volumeUnit: "billable_hours",
    driverKind: "hours_rate",
    costShape: "payroll_heavy",
    debtorDaysDefault: 30,
    capexMode: "none",
    confirmedAt: "2026-01-15T00:00:00.000Z",
  },
});
const views = budgetMonthViews(doc, [
  {
    month: "2026-03",
    totals: { revenue: 9_000_000, cogs: 9_000_000, overheadsTotal: 1, ebit: -1 },
  },
]);
const empty = revenueYtd(budgetMonthViews(doc, []), "2026-10");
assert(empty.actual == null, "no uploaded months leave actuals blank");
const ytd = revenueYtd(views, "2026-10");
assert(ytd.actual === 9_000_000, "year to date sums months that have actuals");
const later = revenueYtd(views, "2026-02");
assert(later.actual == null, "a month after the window is not in this year");

const rows = budgetTableRows(doc, views);
assert(rows.some((row) => row.kind === "subtotal" && row.id === "revenue"), "revenue is a subtotal");
assert(rows.some((row) => row.kind === "subtotal" && row.id === "overheads"), "overheads are a subtotal");
assert(rows.some((row) => row.kind === "total" && row.label === "Profit"), "profit is the grand total");
const march = views.findIndex((row) => row.month === "2026-03");
const revenue = rows.find((row) => row.id === "revenue")?.cells[march];
const cogs = rows.find((row) => row.id === "cogs")?.cells[march];
assert(revenue?.variance?.signal === "favourable", "higher revenue is favourable");
assert(cogs?.variance?.signal === "adverse", "higher cost of sales is adverse");
assert(rows.find((row) => row.id === "revenue")?.cells[march + 1]?.actual == null, "a later month stays budget only");

const read = (path: string) => readFileSync(resolve(path), "utf8");
const simple = read("src/components/budget/budget-simple-view.tsx");
const workspace = read("src/components/budget/budget-workspace.tsx");
const chart = read("src/components/budget/budget-chart-table.tsx");
const toggle = read("src/components/ui/view-toggle.tsx");
const panel = read("src/components/budget/budget-panel.tsx");
const route = read("src/routes/_authenticated/clients.$clientId.tsx");
const harness = read("scripts/rail-studio-harness/main.tsx");

const stripAt = simple.indexOf("<BudgetVerdictStrip");
const chartAt = simple.indexOf("<BudgetChartTable");
const drawerAt = simple.indexOf("{drawer}");
assert(stripAt !== -1 && chartAt > stripAt && drawerAt > chartAt, "the simple chart sits under the strip and above the drawer");

const complexChart = workspace.indexOf("<BudgetChartTable");
const complexDrawer = workspace.indexOf("{nestInDrawer(", complexChart);
assert(complexChart !== -1 && complexDrawer > complexChart, "the full budget chart sits under the strip and above the drawer");
assert(!workspace.includes("BudgetYearOverviewChart"), "the old year chart stays unmounted");
assert(panel.includes("data-view-mode-toggle"), "the summary toggle still lives in the drawer");
assert(!route.includes("data-view-mode-toggle"), "the summary toggle is not a second control on the page");

for (const src of [simple, workspace]) {
  const labelAt = src.indexOf("Opening cash");
  const fieldAt = src.indexOf("<MoneyField", labelAt);
  assert(fieldAt !== -1, "opening cash uses the formatted money field");
  assert(!src.slice(fieldAt, fieldAt + 280).includes('type="number"'), "opening cash is not a raw number input");
}
assert(simple.includes("formatMoney(value, market)"), "the money field formats the resting value");

assert(chart.includes("budgetYtdSignal"), "the year-to-date colour uses the revenue signal");
assert(!chart.includes(">Only<"), "budget-only months do not say Only");
assert(chart.includes("Budget only"), "the legend still names budget-only months");
assert(read("src/styles/accountant-portal.css").includes(".budget-grid__money{white-space:nowrap"), "money cells do not wrap");
assert(chart.includes("<ViewToggle"), "budget uses the shared toggle");
assert(!chart.includes("data-view-mode-toggle"), "the chart toggle is not the drawer toggle");
assert(toggle.includes('role="tablist"'), "the toggle is a tablist");
assert(toggle.includes('role="tab"'), "each option is a tab");
assert(toggle.includes("#d4af37"), "the active segment is gold");
assert(toggle.includes("ArrowRight") && toggle.includes("ArrowLeft"), "arrow keys move the toggle");
assert(toggle.includes("Home") && toggle.includes("End"), "home and end move the toggle");
assert(route.includes('search.view === "table"'), "the client route keeps view=table");
assert(harness.includes('search.view === "table"'), "the harness keeps view=table");

console.log("budget chart table ok");
