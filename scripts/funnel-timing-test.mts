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
  isPreInsightWorkspacePath,
} from "../src/lib/funnel-timing";
import { decideFirmBillingPathGate, decidePostLoginBillingResume } from "../src/lib/stripe-entitlement";
import { firmSignupCheckoutIntent } from "../src/lib/stripe-plans";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function read(path: string) {
  return readFileSync(resolve(path), "utf8");
}

assert(FUNNEL_SOLO_FIRST === "solo-first", "solo-first marker");
assert(FUNNEL_CHECKOUT_AFTER_INSIGHT === "checkout-after-insight", "checkout-after-insight marker");
assert(isPreInsightWorkspacePath("/dashboard"), "dashboard is the pre-insight workspace");
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
  }) === "require_billing",
  "client workspace bills once an insight exists",
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
assert(prompt.includes("Continue with"), "one Checkout action after the figures");
assert(client.includes("<CheckoutAfterInsight />"), "client studio offers Checkout after figures");
assert(client.includes("markInsightSeen"), "figures mark the insight");
assert(client.includes("Other ways"), "upload/sync alternatives are folded");
assert(dash.includes("<CheckoutAfterInsight />"), "a scored book offers Checkout");
assert(dash.includes("clientRows.length === 0 ? \"tb-btn\""), "empty book does not gold-button Reports");

const overview = client.slice(client.indexOf('id="pane-overview"'), client.indexOf('id="pane-summary"'));
assert(!overview.includes("btn gold"), "Overview chrome still has no gold button");
assert(!overview.includes('portalButtonClass("primary")'), "this pass does not mint an Overview primary");

console.log("funnel-timing ok");
