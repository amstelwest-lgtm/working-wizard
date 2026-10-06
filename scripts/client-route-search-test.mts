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
assert(normalizeAccountantClientTab("data") === "summary", "?tab=data opens Client Brain");
assert(normalizeAccountantClientTab("brain") === "summary", "?tab=brain opens Client Brain");
assert(normalizeAccountantClientTab("client-brain") === "summary", "?tab=client-brain opens Client Brain");
assert(normalizeAccountantClientTab("pillars") === "ratios", "?tab=pillars opens Health");
assert(normalizeAccountantClientTab("today") === "ratios", "?tab=today opens Health");
assert(normalizeAccountantClientTab("tasks") === "plan", "?tab=tasks opens Action Plan");
assert(normalizeAccountantClientTab("action-plan") === "plan", "?tab=action-plan opens Action Plan");
assert(normalizeAccountantClientTab("waterfall") === "profit", "?tab=waterfall opens Profit");
assert(normalizeAccountantClientTab("profitability") === "profit", "?tab=profitability opens Profit");
assert(normalizeAccountantClientTab("forecast") === "cash", "?tab=forecast opens Cash");
assert(normalizeAccountantClientTab("cash-forecast") === "cash", "?tab=cash-forecast opens Cash");
assert(normalizeAccountantClientTab("bot") === "ask", "?tab=bot opens Milōn Bot");
assert(normalizeAccountantClientTab("milon-bot") === "ask", "?tab=milon-bot opens Milōn Bot");
assert(normalizeAccountantClientTab("report") === "reports", "?tab=report opens Reports");

const route = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
const parser = route.slice(route.indexOf("validateSearch:"), route.indexOf("component: ClientView"));
assert(parser.includes("normalizeAccountantClientTab(search.tab)"), "alias runs inside validateSearch");
assert(parser.includes('search.tab === "pillars"'), "?tab=pillars sets the Health pillar focus");
assert(
  route.includes('resolveAccountantTab(search.tab) ?? "overview"'),
  "the first paint uses the parsed tab, not a later Overview landing",
);

console.log("client-route-search-test: all assertions passed");
