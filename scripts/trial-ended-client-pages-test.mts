/**
 * A trial-ended firm can still open an existing client.
 * Only the bare /clients list redirects to the practice table.
 * Run: pnpm test:trial-ended-client-pages
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Generator, getConfig } from "@tanstack/router-generator";
import { createMemoryHistory, createRouter, isRedirect } from "@tanstack/react-router";
import { routeTree } from "../src/routeTree.gen";

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(
  !existsSync(resolve("src/routes/_authenticated/clients.tsx")),
  "clients.tsx is a layout, so its redirect would run for every client page",
);

const indexSrc = readFileSync(resolve("src/routes/_authenticated/clients.index.tsx"), "utf8");
assert(indexSrc.includes('"/_authenticated/clients/"'), "the list redirect is an index route");
assert(indexSrc.includes('hash: "clients-table"'), "bare /clients goes to the practice client list");

const clientSrc = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
assert(!clientSrc.includes("clients-table"), "a client page does not send the reader back to the list");
assert(
  clientSrc.includes("TrialEndedPlanBlock"),
  "generation on a readable client page still shows the refusal card",
);

const gateSrc = readFileSync(resolve("src/routes/_authenticated.tsx"), "utf8");
assert(gateSrc.includes("applyPortalTheme(resolvePortalTheme())"), "the billing check applies the saved theme");
const billingGate = gateSrc.slice(gateSrc.indexOf('data-billing-gate="pending"') - 80, gateSrc.indexOf('data-billing-gate="pending"') + 280);
assert(
  gateSrc.includes('data-billing-gate="pending"') && billingGate.includes("bg-background"),
  "the billing check uses the theme surface",
);
assert(
  !gateSrc.includes("Checking billing…") && !billingGate.includes("min-h-screen"),
  "a paid firm does not get a full-screen billing flash",
);

const settingsSrc = readFileSync(resolve("src/routes/_authenticated/settings.index.tsx"), "utf8");
const portalCss = readFileSync(resolve("src/styles/accountant-portal.css"), "utf8");
assert(settingsSrc.includes("settings-plan-card"), "Settings marks the plan card");
assert(
  portalCss.includes("body:has(.settings-plan-card) #wizard-notes-pin"),
  "the notes pencil hides on the Settings plan card",
);

const router = createRouter({
  routeTree,
  history: createMemoryHistory({ initialEntries: ["/"] }),
});

function routeIds(path: string): string[] {
  return router.matchRoutes(path).map((match) => match.routeId);
}

const summaryIds = routeIds(`/clients/${CLIENT_ID}?tab=summary`);
assert(
  summaryIds.includes("/_authenticated/clients/$clientId"),
  "a trial-ended firm's /clients/<id>?tab=summary renders the client page",
);
assert(
  !summaryIds.some((id) => id === "/_authenticated/clients" || id === "/_authenticated/clients/"),
  "opening a client does not match the list redirect",
);

const advisoryIds = routeIds(`/clients/${CLIENT_ID}?tab=advisory`);
assert(
  advisoryIds.includes("/_authenticated/clients/$clientId"),
  "advisory stays on the client page",
);
assert(!advisoryIds.includes("/_authenticated/dashboard"), "advisory is not the dashboard");

const listIds = routeIds("/clients");
assert(listIds.includes("/_authenticated/clients/"), "bare /clients matches the list index");
assert(!listIds.includes("/_authenticated/clients/$clientId"), "bare /clients is not a client page");

let redirect: unknown;
try {
  const indexRoute = listIds.includes("/_authenticated/clients/")
    ? router.routesById["/_authenticated/clients/"]
    : undefined;
  indexRoute?.options.beforeLoad?.({} as never);
} catch (error) {
  redirect = error;
}
assert(isRedirect(redirect), "bare /clients redirects");
const location = (redirect as { options?: { to?: string; hash?: string } }).options;
assert(location?.to === "/dashboard", "the list redirect target is the dashboard");
assert(location?.hash === "clients-table", "the list redirect lands on the client table");

const generatedPath = resolve("/tmp/trial-ended-routeTree.gen.ts");
const generator = new Generator({
  root: process.cwd(),
  config: getConfig(
    {
      routesDirectory: "./src/routes",
      generatedRouteTree: generatedPath,
      disableLogging: true,
      disableTypes: true,
    },
    process.cwd(),
  ),
});
await generator.run();
const generated = readFileSync(generatedPath.replace(/\.ts$/, ".js"), "utf8");
const clientUpdate = generated.match(
  /AuthenticatedClientsClientIdRouteImport\.update\(\{[\s\S]*?\}\)/,
)?.[0];
assert(Boolean(clientUpdate), "the generated tree registers the client page");
assert(
  clientUpdate?.includes("getParentRoute: () => AuthenticatedRoute"),
  "the generated client page is not nested under a /clients layout",
);
assert(
  !generated.includes("from './routes/_authenticated/clients'"),
  "the generated tree does not import a clients layout",
);

console.log("trial-ended-client-pages ok");
