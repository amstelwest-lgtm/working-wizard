/**
 * Accountant cash forecast page: block menu, one pane per view, one Enlarge.
 * Owner and try keep the stacked layout.
 * Run: pnpm test:cash-paged-layout
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CASH_PAGED_LABEL,
  CASH_PAGED_VIEWS,
  cashPagedEnlargeTarget,
  cashPagedSearch,
  cashPagedSentence,
  cashPagedViewFromHash,
  cashPagedViewFromSearch,
} from "../src/lib/cash-paged-view";
import { accountantClientRouteSearch } from "../src/lib/client-route-search";
import { CashForecastMenu } from "../src/components/cash/cash-forecast-menu";
import {
  ForecastLineTable,
  forecastLineRemovable,
} from "../src/components/cash/forecast-line-table";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

assert(
  CASH_PAGED_VIEWS.map((view) => CASH_PAGED_LABEL[view]).join(" | ") ===
    "Forecast | 13-week | Forecast setup | Audit inputs | Scenario planning",
  "menu names and order",
);

assert(cashPagedViewFromSearch(undefined) === "graph", "no view opens the graph");
assert(cashPagedViewFromSearch("13week") === "13week", "13week deep link");
assert(cashPagedViewFromSearch("table") === "13week", "old table lens lands on 13-week");
assert(cashPagedViewFromSearch("nonsense") === "graph", "unknown view falls back to graph");
assert(cashPagedViewFromHash("#detailed-forecast") === "13week", "detail anchor opens 13-week");
assert(cashPagedViewFromHash("#wizard-cash-setup") === "setup", "setup anchor opens setup");
assert(cashPagedViewFromHash("#wizard-cash-scenario") === "scenario", "scenario anchor");
assert(cashPagedViewFromHash("#elsewhere") === null, "other anchors leave the view alone");

const prev = { tab: "cash", section: "forecast", view: "setup" };
assert(!("view" in cashPagedSearch(prev, "graph")), "graph drops view");
assert(cashPagedSearch(prev, "audit").view === "audit", "audit sets view");
assert(cashPagedSearch(prev, "audit").section === "forecast", "other params kept");

for (const view of ["13week", "setup", "audit", "scenario"] as const) {
  const out = accountantClientRouteSearch({ tab: "cash", section: "forecast", view });
  assert(out.view === view, `route search keeps view=${view}`);
}
assert(
  accountantClientRouteSearch({ tab: "home", view: "setup" }).view === undefined,
  "view is dropped off the cash tab",
);

for (const view of CASH_PAGED_VIEWS) {
  const line = cashPagedSentence(view, { floorText: "R 112k" });
  assert(line, `${view} has a sentence`);
  assert(line.split(/[.;]\s+[A-Z]/).length === 1, `${view} has at most one sentence`);
}
assert(cashPagedSentence("graph", { empty: true }) === null, "empty graph has no sentence");
assert(cashPagedEnlargeTarget("graph") === "chart", "graph enlarges the chart");
assert(cashPagedEnlargeTarget("13week") === "table", "13-week enlarges the table");
for (const view of ["setup", "audit", "scenario"] as const) {
  assert(cashPagedEnlargeTarget(view) === null, `${view} has no Enlarge`);
}

const menu = renderToStaticMarkup(
  createElement(CashForecastMenu, { value: "audit", onChange: () => {}, auditCount: 3 }),
);
assert(menu.includes('role="tablist"'), "menu is a tablist");
assert((menu.match(/role="tab"/g) ?? []).length === 5, "five tabs");
assert(menu.includes('aria-selected="true" aria-controls="cash-pane-audit"'), "audit selected");
assert(menu.includes("data-cash-audit-badge"), "audit badge shows a count");
const quiet = renderToStaticMarkup(
  createElement(CashForecastMenu, { value: "graph", onChange: () => {}, auditCount: 0 }),
);
assert(!quiet.includes("data-cash-audit-badge"), "no badge when nothing waits");

const line = (id: string, name: string, frequency = "recurring-monthly" as const) => ({
  id,
  name,
  amount: "1000",
  frequency,
  startWeek: 1,
  splitCount: 3,
});
const table = renderToStaticMarkup(
  createElement(ForecastLineTable, {
    revenue: [line("r1", "Sales"), line("r2", "Grant")],
    expenses: [line("e1", "Rent"), line("e2", "Salaries & wages")],
    other: [{ ...line("o1", "Deposit"), frequency: "split-weeks" as const }],
    currency: "R",
    weeks: 13,
    stagedIds: new Set(["r2"]),
    onChange: () => {},
    onRemove: () => {},
    onAdd: () => {},
  }),
);
assert((table.match(/<table/g) ?? []).length === 1, "one table holds every line");
const headers = [...table.matchAll(/<th scope="col"[^>]*>(.*?)<\/th>/g)].map((m) =>
  m[1].replace(/<[^>]+>/g, ""),
);
assert(
  headers.join(" | ") === "Description | Amount (R) | Frequency | Start week | Remove",
  `columns: ${headers.join(" | ")}`,
);
for (const group of ["Money in", "Main expenses", "Other expenses"]) {
  assert(table.includes(`>${group}</th>`), `${group} group header`);
}
assert(table.includes('aria-label="Remove Sales"'), "money-in rows can be removed");
assert(!table.includes('aria-label="Remove Rent"'), "main expenses keep no remove");
assert(!table.includes('aria-label="Remove Deposit"'), "the last other-expense row stays");
assert(table.includes('aria-label="Number of weeks"'), "split count sits inline in Frequency");
assert(/data-forecast-line="r2" data-staged=""/.test(table), "staged once-offs are highlighted");
assert(table.includes("Add money-in line") && table.includes("Add expense line"), "block add buttons");
assert(!table.includes("rounded-full"), "no pills in the table");
assert(forecastLineRemovable("expenses", 9) === false, "main expenses never remove");
assert(forecastLineRemovable("revenue", 1) === false, "keep one money-in row");
assert(forecastLineRemovable("other", 2) === true, "extra other rows remove");

const css = readFileSync("src/components/cash/cash-paged.css", "utf8");
assert(/\.cash-menu__tab \{[^}]*border-radius: 8px/.test(css), "menu tabs are blocks, not pills");
assert(css.includes("#f4f8ff"), "light blue page background");

const cash = readFileSync("src/components/cash-forecast.tsx", "utf8");
assert(cash.includes('layout = "stacked"'), "stacked stays the default");
const pagedStart = cash.indexOf("if (paged) {");
const pagedEnd = cash.indexOf("if (simplified) {", pagedStart);
assert(pagedStart > 0 && pagedEnd > pagedStart, "paged branch exists");
const pagedBranch = cash.slice(pagedStart, pagedEnd);
assert((pagedBranch.match(/<EnlargeButton/g) ?? []).length === 1, "paged layout has one Enlarge");
assert(!pagedBranch.includes("<ViewToggle"), "the menu replaces the Chart/13-week toggle");
assert(!pagedBranch.includes("ReviewInputsDrawer"), "no drawer in the paged layout");
assert(!pagedBranch.includes("answer-strip__heading"), "no duplicate H2 in the paged header");
for (const noise of [
  "cashCopy.bullets",
  "runwayAside",
  "weekTableHint",
  "data-forecast-updated",
  "data-forecast-seed",
  "cash-details",
  "disagreeNotice",
]) {
  assert(!pagedBranch.includes(noise), `paged layout drops ${noise}`);
}
assert(
  (pagedBranch.match(/data-cash-pane-sentence/g) ?? []).length === 1,
  "one sentence line under the menu",
);
assert(!cash.includes("PlBankDisagreeNotice"), "the invoiced-vs-cash banner is gone from cash");
assert(pagedBranch.includes("<ForecastLineTable"), "setup pane uses the one table");
assert(!pagedBranch.includes("<LineEditor"), "no per-line cards on the paged setup pane");
assert(!pagedBranch.includes("{moneyInOut}"), "Money In & Out folds into Forecast setup");
assert(!pagedBranch.includes("CollapsibleGoldCard"), "no collapsible cards in the paged layout");
assert(!/what-?if/i.test(pagedBranch), "no what-if wording on the accountant page");
assert(pagedBranch.includes("{scenarioMiniChart}"), "scenario pane shows base vs scenario");
assert(pagedBranch.includes("{scenarioSliders}"), "scenario pane holds the sliders");
assert(pagedBranch.includes('className="cash-scenario__reset"'), "Reset to base is a block button");
assert(pagedBranch.includes("data-scenario-on"), "the Forecast pane says when a scenario is on");
const miniChart = cash.slice(cash.indexOf("const scenarioMiniChart"), pagedStart);
assert(miniChart.includes('dataKey="base"') && miniChart.includes('dataKey="scenario"'), "two series");
const briefing = readFileSync("src/lib/client-briefing.ts", "utf8");
assert(!/what-?if/i.test(briefing), "briefing copy says scenario planning");
for (const file of ["src/reports/cash-forecast.tsx", "src/lib/feature-finder.ts"]) {
  assert(!/what-?if/i.test(readFileSync(file, "utf8")), `${file} has no what-if wording`);
}

const palette = readFileSync("src/lib/brand-palette.ts", "utf8");
const waterfall = readFileSync("src/components/profitability-waterfall.tsx", "utf8");
assert(waterfall.includes('from "@/lib/brand-palette"'), "waterfall reads the shared palette");
assert(cash.includes('from "@/lib/brand-palette"'), "cash chart reads the shared palette");
assert(palette.includes('green: { from: "#41c586", to: "#1f9e62" }'), "waterfall green kept");
assert(cash.includes('dataKey="net"') && cash.includes("url(#cfNetDown)"), "weekly net bars");
const heroAt = cash.indexOf("const heroChart");
const barAt = cash.indexOf('dataKey="net"', heroAt);
assert(cash.slice(heroAt, barAt).includes('layout === "paged" ? ('), "net bars only on the paged chart");
assert(/\.cash-paged \.cash-kpi\[data-tone="bad"\][^}]*inset 3px 0 0 #e76a6a/.test(css), "red tile accent");
assert(/\.cash-paged \.cash-kpi\[data-tone="good"\][^}]*inset 3px 0 0 #1f9e62/.test(css), "green tile accent");
assert(css.includes('tr[data-cash-row="total-receipts"]'), "grid receipts row tinted");
assert(css.includes('tr[data-cash-row="total-payments"]'), "grid payments row tinted");
assert(/\[class\*="border-amber-900"\][^}]*#dbeafe/.test(css), "warm borders read blue on the page");
for (const selector of [".cash-paged {", ".cash-paged__pane {", ".cash-menu__tab {", ".cash-paged__chip {"]) {
  const block = css.slice(css.indexOf(selector), css.indexOf("}", css.indexOf(selector)));
  for (const hex of block.match(/#[0-9a-f]{6}\b/gi) ?? []) {
    const [r, , b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    assert(b >= r, `${selector} has no warm tint: ${hex}`);
  }
}

const route = readFileSync("src/routes/_authenticated/clients.$clientId.tsx", "utf8");
const mount = route.slice(route.indexOf('title="13-week forecast"'), route.indexOf("<CashForecastPanel"));
assert(!mount.includes("subtitle="), "the forecast subpage has no subtitle");
assert(route.includes('layout="paged"'), "accountant route opts into the paged layout");
const owner = readFileSync("src/routes/app.tsx", "utf8");
assert(!owner.includes('layout="paged"'), "owner stays stacked");
const tryBoards = readFileSync("src/components/try-sample-boards.tsx", "utf8");
assert(!tryBoards.includes('layout="paged"'), "try demo stays stacked");

console.log("cash-paged-layout-test: all assertions passed");
