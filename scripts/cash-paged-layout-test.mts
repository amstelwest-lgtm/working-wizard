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

const route = readFileSync("src/routes/_authenticated/clients.$clientId.tsx", "utf8");
const mount = route.slice(route.indexOf('title="13-week forecast"'), route.indexOf("<CashForecastPanel"));
assert(!mount.includes("subtitle="), "the forecast subpage has no subtitle");
assert(route.includes('layout="paged"'), "accountant route opts into the paged layout");
const owner = readFileSync("src/routes/app.tsx", "utf8");
assert(!owner.includes('layout="paged"'), "owner stays stacked");
const tryBoards = readFileSync("src/components/try-sample-boards.tsx", "utf8");
assert(!tryBoards.includes('layout="paged"'), "try demo stays stacked");

console.log("cash-paged-layout-test: all assertions passed");
