/**
 * Accountant client Home: team cards, then Needs attention, Team progress, Books connection.
 * Run: pnpm test:client-home-paged
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  accountantClientRouteSearch,
  accountantClientTabSearch,
  accountantValidatedSearch,
} from "../src/lib/client-route-search";
import { buildFinancialManagerBrief } from "../src/lib/financial-manager-brief";
import { homeAttentionItems } from "../src/lib/home-attention";
import {
  HOME_PAGED_LABEL,
  HOME_PAGED_VIEWS,
  homePagedSearch,
  homePagedViewFromSearch,
} from "../src/lib/home-paged-view";
import { homeWorkLog, type WorkLogFinding } from "../src/lib/home-work-log";
import { formatMoney } from "../src/lib/market/format";
import { ZA_MARKET } from "../src/lib/market";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// Menu and search.
assert(HOME_PAGED_VIEWS.join(",") === "attention,progress,books", "three panes in order");
assert(HOME_PAGED_LABEL.attention === "Needs attention", HOME_PAGED_LABEL.attention);
assert(HOME_PAGED_LABEL.progress === "Team progress", HOME_PAGED_LABEL.progress);
assert(HOME_PAGED_LABEL.books === "Books connection", HOME_PAGED_LABEL.books);
assert(homePagedViewFromSearch(undefined) === "attention", "Home opens on Needs attention");
assert(homePagedViewFromSearch("13week") === "attention", "a cash view does not pick a Home pane");
assert(homePagedViewFromSearch("progress") === "progress", "view=progress opens Team progress");
assert(
  !("view" in homePagedSearch({ tab: "home", view: "books" }, "attention")),
  "Needs attention drops view",
);
assert(
  homePagedSearch({ tab: "home" }, "books").view === "books",
  "Books connection writes view=books",
);
for (const view of HOME_PAGED_VIEWS) {
  const kept = accountantValidatedSearch({ tab: "home", view });
  assert(kept.tab === "home" && kept.section === undefined, `view=${view} stays on Home`);
}
assert(
  accountantClientRouteSearch({ tab: "home", view: "progress" }).view === "progress",
  "the route keeps view=progress",
);
assert(
  accountantClientRouteSearch({ view: "books" }).view === "books",
  "a bare view=books is Home",
);
assert(
  accountantClientRouteSearch({ tab: "cash", view: "books" }).view === undefined,
  "Cash ignores a Home view",
);
const left = accountantClientTabSearch(
  { tab: "home", view: "progress" } as Record<string, unknown>,
  "reports",
  {
    section: "drafts",
  },
);
assert(!("view" in left), "leaving Home drops the Home pane");
const cash = accountantClientTabSearch(
  { tab: "cash", view: "13week" } as Record<string, unknown>,
  "cash",
  {
    section: "forecast",
  },
);
assert(cash.view === "13week", "a cash view is not touched");

// Needs attention.
const money = (amount: number) => formatMoney(amount, ZA_MARKET);
const brief = buildFinancialManagerBrief({
  clientName: "Harbour Glass",
  currentFinancials: { revenue: 420000, receivables: 120000 },
  snapshots: [],
  openActionTitles: ["Collect the deposit", "File the VAT return"],
  overdueActions: 1,
  actionsReady: true,
  draftsReady: true,
  receivables: 120000,
  drafts: [{ id: "d1", title: "Debtor days need a closer look.", label: "Advisory" }],
  formatMoney: money,
});
const items = homeAttentionItems({
  brief,
  planHeading: "2 open, 1 overdue",
  planMore: true,
  reportsLine: "1 ready to send",
  booksMissing: true,
});
const kinds = items.map((item) => item.kind).join(",");
assert(kinds === "books,hand,hand,chase,draft,plan,reports", kinds);
const draft = items.find((item) => item.kind === "draft");
assert(
  draft?.kind === "draft" && draft.title === "Advisory draft" && draft.draftId === "d1",
  "the draft row names the document",
);
assert(
  homeAttentionItems({ brief: { ...brief, actions: [], drafts: [] } }).length === 0,
  "nothing to act on is an empty list",
);

// Team progress.
const draftEvidence = { draft: true, requires_human_approval: true };
const findings: WorkLogFinding[] = [
  {
    id: "f-hand",
    agent: "analyst",
    kind: "action_point_draft",
    evidence: draftEvidence,
    created_at: "2026-10-20T09:00:00Z",
  },
  {
    id: "f-adv",
    agent: "advisor",
    kind: "advisory_deliverable_draft",
    evidence: draftEvidence,
    created_at: "2026-10-22T09:00:00Z",
  },
  {
    id: "f-ok",
    agent: "financial_manager",
    kind: "data_request_draft",
    evidence: draftEvidence,
    created_at: "2026-10-10T09:00:00Z",
    status: "approved",
    approved_at: "2026-10-12T09:00:00Z",
  },
  {
    id: "f-gone",
    agent: "analyst",
    kind: "action_point_draft",
    evidence: draftEvidence,
    created_at: "2026-10-25T09:00:00Z",
    status: "dismissed",
  },
  {
    id: "f-info",
    agent: "analyst",
    kind: "ratio",
    evidence: {},
    created_at: "2026-10-26T09:00:00Z",
  },
];
const log = homeWorkLog({
  findings,
  handoffs: [
    {
      id: "a1",
      title: "Collect the deposit",
      assignee: "Analyst",
      agent: "analyst",
      run: { id: "r1", agent: "analyst", status: "succeeded", at: "2026-10-21T09:00:00Z" },
      draftId: "f-hand",
    },
    {
      id: "a2",
      title: "File the VAT return",
      assignee: "Advisor",
      agent: "advisor",
      run: { id: "r2", agent: "advisor", status: "running", at: "2026-10-27T09:00:00Z" },
    },
    {
      id: "a3",
      title: "Chase the bank letter",
      assignee: "Thandi",
      openedAt: "2026-10-18T09:00:00Z",
    },
    { id: "a4", title: "Unassigned", assignee: null },
    {
      id: "a5",
      title: "Reconcile the loan",
      assignee: "Financial Manager",
      agent: "financial_manager",
      run: { id: "r5", agent: "financial_manager", status: "failed", at: "2026-10-15T09:00:00Z" },
    },
  ],
});
const keys = log.rows.map((row) => row.key).join(",");
assert(keys === "action-a2,draft-f-adv,action-a1,action-a3,action-a5,draft-f-ok", keys);
const [working, advisory, handed, person, failed, approved] = log.rows;
assert(
  working?.who === "Advisor" && working.status === "Working" && working.next === "Draft to follow",
  "running reads Working",
);
assert(
  advisory?.what === "Drafted advisory notes" && advisory.draftId === "f-adv",
  "a draft row names the document kind",
);
assert(
  handed?.status === "Draft ready" &&
    handed.next === "Review the draft" &&
    handed.draftId === "f-hand",
  "a finished hand-off links its draft",
);
assert(person?.who === "Thandi" && person.state === "assigned", "a person keeps their name");
assert(
  failed?.retry?.actionItemId === "a5" && failed.next === "Hand it on again",
  "a failed run offers Retry",
);
assert(
  approved?.status === "Approved" &&
    approved.at === "2026-10-12T09:00:00Z" &&
    approved.next == null,
  "approved is dated by the approval",
);
assert(!log.rows.some((row) => row.draftId === "f-gone"), "a dismissed draft stays off");
assert(
  log.rows.filter((row) => row.draftId === "f-hand").length === 1,
  "a hand-off draft is listed once",
);
for (const row of log.rows) {
  assert(
    !/Debtor|figures|ratio/i.test(row.what),
    `rows do not quote the stored sentence (${row.what})`,
  );
}
const capped = homeWorkLog({ findings, handoffs: [], limit: 1 });
assert(capped.rows.length === 1 && capped.more === 2, `limit counts the rest (${capped.more})`);

// The Home pane and the components.
const page = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
const home = page.slice(page.indexOf('id="pane-overview"'), page.indexOf('id="pane-summary"'));
assert(home.indexOf("<OwnerHome") < home.indexOf("<ClientHomePaged"), "Financial team first");
assert(
  home.indexOf("<ConnectBooksHomeCard") > home.indexOf("<ClientHomePaged"),
  "connect card is in the Books pane",
);
assert(home.includes("bare"), "the connect card sits in the pane without its own card");
const container = readFileSync(resolve("src/components/client-home/client-home-paged.tsx"), "utf8");
const menu = readFileSync(resolve("src/components/client-home/home-paged-menu.tsx"), "utf8");
assert(
  container.includes("cash-paged__pane") && container.includes('role="tabpanel"'),
  "same pane as the cash forecast",
);
assert(
  menu.includes("cash-menu__tab") && menu.includes('role="tab"'),
  "same block menu as the cash forecast",
);
// Switching panes keeps the page where it is: no router scroll reset, and the
// menu is held on screen while a shorter pane mounts.
for (const helper of ["homePagedSearch", "cashPagedSearch", "budgetPagedSearch"]) {
  const at = page.indexOf(`${helper}(prev, next)`);
  assert(at > 0, `${helper} is used by the route`);
  assert(
    page.slice(at, at + 120).includes("resetScroll: false"),
    `${helper} navigation keeps the scroll position`,
  );
}
assert(
  container.includes("useLayoutEffect") && container.includes("data-home-paged-spacer"),
  "the menu is held in place across a pane switch",
);
const attentionCss = readFileSync(resolve("src/components/financial-manager-brief.css"), "utf8");
assert(
  attentionCss.includes("#0b5fff") && !/#(?:16a34a|22c55e|10b981)/i.test(attentionCss),
  "cobalt actions, no greens",
);

console.log("client-home-paged-test: ok");
