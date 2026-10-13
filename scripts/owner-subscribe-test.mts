/**
 * Owner Subscribe / Manage billing, and the owner signup path into the door.
 * Run: pnpm test:owner-subscribe
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isFirmProductPath } from "../src/lib/stripe-entitlement";
import {
  ownerCheckoutHref,
  ownerCheckoutReturnCopy,
  ownerCoveredLine,
  ownerSubscribeView,
  OWNER_UNAVAILABLE_LINE,
} from "../src/lib/owner-subscribe";
import type { OwnerEntitlement } from "../src/lib/owner-billing";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

function entitlement(source: OwnerEntitlement["source"], entitled: boolean): OwnerEntitlement {
  return {
    entitled,
    source,
    plan: source === "none" ? null : "owner",
    status: entitled ? "active" : null,
    market: "us",
    interval: "month",
    currentPeriodEnd: null,
    firmName: source === "firm" ? "Harbour & Co" : null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    lookupKey: null,
  };
}

assert(
  ownerSubscribeView({ entitlement: entitlement("none", false), checkout: null }).kind === "subscribe",
  "no entitlement shows Subscribe",
);
assert(
  ownerSubscribeView({ entitlement: entitlement("stripe", true), checkout: null }).kind === "manage",
  "a Stripe plan shows Manage billing",
);
const covered = ownerSubscribeView({ entitlement: entitlement("firm", true), checkout: null });
assert(
  covered.kind === "covered" && covered.firmName === "Harbour & Co",
  "a firm source names the firm",
);
assert(
  ownerCoveredLine("Harbour & Co") === "Included, Harbour & Co covers your plan",
  "firm coverage has no price and names the firm",
);
assert(
  ownerSubscribeView({
    entitlement: entitlement("none", false),
    checkout: { status: "covered_by_firm", firm_name: "Northline" },
  }).kind === "covered",
  "checkout coverage replaces the button",
);
assert(
  ownerSubscribeView({
    entitlement: entitlement("none", false),
    checkout: { status: "owner_price_unavailable" },
  }).kind === "unavailable",
  "a missing price is a calm unavailable state",
);
assert(OWNER_UNAVAILABLE_LINE === "Subscriptions open shortly", "unavailable copy stays calm");
assert(
  ownerCheckoutHref({ status: "checkout", url: "https://checkout.stripe.com/c" }) ===
    "https://checkout.stripe.com/c",
  "checkout redirects to the session url",
);
assert(
  ownerCheckoutHref({ status: "portal", url: "https://billing.stripe.com/p" }) ===
    "https://billing.stripe.com/p",
  "manage billing redirects to the portal url",
);
assert(
  ownerCheckoutHref({ status: "owner_price_unavailable" }) === null,
  "an unavailable price does not redirect",
);
assert(
  ownerCheckoutReturnCopy("success") === "Payment received. Your plan updates in a moment.",
  "success return stays calm",
);
assert(ownerCheckoutReturnCopy("cancel") === "Nothing was charged.", "cancel return stays calm");

const subscribe = read("src/components/owner-door/owner-subscribe.tsx");
const labels = read("src/lib/owner-subscribe.ts");
assert(
  subscribe.includes("OWNER_SUBSCRIBE_LABEL") && labels.includes('OWNER_SUBSCRIBE_LABEL = "Subscribe"'),
  "the primary button is Subscribe",
);
assert(
  subscribe.includes("OWNER_MANAGE_LABEL") && labels.includes('OWNER_MANAGE_LABEL = "Manage billing"'),
  "Stripe entitlement is Manage billing",
);
assert(
  !subscribe.includes("R199") && !subscribe.includes("R299") && !subscribe.includes("ZAR"),
  "the button does not ship a rand price",
);
assert(!subscribe.includes("role=\"alert\""), "unavailable is not an error");

const pages = read("src/components/owner-door/owner-pages.tsx");
assert(pages.includes("<OwnerSubscribe"), "Plan and Settings mount the subscribe control");
assert(pages.includes('data-owner-page="plan"'), "the plan view stays on the owner door");
assert(pages.includes("What you get"), "the plan card lists what the plan includes");
assert(pages.includes("OWNER_PLAN_BENEFITS"), "the plan card uses the shared benefit lines");
assert(pages.includes("OWNER_PLAN_FREE_LINE"), "the none state names the free accountant line");
assert(pages.includes("OWNER_PLAN_INVITE_LABEL"), "the none state links to the accountant invite");
assert(
  labels.includes('OWNER_PLAN_FREE_LINE = "Free when your accountant joins Milōn"'),
  "the muted line names Milōn",
);
assert(labels.includes("Three Milōn agents watching your books"), "the card lists the three agents");
assert(labels.includes("Cash forecast and budget"), "the card lists the forecast and budget");
assert(labels.includes("Next moves"), "the card lists next moves");
assert(labels.includes("The accountant portal"), "the card lists the accountant portal");
const planCss = read("src/components/owner-door/owner-door.css");
assert(planCss.includes("max-width: 560px"), "the plan card stays about 560px wide");
assert(planCss.includes(".owner-plan-card .btn.gold.owner-ask"), "the plan button is sized inside the card");
assert(planCss.includes("width: auto") && planCss.includes("min-height: 44px"), "the subscribe button is not full-bleed");

const door = read("src/components/owner-door/owner-door.tsx");
assert(door.includes('onInvite={() => go("accountant")}'), "invite opens the accountant portal");
assert(door.includes("startOwnerCheckout"), "Subscribe calls owner checkout");
assert(door.includes("getOwnerEntitlement"), "the door reads owner entitlement");
assert(door.includes('interval: "month"'), "checkout asks for the monthly plan");

const core = read("src/lib/stripe-checkout.core.ts");
assert(
  core.includes("/billing/cancel?plan=owner"),
  "owner checkout cancel returns to the owner cancel page",
);
const success = read("src/routes/billing.success.tsx");
assert(success.includes('plan === "owner"'), "success treats an owner session differently");
assert(success.includes('screen: "plan"'), "success returns to the owner plan");
const cancel = read("src/routes/billing.cancel.tsx");
assert(cancel.includes('plan === "owner"'), "cancel treats an owner return differently");

const owners = read("src/routes/for-owners.tsx");
assert(owners.includes('ctaHref="/?signup=owner#register"'), "for owners uses the existing owner signup route");
const landing = read("src/routes/index.tsx");
assert(landing.includes('get("signup") === "owner"'), "the landing signup flag selects an owner");
assert(landing.includes('clearPendingCheckout()'), "owner signup does not keep a firm checkout");
assert(landing.includes('navigate({ to: "/app" })'), "a new owner lands in the owner door");
assert(!isFirmProductPath("/app"), "the owner door is not behind the firm billing wall");

console.log("owner-subscribe tests passed");
