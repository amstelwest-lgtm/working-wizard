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
  paletteClients,
  paletteEmptyCopy,
  recentFinderClients,
  searchClientSectionJumps,
  searchClients,
  shortClientId,
  finderAddedLabel,
  finderBusinessName,
  type FinderClient,
} from "../src/lib/feature-finder-clients.ts";
import { firmClientOrFilter } from "../src/lib/firm-client-list.ts";
import {
  createFeatureFinderHotkeyBus,
  toggleFinderOpen,
  type FeatureFinderHotkeyEvent,
} from "../src/lib/feature-finder-hotkey.ts";

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
  href("health", studio) === `/clients/${CLIENT}?tab=health&section=score&focus=health`,
  "Health is its own rail item",
);
assert(
  href("pillars", studio) ===
    `/clients/${CLIENT}?tab=${coach("pillars").tab}&section=${coach("pillars").section}&focus=pillars`,
  "Pillars stay on Health",
);
assert(href("profitability", studio).includes("tab=profit"), "Profit is its own rail item");
assert(href("cash", studio).includes("tab=cash"), "Cash flow is its own rail item");
assert(href("budget", studio).includes("tab=budget"), "Budget is its own rail item");
assert(href("collections", studio).includes("section=collections"), "Collections stays under Cash flow");
assert(href("payables", studio).includes("section=payables"), "Payables stay under Cash flow");
assert(href("bot", studio).endsWith("tab=home"), "Bot inside a client file opens that client's Home");
assert(href("bot", firm) === "/dashboard", "Bot from practice opens practice Home");
assert(href("drafts", firm) === "/dashboard", "Drafts from practice open practice Home");
assert(href("overview", studio).endsWith("tab=home"), "the briefing opens Home");
assert(href("moves", studio).includes("tab=moves"), "Next moves is its own rail item");
assert(href("tax", studio) === `/clients/${CLIENT}?tab=tax`, "Tax is its own Work rail item");
assert(ids("tax specialist", studio)[0] === "tax", "tax specialist opens Tax");
assert(!ids("tax", owner).includes("tax"), "the owner finder has no Tax page");
assert(href("reports", studio).includes("tab=reports"), "Reports is its own rail item");
assert(
  href("advisory pack", studio).includes("tab=reports") &&
    href("advisory pack", studio).includes("section=drafts"),
  "Advisory pack opens Reports drafts",
);
assert(href("drafter", studio).includes("section=drafts"), "Advisory drafter opens Reports drafts");
assert(
  href("actions", studio) === `/clients/${CLIENT}?tab=plan&section=open`,
  "Action Plan is its own rail item",
);
assert(
  href("sync", studio) === `/clients/${CLIENT}?tab=${coach("data").tab}&section=${coach("data").section}`,
  "Data & sync opens Client portal",
);
assert(
  href("upload", studio) ===
    `/clients/${CLIENT}?tab=${coach("data").tab}&section=${coach("data").section}&onboard=1`,
  "Upload reuses the onboard deep link on Client portal",
);
assert(href("clients", studio) === "/clients", "Clients opens the client list");
assert(href("billing", studio) === "/settings", "Billing opens Settings");
assert(href("stripe", firm) === "/settings", "Billing is available without a client");
const firmEmpty = searchFeatures("", firm).results.map((row) => row.label);
for (const label of [
  "Home",
  "Clients",
  "Open queries",
  "Needs attention",
  "Follow up",
  "Insights",
  "Marketplace",
  "Playbooks",
  "Billing",
]) {
  assert(firmEmpty.includes(label), `empty practice search lists ${label}`);
}
for (const [label, path] of [
  ["open queries", "/clients/queries"],
  ["needs attention", "/practice/needs-attention"],
  ["follow up", "/practice/follow-up"],
  ["insights", "/practice/insights"],
  ["marketplace", "/practice/marketplace"],
  ["playbooks", "/practice/playbooks"],
] as const) {
  const address = href(label, firm);
  assert(address === path, `${label} opens ${path}, got ${address}`);
  assert(!address.includes("#"), `${label} is a route, not an anchor`);
}
const emptyPracticeHrefs = searchFeatures("", firm).results.map((row) => row.href);
assert(
  emptyPracticeHrefs.includes("/practice/needs-attention"),
  "an empty palette lists the needs-attention route",
);
assert(
  !emptyPracticeHrefs.some((address) => address.includes("#")),
  "an empty practice palette does not list anchors",
);

