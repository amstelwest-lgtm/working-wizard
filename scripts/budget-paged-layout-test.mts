/**
 * Accountant budget uses the same paged menu as cash. Owner stays stacked.
 * Run: pnpm test:budget-paged-layout
 */
import { readFileSync } from "node:fs";
import { accountantClientRouteSearch } from "../src/lib/client-route-search.ts";
import {
  budgetPagedSearch,
  budgetPagedSentence,
  budgetPagedViewFromHash,
  budgetPagedViewFromSearch,
  BUDGET_PAGED_VIEWS,
} from "../src/lib/budget-paged-view.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

assert(
  BUDGET_PAGED_VIEWS.join(",") === "overview,months,setup",
  "budget panes are the current cards: overview, months, setup",
);
assert(!BUDGET_PAGED_VIEWS.includes("audit" as never), "budget has no audit pane to invent");

assert(budgetPagedViewFromSearch({ section: "year" }) === "overview", "This year is Overview");
assert(
  budgetPagedViewFromSearch({ section: "months" }) === "months",
  "section=months is Month by month",
);
assert(
  budgetPagedViewFromSearch({ view: "table" }) === "months",
  "legacy view=table is Month by month",
);
assert(
  budgetPagedViewFromSearch({ section: "year", view: "setup" }) === "setup",
  "view=setup wins",
);
assert(budgetPagedViewFromSearch({ view: "engine" }) === "setup", "engine is the setup pane");

const tableRoute = accountantClientRouteSearch({ tab: "budget", view: "table" });
assert(
  tableRoute.section === "months" && tableRoute.view === undefined,
  "view=table still canonicalizes to months",
);
const setupRoute = accountantClientRouteSearch({ tab: "budget", section: "year", view: "setup" });
assert(setupRoute.section === "year" && setupRoute.view === "setup", "view=setup is preserved");

assert(
  budgetPagedViewFromHash("#wizard-budget-month-engine") === "setup",
  "month engine hash opens setup",
);
assert(
  budgetPagedViewFromHash("#wizard-budget-cash-timing") === "setup",
  "cash timing hash opens setup",
);
assert(
  budgetPagedViewFromHash("#wizard-budget-assumptions") === "setup",
  "assumptions hash opens setup",
);
assert(budgetPagedViewFromHash("#wizard-budget-plan") === null, "the page root is not a pane hash");
assert(budgetPagedViewFromHash("#year") === "overview", "year hash opens overview");
assert(budgetPagedViewFromHash("#months") === "months", "months hash opens month by month");

const fromMonths = budgetPagedSearch(
  { tab: "budget", section: "months", view: "setup" },
  "overview",
);
assert(
  fromMonths.section === "year" && !("view" in fromMonths),
  "overview drops view and returns to the year",
);
const toSetup = budgetPagedSearch({ tab: "budget", section: "months" }, "setup");
assert(toSetup.section === "months" && toSetup.view === "setup", "setup keeps the current section");
const toMonths = budgetPagedSearch({ tab: "budget", section: "year", view: "setup" }, "months");
assert(toMonths.section === "months" && !("view" in toMonths), "months drops the setup view");

for (const view of BUDGET_PAGED_VIEWS) {
  const sentence = budgetPagedSentence(view);
  const stops = sentence.split(/[.!?]/).filter((part) => part.trim());
  assert(stops.length === 1, `${view} has one sentence: ${sentence}`);
}

const menu = readFileSync("src/components/budget/budget-paged-menu.tsx", "utf8");
assert(menu.includes('className="cash-menu"'), "budget reuses the cash block menu");
assert(menu.includes('className="cash-menu__tab"'), "budget tabs are the cash block tabs");
assert(!menu.includes("rounded-full"), "budget menu is not pills");

const css = readFileSync("src/components/cash/cash-paged.css", "utf8");
assert(/\.cash-menu__tab \{[^}]*border-radius: 8px/.test(css), "shared menu tabs are 8px blocks");
assert(/\.cash-menu__tab\[aria-selected="true"\][^}]*#0b5fff/.test(css), "active tab is cobalt");

const simple = readFileSync("src/components/budget/budget-simple-view.tsx", "utf8");
assert(
  simple.includes('layout === "paged" && role === "accountant" && !readOnly'),
  "paging is accountant-only and skips the read-only board",
);
assert(
  (simple.match(/data-budget-pane-sentence/g) ?? []).length === 1,
  "one sentence under the menu",
);
assert(simple.includes('data-budget-pane="setup"'), "setup is its own pane");
assert(simple.includes('data-budget-pane="overview"'), "the year strip is the overview pane");
assert(simple.includes("hideLensToggle={paged}"), "the chart/table toggle is the menu");
assert(simple.includes("quiet={paged}"), "paged panes drop the extra chart sentences");
assert(simple.includes("<BudgetVerdictStrip"), "sign-off stays on the page");
assert(simple.includes('title="Year detail"'), "year detail stays in setup");
assert(simple.includes('id="wizard-budget-month-engine"'), "the month engine stays in setup");
assert(simple.includes('id="wizard-budget-cash-timing"'), "cash timing stays in setup");

const route = readFileSync("src/routes/_authenticated/clients.$clientId.tsx", "utf8");
const budgetAt = route.indexOf('id="wizard-budget-panel"');
const budgetMount = route.slice(
  budgetAt,
  route.indexOf("/>", route.indexOf("<BudgetPanel", budgetAt)) + 2,
);
assert(budgetMount.includes('layout="paged"'), "the accountant budget opts into the paged layout");
assert(
  budgetMount.includes("budgetPagedViewFromSearch"),
  "the accountant budget reads the pane from the address",
);
const owner = readFileSync("src/routes/app.tsx", "utf8");
assert(!owner.includes('layout="paged"'), "owner budget and cash stay stacked");
const tryBoards = readFileSync("src/components/try-sample-boards.tsx", "utf8");
assert(!tryBoards.includes('layout="paged"'), "try demo stays stacked");

console.log("budget-paged-layout-test: all assertions passed");
