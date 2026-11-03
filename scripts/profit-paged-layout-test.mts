/**
 * Owner and accountant Profit share the cash block menu, the P&L, and the chart.
 * Run: pnpm test:profit-paged-layout
 */
import { readFileSync } from "node:fs";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

const menu = readFileSync("src/components/profit/profit-paged-menu.tsx", "utf8");
const workspace = readFileSync("src/components/profit/profit-workspace.tsx", "utf8");
const chart = readFileSync("src/components/profit/profit-chart.tsx", "utf8");
const table = readFileSync("src/components/profit/profit-pnl-table.tsx", "utf8");
const owner = readFileSync("src/routes/app.tsx", "utf8");
const accountant = readFileSync("src/routes/_authenticated/clients.$clientId.tsx", "utf8");
const shape = readFileSync("src/components/profit/chart-shape-toggle.tsx", "utf8");

assert(menu.includes('className="cash-menu"'), "profit reuses the cash block menu");
assert(menu.includes('className="cash-menu__tab"'), "profit tabs are the cash block tabs");
assert(menu.includes("Audit inputs") === false, "labels come from the shared map");
assert(workspace.includes("ProfitPagedMenu"), "the workspace renders the menu");
assert(workspace.includes("ProfitChart"), "the chart is a profit pane");
assert(workspace.includes("ProfitPnlTable"), "the P&L is a profit pane");
assert(workspace.includes("CashInputAuditTable"), "profit audit uses the cash audit table");
assert(!chart.includes("ProfitSeriesMenu"), "the chart has no series picker");
assert(!chart.includes("Income vs Expenses"), "the chart does not offer series tabs");
assert(chart.includes("ChartShapeToggle"), "the chart has the bar|line toggle");
assert(chart.includes('ariaLabel="Interval"'), "the chart has week, month, and year");
assert(chart.includes('aria-label="Start date"'), "the chart has a start date");
assert(chart.includes('data-profit-chart='), "the chart is marked");
assert(table.includes("Variance (%)"), "the table has a variance percent column");
assert(table.includes("YTD (FY)"), "the table has a year-to-date column");
assert(shape.includes("Bar chart") && shape.includes("Line chart"), "the toggle names both shapes");
assert(owner.includes("<ProfitWorkspace"), "the owner profit page uses the shared workspace");
assert(owner.includes("fallback={ownerWaterfallFallback}"), "the owner waterfall stays on the same slice");
assert(accountant.includes("<ProfitWorkspace"), "the accountant profit page uses the shared workspace");
assert(accountant.includes('id="lines"'), "product lines stay their own frame");
assert(accountant.includes('scope="profitability"'), "profit keeps one sign-off strip");
assert(accountant.includes("Edit the period figures on Health."), "figures are still edited on Health");

const profitStart = accountant.indexOf('id="pane-profit"');
const profitEnd = accountant.indexOf('id="pane-cash"');
const profitPane = accountant.slice(profitStart, profitEnd);
assert(
  profitPane.indexOf("Product lines") < profitPane.indexOf("<ProfitabilityWaterfall"),
  "product lines stay ahead of the waterfall in the profit pane",
);
assert(
  profitPane.indexOf("Edit the period figures on Health.") < profitPane.indexOf('id="wizard-profit-walk"'),
  "the Health link stays above the waterfall",
);

console.log("profit-paged-layout-test: all assertions passed");
