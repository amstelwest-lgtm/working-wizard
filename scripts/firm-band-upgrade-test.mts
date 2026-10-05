/**
 * In-app firm-band upgrade: catalog prices, owner gate, subscription update vs Checkout.
 * Run: pnpm test:firm-band-upgrade
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ASK_FIRM_OWNER_TO_UPGRADE,
  UPGRADE_CANCELLED_MESSAGE,
  UPGRADE_FAILED_MESSAGE,
  assertUpgradeTarget,
  bandFromSubscriptionSnapshot,
  billedBandFromPrice,
  callerCanManageFirmBilling,
  decideFirmUpgradeRoute,
  DOWNGRADE_BELOW_USAGE_MESSAGE,
  downgradeDropsBelowUsage,
  firmBandPriceLabel,
  firmSubscriptionUpgradeParams,
  firmUpgradePriceCurrency,
  firmUpgradeReturnPath,
  formatFirmClientUsage,
  metadataPatchForPrice,
  MILON_DOWNGRADE_BLOCKED,
  nextBandUp,
  parseFirmUpgradeReturn,
  pickEntitlingFirmSubscription,
  previousPriceIdFromSubscriptionEvent,
  readSubscriptionPrice,
  shouldCancelReplacedSubscription,
  shouldRevertBlockedDowngrade,
  upgradeButtonLabel,
  upgradeSuccessMessage,
} from "../src/lib/firm-band-upgrade";
import {
  firmCheckoutSessionParams,
  firmIntegrationIdentifier,
  firmSetupCheckoutMessage,
  firmSetupCheckoutSessionParams,
  firmUpgradeCheckoutSessionParams,
  readFirmSetupUpgrade,
  withFirmZaCoupon,
} from "../src/lib/stripe-checkout.core";
import {
  SA_FIRM_DISCOUNT_NOTE,
  isSaMarketFirm,
  stripeZaCouponId,
  zaSubscriptionDiscounts,
} from "../src/lib/firm-sa-market";
import {
  CANONICAL_APP_ORIGIN,
  appRedirectOrigin,
} from "../src/lib/app-origin";
import {
  CANONICAL_APP_ORIGIN as EDGE_CANONICAL,
  appRedirectOrigin as edgeAppRedirectOrigin,
} from "../supabase/functions/_shared/app-origin.ts";
import { checkoutEmailRedirectTo } from "../src/lib/pending-checkout";
import { FirmBandUpgrade } from "../src/components/firm-band-upgrade";
import { decideFirmClientCreate } from "../src/lib/firm-client-cap";
import {
  STARTER_TRIAL_ENDED_MESSAGE,
  starterTrialClock,
} from "../src/lib/firm-starter-trial";
import { FIRM_BAND_CATALOG, FIRM_CHECKOUT_BANDS } from "../src/lib/stripe-plans";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(nextBandUp("starter") === "solo", "starter's next band is Solo");
assert(nextBandUp("solo") === "small", "solo's next band is Small");
assert(nextBandUp("scale") === null, "scale has no self-serve band above it");
assert(nextBandUp(null) === "solo", "no band preselects Solo");
assert(
  nextBandUp("starter", 20) === "small",
  "a starter practice with 20 clients skips Solo 15",
);

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
  decideFirmUpgradeRoute({
    hasEntitlingSubscription: false,
    hasPaymentMethod: false,
  }) === "checkout",
  "no subscription uses a new Checkout subscription",
);
assert(
  decideFirmUpgradeRoute({
    hasEntitlingSubscription: true,
    hasPaymentMethod: false,
  }) === "setup_checkout",
  "an existing subscription without a card collects one in setup mode",
);
assert(
  decideFirmUpgradeRoute({
    hasEntitlingSubscription: true,
    hasPaymentMethod: true,
  }) === "update_subscription",
  "an existing subscription with a card is updated in place",
);
assert(
  decideFirmUpgradeRoute({
    hasEntitlingSubscription: true,
    hasPaymentMethod: true,
  }) === "update_subscription",
  "presentment currency does not change the route",
);

const zarStarter = readSubscriptionPrice({
  currency: "zar",
  items: {
    data: [
      {
        id: "si_starter",
        price: {
          id: "price_starter",
          lookup_key: "milon_starter_monthly",
          currency: "usd",
          unit_amount: 0,
          recurring: { interval: "month" },
        },
      },
    ],
  },
});
assert(zarStarter.currency === "usd", "the Starter price object is USD");
assert(
  zarStarter.chargeCurrency === "zar",
  "subscription.currency is read separately from Adaptive Pricing presentment",
);
assert(
  billedBandFromPrice({ lookupKey: null, productBand: "solo" }) === "solo",
  "product metadata.band is used when the lookup key is missing",
);

let downgradeBlocked = false;
try {
  assertUpgradeTarget({ phase: "active", current: "small", target: "solo" });
} catch {
  downgradeBlocked = true;
}
assert(downgradeBlocked, "active firms cannot move to a smaller band");
assertUpgradeTarget({ phase: "active", current: "starter", target: "solo", clientCount: 3 });
assertUpgradeTarget({ phase: "trialing", current: "solo", target: "solo", clientCount: 3 });
assert(
  !downgradeDropsBelowUsage("solo", 15),
  "a band that matches the current client count is allowed",
);
assert(downgradeDropsBelowUsage("solo", 16), "solo cannot cover 16 clients");
assert(!downgradeDropsBelowUsage("scale", null), "an unknown client count is not a block");
let usageBlocked = false;
try {
  assertUpgradeTarget({ phase: "active", current: "starter", target: "solo", clientCount: 20 });
} catch (err) {
  usageBlocked = err instanceof Error && err.message === DOWNGRADE_BELOW_USAGE_MESSAGE;
}
assert(usageBlocked, "in-app upgrade rejects a band below the current client count");

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

const zaCheckout = firmUpgradeCheckoutSessionParams({
  priceId: "price_test_solo",
  lookupKey: "milon_solo_monthly",
  band: "solo",
  interval: "month",
  origin: "https://www.milon.co.za",
  userId: "user_1",
  email: "owner@firm.example",
  market: "za",
  integrationIdentifier: firmIntegrationIdentifier("solo", "month", "abcdefgh"),
  includeTrial: false,
});
assert(
  zaCheckout.success_url?.startsWith(`${CANONICAL_APP_ORIGIN}/dashboard?addClient=1`),
  "a milon.co.za checkout origin is rewritten and reopens Add client",
);
assert(
  zaCheckout.cancel_url === `${CANONICAL_APP_ORIGIN}/dashboard?addClient=1&upgrade=cancelled`,
  "checkout cancel never returns to milon.co.za",
);
assert(
  !zaCheckout.success_url?.includes("milon.co.za") && !zaCheckout.cancel_url?.includes("milon.co.za"),
  "checkout URLs do not contain milon.co.za",
);

const setup = firmSetupCheckoutSessionParams({
  origin: "https://www.milon.co.za",
  customerId: "cus_starter",
  userId: "user_1",
  subscriptionId: "sub_starter",
  lookupKey: "milon_solo_monthly",
  band: "solo",
  interval: "month",
  price: { unit_amount: 9_900, currency: "usd", recurring: { interval: "month" } },
  saMarket: false,
});
assert(setup.mode === "setup", "a cardless subscription uses Checkout setup mode");
assert(setup.customer === "cus_starter", "setup Checkout stays on the existing customer");
assert(setup.currency === "usd", "setup Checkout collects a USD card");
assert(!setup.line_items, "setup Checkout does not create a second subscription");
assert(
  setup.success_url?.startsWith(`${CANONICAL_APP_ORIGIN}/dashboard?addClient=1`),
  "setup success returns to Add client on the canonical host",
);
assert(setup.metadata?.milon_setup_upgrade === "1", "setup session is marked as an upgrade");
assert(setup.metadata?.milon_subscription_id === "sub_starter", "setup session names the subscription");
assert(setup.metadata?.milon_lookup_key === "milon_solo_monthly", "setup session names the lookup key");
assert(setup.metadata?.milon_plan === "solo", "setup session names the band");
assert(setup.metadata?.milon_interval === "month", "setup session names the interval");
assert(setup.metadata?.milon_user_id === "user_1", "setup session names the user");
assert(
  setup.custom_text?.submit?.message ===
    "Saving this card moves you to MILŌN Solo at $99/month (15 clients). Billed in USD, cancel anytime.",
  "setup Checkout names the plan and the resolved price",
);
assert(
  setup.custom_text?.after_submit?.message === setup.custom_text?.submit?.message,
  "setup Checkout repeats the plan on after_submit",
);
assert(
  !setup.custom_text?.submit?.message?.includes("South Africa") &&
    !setup.custom_text?.submit?.message?.includes("50% off"),
  "a US setup Checkout has no discount text",
);

const usMonthly = firmSetupCheckoutMessage({
  bandName: "Solo",
  clientLimit: 15,
  unitAmount: 9_900,
  currency: "usd",
  interval: "month",
  saMarket: false,
});
const usYearly = firmSetupCheckoutMessage({
  bandName: "Solo",
  clientLimit: 15,
  unitAmount: 95_000,
  currency: "usd",
  interval: "year",
  saMarket: false,
});
const saMonthly = firmSetupCheckoutMessage({
  bandName: "Solo",
  clientLimit: 15,
  unitAmount: 9_900,
  currency: "usd",
  interval: "month",
  saMarket: true,
});
assert(
  usMonthly ===
    "Saving this card moves you to MILŌN Solo at $99/month (15 clients). Billed in USD, cancel anytime.",
  "US monthly setup copy uses the price amount",
);
assert(
  usYearly ===
    "Saving this card moves you to MILŌN Solo at $950/year (15 clients). Billed in USD, cancel anytime.",
  "US yearly setup copy uses the price amount",
);
assert(
  saMonthly ===
    "Saving this card moves you to MILŌN Solo at $49.50/month (South Africa pricing: 50% off) (15 clients). Billed in USD, cancel anytime.",
  "SA monthly setup copy shows the discounted charge",
);
assert(!usMonthly.includes("50% off") && !usYearly.includes("South Africa"), "US copy has no discount text");
assert(
  firmSetupCheckoutMessage({
    bandName: "Solo",
    clientLimit: 15,
    unitAmount: 10_900,
    currency: "usd",
    interval: "month",
    saMarket: false,
  }).includes("$109/month"),
  "the amount is the resolved price, not a hardcoded catalog figure",
);
assert(
  setup.setup_intent_data?.metadata?.milon_subscription_id === "sub_starter",
  "the setup intent carries the subscription id",
);
const setupRequest = readFirmSetupUpgrade(setup.metadata as Record<string, string>);
assert(setupRequest?.subscriptionId === "sub_starter" && setupRequest.band === "solo", "setup metadata parses");
assert(readFirmSetupUpgrade({ milon_plan: "solo" }) === null, "a subscription checkout is not a setup upgrade");
assert(
  appRedirectOrigin(["https://www.milonfinance.com"]) === "https://www.milonfinance.com",
  "www.milonfinance.com stays",
);
assert(
  appRedirectOrigin(["https://milonfinance.com/settings"]) === "https://milonfinance.com",
  "apex milonfinance.com stays",
);
assert(
  appRedirectOrigin(["https://working-wizard-git-preview.vercel.app"]) ===
    "https://working-wizard-git-preview.vercel.app",
  "a Vercel preview host stays",
);
assert(
  appRedirectOrigin(["https://www.milon.co.za", "https://app.milon.co.za"]) === CANONICAL_APP_ORIGIN,
  "milon.co.za is never an app redirect",
);
assert(
  appRedirectOrigin(["http://www.milonfinance.com"]) === CANONICAL_APP_ORIGIN,
  "a non-https host is not used",
);
assert(edgeAppRedirectOrigin(["https://www.milon.co.za"]) === EDGE_CANONICAL, "edge helper matches");
assert(
  checkoutEmailRedirectTo("https://www.milon.co.za/", {
    plan: "solo",
    interval: "month",
    market: "za",
  }) === `${CANONICAL_APP_ORIGIN}/auth/callback?checkout=solo&interval=month&market=za`,
  "signup emailRedirectTo leaves milon.co.za",
);

assert(
  bandFromSubscriptionSnapshot({ lookupKey: "milon_solo_monthly", metadataPlan: "starter" }) ===
    "solo",
  "the billed price wins over stale starter metadata",
);
assert(
  bandFromSubscriptionSnapshot({ lookupKey: null, metadataPlan: "small" }) === "small",
  "metadata is the fallback when the price is not expanded",
);
assert(
  bandFromSubscriptionSnapshot({
    lookupKey: "milon_solo_monthly",
    metadataPlan: "small",
    downgradeBlocked: "1",
  }) === "small",
  "a flagged downgrade keeps the metadata band that still covers usage",
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
    clientCount: 3,
  }) === null,
  "sync does not rewrite metadata that already matches",
);
const blockedPatch = metadataPatchForPrice({
  lookupKey: "milon_solo_monthly",
  metadata: { milon_plan: "small", milon_interval: "month", milon_lookup_key: "milon_small_monthly" },
  clientCount: 20,
});
assert(blockedPatch?.milon_plan === "small", "a downgrade below usage does not rewrite milon_plan");
assert(
  blockedPatch?.[MILON_DOWNGRADE_BLOCKED] === "1",
  "a downgrade below usage is flagged",
);
assert(
  blockedPatch?.milon_downgrade_blocked_band === "solo",
  "the flag names the band that was refused",
);
assert(
  metadataPatchForPrice({
    lookupKey: "milon_solo_monthly",
    metadata: blockedPatch ?? {},
    clientCount: 20,
  }) === null,
  "a repeated blocked downgrade does not rewrite the flag",
);
const cleared = metadataPatchForPrice({
  lookupKey: "milon_small_monthly",
  metadata: blockedPatch ?? {},
  clientCount: 20,
});
assert(cleared?.milon_plan === "small", "a covering price restores milon_plan");
assert(cleared?.[MILON_DOWNGRADE_BLOCKED] === "0", "a covering price clears the downgrade flag");
assert(
  shouldRevertBlockedDowngrade({
    blocked: true,
    currentPriceId: "price_solo",
    previousPriceId: "price_small",
    itemId: "si_1",
  }),
  "a blocked downgrade restores the previous price when the event has it",
);
assert(
  !shouldRevertBlockedDowngrade({
    blocked: true,
    currentPriceId: "price_solo",
    previousPriceId: null,
    itemId: "si_1",
  }),
  "without a previous price the webhook flags and does not guess an id",
);
assert(
  previousPriceIdFromSubscriptionEvent({
    type: "customer.subscription.updated",
    data: { previous_attributes: { items: { data: [{ price: "price_small" }] } } },
  }) === "price_small",
  "the webhook reads the previous price from the subscription event",
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
assert(fn.includes("firmUpgradeCheckoutSessionParams"), "no subscription uses a new Checkout subscription");
assert(fn.includes("firmSetupCheckoutSessionParams"), "a subscription without a card uses setup Checkout");
assert(fn.includes("setup_checkout"), "the no-card route is setup checkout");
assert(fn.includes("requestAppOrigin"), "billing origin comes from the request allowlist");
assert(fn.includes('return_url: `${origin.replace(/\\/$/, "")}/dashboard`') || fn.includes("/dashboard`"), "portal returns to the dashboard");
assert(!fn.includes("SITE_URL"), "billing does not trust SITE_URL");
assert(!fn.includes("/settings`"), "portal return is not /settings");
assert(fn.includes("finalizeFirmBandCheckout"), "return path syncs the new band");
assert(fn.includes("completeFirmSetupUpgrade"), "setup Checkout updates the same subscription");
assert(!fn.includes("isStripeCurrencyConflict"), "currency mismatch is not a route");
assert(!fn.includes("subscriptionCurrency"), "the upgrade route does not read charge currency");
const upgradeBody = fn.slice(fn.indexOf("export const upgradeFirmBand"));
assert(
  upgradeBody.indexOf("assertCallerCanUpgradeFirm") < upgradeBody.indexOf("subscriptions.update"),
  "authorization runs before the subscription update",
);
assert(
  upgradeBody.includes("clientCount"),
  "the in-app upgrade passes the current client count",
);
assert(
  upgradeBody.includes("replacesSubscriptionId"),
  "a new Checkout subscription still records the subscription to cancel",
);
assert(
  !upgradeBody.includes("firmUpgradeCheckoutSessionParams(checkoutInput)"),
  "Checkout is not retried without the customer",
);

const webhook = readFileSync(resolve("src/routes/api/stripe/webhook.ts"), "utf8");
assert(webhook.includes("constructFirmBillingEvent"), "webhook verifies the Stripe signature");
assert(webhook.includes("STRIPE_WEBHOOK_SECRET"), "webhook requires the signing secret");
assert(webhook.includes("checkout.session.completed"), "webhook documents checkout completion");
assert(webhook.includes("syncFirmSubscriptionBand"), "webhook syncs the firm band");
assert(
  webhook.includes("previousPriceIdFromSubscriptionEvent"),
  "webhook can restore the price from the event",
);
assert(!webhook.includes("prices.update"), "webhook does not change Stripe prices");
assert(webhook.includes("milon_downgrade_blocked"), "webhook documents the downgrade flag");
assert(webhook.includes("completeFirmSetupUpgrade"), "webhook applies a setup-mode card to the same subscription");

const server = readFileSync(resolve("src/lib/firm-client-cap.server.ts"), "utf8");
assert(
  server.includes("pickEntitlingFirmSubscription"),
  "cap check prefers the larger active band",
);
assert(
  server.includes("ASK_FIRM_OWNER_TO_UPGRADE"),
  "server rejects non-owners with the ask-owner message",
);
assert(server.includes("chargeCurrency"), "the cap reader keeps the subscription charge currency");
assert(server.includes("startedAt"), "the cap reader keeps the subscription start");
assert(server.includes("starter_trial_enforced"), "the cap reader loads the pilot flag");
assert(server.includes("starterTrialExpired"), "an expired Starter blocks a new client");
assert(
  server.includes("isMissingTrialColumn"),
  "a missing enforcement column fails open",
);
assert(
  server.includes("milon_downgrade_blocked"),
  "the cap reader honors a blocked downgrade",
);

const sync = readFileSync(resolve("src/lib/stripe-billing-sync.server.ts"), "utf8");
assert(sync.includes("downgradeDropsBelowUsage"), "sync refuses a limit below usage");
assert(sync.includes("milon_replaces_subscription"), "sync still cancels the replaced subscription");
assert(sync.includes("shouldRevertBlockedDowngrade"), "sync restores a previous price when it has one");
assert(sync.includes("completeFirmSetupUpgrade"), "setup completion updates the existing subscription");
assert(sync.includes("default_payment_method"), "setup completion saves the card on the subscription");

const panel = readFileSync(resolve("src/components/firm-band-upgrade.tsx"), "utf8");
assert(panel.includes("downgradeDropsBelowUsage"), "the band list hides a limit below usage");
assert(panel.includes("clientCount"), "the band list receives the client count");

const overSolo = renderToStaticMarkup(
  createElement(FirmBandUpgrade, {
    currentBand: "starter",
    interval: "month",
    priceCurrency: "USD",
    canUpgrade: true,
    clientCount: 20,
    onUpgrade: () => undefined,
  }),
);
assert(!overSolo.includes('value="solo"'), "Solo is not selectable when the firm already has 20 clients");
assert(overSolo.includes('value="small"'), "Small stays selectable because 25 covers 20 clients");
assert(overSolo.includes("$99"), "the list still shows the USD catalog price");

const inviteEmail = readFileSync(resolve("src/lib/client-invite-email.ts"), "utf8");
assert(inviteEmail.includes("appRedirectOrigin"), "owner invite links use the app origin helper");
assert(!inviteEmail.includes("https://milon.co.za"), "owner invite links do not default to milon.co.za");

const reset = readFileSync(resolve("src/components/password-reset-request.tsx"), "utf8");
assert(reset.includes("browserAppUrl(\"/reset-password\")"), "password reset uses the allowlisted origin");
const landing = readFileSync(resolve("src/routes/index.tsx"), "utf8");
assert(landing.includes("browserAppUrl(\"/reset-password\")"), "landing password reset uses the allowlisted origin");
assert(landing.includes("browserAppUrl(\"/app\")"), "owner signup redirect uses the allowlisted origin");
const google = readFileSync(resolve("src/lib/google-auth.ts"), "utf8");
assert(google.includes("browserAppOrigin()"), "Google redirectTo uses the allowlisted origin");

const taskLink = readFileSync(resolve("supabase/functions/task-link/index.ts"), "utf8");
const nudge = readFileSync(resolve("supabase/functions/nudge-action-items/index.ts"), "utf8");
assert(taskLink.includes("appRedirectOrigin"), "task-link emails use the allowlisted origin");
assert(nudge.includes("appRedirectOrigin"), "nudge emails use the allowlisted origin");
assert(taskLink.includes("noreply@notify.milon.co.za"), "task-link keeps the notify mailbox");

assert(isSaMarketFirm({ market: { country: "ZA", regionCode: null } }), "country ZA is SA");
assert(!isSaMarketFirm({ market: { country: "US", regionCode: "NY" } }), "country US is not SA");
assert(!isSaMarketFirm({ market: null }), "a missing market is not SA");
assert(!isSaMarketFirm(null), "a missing firm is not SA");
assert(
  isSaMarketFirm({ market: { country: "US", regionCode: "NY" }, currency: "ZAR" }),
  "a stored ZAR currency is SA when country is not ZA",
);
assert(
  isSaMarketFirm({ market: { locale: "en-ZA" } }),
  "a stored en-ZA locale is SA when country is absent",
);
assert(
  !isSaMarketFirm({ market: { country: "US", currency: "USD", locale: "en-US" } }),
  "USD and en-US are not SA",
);
assert(stripeZaCouponId(undefined) === "MILON_ZA_50", "the coupon id defaults to MILON_ZA_50");
assert(stripeZaCouponId("  ") === "MILON_ZA_50", "a blank env still uses the default coupon");
assert(stripeZaCouponId("coupon_custom") === "coupon_custom", "STRIPE_ZA_COUPON_ID overrides the id");

const checkoutBase = {
  priceId: "price_test_solo",
  lookupKey: "milon_solo_monthly",
  band: "solo" as const,
  interval: "month" as const,
  origin: "https://www.milonfinance.com",
  userId: "user_1",
  email: "owner@firm.example",
  market: "us" as const,
  integrationIdentifier: "milon-solo-month-abcdefgh",
  includeTrial: false,
  promotionCodeId: "promo_founding",
};
const usCheckout = firmCheckoutSessionParams(checkoutBase);
assert(usCheckout.allow_promotion_codes == null, "a promotion code replaces the promo box");
assert(
  usCheckout.discounts?.[0] && "promotion_code" in usCheckout.discounts[0],
  "a US checkout can still carry FOUNDING",
);
assert(
  !JSON.stringify(usCheckout.discounts ?? []).includes("MILON_ZA_50"),
  "a US checkout does not include the SA coupon",
);
const saCheckout = firmCheckoutSessionParams({ ...checkoutBase, zaCouponId: "MILON_ZA_50" });
assert(saCheckout.discounts?.length === 1, "SA checkout has one discount");
assert(
  saCheckout.discounts?.[0] &&
    "coupon" in saCheckout.discounts[0] &&
    saCheckout.discounts[0].coupon === "MILON_ZA_50",
  "SA checkout attaches the coupon",
);
assert(saCheckout.allow_promotion_codes == null, "SA checkout does not open the promo box");
assert(
  !JSON.stringify(saCheckout.discounts).includes("promo_founding"),
  "SA checkout does not stack FOUNDING",
);
const saAgain = withFirmZaCoupon(saCheckout, "MILON_ZA_50");
assert(saAgain.discounts?.length === 1, "applying the SA coupon twice does not stack it");
const saUpgrade = firmUpgradeCheckoutSessionParams({
  ...checkoutBase,
  zaCouponId: "MILON_ZA_50",
  replacesSubscriptionId: "sub_starter",
});
assert(
  saUpgrade.discounts?.[0] &&
    "coupon" in saUpgrade.discounts[0] &&
    saUpgrade.discounts[0].coupon === "MILON_ZA_50",
  "replacing a Starter subscription still attaches the SA coupon",
);

const saUpdate = firmSubscriptionUpgradeParams({
  itemId: "si_test",
  priceId: "price_test_solo",
  band: "solo",
  interval: "month",
  lookupKey: "milon_solo_monthly",
  endTrial: false,
  discounts: zaSubscriptionDiscounts({ couponId: "MILON_ZA_50", existing: [] }),
});
assert(saUpdate.discounts?.length === 1, "an SA subscription update attaches the coupon");
assert(
  zaSubscriptionDiscounts({
    couponId: "MILON_ZA_50",
    existing: [{ id: "di_za", couponId: "MILON_ZA_50" }],
  }) === undefined,
  "a subscription that already has the coupon is not updated twice",
);
const usUpdate = firmSubscriptionUpgradeParams({
  itemId: "si_test",
  priceId: "price_test_solo",
  band: "solo",
  interval: "month",
  lookupKey: "milon_solo_monthly",
  endTrial: false,
  discounts: zaSubscriptionDiscounts({ couponId: null, existing: [] }),
});
assert(usUpdate.discounts == null, "a US subscription update has no SA coupon");
assert(
  firmBandPriceLabel("solo", "month", "USD", null, { saDiscount: true }) === "$49.50",
  "SA Solo monthly is half of $99",
);
assert(
  firmBandPriceLabel("solo", "year", "USD", null, { saDiscount: true }) === "$475",
  "SA Solo yearly is half of $950",
);
assert(firmBandPriceLabel("solo", "month", "USD") === "$99", "US Solo monthly stays $99");

const usPicker = renderToStaticMarkup(
  createElement(FirmBandUpgrade, {
    currentBand: "starter",
    interval: "month",
    priceCurrency: "USD",
    canUpgrade: true,
    clientCount: 1,
    saDiscount: false,
    onUpgrade: () => undefined,
  }),
);
assert(usPicker.includes("$99"), "a US picker shows the full USD price");
assert(!usPicker.includes("$49.50"), "a US picker does not show the halved price");
assert(!usPicker.includes(SA_FIRM_DISCOUNT_NOTE), "a US picker has no SA pricing note");
assert(!usPicker.includes("50% off"), "a US picker has no discount text");
assert(!usPicker.includes("regional pricing"), "a US picker has no regional-pricing text");
const saPicker = renderToStaticMarkup(
  createElement(FirmBandUpgrade, {
    currentBand: "starter",
    interval: "month",
    priceCurrency: "USD",
    canUpgrade: true,
    clientCount: 1,
    saDiscount: true,
    onUpgrade: () => undefined,
  }),
);
assert(saPicker.includes("$49.50"), "an SA picker shows the discounted USD amount");
assert(saPicker.includes(SA_FIRM_DISCOUNT_NOTE), "an SA picker names the South Africa price");

for (const publicFile of [
  "src/components/firm-band-pricing.tsx",
  "src/routes/faq.tsx",
  "src/routes/terms.tsx",
  "src/routes/for-accountants.tsx",
  "src/routes/for-owners.tsx",
]) {
  const text = readFileSync(resolve(publicFile), "utf8");
  assert(!text.includes(SA_FIRM_DISCOUNT_NOTE), `${publicFile} does not advertise the SA discount`);
  assert(!text.includes("regional pricing"), `${publicFile} does not mention regional pricing`);
}

assert(fn.includes("isSaMarketFirm"), "checkout decides SA from the firm record");
assert(fn.includes("STRIPE_ZA_COUPON_ID"), "the coupon id is read from the env");
assert(fn.includes("zaCouponIdForMarket"), "the client market flag is not the coupon switch");
assert(sync.includes("zaSubscriptionDiscounts"), "setup completion attaches the coupon once");

const now = new Date("2026-10-05T12:00:00.000Z");
const day10 = starterTrialClock({
  enforced: true,
  band: "starter",
  startedAt: "2026-09-26T12:00:00.000Z",
  now,
});
assert(day10.dayOfTrial === 10 && day10.showCountdown && !day10.expired, "day 10 shows a countdown");
assert(day10.daysLeft === 5, "day 10 has five days left");
const day9 = starterTrialClock({
  enforced: true,
  band: "starter",
  startedAt: "2026-09-27T12:00:00.000Z",
  now,
});
assert(!day9.showCountdown && !day9.expired && day9.dayOfTrial === 9, "day 9 has no countdown");
const ended = starterTrialClock({
  enforced: true,
  band: "starter",
  startedAt: "2026-09-21T12:00:00.000Z",
  now,
});
assert(ended.expired && !ended.showCountdown, "start plus 14 days is expired");
const exempt = starterTrialClock({
  enforced: false,
  band: "starter",
  startedAt: "2026-09-01T12:00:00.000Z",
  now,
});
assert(!exempt.expired && !exempt.showCountdown && !exempt.enforced, "an exempt firm does not expire");
const unknownStart = starterTrialClock({ enforced: true, band: "starter", now });
assert(!unknownStart.expired, "an unknown start does not invent a block");
const paid = starterTrialClock({
  enforced: true,
  band: "solo",
  startedAt: "2026-09-01T12:00:00.000Z",
  now,
});
assert(!paid.expired && !paid.enforced, "a paid band is not on the Starter clock");
const storedEnd = starterTrialClock({
  enforced: true,
  band: "starter",
  stripeTrialEnd: "2026-10-01T12:00:00.000Z",
  now,
});
assert(storedEnd.expired, "a stored Stripe trial_end is the end");
const endedCreate = decideFirmClientCreate({
  stripeConfigured: true,
  phase: "active",
  band: "starter",
  clientCount: 0,
  starterTrialExpired: true,
});
assert(
  !endedCreate.allowed &&
    endedCreate.code === "starter_trial_ended" &&
    endedCreate.message === STARTER_TRIAL_ENDED_MESSAGE,
  "an expired Starter cannot add a client",
);
assert(
  decideFirmClientCreate({
    stripeConfigured: true,
    phase: "active",
    band: "starter",
    clientCount: 1,
  }).allowed,
  "omitting the clock does not expire Starter",
);

assert(dashboard.includes("FirmStarterTrialBanner"), "the practice dashboard shows the trial banner");
assert(
  dashboard.includes("Your trial has ended, choose a plan"),
  "the add-client panel uses the ended sentence",
);
const banner = readFileSync(resolve("src/components/firm-starter-trial-banner.tsx"), "utf8");
assert(banner.includes("STARTER_TRIAL_ENDED_MESSAGE"), "the banner uses the ended sentence");
assert(banner.includes("FirmBandUpgrade"), "the ended banner includes the band picker");
const migration = readFileSync(
  resolve("supabase/migrations/20261005190000_firm_starter_trial_enforced.sql"),
  "utf8",
);
assert(migration.includes("starter_trial_enforced"), "migration adds the pilot flag");
assert(migration.includes("SET DEFAULT true"), "new firms are enforced");
assert(migration.includes("SET starter_trial_enforced = false"), "existing firms are exempt");
const packs = readFileSync(resolve("src/lib/advisory-pack.functions.ts"), "utf8");
assert(packs.includes("assertStarterTrialAllowsNewWork"), "new packs are blocked after the trial");
const brain = readFileSync(resolve("src/components/client-brain-summary.tsx"), "utf8");
assert(
  brain.includes("assertFirmCanGenerateDeliverable"),
  "a new brain deliverable checks the trial before the edge function",
);

console.log("firm-band-upgrade ok");
