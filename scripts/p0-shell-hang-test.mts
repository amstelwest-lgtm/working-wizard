/**
 * P0 shell hang. Cash and Action plan share the client shell, /reports must
 * redirect in one hop, and Home must not say the book is empty while the
 * client query is still in flight.
 * Run: pnpm test:p0-shell-hang
 */
import { readFileSync } from "node:fs";
import { defaultParseSearch, defaultStringifySearch } from "@tanstack/router-core";
import { accountantClientRouteSearch } from "../src/lib/client-route-search";
import { stableCashChartWidth } from "../src/lib/cash-forecast-view";
import { practiceHomeLines } from "../src/lib/owner-answers";
import { reportsIndexRedirect, reportsIndexSearch } from "../src/lib/reports-index-redirect";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

/** Same merge the router applies: validateSearch over the parsed query. */
function searchHref(raw: Record<string, unknown>): string {
  return defaultStringifySearch({ ...raw, ...accountantClientRouteSearch(raw) });
}

function assertSettles(start: string, label: string) {
  const once = searchHref(defaultParseSearch(start));
  const twice = searchHref(defaultParseSearch(once));
  assert(once === twice, `${label} rewrites again: ${once} -> ${twice}`);
  return once;
}

const cash = assertSettles("?tab=cash", "?tab=cash");
assert(cash === "?tab=cash", `cash stays on cash (${cash})`);

const plan = assertSettles("?tab=plan", "?tab=plan");
assert(plan === "?tab=plan", `plan stays on plan (${plan})`);

const actions = assertSettles("?tab=actions", "?tab=actions");
assert(actions.includes("tab=plan") && actions.includes("section=open"), `actions becomes Open work once (${actions})`);

const reportsPlan = assertSettles("?tab=reports&section=plan", "?tab=reports&section=plan");
assert(
  reportsPlan.includes("tab=plan") && reportsPlan.includes("section=open"),
  `reports section=plan becomes Open work once (${reportsPlan})`,
);

const overdue = assertSettles("?tab=plan&filter=overdue", "?tab=plan&filter=overdue");
assert(overdue.includes("tab=plan") && overdue.includes("filter=overdue"), "an overdue filter stays on plan");

const cashOverdue = assertSettles("?tab=cash&filter=overdue", "cash drops a plan filter");
assert(!cashOverdue.includes("filter="), `a plan filter does not stick to cash (${cashOverdue})`);

const aliasOverdue = assertSettles(
  "?tab=reports&section=plan&filter=overdue",
  "alias plus overdue filter",
);
assert(
  aliasOverdue.includes("tab=plan") &&
    aliasOverdue.includes("filter=overdue") &&
    aliasOverdue.includes("section=overdue"),
  `the overdue alias settles on the overdue page (${aliasOverdue})`,
);

const homeRedirect = reportsIndexRedirect(reportsIndexSearch({}));
assert(homeRedirect.to === "/dashboard", "/reports with no client goes Home");
const again = reportsIndexRedirect(reportsIndexSearch({}));
assert(again.to === homeRedirect.to, "/reports to Home does not bounce");

const clientRedirect = reportsIndexRedirect(
  reportsIndexSearch({ clientId: "9110be9b-d912-40df-8419-494ebeeb97d0", action: "nope" }),
);
assert(clientRedirect.to === "/clients/$clientId", "a client id opens that client's reports");
if (clientRedirect.to === "/clients/$clientId") {
  assert(clientRedirect.params.clientId.startsWith("9110be9b"), "the client id is kept");
  assert(clientRedirect.search.tab === "reports", "the client opens on Reports");
  assert(!("report" in clientRedirect.search), "an omitted report is not written as undefined");
  assert(!("action" in clientRedirect.search), "a bad action is not written as undefined");
  const landed = assertSettles(
    defaultStringifySearch(clientRedirect.search),
    "the reports redirect search",
  );
  assert(landed.includes("tab=reports"), `the client reports search stays (${landed})`);
}

const named = reportsIndexRedirect(
  reportsIndexSearch({ client: "9110be9b", report: "scorecard", action: "preview" }),
);
if (named.to === "/clients/$clientId") {
  assert(named.search.report === "scorecard" && named.search.action === "preview", "a real report link is kept");
}

const loadingLines = practiceHomeLines({
  clientCount: 0,
  avgHealth: null,
  needAttention: 0,
  reviewNow: 0,
  openQueries: 0,
  followUps: 0,
  loading: true,
});
assert(
  !loadingLines.financial_manager.join(" ").includes("0 clients"),
  "Home does not say the book is empty while clients are still loading",
);
assert(
  loadingLines.financial_manager[0] === "Loading the book.",
  "Home says the book is loading",
);
const emptyLines = practiceHomeLines({
  clientCount: 0,
  avgHealth: null,
  needAttention: 0,
  reviewNow: 0,
  openQueries: 0,
  followUps: 0,
  loading: false,
});
assert(emptyLines.financial_manager[0] === "0 clients on the book.", "a finished empty book still says zero");

assert(stableCashChartWidth(0, 0) === 0, "an unmeasured chart stays unmeasured");
assert(stableCashChartWidth(0, 820) === 820, "the first real width is kept");
assert(stableCashChartWidth(820, 0) === 820, "a hidden 0-width frame does not reset the chart");
let width = 430;
for (const next of [450, 428, 452, 430, 448]) width = stableCashChartWidth(width, next);
assert(width === 430, "a few pixels around the tick breakpoint do not flip the axis");
assert(stableCashChartWidth(800, 520) === 520, "a real resize is kept");

const clientRoute = readFileSync("src/routes/_authenticated/clients.$clientId.tsx", "utf8");
assert(
  clientRoute.includes('activeTab === "cash" && search.section === "forecast"'),
  "the cash forecast mounts only on its page",
);
assert(
  clientRoute.includes('activeTab === "profit" && search.section === "waterfall"'),
  "the waterfall mounts only on its page",
);
assert(
  clientRoute.includes('activeTab === "budget" && (search.section === "year" || search.section === "months")'),
  "the budget chart mounts only on a budget page",
);
const cashAt = clientRoute.indexOf('id="pane-cash"');
const cashGate = clientRoute.indexOf('activeTab === "cash" && search.section === "forecast"', cashAt);
const cashPanel = clientRoute.indexOf("<CashForecastPanel", cashAt);
assert(cashGate !== -1 && cashGate < cashPanel, "CashForecastPanel is inside the cash-tab gate");

const board = readFileSync("src/components/practice-board.tsx", "utf8");
const paint = board.indexOf("const lightRows = rawClients.map((c) => lightClientRow(c))");
const publish = board.indexOf("setClientRows(lightRows)");
const history = board.indexOf("client_score_history");
assert(
  paint !== -1 && publish > paint && history > publish,
  "clients are shown before score history is loaded",
);
assert(board.includes("accountantPortalStay"), "a known accountant does not wait on the role check again");
assert(board.includes("rememberPaintedBook"), "a painted book is reused when All clients remounts");
assert(
  clientRoute.includes("Loading the plan…"),
  "the action plan chunk has a visible fallback",
);

const reportsRoute = readFileSync("src/routes/_authenticated/reports.index.tsx", "utf8");
assert(reportsRoute.includes("component: ReportsIndexRedirect"), "/reports has a component so the redirect can settle");
assert(reportsRoute.includes("replace: true"), "/reports replaces instead of pushing a loop");

console.log("p0 shell hang guards ok");
