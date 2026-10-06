/**
 * Firm client pages must not stay in owner-board client mode.
 * A different /clients/:id used to 403 and then crash on an unguarded .slice.
 * Run: pnpm test:client-mode-firm-page
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  actingAsHeaderForPath,
  exitFirmClientMode,
  isImpersonationForbidden,
} from "../src/lib/acting-as-client";
import { normalizeAccountantClientTab } from "../src/lib/client-route-search";
import { computeOverviewCaption, computeWeekChanges } from "../src/lib/overview-insights";
import {
  knownStarterTrialGenerationBlocked,
  rememberStarterTrialGenerationBlocked,
} from "../src/lib/starter-trial-client";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const read = (path: string) => readFileSync(resolve(path), "utf8");

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
}

const storage = new MemoryStorage();
storage.setItem("acting_as_client_id", "qa-us");
storage.setItem("acting_as_client_name", "QA US");
assert(exitFirmClientMode(storage) === "qa-us", "leaving client mode returns the impersonated id");
assert(storage.getItem("acting_as_client_id") === null, "acting client id is cleared");
assert(storage.getItem("acting_as_client_name") === null, "acting client name is cleared");
assert(exitFirmClientMode(storage) === null, "a second exit is a no-op");
assert(exitFirmClientMode(null) === null, "missing storage does not throw");

assert(actingAsHeaderForPath("/app") === true, "owner board still sends the acting-as header");
assert(actingAsHeaderForPath("/app/extra") === true, "owner board subpaths still impersonate");
assert(
  actingAsHeaderForPath("/clients/11111111-1111-1111-1111-111111111111") === false,
  "a firm client page does not impersonate",
);
assert(actingAsHeaderForPath("/dashboard") === false, "the firm dashboard does not impersonate");

assert(
  isImpersonationForbidden({ status: 403, message: "Forbidden: request clientId is outside the current impersonation scope" }),
  "403 impersonation scope is a forbidden error",
);
assert(
  isImpersonationForbidden(new Error("Forbidden: query is outside the current impersonation scope")),
  "scope Error is a forbidden error",
);
assert(!isImpersonationForbidden(new Error("Cannot read properties of undefined")), "a slice crash is not a 403");

const missing = computeWeekChanges(undefined);
assert(Array.isArray(missing) && missing.length === 0, "overview insights does not slice a missing input");
assert(computeOverviewCaption(undefined) === undefined, "overview caption survives a missing input");
const capped = computeWeekChanges({
  revenueGrowth: 0.1,
  cashHealth: 80,
  profitHealth: 40,
  grossMarginRatio: 0.4,
});
assert(capped.length === 3, "week changes still cap at three");
assert(normalizeAccountantClientTab("summary") === "overview", "?tab=summary is Overview");

const client = read("src/routes/_authenticated/clients.$clientId.tsx");
assert(client.includes("exitClientModeOnFirmPage"), "the client route exits client mode");
assert(client.includes("beforeLoad: () => {\n    exitClientModeOnFirmPage();"), "exit runs before the page loads");
assert(client.includes("errorComponent: ClientPageError"), "403 uses the route error state");
assert(client.includes("isImpersonationForbidden"), "the error state recognises a 403");
assert(
  client.includes("This client page couldn't be opened."),
  "a 403 renders an empty state instead of the root error boundary",
);
assert(
  client.includes("<TrialEndedPlanBlock firmId={client.firm_id ?? null} />"),
  "the trial refusal card is on the studio, not only the hidden overview pane",
);
const overviewPane = client.indexOf('id="pane-overview"');
const trialCard = client.indexOf("<TrialEndedPlanBlock");
assert(trialCard !== -1 && trialCard < overviewPane, "the refusal card sits above the tab panes");

const attacher = read("src/integrations/supabase/auth-attacher.ts");
assert(attacher.includes("actingAsHeaderForPath"), "server functions attach impersonation only on the owner board");

const dashboard = read("src/routes/_authenticated/dashboard.tsx");
assert(dashboard.includes('aria-label="Enter as client"'), "Enter as client has an accessible name");
assert(dashboard.includes('className="icon-tip"'), "row icons have a visible tooltip");
assert(
  (dashboard.match(/aria-label="/g) ?? []).length >= 4,
  "each dashboard row icon has an aria-label",
);

const pack = read("src/components/advisory-pack-panel.tsx");
const generateAt = pack.indexOf("const doGenerate");
const knownAt = pack.indexOf("knownStarterTrialGenerationBlocked(firmId)", generateAt);
const serverAt = pack.indexOf("generate({ data: { clientId } })", generateAt);
assert(knownAt !== -1 && knownAt < serverAt, "Generate pack refuses client-side before the server call");

const bot = read("src/lib/ask-ai.js");
assert(bot.includes("restoreThread"), "a Bot trial refusal restores the previous answer");
assert(bot.includes("openTrialRefusal"), "a Bot trial refusal opens the plan card");
assert(
  bot.includes("knownStarterTrialGenerationBlocked()"),
  "Bot create refuses instantly when the trial block is already known",
);

const memory = new MemoryStorage();
(globalThis as { sessionStorage?: MemoryStorage }).sessionStorage = memory;
rememberStarterTrialGenerationBlocked("firm-ben", true);
assert(knownStarterTrialGenerationBlocked("firm-ben") === true, "a known ended trial blocks generation");
assert(knownStarterTrialGenerationBlocked("other-firm") === false, "a different firm is not blocked");
rememberStarterTrialGenerationBlocked("firm-ben", false);
assert(knownStarterTrialGenerationBlocked("firm-ben") === false, "a refreshed allowance clears the block");

console.log("client-mode-firm-page-test: all assertions passed");
