/**
 * Cold practice and owner bootstrap stay parallel, and the 8s deadline
 * covers the list and the cards.
 * Run: pnpm test:bootstrap-waterfall
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { dashboardCardsPhase } from "../src/lib/bounded-load.ts";
import { clearBootstrapCache, once } from "../src/lib/bootstrap-cache.ts";
import { shellGateRemaining } from "../src/lib/shell-gate.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(
  dashboardCardsPhase({ bookLoading: true, countsReady: false, timedOut: true }) === "error",
  "a chain timeout replaces Loading on the cards while the book flag is still true",
);
assert(
  dashboardCardsPhase({ bookLoading: false, countsReady: true, timedOut: true }) === "error",
  "releasing the spinner on timeout still shows the card error",
);
assert(
  dashboardCardsPhase({ bookLoading: true, countsReady: false, timedOut: false }) === "loading",
  "cards stay on Loading before the deadline",
);
assert(
  dashboardCardsPhase({ bookLoading: false, countsReady: true, timedOut: false }) === "ready",
  "cards leave Loading once counts land",
);

clearBootstrapCache();
let calls = 0;
const first = once("firms:user", async () => {
  calls += 1;
  return ["firm"];
});
const second = once("firms:user", async () => {
  calls += 1;
  return ["other"];
});
assert(first === second, "two cold callers share one in-flight read");
assert((await first)[0] === "firm", "the shared read resolves once");
assert(calls === 1, "the loader does not run twice");
clearBootstrapCache();

const started = 1_000;
assert(shellGateRemaining(started, started + 6_000) === 2_000, "a late arm keeps the original deadline");
assert(shellGateRemaining(started, started + 9_000) === 0, "past the deadline the chain has no wait left");

const gate = readFileSync(resolve("src/routes/_authenticated.gate.tsx"), "utf8");
const shellBefore = gate.indexOf("Shell paints before Stripe");
const entitlement = gate.indexOf("latest.current.checkEntitlement");
assert(shellBefore > 0 && entitlement > shellBefore, "Stripe entitlement runs after the shell is allowed");
assert(!gate.includes("while (latest.current.brandLoading"), "brand hydrate does not consume the shell deadline");
assert(gate.includes("shouldStayOnAccountantPortal"), "the stay check still runs");
assert(gate.includes("getFirmBillingEntitlement"), "the shell still calls the Stripe gate");
assert(gate.includes("FirmShellLoading"), "the gate keeps the dashboard skeleton while the stay check runs");
assert(!gate.includes("animate-pulse"), "the gate does not swap the skeleton for a blank pulse");
assert(
  gate.indexOf("Shell paints before Stripe") < gate.indexOf("latest.current.checkEntitlement"),
  "Stripe still runs after the shell is allowed",
);

const shell = readFileSync(resolve("src/routes/_authenticated.tsx"), "utf8");
assert(
  shell.indexOf("shouldStayOnAccountantPortal") < shell.indexOf("import(\"./_authenticated.gate\")"),
  "the stay check starts before the gate chunk is required",
);
const root = readFileSync(resolve("src/routes/__root.tsx"), "utf8");
assert(root.includes("[data-shell-boot]"), "the boot skeleton has critical CSS");
assert(root.includes(".owner-presence{width:156px"), "avatar SVG size is in the first style tag");
const sheets = readFileSync(resolve("src/styles/app-route-styles.ts"), "utf8");
assert(sheets.includes("owner-door.css?url"), "the authenticated layout preloads the agent-card sheet");

const roles = readFileSync(resolve("src/lib/user-roles.ts"), "utf8");
const signupAt = roles.indexOf("async function readPracticeSignup");
const signup = roles.slice(signupAt, roles.indexOf("export function isSmeOnly"));
assert(signup.includes("getSession"), "practice signup metadata is read from the local session");
assert(!signup.includes(".getUser"), "practice signup metadata does not call getUser()");
assert(roles.includes('once(`stay:${userId}`'), "the gate and the board share one stay check");
assert(!roles.includes("accountantStayChecks.delete"), "a settled stay check is not dropped before the board mounts");
const stayAt = roles.indexOf("async function resolveAccountantStay");
const stayFn = roles.slice(stayAt, stayAt + 1400);
const allAt = stayFn.indexOf("Promise.all");
const allBlock = stayFn.slice(allAt, stayFn.indexOf("]);", allAt));
assert(!allBlock.includes("isMilonItMember"), "the IT lookup is not in the stay Promise.all");
assert(
  stayFn.indexOf("firmSeatSkipsItWait(stay)") > 0 &&
    stayFn.indexOf("firmSeatSkipsItWait(stay)") < stayFn.indexOf("return itPromise"),
  "a firm seat opens the shell without waiting on the IT lookup",
);

const firms = readFileSync(resolve("src/lib/firm-brand.ts"), "utf8");
const listAt = firms.indexOf("export async function listUserFirms");
const listFn = firms.slice(listAt, firms.indexOf("export function pickActiveFirm") > listAt
  ? firms.indexOf("export async function fetchUserFirm")
  : firms.indexOf("export async function fetchUserFirm"));
assert(listFn.includes("Promise.all"), "owned firms and memberships load together");

const profile = readFileSync(resolve("src/contexts/accountant-profile.tsx"), "utf8");
assert(profile.includes("readPersistedNameChain"), "the profile name is still read");
assert(
  profile.includes("once(firmsCacheKey"),
  "the firm row is read once and shared",
);
assert(!profile.includes("fetchUserFirm(signedIn.id, preferred)"), "hydrate does not list firms twice");

const board = readFileSync(resolve("src/components/practice-board.tsx"), "utf8");
assert(board.includes("shellGateRemaining"), "the book deadline is the time left on the chain");
assert(board.includes("retryChain"), "the list and the cards can retry");
assert(board.includes("FOLLOW_UPS_LOAD_ERROR"), "follow-ups show an error");
assert(board.includes("cardsPhase === \"error\""), "open queries and follow-ups leave Loading on timeout");
assert(board.includes("isMilonItMember"), "the client list shares the cached IT check");
assert(board.includes("measureBootstrap"), "practice bootstrap records a perf measure");
assert(
  board.indexOf("Promise.all([isMilonItMember(userId), scoped])") > 0,
  "IT membership and the client select start together",
);

const app = readFileSync(resolve("src/routes/app.tsx"), "utf8");
assert(app.includes("Cold owner link reads the local session"), "owner bootstrap uses the local session");
assert(app.includes("OwnerBootFailed"), "owner boot has an error state");
assert(app.includes("measureBootstrap(\"owner-board\")"), "owner bootstrap records a perf measure");
assert(app.includes("Promise.all([\n        shouldOpenItInbox(user.id)"), "owner IT and bounce checks run together");
assert(!app.includes("getFirmBillingEntitlement"), "owner /app is not Stripe-gated");

const migration = readFileSync(
  resolve("supabase/migrations/20261020120000_bootstrap_lookup_indexes.sql"),
  "utf8",
);
assert(migration.includes("firms_owner_user_id_idx"), "firms.owner_user_id is indexed");
assert(migration.includes("firm_memberships_user_id_idx"), "memberships are indexed by user");
assert(migration.includes("clients_firm_id_idx"), "clients.firm_id is indexed");
assert(migration.includes("clients_owner_user_id_idx"), "clients.owner_user_id is indexed");

console.log("bootstrap-waterfall: ok");
