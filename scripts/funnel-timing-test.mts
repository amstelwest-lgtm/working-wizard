/**
 * DMMT C funnel: Solo leads, Checkout waits until an insight.
 * Run: pnpm test:funnel-timing
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { decideAccountantAuthLanding } from "../src/lib/auth-landing";
import {
  FUNNEL_CHECKOUT_AFTER_INSIGHT,
  FUNNEL_SOLO_FIRST,
  INSIGHT_SEEN_KEY,
  clearLegacyInsightSeen,
  insightSeenStorageKey,
  isPreInsightWorkspacePath,
  markInsightSeen,
  readInsightSeen,
  routePathname,
} from "../src/lib/funnel-timing";
import {
  decideFirmBillingEntitlement,
  decideFirmBillingPathGate,
  decidePostLoginBillingResume,
} from "../src/lib/stripe-entitlement";
import { PRECARD_ONBOARDING_HREF, SMART_LANDING_PATH, decideSmartLanding } from "../src/lib/smart-landing";
import { firmSignupCheckoutIntent } from "../src/lib/stripe-plans";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function read(path: string) {
  return readFileSync(resolve(path), "utf8");
}

function installMemoryStorage() {
  const store = new Map<string, string>();
  const memory = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? (store.get(key) ?? null) : null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: memory,
  });
}

const unpaid = {
  isAccountantFirmUser: true,
  isMilonItMember: false,
  entitled: false,
} as const;

assert(FUNNEL_SOLO_FIRST === "solo-first", "solo-first marker");
assert(FUNNEL_CHECKOUT_AFTER_INSIGHT === "checkout-after-insight", "checkout-after-insight marker");
assert(isPreInsightWorkspacePath("/dashboard"), "dashboard is the pre-insight workspace");
assert(
  isPreInsightWorkspacePath("/dashboard?addClient=1"),
  "add-client step is the pre-insight workspace",
);
assert(routePathname(PRECARD_ONBOARDING_HREF) === "/dashboard", "add-client href is the dashboard path");
assert(isPreInsightWorkspacePath("/clients/abc"), "client studio is the pre-insight workspace");
assert(!isPreInsightWorkspacePath("/reports"), "reports is not the aha path");
assert(!isPreInsightWorkspacePath("/settings/team"), "team settings is not the aha path");

assert(firmSignupCheckoutIntent().plan === "solo", "stashed signup Checkout is still Solo");

const fresh = decideAccountantAuthLanding({
  flow: "signup",
  hadFirmBefore: false,
  hasLiveEntitlement: false,
  pending: { plan: "solo", interval: "month", market: "us" },
  next: undefined,
});
assert(fresh.kind === "workspace", "signup does not open Checkout before an insight");

const after = decideAccountantAuthLanding({
  flow: "signin",
  hadFirmBefore: false,
  hasLiveEntitlement: false,
  pending: null,
  next: "/billing/start?plan=solo&interval=month&market=us",
  insightSeen: true,
});
assert(after.kind === "billing" && after.pending.plan === "solo", "Checkout after insight is Solo");

assert(
  decideFirmBillingPathGate({
    pathname: "/dashboard",
    isAccountantFirmUser: true,
    isMilonItMember: false,
    entitled: false,
    insightSeen: false,
  }) === "allow",
  "unpaid dashboard is open before an insight",
);
assert(
  decideFirmBillingPathGate({
    pathname: "/clients/abc",
    isAccountantFirmUser: true,
    isMilonItMember: false,
    entitled: false,
    insightSeen: true,
    firmClientCount: 1,
    firstClientId: "abc",
  }) === "allow",
  "first-client figures stay viewable without a card",
);
assert(
  decideFirmBillingPathGate({
    pathname: "/clients/second",
    isAccountantFirmUser: true,
    isMilonItMember: false,
    entitled: false,
    insightSeen: true,
    firmClientCount: 2,
    firstClientId: "abc",
  }) === "require_billing",
  "a second client still bills once an insight exists",
);
assert(
  decideFirmBillingPathGate({
    pathname: "/reports",
    isAccountantFirmUser: true,
    isMilonItMember: false,
    entitled: false,
    insightSeen: true,
    firmClientCount: 1,
  }) === "require_billing",
  "export still bills once an insight exists",
);
assert(
  decidePostLoginBillingResume({
    hasPendingFirmCheckout: true,
    ownsFirm: true,
    resumeFirmBilling: false,
    insightSeen: false,
  }) === "workspace",
  "pending Checkout before an insight opens the practice, not Spark",
);

installMemoryStorage();
localStorage.setItem(INSIGHT_SEEN_KEY, "1");
markInsightSeen("firm-a");
assert(localStorage.getItem(INSIGHT_SEEN_KEY) === null, "marking an insight drops the legacy global key");
assert(localStorage.getItem(insightSeenStorageKey("firm-a")) === "1", "firm A insight is stored on its own key");
assert(readInsightSeen("firm-a") === true, "firm A still reads as seen");
assert(readInsightSeen("firm-b") === false, "stale insight on firm A is not seen for firm B");
assert(readInsightSeen(null) === false, "no firm id is not seen");
assert(readInsightSeen(undefined) === false, "unknown firm id is not seen");
assert(readInsightSeen("  ") === false, "blank firm id is not seen");

localStorage.setItem(INSIGHT_SEEN_KEY, "1");
assert(readInsightSeen("firm-b") === false, "legacy global insight key is ignored");
assert(localStorage.getItem(INSIGHT_SEEN_KEY) === null, "legacy global insight key is removed on read");
assert(readInsightSeen("firm-a") === true, "removing the legacy key keeps firm A's flag");

localStorage.setItem(INSIGHT_SEEN_KEY, "1");
clearLegacyInsightSeen();
assert(localStorage.getItem(INSIGHT_SEEN_KEY) === null, "sign-out clears the legacy global insight key");
assert(
  localStorage.getItem(insightSeenStorageKey("firm-a")) === "1",
  "sign-out leaves the per-firm insight flag in place",
);

const signupDespiteStaleFlag = decideAccountantAuthLanding({
  flow: "signup",
  hadFirmBefore: false,
  hasLiveEntitlement: false,
  pending: { plan: "solo", interval: "month", market: "us" },
  next: "/billing/start?plan=solo&interval=month&market=us",
  insightSeen: true,
});
assert(
  signupDespiteStaleFlag.kind === "workspace",
  "new firm signup lands in the workspace even if a stored insight flag is set",
);
const signupFromFirmBRead = decideAccountantAuthLanding({
  flow: "signup",
  hadFirmBefore: false,
  hasLiveEntitlement: false,
  pending: { plan: "solo", interval: "month", market: "us" },
  next: "/billing/start?plan=solo&interval=month&market=us",
  insightSeen: readInsightSeen("firm-b"),
});
assert(
  signupFromFirmBRead.kind === "workspace",
  "stale flag from firm A does not send new firm B to Checkout",
);

assert(
  decideFirmBillingPathGate({
    ...unpaid,
    pathname: "/dashboard",
    insightSeen: true,
    firmClientCount: 0,
  }) === "allow",
  "0-client firm keeps /dashboard open before a card",
);
assert(
  decideFirmBillingPathGate({
    ...unpaid,
    pathname: "/clients",
    insightSeen: true,
    firmClientCount: 0,
  }) === "allow",
  "0-client firm keeps /clients open before a card",
);
assert(
  decideFirmBillingPathGate({
    ...unpaid,
    pathname: PRECARD_ONBOARDING_HREF,
    insightSeen: true,
    firmClientCount: 0,
  }) === "allow",
  "0-client /open destination /dashboard?addClient=1 stays open pre-card",
);
const openLanding = decideSmartLanding({ signedIn: true, entitled: false, firstClientId: null });
assert(
  openLanding.href === PRECARD_ONBOARDING_HREF && openLanding.kind === "onboarding",
  "/open sends a 0-client firm to the add-client step",
);
assert(
  decideFirmBillingPathGate({
    ...unpaid,
    pathname: SMART_LANDING_PATH,
    insightSeen: true,
    firmClientCount: 0,
  }) === "allow",
  "0-client /open is not walled at /billing/required",
);
assert(
  decideFirmBillingPathGate({
    ...unpaid,
    pathname: "/dashboard",
    insightSeen: readInsightSeen("firm-b"),
    firmClientCount: 0,
  }) === "allow",
  "firm B with 0 clients can open /dashboard",
);
assert(
  decideFirmBillingPathGate({
    ...unpaid,
    pathname: "/reports",
    insightSeen: true,
    firmClientCount: 0,
  }) === "require_billing",
  "reports still bill when the firm has no clients",
);
assert(
  decideFirmBillingPathGate({
    ...unpaid,
    pathname: "/dashboard",
    insightSeen: true,
    firmClientCount: null,
  }) === "require_billing",
  "unknown client count is not treated as zero",
);
assert(
  decideFirmBillingPathGate({
    ...unpaid,
    pathname: "/dashboard",
    insightSeen: true,
  }) === "require_billing",
  "omitted client count is not treated as zero",
);

markInsightSeen("firm-b");
assert(readInsightSeen("firm-b") === true, "firm B is seen only after its own insight");
assert(readInsightSeen("firm-a") === true, "firm A's insight flag is unchanged");
const resumeFirmB = decideAccountantAuthLanding({
  flow: "signin",
  hadFirmBefore: false,
  hasLiveEntitlement: false,
  pending: null,
  next: "/billing/start?plan=solo&interval=month&market=us",
  insightSeen: readInsightSeen("firm-b"),
});
assert(
  resumeFirmB.kind === "billing" && resumeFirmB.pending.plan === "solo",
  "firm B after its own insight still resumes Checkout",
);
assert(
  decidePostLoginBillingResume({
    hasPendingFirmCheckout: true,
    ownsFirm: true,
    resumeFirmBilling: false,
    insightSeen: readInsightSeen("firm-b"),
  }) === "billing_start",
  "firm B after its own insight still resumes pending Checkout",
);
assert(
  decideFirmBillingPathGate({
    ...unpaid,
    pathname: "/reports",
    insightSeen: readInsightSeen("firm-b"),
    firmClientCount: 1,
  }) === "require_billing",
  "firm B after its insight still walls /reports",
);
assert(
  decideFirmBillingPathGate({
    ...unpaid,
    pathname: "/clients/second",
    insightSeen: readInsightSeen("firm-b"),
    firmClientCount: 2,
    firstClientId: "first",
  }) === "require_billing",
  "firm B after its insight still walls a second client",
);
assert(
  decideFirmBillingPathGate({
    ...unpaid,
    pathname: "/settings/team",
    insightSeen: readInsightSeen("firm-b"),
    firmClientCount: 1,
  }) === "require_billing",
  "firm B after its insight still walls team settings",
);
assert(
  decideFirmBillingPathGate({
    ...unpaid,
    pathname: PRECARD_ONBOARDING_HREF,
    insightSeen: true,
    firmClientCount: 1,
  }) === "require_billing",
  "add-client query does not keep the board open after an insight",
);

assert(
  decideFirmBillingEntitlement({
    stripeConfigured: true,
    hasEntitlingSubscription: true,
    ownsFirm: true,
    isFirmMember: false,
  }).reason === "active_subscription",
  "active_subscription entitlement is unchanged",
);
assert(
  decideFirmBillingEntitlement({
    stripeConfigured: true,
    hasEntitlingSubscription: false,
    ownsFirm: false,
    isFirmMember: true,
  }).reason === "firm_member",
  "firm_member entitlement is unchanged",
);

const signup = read("src/components/firm-signup-terms.tsx");
const pricing = read("src/components/firm-band-pricing.tsx");
const picker = read("src/components/firm-band-upgrade.tsx");
const prompt = read("src/components/checkout-after-insight.tsx");
const client = read("src/routes/_authenticated/clients.$clientId.tsx");
const dash = read("src/routes/_authenticated/dashboard.tsx");

assert(signup.includes(`data-funnel={FUNNEL_SOLO_FIRST}`), "signup leads Solo");
assert(signup.includes("<strong>Solo</strong>"), "signup names Solo as the start plan");
assert(signup.includes("<details>"), "larger bands are not equal first choices");
assert(pricing.includes(`data-funnel={FUNNEL_SOLO_FIRST}`), "pricing leads Solo");
assert(pricing.includes("Larger bands, from Small to Scale"), "Scale is behind the Solo lead");
assert(picker.includes("FUNNEL_SOLO_FIRST"), "plan picker marks Solo when it leads");
assert(picker.includes("Start here"), "plan picker says Solo is where to start");
assert(!pricing.includes("SA_FIRM_DISCOUNT") || pricing.includes("showSaPricing"), "SA discount stays behind the geo flag");
assert(prompt.includes(`data-funnel={FUNNEL_CHECKOUT_AFTER_INSIGHT}`), "checkout prompt is the after-insight marker");
assert(
  prompt.includes("Add a card to start your 14-day free trial"),
  "one card action after the figures",
);
assert(client.includes("<CheckoutAfterInsight />"), "client studio offers Checkout after figures");
assert(
  client.includes('if (hasFigures && activeTab === "overview") markInsightSeen(firmId)'),
  "Overview showing the figures marks this firm's insight",
);
const imported = client.slice(
  client.indexOf("const handleConfirmFinancials"),
  client.indexOf("Deliverables bar actions"),
);
assert(
  imported.includes('accountantClientTabSearch(prev, "overview")'),
  "a successful import lands on Overview",
);
assert(!imported.includes('"ask"'), "a successful import does not open the bot tab");
const wizard = read("src/components/walkthrough-wizard.tsx");
const tour = wizard.slice(
  wizard.indexOf("const ACCOUNTANT_CLIENT_STEPS: Step[] = ["),
  wizard.indexOf("function stepsFor"),
);
assert(
  tour.indexOf('tab: "overview"') !== -1 &&
    tour.indexOf('tab: "overview"') < tour.indexOf('tab: "ask"'),
  "the studio tour opens Overview before the bot",
);
assert(client.includes("Other ways"), "upload/sync alternatives are folded");
assert(dash.includes("<CheckoutAfterInsight />"), "a scored book offers Checkout");
assert(dash.includes("markInsightSeen(firmId)"), "a scored book marks this firm's insight");
assert(dash.includes("clientRows.length === 0 ? \"tb-btn\""), "empty book does not gold-button Reports");

const overview = client.slice(client.indexOf('id="pane-overview"'), client.indexOf('id="pane-summary"'));
assert(!overview.includes("btn gold"), "Overview chrome still has no gold button");
assert(!overview.includes('portalButtonClass("primary")'), "this pass does not mint an Overview primary");

const shell = read("src/routes/_authenticated.tsx");
assert(
  shell.includes("clients.firmClientCount === 0 ? false : readInsightSeen(firmId)"),
  "shell treats a 0-client firm as not yet seen",
);
assert(read("src/hooks/use-auth.tsx").includes("clearLegacyInsightSeen()"), "sign-out drops the legacy insight key");
const authPage = read("src/routes/auth.tsx");
assert(
  authPage.includes('flow === "signup" && !firmsKnown'),
  "Create firm signup does not treat a stored flag as this firm's insight",
);
const callback = read("src/routes/auth_.callback.tsx");
assert(
  callback.includes("readInsightSeen(await activeFirmIdForUser(user.id))"),
  "Google return reads this firm's insight flag",
);
assert(
  callback.indexOf("accessTokenFromNext") !== -1 &&
    callback.indexOf("accessTokenFromNext") < callback.indexOf("readInsightSeen("),
  "staff-invite next still runs before the insight Checkout check",
);
const landing = read("src/routes/index.tsx");
assert(!landing.includes("readInsightSeen()"), "landing does not read the global insight key");
const landingSignup = landing.slice(
  landing.indexOf('rpc("ensure_practice_firm"'),
  landing.indexOf("Standard owner signup"),
);
assert(
  !landingSignup.includes("readInsightSeen"),
  "new firm signup does not consult a stored insight flag",
);
assert(landingSignup.includes('navigate({ to: "/dashboard" })'), "new firm signup opens the workspace");
assert(
  read("src/components/landing/sign-in-modal.tsx").includes("readInsightSeen(firmId)"),
  "sign-in modal reads the current firm's insight flag",
);

console.log("funnel-timing ok");
