/**
 * In-app firm-band upgrade: catalog prices, owner gate, subscription update vs Checkout.
 * Run: pnpm test:firm-band-upgrade
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ASK_FIRM_OWNER_TO_UPGRADE,
  UPGRADE_CANCELLED_MESSAGE,
  UPGRADE_FAILED_MESSAGE,
  assertUpgradeTarget,
  bandFromSubscriptionSnapshot,
  callerCanManageFirmBilling,
  decideFirmUpgradeRoute,
  firmBandPriceLabel,
  firmSubscriptionUpgradeParams,
  firmUpgradePriceCurrency,
  firmUpgradeReturnPath,
  formatFirmClientUsage,
  metadataPatchForPrice,
  nextBandUp,
  parseFirmUpgradeReturn,
  pickEntitlingFirmSubscription,
  shouldCancelReplacedSubscription,
  upgradeButtonLabel,
  upgradeSuccessMessage,
} from "../src/lib/firm-band-upgrade";
import {
  firmIntegrationIdentifier,
  firmUpgradeCheckoutSessionParams,
} from "../src/lib/stripe-checkout.core";
import { FIRM_BAND_CATALOG, FIRM_CHECKOUT_BANDS } from "../src/lib/stripe-plans";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(nextBandUp("starter") === "solo", "starter's next band is Solo");
assert(nextBandUp("solo") === "small", "solo's next band is Small");
assert(nextBandUp("scale") === null, "scale has no self-serve band above it");
assert(nextBandUp(null) === "solo", "no band preselects Solo");

assert(firmBandPriceLabel("starter", "month", "USD") === "$0", "starter stays $0");
assert(firmBandPriceLabel("solo", "month", "USD") === "$99", "solo monthly is the catalog $99");
assert(firmBandPriceLabel("small", "month", "USD") === "$149", "small monthly is the catalog $149");
assert(firmBandPriceLabel("scale", "month", "USD") === "$999", "scale monthly is the catalog $999");
assert(firmBandPriceLabel("solo", "year", "USD") === "$950", "solo yearly is the catalog $950");
assert(FIRM_BAND_CATALOG.solo.clientLimit === 15, "solo limit stays 15");
assert(FIRM_BAND_CATALOG.scale.clientLimit === 500, "scale limit stays 500");

assert(formatFirmClientUsage(3, 3) === "3 of 3 clients", "usage reads 3 of 3 clients");
assert(formatFirmClientUsage(3, 15) === "3 of 15 clients", "usage uses the paid limit");
assert(formatFirmClientUsage(4, null) === "4 clients", "unlimited band has no denominator");

const zarIncomplete = firmUpgradePriceCurrency({
  billingCurrency: "zar",
  interval: "month",
  zarByBand: {},
});
assert(zarIncomplete === "USD", "missing ZAR amounts stay on the USD catalog");
assert(
  !firmBandPriceLabel("solo", "month", zarIncomplete)!.includes("ZAR"),
  "USD fallback does not say Charged in ZAR",
);
assert(!firmBandPriceLabel("starter", "month", "USD")!.includes("0.00"), "starter is $0 not $0.00");

const zarByBand = Object.fromEntries(
  FIRM_CHECKOUT_BANDS.map((id) => [id, { month: 100, year: 1000 }]),
) as Partial<
  Record<(typeof FIRM_CHECKOUT_BANDS)[number], { month: number | null; year: number | null }>
>;
assert(
  firmUpgradePriceCurrency({ billingCurrency: "zar", interval: "month", zarByBand }) === "ZAR",
  "complete Stripe ZAR amounts use ZAR",
);
assert(
  firmBandPriceLabel("solo", "month", "ZAR", zarByBand) === "R1",
  "ZAR price uses the Stripe amount",
);
assert(
  firmUpgradePriceCurrency({ billingCurrency: "usd", interval: "month", zarByBand }) === "USD",
  "a USD subscription stays in USD",
);

assert(
  callerCanManageFirmBilling({ isOwner: true, membershipRole: "member" }),
  "owner can upgrade",
);
assert(
  callerCanManageFirmBilling({ isOwner: false, membershipRole: "admin" }),
  "firm admin can upgrade",
);
assert(
  callerCanManageFirmBilling({ isOwner: false, membershipRole: "owner" }),
  "owner role can upgrade",
);
assert(
  !callerCanManageFirmBilling({ isOwner: false, membershipRole: "member" }),
  "member cannot upgrade",
);
assert(
  !callerCanManageFirmBilling({ isOwner: false, membershipRole: null }),
  "stranger cannot upgrade",
);

assert(
  decideFirmUpgradeRoute({ hasEntitlingSubscription: false, hasPaymentMethod: false }) ===
    "checkout",
  "no subscription uses Checkout",
);
assert(
  decideFirmUpgradeRoute({ hasEntitlingSubscription: true, hasPaymentMethod: false }) ===
    "checkout",
  "starter without a card uses Checkout",
);
assert(
  decideFirmUpgradeRoute({ hasEntitlingSubscription: true, hasPaymentMethod: true }) ===
    "update_subscription",
  "card on file updates the subscription",
);

let downgradeBlocked = false;
try {
  assertUpgradeTarget({ phase: "active", current: "small", target: "solo" });
} catch {
  downgradeBlocked = true;
}
assert(downgradeBlocked, "active firms cannot move to a smaller band");
assertUpgradeTarget({ phase: "active", current: "starter", target: "solo" });
assertUpgradeTarget({ phase: "trialing", current: "solo", target: "solo" });

const update = firmSubscriptionUpgradeParams({
  itemId: "si_test",
  priceId: "price_test_solo",
  band: "solo",
  interval: "month",
  lookupKey: "milon_solo_monthly",
  metadata: { milon_plan: "starter" },
  endTrial: false,
});
assert(
  update.proration_behavior === "create_prorations",
  "proration matches the existing Stripe default",
);
assert(
  update.payment_behavior === "error_if_incomplete",
  "a failed card does not leave a half-upgraded plan",
);
assert(update.items[0]?.price === "price_test_solo", "update swaps the catalog price");
assert(update.metadata.milon_plan === "solo", "metadata band updates with the price");
assert(update.trial_end == null, "an active plan is not forced off a trial");

const trialEnd = firmSubscriptionUpgradeParams({
  itemId: "si_test",
  priceId: "price_test_small",
  band: "small",
  interval: "month",
  lookupKey: "milon_small_monthly",
  metadata: { milon_plan: "solo" },
  endTrial: true,
});
assert(trialEnd.trial_end === "now", "a trial upgrade ends the trial so the new limit applies");

const checkout = firmUpgradeCheckoutSessionParams({
  priceId: "price_test_solo",
  lookupKey: "milon_solo_monthly",
  band: "solo",
  interval: "month",
  origin: "https://milonfinance.com",
  userId: "user_1",
  email: "owner@firm.example",
  customerId: "cus_starter",
  market: "za",
  integrationIdentifier: firmIntegrationIdentifier("solo", "month", "abcdefgh"),
  includeTrial: true,
  replacesSubscriptionId: "sub_starter",
});
assert(
  checkout.subscription_data?.trial_period_days == null,
  "upgrade checkout does not start another trial",
);
assert(
  checkout.success_url?.includes("/dashboard?addClient=1&upgrade=success"),
  "success reopens add client",
);
assert(
  checkout.success_url?.includes("session_id={CHECKOUT_SESSION_ID}"),
  "success keeps the checkout session id",
);
assert(
  checkout.cancel_url === "https://milonfinance.com/dashboard?addClient=1&upgrade=cancelled",
  "cancel returns to the dashboard",
);
assert(
  checkout.metadata?.milon_replaces_subscription === "sub_starter",
  "checkout names the subscription it replaces",
);
assert(
  checkout.subscription_data?.metadata?.milon_plan === "solo",
  "new subscription is tagged Solo",
);
assert(checkout.adaptive_pricing?.enabled === true, "upgrade checkout keeps adaptive pricing");
assert(
  !("managed_payments" in checkout) || checkout.managed_payments == null,
  "upgrade checkout does not override managed payments",
);
assert(firmUpgradeReturnPath("cancelled").includes("upgrade=cancelled"), "cancel path helper");

assert(
  bandFromSubscriptionSnapshot({ lookupKey: "milon_solo_monthly", metadataPlan: "starter" }) ===
    "solo",
  "the billed price wins over stale starter metadata",
);
assert(
  bandFromSubscriptionSnapshot({ lookupKey: null, metadataPlan: "small" }) === "small",
  "metadata is the fallback when the price is not expanded",
);

const picked = pickEntitlingFirmSubscription([
  { id: "sub_starter", status: "active", created: 1, band: "starter" as const },
  { id: "sub_solo", status: "active", created: 2, band: "solo" as const },
]);
assert(
  picked?.id === "sub_solo",
  "a newer Solo subscription beats a leftover Starter subscription",
);
const trialPick = pickEntitlingFirmSubscription([
  { id: "sub_trial", status: "trialing", created: 3, band: "solo" as const },
  { id: "sub_solo", status: "active", created: 4, band: "small" as const },
]);
assert(trialPick?.id === "sub_trial", "a trial still caps the firm until it is active");

const patch = metadataPatchForPrice({
  lookupKey: "milon_small_monthly",
  metadata: { milon_plan: "starter", milon_replaces_subscription: "sub_starter" },
});
assert(patch?.milon_plan === "small", "sync writes the price's band");
assert(
  patch?.milon_replaces_subscription === "sub_starter",
  "sync keeps the replaced subscription id",
);
assert(
  metadataPatchForPrice({
    lookupKey: "milon_small_monthly",
    metadata: patch ?? {},
  }) === null,
  "sync does not rewrite metadata that already matches",
);
assert(
  shouldCancelReplacedSubscription({
    newStatus: "active",
    replacedId: "sub_starter",
    newId: "sub_solo",
  }),
  "an active upgrade cancels the replaced subscription",
);
assert(
  !shouldCancelReplacedSubscription({
    newStatus: "incomplete",
    replacedId: "sub_starter",
    newId: "sub_solo",
  }),
  "an unfinished checkout leaves the current subscription in place",
);

const back = parseFirmUpgradeReturn("?addClient=1&upgrade=success&session_id=cs_test_123");
assert(
  back.reopenAddClient && back.outcome === "success" && back.sessionId === "cs_test_123",
  "success return reopens add client",
);
const cancelled = parseFirmUpgradeReturn("?addClient=1&upgrade=cancelled");
assert(
  cancelled.outcome === "cancelled" && cancelled.sessionId === null,
  "cancel return has no session",
);
assert(upgradeButtonLabel("solo") === "Upgrade to Solo", "button names the chosen band");
assert(
  upgradeSuccessMessage("solo").includes("Up to 15 active clients"),
  "success names the new limit",
);
assert(ASK_FIRM_OWNER_TO_UPGRADE === "Ask your firm owner to upgrade", "non-owner copy");
assert(UPGRADE_CANCELLED_MESSAGE.includes("Nothing was charged"), "cancel copy");
assert(UPGRADE_FAILED_MESSAGE.includes("not changed"), "failure copy");

const dashboard = readFileSync(resolve("src/routes/_authenticated/dashboard.tsx"), "utf8");
assert(dashboard.includes("FirmBandUpgrade"), "client-limit panel lists bands");
assert(
  dashboard.includes("Ask your firm owner to upgrade"),
  "non-owners are told to ask the owner",
);
assert(dashboard.includes("upgradeFirmBand"), "the panel calls the existing billing upgrade");
assert(dashboard.includes("parseFirmUpgradeReturn"), "dashboard reopens add client after checkout");
assert(dashboard.includes("UPGRADE_CANCELLED_MESSAGE"), "dashboard shows the cancel message");
assert(dashboard.includes("UPGRADE_FAILED_MESSAGE"), "dashboard shows the failure message");
assert(
  !dashboard.includes("createBillingPortalSession"),
  "the client-limit panel does not depend on the portal",
);

const settings = readFileSync(resolve("src/routes/_authenticated/settings.index.tsx"), "utf8");
assert(settings.includes("FirmBandUpgrade"), "settings plan lists bands");
assert(settings.includes("plan?.usageLabel"), "settings plan shows client usage");
assert(settings.includes("upgradeFirmBand"), "settings upgrades through the same server function");
assert(settings.includes("plan.canUpgrade"), "manage billing stays on the owner");

const fn = readFileSync(resolve("src/lib/stripe-checkout.functions.ts"), "utf8");
assert(fn.includes("export const upgradeFirmBand"), "upgrade server function");
assert(fn.includes("assertCallerCanUpgradeFirm"), "upgrade checks the firm owner on the server");
assert(fn.includes("firmSubscriptionUpgradeParams"), "paid upgrades update the subscription");
assert(fn.includes("firmUpgradeCheckoutSessionParams"), "no-card upgrades use Checkout");
assert(fn.includes("finalizeFirmBandCheckout"), "return path syncs the new band");
const upgradeBody = fn.slice(fn.indexOf("export const upgradeFirmBand"));
assert(
  upgradeBody.indexOf("assertCallerCanUpgradeFirm") < upgradeBody.indexOf("subscriptions.update"),
  "authorization runs before the subscription update",
);

const webhook = readFileSync(resolve("src/routes/api/stripe/webhook.ts"), "utf8");
assert(webhook.includes("constructFirmBillingEvent"), "webhook verifies the Stripe signature");
assert(webhook.includes("STRIPE_WEBHOOK_SECRET"), "webhook requires the signing secret");
assert(webhook.includes("checkout.session.completed"), "webhook documents checkout completion");
assert(webhook.includes("syncFirmSubscriptionBand"), "webhook syncs the firm band");
assert(!webhook.includes("prices.update"), "webhook does not change Stripe prices");

const server = readFileSync(resolve("src/lib/firm-client-cap.server.ts"), "utf8");
assert(
  server.includes("pickEntitlingFirmSubscription"),
  "cap check prefers the larger active band",
);
assert(
  server.includes("ASK_FIRM_OWNER_TO_UPGRADE"),
  "server rejects non-owners with the ask-owner message",
);

console.log("firm-band-upgrade ok");