assert(ids("health", firm).length === 0, "Health is hidden on the firm dashboard");
assert(searchFeatures("health", firm).needsClient, "Health without a client explains why");
assert(ids("clients", firm)[0] === "clients", "Practice clients still listed without a client");
assert(!ids("ar", studio).includes("action-plan"), "AR does not open Action Plan");
assert(ids("ca", studio)[0] === "cash", "ca prefers Cash over Collections");

assert(href("health", owner) === "/app?tab=health", "owner Health");
assert(href("pillars", owner) === "/app?tab=health", "owner pillars land on Health");
assert(href("profit", owner) === "/app?tab=profit", "owner Profitability");
assert(href("cash", owner) === "/app?tab=cash", "owner Cash");
assert(href("budget", owner) === "/app?tab=budget", "owner Budget");
assert(href("sign off", owner) === "/app?tab=moves", "owner Action Plan");
assert(ids("collections", owner).length === 0, "owner has no Collections route");
assert(ids("xero", owner).length === 0, "owner has no connect route");
assert(ids("billing", owner).length === 0, "billing stays on the practice side");

const accountantIds = featureIndex("accountant").map((row) => row.id);
for (const id of [
  "overview",
  "health",
  "pillars",
  "profitability",
  "cash",
  "budget",
  "collections",
  "payables",
  "moves",
  "bot",
  "action-plan",
  "reports",
  "advisory-pack",
  "advisory-drafter",
  "data-sync",
  "upload",
  "clients",
  "billing",
  "practice-home",
  "open-queries",
  "needs-attention",
  "follow-up",
  "portfolio-insights",
  "marketplace",
  "playbooks",
]) {
  assert(accountantIds.includes(id), `indexed ${id}`);
}

