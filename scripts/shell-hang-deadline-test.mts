/**
 * Shell hangs settle inside the deadline.
 * A stuck auth lock cannot hold a session read, and two realms do not share processLock.
 * Run: pnpm test:shell-hang-deadline
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Worker } from "node:worker_threads";
import { accessTokenWithin, restoreSession, sessionRestoreSignal } from "../src/integrations/supabase/session-deadline.ts";
import {
  concurrentRefreshKeepsSession,
  REFRESH_TOKEN_REUSE_INTERVAL_MS,
  tabAuthLock,
} from "../src/integrations/supabase/tab-auth.ts";
import { resolveBillingWall } from "../src/lib/billing-wall.ts";
import {
  activeClientsLabel,
  formatFirmClientUsage,
  formatFirmOverLimitNote,
} from "../src/lib/firm-band-upgrade.ts";
import {
  accessWhileEntitlementUnknown,
  pageWhileEntitlementUnknown,
  skeletonAfterBillingDeadline,
} from "../src/lib/firm-gate-access.ts";
import { SHELL_GATE_TIMEOUT_MS } from "../src/lib/shell-gate.ts";
import { readWithOneRetry, type Settled } from "../src/lib/bounded-load.ts";
import {
  clearCachedFirmEntitlement,
  readCachedFirmEntitlement,
} from "../src/lib/firm-entitlement-client.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const never = <T>() => new Promise<T>(() => {});

const hungWall = await resolveBillingWall({
  client: never(),
  entitlement: never(),
  quote: never(),
  plan: "starter",
  interval: "month",
  timeoutMs: 30,
});
assert(hungWall.checking === false, "a hung billing read stops checking");
assert(hungWall.returnClient === null, "a hung client read does not invent a client");
assert(hungWall.quote === null, "a hung quote is missing");
assert(hungWall.quoteError.length > 0, "a missing quote is an error");
assert(hungWall.priceLabel === "$39/mo", "unknown market prices from the USD catalog");
assert(hungWall.entitled === false, "a hung entitlement is not a grant");

const zaBlank = await resolveBillingWall({
  client: Promise.resolve(null),
  entitlement: Promise.resolve({ entitled: false }),
  quote: Promise.resolve({ market: "za", priceLabel: null }),
  plan: "starter",
  interval: "month",
  timeoutMs: 30,
});
assert(zaBlank.quoteError.length > 0, "a ZA quote with no price label is an error");
assert(zaBlank.priceLabel === null, "a blank ZA label is not replaced with a rand amount");

const usQuote = await resolveBillingWall({
  client: Promise.resolve(null),
  entitlement: Promise.resolve({ entitled: false }),
  quote: Promise.resolve({ market: "us", priceLabel: null }),
  plan: "starter",
  interval: "month",
  timeoutMs: 30,
});
assert(usQuote.priceLabel === "$39/mo", "a US quote uses the USD catalog");
assert(usQuote.quoteError === "", "a US quote with a null label is not an error");

const nullMarket = await resolveBillingWall({
  client: Promise.resolve(null),
  entitlement: Promise.resolve({ entitled: false }),
  quote: Promise.resolve(null),
  plan: "starter",
  interval: "month",
  timeoutMs: 30,
});
assert(nullMarket.priceLabel === "$39/mo", "a null market is not ZA");

const restored = await restoreSession(() => never<{ data: { session: null } }>(), 20);
assert(restored.ok === false, "a hung session restore fails closed");
const token = await accessTokenWithin(() => never(), 20);
assert(token === null, "a hung getSession does not hold a server function auth read");

let restoreAborted = false;
const timedOut = await restoreSession(
  () =>
    tabAuthLock(
      "restore-release",
      -1,
      () =>
        new Promise<string>((resolve, reject) => {
          const signal = sessionRestoreSignal();
          if (!signal) {
            reject(new Error("missing restore signal"));
            return;
          }
          signal.addEventListener("abort", () => {
            restoreAborted = true;
            resolve("aborted");
          });
        }),
    ),
  40,
);
assert(restoreAborted, "a timed-out restore aborts the in-flight session read");
assert(timedOut.ok === false, "a timed-out restore still fails closed");
const freed = await Promise.race([
  tabAuthLock("restore-release", -1, async () => "free" as const),
  new Promise<never>((_resolve, reject) => {
    setTimeout(() => reject(new Error("auth lock still held after restore timeout")), 500);
  }),
]);
assert(freed === "free", "restore timeout releases the auth lock");
const finished = await restoreSession(async () => "done", 200);
assert(finished.ok === true && finished.value === "done", "a finished restore returns the session");
assert(sessionRestoreSignal() === null, "a finished restore does not abort later fetches");
assert(SHELL_GATE_TIMEOUT_MS === 8_000, "the shell deadline stays 8 seconds");

let clientReads = 0;
const retried = await readWithOneRetry(async (): Promise<Settled<string>> => {
  clientReads += 1;
  if (clientReads === 1) return { status: "timeout" };
  return { status: "value", value: "clients" };
}, 5, async () => {});
assert(clientReads === 2 && retried.status === "value" && retried.value === "clients", "a timed-out client read retries once");
const hungTwice = await readWithOneRetry(async (): Promise<Settled<string>> => ({ status: "timeout" }), 5, async () => {});
assert(hungTwice.status === "timeout", "a second timeout is the error the card shows");

assert(activeClientsLabel(1) === "1 active client", "one active client is singular");
assert(activeClientsLabel(8) === "8 active clients", "several clients stay plural");
assert(formatFirmClientUsage(1, 1, "Starter") === "1 active client · Starter limit 1", "usage of one is singular");
assert(
  formatFirmOverLimitNote({ count: 1, limit: 0 }) ===
    "This plan includes 0 active clients. This practice has 1 active client, 1 over the limit. Upgrade to raise it.",
  "the over-limit note uses the singular for one client",
);

assert(accessWhileEntitlementUnknown("/dashboard") === "allow", "Home stays reachable");
assert(accessWhileEntitlementUnknown("/practice") === "allow", "the practice shell stays reachable");
assert(accessWhileEntitlementUnknown("/clients") === "allow", "the client list stays reachable");
assert(accessWhileEntitlementUnknown("/settings") === "allow", "settings stay reachable");
assert(accessWhileEntitlementUnknown("/billing/required") === "allow", "billing stays reachable");
assert(
  accessWhileEntitlementUnknown("/clients/11111111-1111-4111-8111-111111111111") === "wall",
  "a client file stays closed while entitlement is unknown",
);
assert(accessWhileEntitlementUnknown("/reports") === "wall", "reports stay closed while entitlement is unknown");
assert(
  pageWhileEntitlementUnknown({
    pathname: "/clients/11111111-1111-4111-8111-111111111111",
    firmClientCount: null,
    firstClientId: null,
  }) === "wall",
  "an unknown client count does not open a client file",
);
assert(
  pageWhileEntitlementUnknown({
    pathname: "/clients/11111111-1111-4111-8111-111111111111",
    firmClientCount: 1,
    firstClientId: "11111111-1111-4111-8111-111111111111",
  }) === "allow",
  "the first client with a known count may mount before Stripe returns",
);
assert(
  pageWhileEntitlementUnknown({
    pathname: "/clients/22222222-2222-4222-8222-222222222222",
    firmClientCount: 2,
    firstClientId: "11111111-1111-4111-8111-111111111111",
  }) === "wall",
  "a later client stays on the skeleton while entitlement is unknown",
);
assert(
  skeletonAfterBillingDeadline({
    deadlinePassed: true,
    firmEntitled: null,
    unknownPage: "wall",
  }),
  "a deadline that passed on Home replaces the skeleton on a later client file",
);
assert(
  !skeletonAfterBillingDeadline({
    deadlinePassed: false,
    firmEntitled: null,
    unknownPage: "wall",
  }),
  "before the deadline a later client file stays on the skeleton",
);
assert(
  !skeletonAfterBillingDeadline({
    deadlinePassed: true,
    firmEntitled: null,
    unknownPage: "allow",
  }),
  "Home stays open after the deadline",
);
assert(
  !skeletonAfterBillingDeadline({
    deadlinePassed: true,
    firmEntitled: true,
    unknownPage: "wall",
  }),
  "a resolved entitlement does not turn into the retry card",
);

clearCachedFirmEntitlement();
let entitlementCalls = 0;
const loadEntitlement = async () => {
  entitlementCalls += 1;
  return { entitled: false, reason: "no_active_subscription" as const };
};
await Promise.all([
  readCachedFirmEntitlement("user-a", loadEntitlement),
  readCachedFirmEntitlement("user-a", loadEntitlement),
]);
assert(entitlementCalls === 1, "two callers share one entitlement read");
await readCachedFirmEntitlement("user-a", loadEntitlement);
assert(entitlementCalls === 1, "the next navigation reuses the cached entitlement");
await readCachedFirmEntitlement("user-b", loadEntitlement);
assert(entitlementCalls === 2, "the tab cache is keyed by user");
clearCachedFirmEntitlement();

assert(REFRESH_TOKEN_REUSE_INTERVAL_MS === 10_000, "hosted refresh reuse default is 10 seconds");
assert(concurrentRefreshKeepsSession(0), "a simultaneous refresh stays inside the window");
assert(concurrentRefreshKeepsSession(9_999), "a refresh 1ms inside the window keeps the session");
assert(!concurrentRefreshKeepsSession(10_000), "a refresh at the window boundary does not keep the session");

const src = (path: string) => readFileSync(resolve(path), "utf8");
const client = src("src/integrations/supabase/client.ts");
assert(client.includes("lock: tabAuthLock"), "the browser client uses the per-tab lock");
assert(client.includes("processLock"), "the lock is the auth-js process lock");
assert(!client.includes("navigatorLock"), "the browser client does not take navigator.locks");

const roles = src("src/lib/user-roles.ts");
const signupAt = roles.indexOf("async function readPracticeSignup");
const signup = roles.slice(signupAt, roles.indexOf("export function isSmeOnly", signupAt));
assert(signup.includes("getSession"), "practice signup reads the session");
assert(!signup.includes("getUser"), "practice signup does not call getUser");
assert(
  roles.includes("accountantStayChecks.set(userId, Promise.resolve(stay))"),
  "a successful stay check is cached",
);
assert(!roles.includes("accountantStayChecks.delete"), "sign-out clears the stay map without dropping one key");
assert(roles.includes("itMemberChecks.set(userId, Promise.resolve(member))"), "a successful IT check is cached");
{
  const itFn = roles.slice(
    roles.indexOf("export function isMilonItMember"),
    roles.indexOf("export async function shouldOpenItInbox"),
  );
  const errorAt = itFn.indexOf("if (error) return false");
  const cacheAt = itFn.indexOf("itMemberChecks.set");
  assert(errorAt !== -1 && cacheAt !== -1 && errorAt < cacheAt, "an IT RPC error is not cached as not IT");
}
assert(roles.includes("clearAccountantStayCache"), "sign-out can clear the stay cache");

const gate = src("src/routes/_authenticated.gate.tsx");
assert(!gate.includes("while (brandLoading)") && !gate.includes("if (brandLoading)"), "the gate does not wait on brand");
const gateView = src("src/components/firm-billing-gate-view.tsx");
assert(
  gate.includes('surface="error"') && gateView.includes("Couldn't check billing"),
  "a failed check shows the retry card",
);
assert(gate.includes("pageWhileEntitlementUnknown"), "unknown entitlement uses the page decision");
assert(
  /setFirmEntitled\(null\);[\s\S]{0,160}\}, \[userId\]\)/.test(gate),
  "entitlement clears when the signed-in user changes",
);
assert(
  gate.includes("clientsPromise") && gate.includes(".catch("),
  "a rejected client count is not an unhandled rejection",
);
assert(gate.includes("<FirmShellLoading />"), "a walled page shows a skeleton while entitlement is unknown");
assert(gate.includes("setBillingDeadlinePassed(true)"), "a timeout remembers that the 8s deadline passed");
const deadlineAt = gate.indexOf("skeletonAfterBillingDeadline");
const holdAt = gate.indexOf("const holdGatedPage");
assert(
  deadlineAt !== -1 && holdAt !== -1 && deadlineAt < holdAt,
  "a passed deadline shows Retry before the skeleton",
);
assert(gate.includes("<Outlet />"), "an allowed page still mounts the outlet");
assert(gateView.includes('to="/dashboard"'), "Back is a router link");
assert(!gate.includes('href="/dashboard"') && !gateView.includes('href="/dashboard"'), "Back is not a full page navigation");
assert(!gate.includes("firmGate"), "entitlement does not use the old gate flag");
assert(
  gate.includes("Gated client pages show Retry"),
  "a timeout keeps Home open and asks to retry on a client file",
);

const attacher = src("src/integrations/supabase/auth-attacher.ts");
assert(attacher.includes("accessTokenWithin"), "server function auth reads are bounded");

const stripe = src("src/lib/stripe.server.ts");
assert(stripe.includes("timeout: 8000") && stripe.includes("maxNetworkRetries: 1"), "Stripe calls time out");

const checkout = src("src/lib/stripe-checkout.functions.ts");
assert(checkout.includes("waitUntil(bounded)"), "checkout does not await the trial mirror");
assert(!checkout.includes("await syncStarterTrialMirrorForActor"), "checkout does not await the trial mirror");
assert(checkout.includes("readFirmSubscriptionHistory"), "entitlement reuses the isolate subscription cache");
assert(!checkout.includes("rememberEntitlement(email, failed)"), "a Stripe error is not cached as unpaid");
assert(checkout.includes("ENTITLEMENT_CACHE_TTL_MS = 60_000"), "a paid entitlement stays cached for 60 seconds");
assert(checkout.includes("NEGATIVE_ENTITLEMENT_TTL_MS = 5_000"), "an unpaid entitlement is not cached for a minute");
assert(checkout.includes("waitUntil"), "the trial mirror uses waitUntil so the isolate is not frozen");
assert(checkout.includes("entitlementInflight"), "overlapping entitlement calls share one Stripe read");
const cap = src("src/lib/firm-client-cap.server.ts");
assert(cap.includes("STRIPE_ISOLATE_CACHE_TTL_MS = 45_000"), "stripe lists stay in the isolate for 45 seconds");
const vercel = src("vercel.json");
assert(vercel.includes('"regions"') && vercel.includes('"dub1"'), "server functions run in Dublin");
assert(!gate.includes("opening the app"), "a timeout does not open the app");
assert(!gate.includes("firmSignupCheckoutIntent"), "the gate does not default a firm to a US signup");
assert(gate.includes("readCachedFirmEntitlement"), "the gate reuses one entitlement read");
assert(gate.includes('to: "/billing/required"'), "a confirmed unpaid firm still leaves a gated client route");
const sync = src("src/lib/stripe-billing-sync.server.ts");
assert(sync.includes("await syncStarterTrialMirrorForActor"), "billing sync still awaits the mirror");

const wall = src("src/routes/billing.required.tsx");
const wallCopy = src("src/lib/billing-wall.ts");
const trialCopy = src("src/lib/starter-trial-constants.ts");
assert(
  wall.includes("cardFreeTrialLine") &&
    wallCopy.includes("cardFreeTrialLine") &&
    wallCopy.includes("CARD_FREE_TRIAL_LINE") &&
    trialCopy.includes("Your first client is free to explore") &&
    trialCopy.includes("seen your first result"),
  "the wall shows the card-free trial line, and trialing copy still names the card",
);
assert(
  wall.includes("firmWallOffersRetry") && wallCopy.includes("Back to clients"),
  "Retry is conditional and Back goes to clients",
);
assert(!wall.includes("R299") && !wall.includes("VAT"), "the wall does not hard-code a rand price or VAT");
assert(wall.includes("resolveBillingWall"), "the wall reads through the deadline");

const board = src("src/components/practice-board.tsx");
assert(!board.slice(board.indexOf("function toClientRow"), board.indexOf("export function PracticeBoard")).includes("bookDeadlineTimer"), "the book deadline does not edit toClientRow");
const homeAt = board.indexOf("loading && !bookTimedOut");
assert(homeAt > 0 && homeAt < board.indexOf("cardPhase=\"ready\""), "Home paints when the book deadline fires");
assert(board.includes("readWithOneRetry"), "a timed-out client read retries once before the error");
assert(board.includes("const bookLoading = loading;"), "the list skeleton does not wait on the brand");
assert(board.includes("firm book reload timed out"), "the reload after a firm id has its own deadline");
assert(src("src/routes/billing.required.tsx").includes("noteFirmEntitlement"), "the billing wall updates the tab cache");
assert(src("src/routes/billing.success.tsx").includes("noteFirmEntitlement"), "checkout success updates the tab cache");
const clientsError = board.slice(board.indexOf('data-clients-load="error"'), board.indexOf('data-clients-load="error"') + 500);
assert(clientsError.includes("CLIENTS_LOAD_ERROR") && clientsError.includes("Retry"), "the clients error card can retry without a refresh");

const app = src("src/routes/app.tsx");
assert(app.includes('data-owner-boot="timeout"'), "owner boot has a deadline");
assert(app.includes('to="/"'), "owner boot goes back through the router");
assert(
  app.includes(
    "[user?.id, clientLinkResolved, effectiveClientId, ownerWorkspaces, actingClientId, ownerBootAttempt]",
  ),
  "owner Retry restarts role resolution",
);
assert(!app.includes("auth.getUser"), "owner boot does not call getUser");

const door = src("src/components/owner-door/owner-door.tsx");
assert(door.includes("auth.getSession()"), "the owner door email comes from the session");
assert(!door.includes("auth.getUser()"), "the owner door does not call getUser");

let waiterRejected = false;
const started = Date.now();
const holder = tabAuthLock("stuck-session", -1, () => new Promise<void>(() => {}));
const waiter = tabAuthLock("stuck-session", -1, async () => "opened").then(
  () => {
    waiterRejected = false;
  },
  () => {
    waiterRejected = true;
  },
);
await waiter;
const elapsed = Date.now() - started;
assert(waiterRejected, "a stuck lock releases the waiter at the shell deadline");
assert(elapsed < SHELL_GATE_TIMEOUT_MS + 1_500, "the waiter does not wait forever");
assert(elapsed >= SHELL_GATE_TIMEOUT_MS - 200, "the waiter waits out the shell deadline");
void holder;

const workerSource = `
import { processLock } from "@supabase/auth-js";
import { parentPort, workerData } from "node:worker_threads";
if (workerData.role === "holder") {
  await processLock("sb-auth-token", -1, async () => {
    parentPort.postMessage({ holding: true });
    await new Promise(() => {});
  });
} else {
  const started = Date.now();
  const value = await processLock("sb-auth-token", 400, async () => "got");
  parentPort.postMessage({ ok: value === "got", ms: Date.now() - started });
}
`;

function runWorker(role: "holder" | "waiter") {
  return new Worker(workerSource, { eval: true, type: "module", workerData: { role } });
}

const holderWorker = runWorker("holder");
await new Promise<void>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("holder did not acquire")), 2000);
  holderWorker.once("message", () => {
    clearTimeout(timer);
    resolve();
  });
  holderWorker.once("error", (err) => {
    clearTimeout(timer);
    reject(err);
  });
});
const waiterWorker = runWorker("waiter");
const otherTab = await new Promise<{ ok: boolean; ms: number }>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("other tab waited on the stuck lock")), 2000);
  waiterWorker.once("message", (msg: { ok: boolean; ms: number }) => {
    clearTimeout(timer);
    resolve(msg);
  });
  waiterWorker.once("error", (err) => {
    clearTimeout(timer);
    reject(err);
  });
});
await holderWorker.terminate();
await waiterWorker.terminate();
assert(otherTab.ok, "the other tab acquired its own process lock");
assert(otherTab.ms < 400, "the other tab did not wait out a shared lock");

console.log("shell-hang-deadline: ok");
