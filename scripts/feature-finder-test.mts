/**
 * Feature finder — fuzzy jump list and the routes it opens.
 * Run: pnpm test:feature-finder
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { FeatureFinder } from "../src/components/feature-finder.tsx";
import { COACH_STEPS } from "../src/lib/workflow-coach.ts";
import {
  featureFinderShortcutLabel,
  featureHref,
  featureIndex,
  isFeatureFinderShortcut,
  searchFeatures,
  type FeatureDestination,
} from "../src/lib/feature-finder.ts";
import {
  CLIENTS_GROUP,
  clientFileHref,
  includeClientGroup,
  paletteEmptyCopy,
  searchClients,
  type FinderClient,
} from "../src/lib/feature-finder-clients.ts";
import { firmClientOrFilter } from "../src/lib/firm-client-list.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const CLIENT = "11111111-1111-1111-1111-111111111111";
const studio = { audience: "accountant" as const, clientId: CLIENT };
const firm = { audience: "accountant" as const, clientId: null };
const owner = { audience: "owner" as const, clientId: CLIENT };

function ids(query: string, ctx: typeof studio) {
  return searchFeatures(query, ctx).results.map((r) => r.id);
}

function href(query: string, ctx: typeof studio) {
  const hit = searchFeatures(query, ctx).results[0];
  assert(!!hit, `no hit for ${JSON.stringify(query)}`);
  return hit.href;
}

function coach(id: string) {
  const step = COACH_STEPS.find((s) => s.id === id);
  assert(!!step, `coach step ${id}`);
  return step;
}

assert(ids("AR", studio)[0] === "collections", "AR opens Collections");
assert(ids("aged receivables", studio)[0] === "collections", "aged receivables opens Collections");
assert(ids("ap", studio)[0] === "payables", "AP opens Payables");
assert(ids("aged creditors", studio)[0] === "payables", "aged creditors opens Payables");
assert(ids("xero", studio)[0] === "data-sync", "Xero opens connect/sync");
assert(ids("QBO", studio)[0] === "data-sync", "QBO opens connect/sync");
assert(ids("QuickBooks", studio)[0] === "data-sync", "QuickBooks opens connect/sync");
assert(ids("drafts", studio)[0] === "bot", "drafts opens Milōn Bot");
assert(ids("sign-off", studio)[0] === "action-plan", "sign-off opens Action Plan");
assert(ids("paybles", studio)[0] === "payables", "fuzzy paybles opens Payables");

assert(
  href("health", studio) === `/clients/${CLIENT}?tab=${coach("health").tab}&focus=health`,
  "Health uses the coach ratios tab and health focus",
);
assert(
  href("pillars", studio) === `/clients/${CLIENT}?tab=${coach("pillars").tab}&focus=pillars`,
  "Pillars uses the coach focus",
);
assert(href("profitability", studio).endsWith("tab=profit"), "Profitability tab");
assert(href("cash", studio).endsWith("tab=cash"), "Cash tab");
assert(href("budget", studio).endsWith("tab=budget"), "Budget tab");
assert(href("collections", studio).endsWith("tab=collections"), "Collections tab");
assert(href("payables", studio).endsWith("tab=payables"), "Payables tab");
assert(href("bot", studio).endsWith("tab=ask"), "Bot tab");
assert(
  href("actions", studio) === `/clients/${CLIENT}?tab=${coach("actions").tab}`,
  "Action Plan uses the coach actions tab",
);
assert(
  href("sync", studio) === `/clients/${CLIENT}?tab=${coach("data").tab}`,
  "Data & sync uses the coach data tab",
);
assert(
  href("upload", studio) === `/clients/${CLIENT}?tab=${coach("data").tab}&onboard=1`,
  "Upload reuses the onboard deep link on Client Brain",
);
assert(href("clients", studio) === "/dashboard", "Clients opens the practice list");
assert(href("billing", studio) === "/settings", "Billing opens Settings");
assert(href("stripe", firm) === "/settings", "Billing is available without a client");

assert(ids("health", firm).length === 0, "Health is hidden on the firm dashboard");
assert(searchFeatures("health", firm).needsClient, "Health without a client explains why");
assert(ids("clients", firm)[0] === "clients", "Practice clients still listed without a client");
assert(!ids("ar", studio).includes("action-plan"), "AR does not open Action Plan");
assert(ids("ca", studio)[0] === "cash", "ca prefers Cash over Collections");

assert(href("health", owner) === "/app?tab=today", "owner Health");
assert(href("pillars", owner) === "/app?tab=today", "owner pillars land on Health");
assert(href("profit", owner) === "/app?tab=waterfall", "owner Profitability");
assert(href("cash", owner) === "/app?tab=cash", "owner Cash");
assert(href("budget", owner) === "/app?tab=budget", "owner Budget");
assert(href("sign off", owner) === "/app?tab=tasks", "owner Action Plan");
assert(ids("collections", owner).length === 0, "owner has no Collections route");
assert(ids("xero", owner).length === 0, "owner has no connect route");
assert(ids("billing", owner).length === 0, "billing stays on the practice side");

const accountantIds = featureIndex("accountant").map((row) => row.id);
for (const id of [
  "health",
  "pillars",
  "profitability",
  "cash",
  "budget",
  "collections",
  "payables",
  "bot",
  "action-plan",
  "data-sync",
  "upload",
  "clients",
  "billing",
]) {
  assert(accountantIds.includes(id), `indexed ${id}`);
}

const collections = featureIndex("accountant").find((row) => row.id === "collections");
assert(
  collections?.synonyms.includes("ar") && collections.synonyms.includes("aged receivables"),
  "AR synonyms",
);
const payables = featureIndex("accountant").find((row) => row.id === "payables");
assert(payables?.synonyms.includes("ap"), "AP synonym");
const data = featureIndex("accountant").find((row) => row.id === "data-sync");
assert(
  !!data && ["xero", "qbo", "quickbooks"].every((word) => data.synonyms.includes(word)),
  "connect synonyms",
);

const key = { key: "k", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };
assert(isFeatureFinderShortcut({ ...key, metaKey: true }, "MacIntel"), "Cmd+K on Mac");
assert(
  !isFeatureFinderShortcut({ ...key, ctrlKey: true }, "MacIntel"),
  "Ctrl+K is not the Mac shortcut",
);
assert(isFeatureFinderShortcut({ ...key, ctrlKey: true }, "Linux x86_64"), "Ctrl+K elsewhere");
assert(
  !isFeatureFinderShortcut({ ...key, metaKey: true }, "Win32"),
  "Cmd is not the Windows shortcut",
);
assert(
  !isFeatureFinderShortcut({ ...key, metaKey: true, shiftKey: true }, "MacIntel"),
  "Shift+Cmd+K is ignored",
);
assert(featureFinderShortcutLabel(true) === "⌘K", "Mac label");
assert(featureFinderShortcutLabel(false) === "Ctrl+K", "other label");

const sample: FeatureDestination = {
  kind: "client",
  clientId: CLIENT,
  search: { tab: "ratios", focus: "health" },
};
assert(featureHref(sample).includes("focus=health"), "href keeps focus");

const YANKEES = "22222222-2222-2222-2222-222222222222";
const SOX = "33333333-3333-3333-3333-333333333333";
const BOOK: FinderClient[] = [
  { id: YANKEES, name: "New York Yankees", clientCode: "MLN-004821" },
  { id: SOX, name: "Boston Red Sox", clientCode: "MLN-110000" },
  { id: "44444444-4444-4444-4444-444444444444", name: "Cash Register Co", clientCode: null },
];

const yankees = searchClients("Yankees", BOOK);
assert(yankees.length === 1, "Yankees matches one client");
assert(yankees[0]?.label === "New York Yankees", "Yankees label is the client name");
assert(yankees[0]?.group === CLIENTS_GROUP, "client hits sit in the Clients group");
assert(yankees[0]?.hint === "MLN-004821", "client code is the hint");
assert(yankees[0]?.href === clientFileHref(YANKEES), "client href is the client page");
assert(yankees[0]?.href === `/clients/${YANKEES}`, "client href has no studio tab");
assert(!yankees[0]?.href.includes("tab="), "client jump does not force a tab");
assert(searchClients("yankees", BOOK)[0]?.clientId === YANKEES, "name match is case-insensitive");
assert(searchClients("new york", BOOK)[0]?.clientId === YANKEES, "multi-word name matches");
assert(searchClients("MLN-004821", BOOK)[0]?.clientId === YANKEES, "client code matches");
assert(searchClients("mln004821", BOOK)[0]?.clientId === YANKEES, "code matches without a hyphen");
assert(searchClients("004821", BOOK)[0]?.clientId === YANKEES, "code suffix matches");
assert(
  searchClients("Yankees", BOOK).every((hit) => hit.clientId !== SOX),
  "Yankees skips other clients",
);
const paletteValues = [
  ...searchFeatures("", studio).results.map((row) => row.id),
  ...searchClients("york", BOOK).map((row) => row.id),
];
assert(
  new Set(paletteValues).size === paletteValues.length,
  "feature and client values stay unique so keyboard nav can cross groups",
);
assert(searchClients("zzz-no-such", BOOK).length === 0, "unknown query matches no clients");
assert(searchClients("", BOOK).length === 0, "empty query does not dump the whole book");
assert(searchClients("   ", BOOK).length === 0, "blank query matches no clients");

const bothNamedNew = searchClients("new", BOOK).map((hit) => hit.clientId);
assert(bothNamedNew.includes(YANKEES) && !bothNamedNew.includes(SOX), "new matches Yankees only");
const cashClients = searchClients("cash", BOOK);
assert(cashClients[0]?.label === "Cash Register Co", "cash matches a client by name");
assert(
  searchFeatures("Yankees", firm).results.length === 0 &&
    !searchFeatures("Yankees", firm).needsClient,
  "Yankees is not a feature",
);
assert(
  searchFeatures("cash", firm).results.length === 0,
  "cash on the firm dashboard is not a selectable feature",
);
assert(searchClients("cash", BOOK).length === 1, "cash still finds the client");

assert(includeClientGroup("accountant"), "accountants get the Clients group");
assert(!includeClientGroup("owner"), "owner accounts hide the Clients group");

const firmId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const userId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
assert(
  firmClientOrFilter(firmId, userId) ===
    `firm_id.eq.${firmId},and(firm_id.is.null,owner_user_id.eq.${userId})`,
  "client list uses the dashboard firm filter",
);

const noHits = { needsClient: false, featureCount: 0, clientCount: 0, clientsLoading: false };
assert(paletteEmptyCopy(noHits) === "No matches.", "nothing at all says No matches");
assert(
  !paletteEmptyCopy(noHits).includes("No matching features"),
  "empty state is not features-only",
);
assert(
  paletteEmptyCopy({ ...noHits, clientCount: 1 }) === "",
  "client hits are not an empty feature search",
);
assert(
  paletteEmptyCopy({ ...noHits, featureCount: 2, clientCount: 1 }) === "",
  "features and clients together are not empty",
);
assert(
  paletteEmptyCopy({ ...noHits, needsClient: true }) ===
    "Open a client to jump to Health, Cash, Collections, and the rest.",
  "a studio feature with no client and no client hit still explains why",
);
assert(
  paletteEmptyCopy({ ...noHits, needsClient: true, clientCount: 1 }) === "",
  "a client hit wins over the studio hint",
);
assert(
  paletteEmptyCopy({ ...noHits, clientsLoading: true }) === "Searching clients…",
  "loading clients is not an empty result",
);

const rootRoute = createRootRoute({
  component: () =>
    createElement(FeatureFinder, { audience: "accountant", clientId: CLIENT, chrome: "portal" }),
});
const router = createRouter({
  routeTree: rootRoute,
  history: createMemoryHistory({ initialEntries: ["/"] }),
});
await router.load();
const html = renderToStaticMarkup(createElement(RouterProvider, { router }));
assert(html.includes("feature-finder-trigger"), "portal trigger renders");
assert(html.includes("Search…"), "trigger is labeled Search");
assert(html.includes('aria-haspopup="dialog"'), "trigger opens a dialog");
assert(html.includes("Ctrl+K") || html.includes("⌘K"), "trigger shows the shortcut");

const finderSrc = readFileSync(
  new URL("../src/components/feature-finder.tsx", import.meta.url),
  "utf8",
);
assert(finderSrc.includes("CLIENTS_GROUP"), "palette renders a Clients group");
assert(finderSrc.includes("searchClients"), "palette filters the loaded client list");
assert(
  finderSrc.includes('to: "/clients/$clientId"') && finderSrc.includes("search: {}"),
  "selecting a client opens the dashboard client route",
);
assert(!finderSrc.includes("No matching features"), "empty copy is not features-only");

const listSrc = readFileSync(new URL("../src/lib/firm-client-list.ts", import.meta.url), "utf8");
assert(
  listSrc.includes('from "@/integrations/supabase/client"'),
  "client list uses the signed-in Supabase client",
);
assert(!listSrc.includes("client.server"), "client list does not use the service role");
assert(!listSrc.includes("supabaseAdmin"), "client list does not use the admin client");

console.log("feature-finder: ok");