const collections = featureIndex("accountant").find((row) => row.id === "collections");
assert(
  collections?.synonyms.includes("ar") && collections.synonyms.includes("aged receivables"),
  "AR synonyms",
);
const budgetVocab = featureIndex("accountant").find((row) => row.id === "budget");
assert(
  budgetVocab?.synonyms.includes("budget") && budgetVocab.synonyms.includes("budget variance"),
  "Budget is in the palette search vocabulary",
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
  search: { tab: "overview", section: "health", focus: "health" },
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
const recent = recentFinderClients(BOOK);
assert(recent.length === BOOK.length, "recent clients follow the loaded order");
assert(recent[0]?.id === YANKEES, "the first loaded client is the first recent row");
assert(recentFinderClients(BOOK, 2).length === 2, "the recent list is capped");
assert(
  paletteClients("", BOOK).map((row) => row.id).join() === recent.map((row) => row.id).join(),
  "an empty palette shows recent clients",
);
assert(paletteClients("yankees", BOOK).length === 1, "a typed query still searches");
assert(searchClients("   ", BOOK).length === 0, "blank query matches no clients");

const THEO = "Theo van der Westhuizen";
const THEO_A = "2d31b10a-a2b4-4451-a65a-6c61b32c1fa3";
const THEO_B = "334bb8ee-8246-443d-967d-cf72d94d8a89";
const THEO_C = "ef4ee372-a453-4ada-943c-d7c0642c81f8";
const THEO_D = "db1293bb-cf37-43aa-bafb-0580a9fd1ed5";
const THEO_E = "442c2e76-8976-4a97-95da-9cad6c01fe74";
const theoBook: FinderClient[] = [
  {
    id: THEO_A,
    name: THEO,
    clientCode: null,
    businessName: "Chill Pepper",
    ownerEmail: "amstel.west@gmail.com",
    createdAt: "2026-03-03T00:00:00.000Z",
  },
  { id: THEO_A, name: THEO, clientCode: null, businessName: "Chill Pepper" },
  {
    id: THEO_B,
    name: THEO,
    clientCode: null,
    businessName: THEO,
    ownerEmail: "amstel.west@gmail.com",
    createdAt: "2026-04-04T00:00:00.000Z",
  },
  {
    id: THEO_C,
    name: THEO,
    clientCode: null,
    ownerEmail: "jack@marflem.co.za",
    createdAt: "2026-05-05T00:00:00.000Z",
  },
  { id: THEO_D, name: THEO, clientCode: null, createdAt: "2026-06-06T12:00:00.000Z" },
  { id: THEO_E, name: THEO, clientCode: null },
  { id: YANKEES, name: "New York Yankees", clientCode: "MLN-004821" },
];
assert(
  finderBusinessName(THEO, [THEO, "Westhuizen Trading"]) === "Westhuizen Trading",
  "a company name is kept only when it is not the person's name",
);
assert(finderAddedLabel("2026-03-03T00:00:00.000Z") === "added 3 Mar 2026", "a missing market stays day-first");
assert(
  finderAddedLabel("2026-10-20T12:00:00.000Z", { market: { country: "US", regionCode: "NY" } }) ===
    "added Oct 20, 2026",
  "a US client uses month-day",
);
const theoRecent = recentFinderClients(theoBook);
assert(theoRecent.length === 6, "duplicate client ids collapse to one recent row");
assert(
  theoRecent.filter((row) => row.clientId === THEO_A).length === 1,
  "the same Theo id is listed once",
);
assert(
  theoRecent.find((row) => row.clientId === THEO_A)?.hint === "Chill Pepper",
  "a different business name is the hint",
);
assert(
  theoRecent.find((row) => row.clientId === THEO_B)?.hint === "amstel.west@gmail.com",
  "a business name that matches the person falls through to the owner email",
);
assert(
  theoRecent.find((row) => row.clientId === THEO_C)?.hint === "jack@marflem.co.za",
  "an owner email is the hint when there is no business name",
);
assert(
  theoRecent.find((row) => row.clientId === THEO_D)?.hint === "added 6 Jun 2026",
  "the added date is the hint when there is no business name or email",
);
assert(
  theoRecent.find((row) => row.clientId === THEO_E)?.hint === shortClientId(THEO_E),
  "the short id is used only when nothing else is stored",
);
assert(
  !theoRecent.some((row) => row.hint === shortClientId(THEO_A) || row.hint === shortClientId(THEO_B)),
  "a readable Theo is not labelled with a hash",
);
assert(
  theoRecent.find((row) => row.clientId === YANKEES)?.hint === "MLN-004821",
  "a unique name keeps its client code",
);
const theoSearch = searchClients("theo", theoBook);
assert(theoSearch.length === 5, "a typed query lists each same-name client once");
assert(
  new Set(theoSearch.map((row) => row.hint)).size === 5,
  "search hints for shared names are not identical",
);
const theoCash = searchClientSectionJumps("cash", theoBook);
assert(
  theoCash.filter((row) => row.label.startsWith("Cash for Theo")).length === 5,
  "a section jump keeps every same-name client",
);
assert(
  theoCash.some((row) => row.label === `Cash for ${THEO} · Chill Pepper`),
  "a section jump names the business, not the id",
);

const OWNER_EMAIL = "amstel.west@gmail.com";
const SAME_DAY = "2026-09-10T08:00:00.000Z";
const prodFour: FinderClient[] = [
  { id: THEO_A, name: THEO, clientCode: null, ownerEmail: OWNER_EMAIL, createdAt: SAME_DAY },
  { id: THEO_B, name: THEO, clientCode: null, ownerEmail: OWNER_EMAIL, createdAt: "2026-09-10T18:30:00.000Z" },
  { id: THEO_C, name: THEO, clientCode: null, ownerEmail: OWNER_EMAIL, createdAt: "2026-08-02T00:00:00.000Z" },
  { id: THEO_D, name: THEO, clientCode: null, ownerEmail: OWNER_EMAIL, createdAt: "2026-07-15T00:00:00.000Z" },
];
const prodFourHints = new Map(recentFinderClients(prodFour).map((row) => [row.clientId, row.hint]));
assert(new Set(prodFourHints.values()).size === 4, "four same-email Theos get distinct labels");
assert(
  ![...prodFourHints.values()].some((hint) => hint === OWNER_EMAIL),
  "an email shared by the group is never the whole label",
);
assert(
  prodFourHints.get(THEO_C) === `${OWNER_EMAIL} · added 2 Aug 2026`,
  "a different added day is email plus that date",
);
assert(
  prodFourHints.get(THEO_D) === `${OWNER_EMAIL} · added 15 Jul 2026`,
  "the other different day is email plus that date",
);
assert(
  prodFourHints.get(THEO_A) === `${OWNER_EMAIL} · added 10 Sep 2026 · ${shortClientId(THEO_A)}`,
  "the first same-day row keeps the short id",
);
assert(
  prodFourHints.get(THEO_B) === `${OWNER_EMAIL} · added 10 Sep 2026 · ${shortClientId(THEO_B)}`,
  "the other same-day row keeps its own short id",
);
assert(
  [THEO_C, THEO_D].every((id) => !prodFourHints.get(id)?.includes(shortClientId(id))),
  "only the same-day pair gets the short id",
);
const prodFourCash = searchClientSectionJumps("cash", prodFour);
assert(
  prodFourCash.some((row) => row.label === `Cash for ${THEO} · ${prodFourHints.get(THEO_A)}`),
  "a section jump uses the same unique label",
);
assert(
  new Set(searchClients("theo", prodFour).map((row) => row.hint)).size === 4,
  "search keeps the four same-email labels distinct",
);

const prodFive: FinderClient[] = [
  ...prodFour,
  { id: THEO_E, name: THEO, clientCode: null, createdAt: SAME_DAY },
];
const prodFiveHints = new Map(recentFinderClients(prodFive).map((row) => [row.clientId, row.hint]));
assert(prodFiveHints.size === 5, "the fifth Theo with no email stays in the list");
assert(new Set(prodFiveHints.values()).size === 5, "five same-name rows, one without email, stay distinct");
assert(
  prodFiveHints.get(THEO_E) === "added 10 Sep 2026",
  "a row with no readable email shows the added day",
);
assert(
  prodFiveHints.get(THEO_E) !== prodFiveHints.get(THEO_A),
  "10 Sep on the no-email row does not match the emailed same-day label",
);

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

const cashJumps = searchClientSectionJumps("cash", BOOK);
assert(
  cashJumps.length === BOOK.length,
  "cash lists a jump for every client on the firm dashboard",
);
assert(
  cashJumps.every((row) => row.label.startsWith("Cash for ") && row.href.includes("tab=cash")),
  "cash jumps open that client's Cash tab",
);
assert(
  cashJumps.some((row) => row.label === "Cash for New York Yankees" && row.hint === "MLN-004821"),
  "cash jump names the client and keeps the client code",
);
assert(
  cashJumps.every((row) => row.id.startsWith("cash:") && !row.id.startsWith("client:")),
  "section jump ids do not collide with client rows",
);
const budgetJumps = searchClientSectionJumps("budget", BOOK);
assert(
  budgetJumps.length === BOOK.length && budgetJumps.every((row) => row.group === "Budget"),
  "budget lists Budget for each client even when no client is named budget",
);
assert(
  budgetJumps.every(
    (row) => row.href.includes("tab=budget") && row.label.startsWith("Budget for "),
  ),
  "budget jumps deep-link to the Budget tab",
);
const yankeesBudget = searchClientSectionJumps("budget yankees", BOOK);
assert(
  yankeesBudget.length === 1 && yankeesBudget[0]?.label === "Budget for New York Yankees",
  "a client name after the section narrows the jump",
);
assert(
  searchClientSectionJumps("yankees budget", BOOK)[0]?.href.includes("tab=budget"),
  "section word can follow the client name",
);
assert(
  searchClientSectionJumps("budget for yankees", BOOK)[0]?.label === "Budget for New York Yankees",
  "the word for in Budget for {client} is not part of the client name",
);
const healthJumps = searchClientSectionJumps("health", BOOK);
assert(
  healthJumps[0]?.href.includes("tab=health") && healthJumps[0]?.href.includes("focus=health"),
  "health jumps keep the coach focus",
);
assert(
  searchClientSectionJumps("collections", BOOK)[0]?.href.includes("section=collections"),
  "collections jumps open Collections",
);
assert(
  searchClientSectionJumps("yankees", BOOK).length === 0,
  "a client name alone stays a client row, not a section jump",
);
assert(searchClientSectionJumps("", BOOK).length === 0, "an empty query does not expand sections");
assert(searchClientSectionJumps("budget", []).length === 0, "an empty book has no section jumps");
assert(
  searchClientSectionJumps("13 week cash", BOOK).every((row) => row.href.includes("tab=cash")),
  "cash synonyms still open Cash for each client",
);
assert(
  searchClientSectionJumps("bot", BOOK).length === 0,
  "practice Bot does not open a client desk",
);
assert(
  searchClientSectionJumps("drafts", BOOK).length === 0,
  "practice drafts do not open a client desk",
);

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
    "Open a client to jump to Health, Cash, Budget, Collections, and the rest.",
  "a studio feature with no client and no client hit still explains why",
);
assert(
  paletteEmptyCopy({ ...noHits, needsClient: true, clientsLoading: true }) === "Searching clients…",
  "a section keyword waits for the client list instead of the empty hint",
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
assert(finderSrc.includes("paletteClients"), "palette filters the loaded client list");
assert(
  finderSrc.includes("searchClientSectionJumps"),
  "firm dashboard turns section keywords into per-client jumps",
);
assert(
  finderSrc.includes('to: "/clients/$clientId"') && finderSrc.includes('tab: "home"'),
  "selecting a client opens Home",
);
assert(!finderSrc.includes("No matching features"), "empty copy is not features-only");
assert(
  finderSrc.includes("subscribeFeatureFinderHotkey"),
  "palette uses the shared hotkey subscription",
);
assert(
  !finderSrc.includes("addEventListener"),
  "palette does not register its own keydown listener",
);
assert(finderSrc.includes("allowSelect"), "a row is not activated until the user selects it");

function ctrlK(repeat = false): FeatureFinderHotkeyEvent {
  return {
    key: "k",
    metaKey: false,
    ctrlKey: true,
    altKey: false,
    shiftKey: false,
    repeat,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.stopped = true;
    },
    defaultPrevented: false,
    stopped: false,
  };
}

