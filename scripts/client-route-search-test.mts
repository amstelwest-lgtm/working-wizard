/**
 * Accountant client search aliases. Old ?tab=actions / ?tab=health links
 * must be rewritten before the studio decides its landing tab.
 * Run: pnpm test:client-route-search
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeAccountantClientTab } from "../src/lib/client-route-search";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(normalizeAccountantClientTab("actions") === "plan", "?tab=actions opens Action Plan");
assert(normalizeAccountantClientTab("health") === "ratios", "?tab=health opens Health & Ratios");
assert(normalizeAccountantClientTab("plan") === "plan", "plan stays plan");
assert(normalizeAccountantClientTab("ratios") === "ratios", "ratios stays ratios");
assert(normalizeAccountantClientTab("overview") === "overview", "overview stays overview");
assert(normalizeAccountantClientTab("cash") === "cash", "cash stays cash");

const route = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
const parser = route.slice(route.indexOf("validateSearch:"), route.indexOf("component: ClientView"));
assert(parser.includes("normalizeAccountantClientTab(search.tab)"), "alias runs inside validateSearch");
assert(
  route.includes('resolveAccountantTab(search.tab) ?? "overview"'),
  "the first paint uses the parsed tab, not a later Overview landing",
);

console.log("client-route-search-test: all assertions passed");
