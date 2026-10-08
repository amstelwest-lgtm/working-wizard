/**
 * Before a card, the client crumb does not link to the practice dashboard.
 * Run: pnpm test:precard-dashboard-crumb
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { firmDashboardCrumbIsLink } from "../src/components/firm-dashboard-crumb";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const read = (path: string) => readFileSync(resolve(path), "utf8");

assert(firmDashboardCrumbIsLink(true), "an entitled firm can open the dashboard");
assert(!firmDashboardCrumbIsLink(false), "no card means the crumb is not a link");
assert(!firmDashboardCrumbIsLink(null), "an unfinished check does not link to the dashboard");

const crumb = read("src/components/firm-dashboard-crumb.tsx");
const unpaid = crumb.slice(crumb.indexOf("if (!linked)"), crumb.indexOf("return ("));
assert(unpaid.includes('data-firm-dashboard-crumb="text"'), "the unpaid crumb is plain text");
assert(!unpaid.includes("<a"), "the unpaid crumb is not an anchor");
assert(crumb.includes('data-firm-dashboard-crumb="link"'), "an entitled firm still gets the link");
assert(crumb.includes("onBack()"), "only the entitled crumb goes back");

const route = read("src/routes/_authenticated/clients.$clientId.tsx");
assert(route.includes("useFirmBillingEntitled"), "the client page reads the shell entitlement");
assert(route.includes("firmDashboardCrumbIsLink"), "the crumb uses that entitlement");
assert(route.includes("<FirmDashboardCrumb"), "the client page renders the shared crumb");
assert(!route.includes(">Firm dashboard</a>"), "the client page does not hard-code a dashboard link");

const layout = read("src/routes/_authenticated.tsx");
assert(layout.includes("FirmBillingAccessProvider"), "the shell shares the entitlement it already loaded");
assert(layout.includes("setFirmEntitled(false)"), "a firm with no card is recorded as not entitled");
assert(layout.includes("getFirmBillingEntitlement"), "the shell still calls the existing entitlement check");

console.log("precard-dashboard-crumb: ok");