const hotkeyAdds: Array<(event: FeatureFinderHotkeyEvent) => void> = [];
const hotkeyBus = createFeatureFinderHotkeyBus(
  {
    addEventListener(_type, listener) {
      hotkeyAdds.push(listener);
    },
    removeEventListener(_type, listener) {
      const index = hotkeyAdds.indexOf(listener);
      if (index >= 0) hotkeyAdds.splice(index, 1);
    },
  },
  () => "Linux x86_64",
  () => "",
);
let firstPalette = 0;
let secondPalette = 0;
const unsubFirst = hotkeyBus.subscribe(() => {
  firstPalette += 1;
});
const unsubSecond = hotkeyBus.subscribe(() => {
  secondPalette += 1;
});
assert(hotkeyBus.listenerCount === 1, "two palettes share one keydown listener");
assert(hotkeyAdds.length === 1, "the listener is registered once");
const press = ctrlK();
hotkeyBus.dispatch(press);
assert(press.defaultPrevented === true, "Ctrl+K calls preventDefault");
assert(press.stopped === true, "Ctrl+K does not reach cmdk");
assert(firstPalette + secondPalette === 1, "one listener fires per keypress");
assert(secondPalette === 1 && firstPalette === 0, "only the visible palette handles the shortcut");
hotkeyBus.dispatch(ctrlK(true));
assert(firstPalette + secondPalette === 1, "a repeated keydown does not fire again");
const openState = { current: false };
assert(toggleFinderOpen(openState) === true, "first shortcut opens");
assert(
  toggleFinderOpen(openState) === false,
  "the next real shortcut closes from the current state",
);
unsubFirst();
assert(hotkeyBus.listenerCount === 1, "one remaining palette keeps the listener");
unsubSecond();
assert(hotkeyBus.listenerCount === 0, "cleanup removes the listener");
assert(hotkeyAdds.length === 0, "cleanup detaches the window listener");

const listSrc = readFileSync(new URL("../src/lib/firm-client-list.ts", import.meta.url), "utf8");
assert(
  listSrc.includes('from "@/integrations/supabase/client"'),
  "client list uses the signed-in Supabase client",
);
assert(!listSrc.includes("client.server"), "client list does not use the service role");
assert(!listSrc.includes("supabaseAdmin"), "client list does not use the admin client");
assert(
  listSrc.includes("contact_email") && listSrc.includes("created_at") && listSrc.includes("financials"),
  "the client list loads email, the added day, and statement names",
);
assert(
  listSrc.includes("tenant_name") && listSrc.includes("company_name"),
  "a shared name can use the ledger company name",
);
assert(!listSrc.includes("firms(name)"), "the practice name is not the disambiguator");

console.log("feature-finder: ok");
