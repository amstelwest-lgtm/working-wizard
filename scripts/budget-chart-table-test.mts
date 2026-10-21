/**
 * Budget chart and table sit under the answer strip.
 * Run: pnpm test:budget-chart-table
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { budgetWindowLabel, createBudgetDocument, fyMonths } from "../src/lib/budget.months";
import {
  budgetUniformNote,
  presentBudgetOnStatementWindow,
  budgetVersusStatement,
} from "../src/lib/budget.bridges";
import { marketForClient } from "../src/lib/market/scope";
import {
  budgetChartDomain,
  budgetLensFromSearch,
  budgetMonthViews,
  budgetPeriodTotalCell,
  budgetPlanIsSet,
  budgetRangeTotals,
  budgetTableRows,
  budgetYtdSentence,
  budgetYtdSignal,
  niceBudgetAxis,
  revenueYtd,
} from "../src/lib/budget-chart-table";
import { formatVariancePct, varianceLine } from "../src/lib/budget.variance";
import { formatMoney } from "../src/lib/market/format";
import { ZA_MARKET } from "../src/lib/market/resolve";
import { applyForecastRent, budgetRentHint, forecastRentPayment } from "../src/lib/budget-forecast-rent";
import { budgetSignoffIsStale, inputsChangedSinceSignoff } from "../src/lib/signoff-status";

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
  budgetYtdSentence({ budget: 1000, actual: null, money }) === "No monthly actuals yet",
  "a year with no monthly actuals does not say in line",
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
const slip = varianceLine("revenue", "Revenue", 400_000, 399_980, true);
assert(slip.delta === -20, "a twenty dollar slip keeps its dollars");
assert(slip.signal === "inline", "a slip that prints as 0.0% stays neutral");
assert(formatVariancePct(slip.deltaPct) === "—", "a near-zero percent prints a dash");
assert(
  varianceLine("revenue", "Revenue", 1000, 800, true).signal === "adverse",
  "a real miss stays adverse",
);

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
assert(rows.some((row) => row.kind === "total" && row.label === "Operating profit"), "operating profit is the grand total");
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
assert(!panel.includes("data-view-mode-toggle"), "the summary pills are gone");
assert(!route.includes("data-view-mode-toggle"), "the summary toggle is not a second control on the page");
assert(chart.includes("<ViewToggle"), "chart and table share one toggle");
assert(chart.includes('label: "Chart"') && chart.includes('label: "Table"'), "the toggle names Chart and Table");

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
assert(chart.includes("data-budget-paint=\"ready\""), "the chart paints before monthly actuals return");
assert(!chart.includes("data-view-mode-toggle"), "the chart toggle is not the drawer toggle");
assert(toggle.includes('role="tablist"'), "the toggle is a tablist");
assert(toggle.includes('role="tab"'), "each option is a tab");
assert(toggle.includes("#0B5FFF"), "the active segment is cobalt");
assert(toggle.includes("ArrowRight") && toggle.includes("ArrowLeft"), "arrow keys move the toggle");
assert(toggle.includes("Home") && toggle.includes("End"), "home and end move the toggle");
assert(
  route.includes('search.section === "months" ? "table" : "chart"'),
  "month by month is the table page",
);
assert(harness.includes('search.view === "table"'), "the harness keeps view=table");

assert(!budgetPlanIsSet([{ budget: { revenue: 0 } }, { budget: { revenue: 0.4 } }]), "a drafted plan is not set");
assert(budgetPlanIsSet([{ budget: { revenue: 70_000 } }]), "a real month sets the plan");
assert(budgetChartDomain([0, 0]) === undefined, "a zero series does not invent an axis");
const scaled = budgetChartDomain([70_000, 60_000]);
assert(scaled?.[0] === 0 && scaled[1] === 80_000, `the axis reaches the real values, got ${scaled}`);
assert(chart.includes("Your accountant is still setting the budget"), "a draft tells the owner the budget is not set");
assert(chart.includes("data-budget-chart=\"draft\""), "the draft chart is marked");
assert(chart.includes("ticks={axis?.ticks}"), "the axis uses even ticks");
assert(chart.includes("data-budget-totals"), "the visible range has a totals header");
assert(chart.includes("data-budget-totals-row"), "the table has a period totals row");
assert(chart.includes("BudgetMonthTick"), "narrow months use a full label tick");
assert(chart.includes('data-budget-axis="chart"'), "the chart keeps one month axis");
assert(chart.includes('data-budget-axis="readout"'), "the desktop readout is marked");
assert(chart.includes('narrow ? " hidden"'), "the second month row hides on a phone");
assert(simple.includes("readOnly={readOnly}"), "only the owner view hides a draft chart");

const rentCash = {
  seededFromBanksAt: "2026-08-24T00:00:00.000Z",
  expenses: [{ name: "Greeff Properties", amount: "28000", frequency: "once-off", startWeek: 1 }],
};
const rent = forecastRentPayment(rentCash);
assert(rent?.name === "Greeff Properties" && rent.monthly === 28000, "forecast rent is the properties payment");
const filled = applyForecastRent(doc, rentCash);
const premises = filled.overheads.find((line) => line.bucket === "premises");
assert(Object.values(premises?.months ?? {}).every((amount) => amount === 28000), "blank premises follows forecast rent");
assert(
  budgetRentHint(filled, rent, money, true) === "Rent follows Greeff Properties in the 13-week forecast.",
  "a matched rent line does not say rent is missing",
);
const mismatch = applyForecastRent(
  {
    ...doc,
    overheads: doc.overheads.map((line) =>
      line.bucket === "premises"
        ? { ...line, months: Object.fromEntries(Object.keys(line.months).map((month) => [month, 1000])) }
        : line,
    ),
  },
  rentCash,
);
assert(
  budgetRentHint(mismatch, rent, money, false)?.includes(money(28000)) === true,
  "a different premises amount names the forecast rent",
);
assert(
  inputsChangedSinceSignoff("2026-09-02T07:54:51.000Z", "2026-09-04T00:00:00.000Z") === true,
  "financials saved after sign-off count as changed inputs",
);
assert(
  budgetSignoffIsStale({ signed_off_at: "2026-09-02T07:54:51.000Z" }, "2026-10-12T00:00:00.000Z", false) === false,
  "the budget autosave clock alone is not stale",
);

const axis = niceBudgetAxis([20_000, 40_000, 70_000]);
assert(axis != null, "a real series has ticks");
const gaps = axis!.ticks.slice(1).map((tick, index) => tick - axis!.ticks[index]!);
assert(gaps.every((gap) => gap === gaps[0]), `ticks are evenly spaced, got ${axis!.ticks.join(",")}`);
assert(axis!.ticks.includes(0) && axis!.ticks[axis!.ticks.length - 1]! >= 70_000, "ticks cover the series");
assert(!axis!.ticks.includes(70_000) || gaps.length === 1, "the data max is not an uneven last tick");

const usMarket = marketForClient({ market: { country: "US", regionCode: "NY" } });
const zaMarket = marketForClient({ market: { country: "ZA" } });
const usDoc = createBudgetDocument({
  templateId: "services_hours",
  fyStart: "2026-01",
  fyStartMonth: 1,
  qualification: doc.qualification,
  market: usMarket,
});
const flat = {
  ...usDoc,
  revenueLines: usDoc.revenueLines.map((line, index) =>
    index === 0
      ? {
          ...line,
          months: Object.fromEntries(fyMonths(usDoc.fyStart).map((month) => [month, { volume: 1, price: 58_333.33 }])),
        }
      : line,
  ),
  overheads: usDoc.overheads.map((line) => ({
    ...line,
    months: Object.fromEntries(fyMonths(usDoc.fyStart).map((month) => [month, 0])),
  })),
};
const books = {
  revenue: "700000",
  cogs: "280000",
  fixedCosts: "351000",
  periodStart: "2025-10-01",
  periodEnd: "2026-09-30",
  periodMonths: "12",
};
const presented = presentBudgetOnStatementWindow(flat, books, usMarket, true);
assert(presented.moved, "a flat Jan–Dec seed moves onto the Oct–Sep books");
assert(presented.doc.fyStart === "2025-10", `aligned start ${presented.doc.fyStart}`);
assert(presented.doc.fyStartMonth === 10, "the displayed year starts in October, so a later save does not snap back to January");
assert(fyMonths(presented.doc.fyStart)[11] === "2026-09", "aligned year ends in Sep 2026");
assert(presented.caption === "Oct 2025 – Sep 2026", presented.caption);
assert(
  budgetUniformNote(presented.uniform) === "Same figure each month. Seeded from the statement.",
  budgetUniformNote(presented.uniform) ?? "missing seed note",
);
const alignedViews = budgetMonthViews(presented.doc, []);
const totals = budgetRangeTotals(alignedViews);
assert(totals.revenue > 0 && totals.expenses >= 0, "the visible range has revenue and expenses");
assert(Math.abs(totals.net - (totals.revenue - totals.expenses)) < 1, "net is revenue less expenses");
const alignedRows = budgetTableRows(presented.doc, alignedViews);
const revenueRow = alignedRows.find((row) => row.id === "revenue");
assert(revenueRow != null, "revenue row is on the table");
const periodCell = budgetPeriodTotalCell(revenueRow!.cells, "revenue", "Revenue", true);
assert(periodCell.budget >= revenueRow!.cells[0]!.budget, "the table total includes every month");
const alignedVersus = budgetVersusStatement(presented.doc, books, usMarket);
assert(alignedVersus != null && alignedVersus.periodMonths === 12, "variance uses the whole shared year");
const mismatched = budgetVersusStatement(flat, books, usMarket);
assert(mismatched != null && mismatched.periodMonths === 9, "an unaligned year only scores the shared months");
const copied = presentBudgetOnStatementWindow(
  {
    ...flat,
    capex: [{ id: "kit", name: "Kit", month: "2026-03", amount: 1200, funding: "cash" }],
    revenueLines: flat.revenueLines.map((line, index) =>
      index === 0
        ? {
            ...line,
            months: Object.fromEntries(fyMonths(flat.fyStart).map((month) => [month, { volume: 1, price: 1 }])),
          }
        : line,
    ),
  },
  books,
  usMarket,
  false,
);
assert(copied.moved && copied.doc.fyStart === "2025-10", "a flat copy-forward still moves onto the books year");
assert(copied.doc.capex[0]?.month === "2025-12", `capex keeps its place in the year, got ${copied.doc.capex[0]?.month}`);
assert(
  budgetUniformNote(copied.uniform) === "Same figure each month. Copied forward.",
  budgetUniformNote(copied.uniform) ?? "missing copy-forward note",
);
const shaped = {
  ...flat,
  revenueLines: flat.revenueLines.map((line, index) =>
    index === 0
      ? {
          ...line,
          months: Object.fromEntries(
            fyMonths(flat.fyStart).map((month, monthIndex) => [
              month,
              { volume: 1, price: monthIndex === 0 ? 10 : 58_333.33 },
            ]),
          ),
        }
      : line,
  ),
};
const stayed = presentBudgetOnStatementWindow(shaped, books, usMarket, false);
assert(!stayed.moved && stayed.doc.fyStart === "2026-01", "a year whose months differ stays on its own window");
assert(stayed.uniform == null, "an uneven year is not flagged as a seed");
assert(
  stayed.caption ===
    "Budget Jan 2026 – Dec 2026. Actuals Oct 2025 – Sep 2026. Variance compares Jan 2026 – Sep 2026.",
  stayed.caption,
);
assert(
  budgetWindowLabel(flat, usMarket) === "FY Jan–Dec · from Jan 2026",
  budgetWindowLabel(flat, usMarket),
);
assert(
  budgetWindowLabel({ fyStart: "2026-01", fyStartMonth: 1 }, zaMarket) === "FY Jan–Dec · from Jan 2026",
  "ZA uses the same month-year, not a day",
);
assert(!budgetWindowLabel(flat, usMarket).includes("Jan 26"), "the caption does not read as a day");

const started = performance.now();
for (let i = 0; i < 40; i++) {
  presentBudgetOnStatementWindow(flat, books, usMarket, true);
  budgetMonthViews(presented.doc, []);
  budgetRangeTotals(budgetMonthViews(presented.doc, []));
}
const perPass = (performance.now() - started) / 40;
assert(perPass < 50, `budget derivation is ${perPass.toFixed(2)}ms, expected under 50ms`);

console.log("budget chart table ok");
