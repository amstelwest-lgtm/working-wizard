/**
 * Renders the profit chart, P&L, and menu the way the portals mount them.
 * Run: pnpm test:profit-chart-render
 */
import { Window } from "happy-dom";

process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "test-anon-key";
process.env.VITE_SUPABASE_URL ??= process.env.SUPABASE_URL;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??= process.env.SUPABASE_PUBLISHABLE_KEY;

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const window = new Window({
  url: "http://127.0.0.1:5000/app",
  width: 1280,
  height: 800,
  settings: {
    disableJavaScriptEvaluation: true,
    disableJavaScriptFileLoading: true,
    disableCSSFileLoading: true,
  },
});
for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLButtonElement",
  "Element",
  "Node",
  "Document",
  "SVGElement",
  "KeyboardEvent",
  "MouseEvent",
  "Event",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "MutationObserver",
] as const) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value: window[key as "window"],
  });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  writable: true,
  value: true,
});
class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, writable: true, value: ResizeObserver });

const { createElement, useState } = await import("react");
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ProfitChart } = await import("../src/components/profit/profit-chart");
const { ProfitPnlTable } = await import("../src/components/profit/profit-pnl-table");
const { ProfitPagedMenu } = await import("../src/components/profit/profit-paged-menu");

const october = {
  periodStart: "2026-10-01",
  periodEnd: "2026-10-31",
  revenue: 51376,
  cogs: 267,
  grossProfit: 51109,
  fixedCosts: 18000,
  ebit: 33109,
  netIncome: 33109,
};
const september = {
  periodStart: "2026-09-01",
  periodEnd: "2026-09-30",
  revenue: 62895,
  cogs: 650,
  grossProfit: 62245,
  fixedCosts: 12000,
  ebit: 50245,
  netIncome: 50245,
};

function Harness() {
  const [view, setView] = useState<"chart" | "pnl" | "waterfall" | "lines" | "setup" | "audit">("chart");
  return createElement(
    "div",
    null,
    createElement(ProfitPagedMenu, { value: view, onChange: setView, includeLines: true }),
    view === "chart"
      ? createElement(ProfitChart, {
          financials: october,
          snapshots: [
            { period_date: "2026-09-30", period_label: "Sep 2026", financials: september },
            { period_date: "2026-10-31", period_label: "Oct 2026", financials: october },
          ],
          currentPeriodEnd: "2026-10-31",
          currentLabel: "Oct 2026",
        })
      : null,
    view === "pnl"
      ? createElement(ProfitPnlTable, {
          financials: october,
          prior: september,
          currentLabel: "Oct 2026",
          priorLabel: "Sep 2026",
          fyStartMonth: 1,
        })
      : null,
  );
}

const host = document.createElement("div");
document.body.appendChild(host);
const root = createRoot(host);
await act(async () => {
  root.render(createElement(Harness));
});

const text = host.textContent ?? "";
assert(text.includes("Income vs Expenses"), "series tabs include income versus expenses");
assert(text.includes("Break-Even"), "series tabs include break-even");
assert(host.querySelector("[data-chart-shape='line']"), "the chart opens as a line");
assert(host.querySelector("[data-profit-series-tab='sales']"), "sales is a series tab");
assert(host.querySelector("[aria-label='Start date']"), "start date is on the chart");
assert(text.includes("Month"), "month is the default interval label");

const expenses = host.querySelector("[data-profit-series-tab='expenses']");
assert(expenses instanceof HTMLButtonElement, "expenses tab is a button");
await act(async () => {
  expenses.click();
});
assert(host.querySelector("[data-profit-chart-series='expenses']"), "expenses series is selected");

const bar = host.querySelector("[data-chart-shape-option='bar']");
assert(bar instanceof HTMLButtonElement, "bar toggle is a button");
await act(async () => {
  bar.click();
});
assert(host.querySelector("[data-chart-shape='bar']"), "bar shape is selected");

const pnl = host.querySelector("[data-profit-menu-tab='pnl']");
assert(pnl instanceof HTMLButtonElement, "P&L is a menu tab");
await act(async () => {
  pnl.click();
});
const tableText = host.textContent ?? "";
assert(tableText.includes("Profit and Loss"), "the P&L table has its title");
assert(tableText.includes("Oct 2026"), "current period is a column");
assert(tableText.includes("Sep 2026"), "prior period is a column");
assert(tableText.includes("YTD (FY)"), "year to date is a column");
assert(host.querySelector("[data-profit-row='sales']"), "sales is a row");
assert(host.querySelector("[data-profit-row='cogs']"), "cost of sales is a row");
const salesRow = host.querySelector("[data-profit-row='sales']");
assert(salesRow?.textContent?.includes("51"), "October sales are on the row");
const cogsRow = host.querySelector("[data-profit-row='cogs']");
assert(cogsRow?.getAttribute("data-profit-row") === "cogs", "cost row is marked");
assert(cogsRow?.querySelector("[data-favourable='true']"), "a lower cost is favourable");

console.log("profit-chart-render-test: all assertions passed");
