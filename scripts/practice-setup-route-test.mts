/**
 * Firm setup route: the Home card opens /practice/setup, not a client.
 * Run: pnpm test:practice-setup-route
 */
import { readFileSync } from "node:fs";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function read(path: string): string {
  return readFileSync(path, "utf8");
}

const card = read("src/components/practice-setup-card.tsx");
assert(card.includes('to="/practice/setup"'), "card opens the firm setup route");
assert(!card.includes("/clients/"), "card does not deep-link a client");
assert(!card.includes("view=books"), "card does not open client books");

const route = read("src/routes/_authenticated/practice_.setup.tsx");
assert(
  route.includes('"/_authenticated/practice_/setup"'),
  "route id follows practice_ convention",
);
assert(route.includes("<PracticeSetupPanel"), "route renders the firm panel");

const panel = read("src/components/practice-setup-panel.tsx");
assert(panel.includes("Implementation Manager"), "firm header label");
assert(panel.includes("data-practice-setup-panel"), "panel marker");
assert(!panel.includes("Connect Xero") && !panel.includes("ConnectBooks"), "no connect block");
assert(!panel.includes("QuickBooks") && !panel.includes("ledger snapshot"), "no client books");
assert(!panel.includes("client picker") && !panel.includes("Select a client"), "no client picker");
assert(panel.includes("buildSetupPartnerFirmMap"), "panel uses the firm API");
const clientPanel = read("src/components/setup-partner-panel.tsx");
assert(!clientPanel.includes("PracticeSetupPanel"), "client panel is not this route");
assert(
  !panel.includes('from "@/components/setup-partner-panel"'),
  "firm panel does not render the client panel",
);

const tree = read("src/routeTree.gen.ts");
assert(tree.includes("'/practice/setup'"), "route tree publishes /practice/setup");

const edge = read("supabase/functions/setup-partner/index.ts");
assert(edge.includes("clientId or firmId is required"), "firm mode does not require a client");
assert(edge.includes("has_client_access"), "client mode still checks client access");

console.log("practice-setup-route-test: ok");
process.exit(0);
