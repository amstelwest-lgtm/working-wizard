/**
 * Feature finder — fuzzy jump list and the routes it opens.
 * Run: pnpm test:feature-finder
 */
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

console.log("feature-finder: ok");
