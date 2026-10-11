/**
 * Firm-band Stripe Checkout: lookup_keys, FOUNDING monthly-only, adaptive_pricing.
 * Run: pnpm test:stripe-checkout
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  billingStartPath,
  checkoutCallbackPath,
  checkoutEmailRedirectTo,
  isBillingStartPath,
  paidPlanFromRegisterLabel,
  parsePendingCheckout,
  parsePendingCheckoutFromSearch,
  pendingCheckoutFromNext,
  registerLabelForPlan,
} from "../src/lib/pending-checkout";
import {
  STRIPE_SAAS_BUSINESS_TAX_CODE,
  bandIdFromLookupKey,
  firmLookupKey,
} from "../src/lib/stripe-plans";
import { parseZaLookupKey, zaLookupKey } from "../src/lib/pricing/za-ladder";
import {
  billingIntentForResolvedMarket,
  firmBillingResumeIntent,
  stripePlanMarketFromFirm,
} from "../src/lib/billing-market";
import {
  assertFoundingMonthlyOnly,
  adaptivePricingForMarket,
  adaptivePricingNote,
  firmCheckoutCharge,
  firmCheckoutSessionParams,
  firmIntegrationIdentifier,
  firmUpgradeCheckoutSessionParams,
  foundingRejectedOnYearly,
  findOwnerCatalogPrice,
  isOwnerLookupKey,
  OWNER_MONTHLY_USD_CENTS,
  OWNER_MONTHLY_ZA_CENTS,
  ownerAnnualCents,
  ownerCheckoutCharge,
  ownerCheckoutSessionParams,
  ownerIntegrationIdentifier,
  ownerLookupKey,
  ownerZarNeedsUsdFallback,
  resolveFirmCheckoutMarket,
  resolvePriceByLookupKey,
} from "../src/lib/stripe-checkout.core";
import { resolveOwnerCheckoutMarket } from "../src/lib/billing-market";
import {
  enforceZaCheckoutBillingCountry,
  syncFirmSubscriptionBand,
} from "../src/lib/stripe-billing-sync.server";
import {
  applyOwnerStripeEvent,
  emptyOwnerStripeSnapshot,
  firmLinkCoversOwner,
  firmSubscriptionCoversOwner,
  getOwnerEntitlement,
  OWNER_FIRM_GRACE_DAYS,
  OWNER_PRICE_UNAVAILABLE,
  ownerBillingEventSignal,
  planOwnerCheckout,
} from "../src/lib/owner-billing";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(firmLookupKey("solo", "month") === "milon_solo_monthly", "resolve solo monthly lookup_key");
assert(
  firmLookupKey("growing", "year") === "milon_growing_yearly",
  "resolve growing yearly lookup_key",
);

const fakeStripe = {
  prices: {
    list: async ({ lookup_keys }: { lookup_keys: string[] }) => {
      const key = lookup_keys[0];
      if (key === "milon_solo_monthly") {
        return {
          data: [
            { id: "price_test_solo_month", lookup_key: key, recurring: { interval: "month" } },
          ],
        };
      }
      return { data: [] };
    },
  },
};

const resolved = await resolvePriceByLookupKey(fakeStripe, "milon_solo_monthly");
assert(resolved.id === "price_test_solo_month", "lookup_key resolution returns catalog price id");
let missing = false;
try {
  await resolvePriceByLookupKey(fakeStripe, "milon_missing_monthly");
} catch {
  missing = true;
}
assert(missing, "unknown lookup_key throws");

assert(foundingRejectedOnYearly("year", "FOUNDING"), "FOUNDING rejected on yearly");
assert(foundingRejectedOnYearly("year", "FOUNDING50"), "FOUNDING50 rejected on yearly");
assert(!foundingRejectedOnYearly("month", "FOUNDING"), "FOUNDING allowed on monthly");
assert(!foundingRejectedOnYearly("year", undefined), "no promo on yearly is fine");
assertFoundingMonthlyOnly("month", "FOUNDING");

const monthly = firmCheckoutSessionParams({
  priceId: "price_test_solo_month",
  lookupKey: "milon_solo_monthly",
  band: "solo",
  interval: "month",
  origin: "https://milonfinance.com",
  userId: "user_1",
  email: "firm@example.com",
  market: "za",
  integrationIdentifier: firmIntegrationIdentifier("solo", "month", "abcdefgh"),
  includeTrial: true,
});

assert(monthly.adaptive_pricing?.enabled === false, "adaptive pricing stays off");
assert(monthly.line_items?.[0] && "price" in monthly.line_items[0], "uses catalog price id");
assert(
  monthly.line_items?.[0] && !("price_data" in monthly.line_items[0]),
  "does not use inline price_data",
);
assert(
  !("managed_payments" in monthly) || monthly.managed_payments == null,
  "MP not force-disabled",
);
assert(!("automatic_tax" in monthly) || monthly.automatic_tax == null, "automatic_tax omitted");
assert(monthly.billing_address_collection === "required", "billing address required");
assert(monthly.allow_promotion_codes === true, "monthly paid allows FOUNDING box");
assert(monthly.payment_method_collection === "always", "card on file at signup");
assert(monthly.subscription_data?.trial_period_days === 14, "first subscription is a 14-day trial");
assert(monthly.mode === "subscription", "subscription mode");
assert(monthly.integration_identifier === "milon-solo-month-abcdefgh", "integration_identifier");
assert(!("payment_method_types" in monthly), "dynamic payment methods");

const yearly = firmCheckoutSessionParams({
  priceId: "price_test_solo_year",
  lookupKey: "milon_solo_yearly",
  band: "solo",
  interval: "year",
  origin: "https://milonfinance.com",
  userId: "user_1",
  email: "firm@example.com",
  market: "us",
  integrationIdentifier: firmIntegrationIdentifier("solo", "year", "abcdefgh"),
  includeTrial: true,
});
assert(yearly.adaptive_pricing?.enabled === false, "US yearly Checkout does not offer ZAR");
assert(!yearly.discounts, "US yearly Checkout has no SA coupon");
assert(yearly.allow_promotion_codes !== true, "yearly Checkout hides promotion codes");
assert(yearly.payment_method_collection === "always", "yearly trial still collects a card");
assert(
  yearly.subscription_data?.trial_period_days === 14,
  "chosen yearly band also trials 14 days",
);

const resumed = firmCheckoutSessionParams({
  priceId: "price_test_solo_month",
  lookupKey: "milon_solo_monthly",
  band: "solo",
  interval: "month",
  origin: "https://milonfinance.com",
  userId: "user_1",
  email: "firm@example.com",
  market: "us",
  integrationIdentifier: firmIntegrationIdentifier("solo", "month", "abcdefgh"),
  includeTrial: false,
});
assert(resumed.payment_method_collection === "always", "resume after trial still collects a card");
assert(
  resumed.subscription_data?.trial_period_days == null,
  "a prior subscription does not get another trial",
);

assert(
  parsePendingCheckout({ plan: "solo", interval: "year", market: "us" })?.plan === "solo",
  "parse solo yearly",
);
assert(parsePendingCheckout({ plan: "spark", market: "us" }) === null, "spark is not a paid plan");
assert(
  parsePendingCheckout({ plan: "orbit", market: "us" }) === null,
  "legacy orbit is not a firm band",
);
assert(
  parsePendingCheckoutFromSearch("?checkout=constellation&market=za") === null,
  "legacy constellation query is ignored",
);
assert(
  parsePendingCheckoutFromSearch("?checkout=small&interval=year")?.interval === "year",
  "checkout query alias + interval",
);
assert(
  parsePendingCheckoutFromSearch("?plan=growing")?.market === "us",
  "market defaults to US when omitted",
);
assert(
  billingStartPath({ plan: "solo", interval: "month", market: "us" }) ===
    "/billing/start?plan=solo&interval=month&market=us",
  "start path",
);
assert(
  checkoutCallbackPath({ plan: "solo", interval: "month", market: "us" }) ===
    "/auth/callback?checkout=solo&interval=month&market=us",
  "email confirm uses allowlisted callback",
);
assert(
  checkoutEmailRedirectTo("https://milonfinance.com/", {
    plan: "solo",
    interval: "month",
    market: "za",
  }) === "https://milonfinance.com/auth/callback?checkout=solo&interval=month&market=za",
  "email redirect strips trailing slash",
);
assert(isBillingStartPath("/billing/start?plan=solo&interval=month&market=us"), "is billing start");
assert(!isBillingStartPath("/app"), "app is not billing start");
assert(
  pendingCheckoutFromNext("/billing/start?plan=starter&interval=month&market=za")?.plan === "solo",
  "archived starter query resumes as Solo",
);
assert(
  parsePendingCheckout({ plan: "starter", interval: "year", market: "us" })?.interval === "month",
  "archived starter does not keep a yearly interval",
);
assert(registerLabelForPlan("solo") === "Solo", "solo label");
assert(paidPlanFromRegisterLabel("Solo") === "solo", "label back to plan");
assert(paidPlanFromRegisterLabel("Spark — Free early access") === null, "spark label is not paid");

const checkoutFn = readFileSync(resolve("src/lib/stripe-checkout.functions.ts"), "utf8");
assert(checkoutFn.includes("getFirmBillingEntitlement"), "firm shell entitlement export");
assert(
  checkoutFn.includes("customerHasEntitlingSubscription"),
  "active/trialing helper used for Checkout and the gate",
);
assert(checkoutFn.includes("createOwnerStripeCheckout = createStripeCheckout"), "ops alias kept");
assert(checkoutFn.includes("createBillingPortalSession"), "portal session export");
assert(checkoutFn.includes("requireSupabaseAuth"), "checkout requires a signed-in user");
assert(!checkoutFn.includes("assertPlatformOwner"), "checkout is not owner-only");
assert(!checkoutFn.includes("payment_method_types"), "dynamic payment methods");
assert(checkoutFn.includes("STRIPE_WEBHOOK_SECRET"), "webhook secret is documented as optional");
assert(
  !/managed_payments:\s*\{\s*enabled:\s*false\s*\}/.test(checkoutFn),
  "firm sessions do not force-disable Managed Payments",
);
assert(checkoutFn.includes("resolveFirmCatalogPrice"), "checkout resolves catalog lookup_keys");
assert(
  checkoutFn.includes("firmCheckoutCharge"),
  "checkout charge follows the firm, not a tampered URL market",
);
assert(!checkoutFn.includes("price_data"), "checkout does not build inline price_data");
assert(checkoutFn.includes("assertFoundingMonthlyOnly"), "FOUNDING guard on create");
assert(
  STRIPE_SAAS_BUSINESS_TAX_CODE === "txcd_10103001",
  "tax_code is SaaS — business use from Stripe's canonical list",
);

const core = readFileSync(resolve("src/lib/stripe-checkout.core.ts"), "utf8");
assert(core.includes("adaptivePricingForMarket"), "core sets adaptive_pricing from the market");
assert(adaptivePricingForMarket("za") === false, "rand prices do not use Adaptive Pricing");
assert(adaptivePricingForMarket("us") === false, "US sessions turn Adaptive Pricing off");
assert(adaptivePricingNote("us") === null, "US interstitial hides a rand line");
assert(adaptivePricingNote("za") === null, "the interstitial does not add a rand sentence");
assert(
  resolveFirmCheckoutMarket({ country: "US", regionCode: "CA" }, "za") === "us",
  "a US firm stays USD even if the request says za",
);
assert(
  resolveFirmCheckoutMarket({ country: "ZA" }, "us") === "za",
  "a SA firm keeps ZAR presentment",
);
assert(resolveFirmCheckoutMarket(null, "us") === "us", "no firm row and a US request stays USD");
assert(resolveFirmCheckoutMarket(null, "za") === "us", "no firm row ignores a za request");
assert(resolveFirmCheckoutMarket(null, "za", "ZA") === "za", "no firm row in ZA uses the edge");
assert(
  resolveFirmCheckoutMarket(null, "us", "ZA") === "za",
  "no firm row in ZA does not follow a us URL",
);
const usFirmZaBill = firmCheckoutCharge({
  firmMarket: { country: "US", regionCode: "CA" },
  requested: "za",
  billingCountry: "ZA",
  band: "solo",
  interval: "month",
});
assert(usFirmZaBill.priceMarket === "us", "US firm with a ZA billing country stays USD");
assert(
  usFirmZaBill.lookupKey === firmLookupKey("solo", "month"),
  "US firm never uses the ZAR lookup",
);
assert(usFirmZaBill.firmMarket === "us", "a ?market=za request does not flip a US firm");
const zaFirmUsBill = firmCheckoutCharge({
  firmMarket: { country: "ZA", regionCode: null },
  requested: "za",
  billingCountry: "US",
  band: "solo",
  interval: "month",
});
assert(zaFirmUsBill.firmMarket === "za", "ZA firm market stays ZA");
assert(
  zaFirmUsBill.priceMarket === "us",
  "ZA firm with a non-ZA billing country falls back to USD",
);
assert(
  zaFirmUsBill.lookupKey === firmLookupKey("solo", "month"),
  "that fallback uses the USD lookup",
);
assert(zaFirmUsBill.billingFallback, "the fallback is recorded");
const zaFirmZaBill = firmCheckoutCharge({
  firmMarket: { country: "ZA" },
  requested: "us",
  billingCountry: "ZA",
  band: "solo",
  interval: "month",
});
assert(zaFirmZaBill.priceMarket === "za", "ZA firm with ZA billing ignores ?market=us");
assert(zaFirmZaBill.lookupKey === zaLookupKey("solo", "month"), "ZA firm uses the ZAR lookup");
const zaFirmUnknownBill = firmCheckoutCharge({
  firmMarket: { country: "ZA" },
  requested: "us",
  billingCountry: null,
  band: "solo",
  interval: "month",
});
assert(
  zaFirmUnknownBill.lookupKey === zaLookupKey("solo", "month"),
  "ZA firm with an unknown billing country stays on the ZAR lookup",
);
assert(
  stripePlanMarketFromFirm({ country: "ZA", regionCode: "GP" }) === "za",
  "wall market reads the firm country",
);
assert(stripePlanMarketFromFirm({ country: "US" }) === "us", "a US firm country is USD");
assert(stripePlanMarketFromFirm(null) === "us", "a missing firm market is not ZA");
assert(stripePlanMarketFromFirm("za") === "us", "a bare za string is not a firm market");
const walled = firmBillingResumeIntent(
  { country: "ZA" },
  { plan: "solo", interval: "month", promo: "FOUNDING" },
);
assert(walled.market === "za", "the billing wall URL uses the firm market");
assert(walled.plan === "solo" && walled.interval === "month", "the wall keeps the chosen band");
assert(
  billingIntentForResolvedMarket("za", { plan: "solo", interval: "month" }).market === "za",
  "a resolved ZA quote overrides a us URL market",
);
const usWithCoupon = firmCheckoutSessionParams({
  priceId: "price_test_solo_month",
  lookupKey: "milon_solo_monthly",
  band: "solo",
  interval: "month",
  origin: "https://milonfinance.com",
  userId: "user_1",
  email: "firm@example.com",
  market: "us",
  zaCouponId: "MILON_ZA_50",
  integrationIdentifier: firmIntegrationIdentifier("solo", "month", "abcdefgh"),
  includeTrial: true,
});
assert(usWithCoupon.adaptive_pricing?.enabled === false, "US session disables Adaptive Pricing");
assert(
  !usWithCoupon.discounts?.some((entry) => "coupon" in entry && entry.coupon === "MILON_ZA_50"),
  "the SA 50% coupon never attaches for a US firm",
);
const zaWithCoupon = firmCheckoutSessionParams({
  priceId: "price_test_solo_month",
  lookupKey: "milon_za_solo_monthly",
  band: "solo",
  interval: "month",
  origin: "https://milonfinance.com",
  userId: "user_1",
  email: "firm@example.com",
  market: "za",
  zaCouponId: "MILON_ZA_50",
  integrationIdentifier: firmIntegrationIdentifier("solo", "month", "abcdefgh"),
  includeTrial: false,
});
assert(
  zaWithCoupon.adaptive_pricing?.enabled === false,
  "a rand session does not use Adaptive Pricing",
);
assert(
  zaWithCoupon.automatic_tax?.enabled === false,
  "a rand session does not enable automatic tax",
);
assert(zaWithCoupon.allow_promotion_codes !== true, "a rand session hides the promotion box");
assert(
  !zaWithCoupon.discounts?.some((entry) => "coupon" in entry && entry.coupon === "MILON_ZA_50"),
  "a rand session does not attach the old coupon",
);
const usUpgrade = firmUpgradeCheckoutSessionParams({
  priceId: "price_test_solo_month",
  lookupKey: "milon_solo_monthly",
  band: "solo",
  interval: "month",
  origin: "https://milonfinance.com",
  userId: "user_1",
  email: "firm@example.com",
  market: "us",
  zaCouponId: "MILON_ZA_50",
  integrationIdentifier: firmIntegrationIdentifier("solo", "month", "abcdefgh"),
  includeTrial: false,
});
assert(usUpgrade.adaptive_pricing?.enabled === false, "US upgrade Checkout does not offer ZAR");
assert(core.includes('billing_address_collection: "required"'), "core collects billing address");
assert(core.includes("subscription_data"), "plan metadata lands on the subscription");
assert(core.includes("trial_period_days: FIRM_TRIAL_DAYS"), "core sets a 14-day trial");
assert(core.includes('payment_method_collection: "always"'), "core always collects a card");
assert(!core.includes("if_required"), "core does not waive the card for Starter");
assert(core.includes("integration_identifier"), "keep integration_identifier on session create");
assert(core.includes("automatic_tax"), "rand sessions can turn automatic tax off");
assert(!/automatic_tax:\s*\{\s*enabled:\s*true/.test(core), "automatic tax is not enabled");
assert(!core.includes("payment_method_types"), "dynamic payment methods in core");

const checkoutDocs = readFileSync(resolve("docs/STRIPE_CHECKOUT.md"), "utf8");
assert(checkoutDocs.includes("managed_payments"), "docs explain Managed Payments");
assert(
  checkoutDocs.includes("txcd_10103001") || checkoutDocs.includes("STRIPE_FIRM_BANDS"),
  "docs name tax / catalog",
);
assert(checkoutDocs.includes("Milon, Inc."), "docs say Milon, Inc.");
assert(checkoutDocs.includes("FOUNDING"), "docs mention FOUNDING");
assert(!checkoutDocs.includes("Owner Spark stays free"), "docs no longer say the owner plan is free Spark");
assert(checkoutDocs.includes("$39/mo"), "docs price the owner plan at $39");
assert(checkoutDocs.includes("R299/mo"), "docs price the owner plan at R299");
assert(
  checkoutDocs.includes("milon_za_owner_monthly"),
  "docs name the ZA owner lookup key",
);
assert(
  checkoutDocs.includes("billing country is ZA"),
  "docs limit ZAR owner checkout to a ZA billing country",
);
assert(
  checkoutDocs.includes("covered_by_firm") || checkoutDocs.includes("free when"),
  "docs say the owner plan is free when the firm is on Milōn",
);

const bandDocs = readFileSync(resolve("docs/STRIPE_FIRM_BANDS.md"), "utf8");
assert(bandDocs.includes("milon_starter_monthly"), "band docs list starter lookup_key");
assert(bandDocs.includes("FOUNDING applies to monthly"), "band docs: FOUNDING monthly-only");
assert(bandDocs.includes("adaptive_pricing"), "band docs: Adaptive Pricing");
assert(bandDocs.includes("Wilmington"), "band docs: tax head office");
assert(
  bandDocs.includes("Do not") && bandDocs.includes("managed_payments"),
  "band docs: do not force-disable MP",
);
assert(
  bandDocs.includes("Accountant product gate"),
  "band docs: firm product requires an active Stripe subscription",
);

const landing = [
  readFileSync(resolve("src/routes/index.tsx"), "utf8"),
  readFileSync(resolve("src/components/landing/register-form.tsx"), "utf8"),
].join("\n");
assert(landing.includes("FirmBandPricingTable"), "landing accountant path shows the band table");
assert(landing.includes("startFirmPlan"), "landing firm CTAs share one checkout starter");
assert(landing.includes("goToFirmSignup"), "landing has a direct firm signup helper");
assert(
  landing.includes("promptSignInToFinishFirmBilling"),
  "already-registered firm signup opens billing sign-in",
);
assert(
  landing.includes("FIRM_BILLING_SIGNIN_MESSAGE"),
  "firm already-registered copy mentions finishing billing",
);
assert(
  landing.includes("signupLooksAlreadyRegistered"),
  "register treats User already registered as sign-in, not a dead-end",
);
assert(
  landing.includes('useState("Accountant / Advisory firm")'),
  "register defaults to accountant",
);
assert(landing.includes("Create firm account"), "landing has a create-firm CTA");
assert(landing.includes("Get your own AI finance team"), "owner signup is a secondary path");
assert(!landing.includes("accountant pricing — shown via body class set by quiz"), "firm prices are not quiz-gated in markup");
assert(!landing.includes("See firm bands"), "owner Orbit/Constellation cards no longer hide prices behind /for-accountants");
assert(!landing.includes("Start Orbit"), "landing no longer Checkouts Orbit");
assert(!landing.includes("Start Constellation"), "landing no longer Checkouts Constellation");
assert(!landing.includes("Join waitlist"), "landing no longer waitlists paid plans");
assert(!landing.includes("billing is not live yet"), "landing no longer says billing is waitlist");
assert(landing.includes('value="Business owner"'), "register keeps the owner plan option");
assert(!landing.includes('option value="Orbit"'), "register no longer Checkouts Orbit through signup");
assert(landing.includes("checkoutEmailRedirectTo"), "signup confirmation uses the allowlisted callback");
assert(landing.includes("register-error"), "register errors render in the form, not only as a toast");
assert(!landing.includes("${window.location.origin}${billingStartPath"), "signup does not emailRedirectTo /billing/start");
const heroCta = landing.slice(landing.indexOf("hero-cta"), landing.indexOf("dash-stage"));
assert(heroCta.includes("HERO_CTA_LABEL"), "hero primary CTA uses the shared trial label");
assert(
  heroCta.includes('goToFirmSignup({ scrollTo: "register" })'),
  "hero primary still routes to firm signup",
);
assert(
  !heroCta.includes("see MILŌN for my clients"),
  "old accountant secondary CTA is gone from the hero",
);
assert(!heroCta.includes("__mq_start"), "hero primary does not launch the quiz");
assert(
  landing.includes("FIRM_CARD_TIMING"),
  "landing states when the first figures and the card happen",
);
assert(
  readFileSync(resolve("src/components/firm-band-pricing.tsx"), "utf8").includes(
    "FIRM_TRIAL_SENTENCE",
  ),
  "pricing bar still uses the locked trial sentence",
);
assert(!landing.includes("3 free clients"), "landing never says 3 free clients");
assert(!landing.includes("Starter is free"), "landing does not offer free-forever Starter");

const landingCss = readFileSync(resolve("src/styles/landing.css"), "utf8");
assert(
  landingCss.includes("[data-milon-landing] section"),
  "landing section padding is scoped so it cannot restyle Sonner",
);
assert(
  !landingCss.includes('html[data-landing="1"] section{'),
  "unscoped landing section rule would tuck toasts under the nav",
);
assert(
  landingCss.includes("[data-sonner-toaster]"),
  "landing pins toaster above the page and below the header",
);
assert(landingCss.includes("scroll-margin-top:88px"), "register hash scroll clears the sticky nav");
assert(landingCss.includes(".reg-error"), "register form has an in-flow error banner");
assert(landingCss.includes(".firm-bands-table"), "landing styles the firm band table");
assert(
  landingCss.includes(".acc-pricing{display:block"),
  "firm band table is visible without a quiz",
);
assert(
  !landingCss.includes("body.persona-accountant .acc-pricing"),
  "persona CSS does not gate firm prices",
);
assert(landingCss.includes(".owner-spark-path"), "owner Spark is styled as a secondary path");

const root = readFileSync(resolve("src/components/app-chrome.tsx"), "utf8");
assert(root.includes("zIndex: 70"), "root toaster sits above sticky marketing chrome");

const start = readFileSync(resolve("src/routes/billing.start.tsx"), "utf8");
assert(start.includes("createStripeCheckout"), "billing start creates a Checkout session");
assert(start.includes('to: "/auth"'), "unsigned visitors are sent to firm signup");
assert(start.includes("signup: true"), "unsigned checkout visitors land on Create firm");
assert(start.includes('role="alert"'), "checkout-start failure is an accessible alert");

const success = readFileSync(resolve("src/routes/billing.success.tsx"), "utf8");
assert(!success.includes("waitlist"), "success page is not waitlist copy");
assert(
  success.includes("subscription is active") || success.includes("Payment received"),
  "success tells the truth",
);
assert(success.includes('to="/dashboard"'), "success returns to the practice portal");
assert(
  success.includes("checkoutSessionUnlocksFirm"),
  "success treats completed trial Checkout as unlock",
);

const cancel = readFileSync(resolve("src/routes/billing.cancel.tsx"), "utf8");
assert(!cancel.includes("Lighthouse"), "cancel is not a Lighthouse-only test page");
assert(cancel.includes("Nothing was charged"), "cancel says nothing was charged");
assert(cancel.includes("Resume Checkout"), "cancel can resume Checkout");

const callback = readFileSync(resolve("src/routes/auth_.callback.tsx"), "utf8");
assert(callback.includes("pendingCheckout"), "Google return resumes paid Checkout");
assert(
  callback.indexOf("pendingCheckout") < callback.indexOf("goOps"),
  "paid Checkout resume runs before generic /app landing",
);
assert(callback.includes("readInsightSeen"), "Google return opens Checkout only after an insight");
assert(
  callback.includes("firmSignupCheckoutIntent"),
  "fresh accountant Google signup still stashes Solo",
);

const settings = readFileSync(resolve("src/routes/_authenticated/settings.index.tsx"), "utf8");
assert(
  settings.includes("createBillingPortalSession"),
  "practice settings can open Customer Portal",
);

assert(existsSync(resolve("src/routes/billing.start.tsx")), "billing start route exists");

assert(OWNER_MONTHLY_USD_CENTS === 3900, "owner monthly USD is $39");
assert(OWNER_MONTHLY_ZA_CENTS === 29900, "owner monthly ZA amount is 29900 cents");
assert(
  ownerAnnualCents(OWNER_MONTHLY_USD_CENTS) === 37440,
  "owner annual USD is monthly x 12 x 0.8",
);
assert(
  ownerAnnualCents(OWNER_MONTHLY_ZA_CENTS) === 287040,
  "owner annual ZA amount is monthly x 12 x 0.8",
);
assert(ownerLookupKey("us", "month") === "milon_owner_monthly", "USD owner monthly lookup");
assert(ownerLookupKey("za", "month") === "milon_za_owner_monthly", "ZA owner monthly lookup");
assert(ownerLookupKey("us", "year") === "milon_owner_annual", "USD owner annual lookup");
assert(ownerLookupKey("za", "year") === "milon_za_owner_annual", "ZA owner annual lookup");
assert(bandIdFromLookupKey("milon_owner_monthly") === null, "owner monthly key is not a firm band");
assert(bandIdFromLookupKey("milon_za_owner_monthly") === null, "ZA owner key is not a firm band");
assert(bandIdFromLookupKey("milon_za_owner_annual") === null, "ZA owner annual key is not a firm band");
assert(
  parseZaLookupKey("milon_za_owner_monthly") === null,
  "firm ZA parser does not claim the owner price",
);
assert(
  parseZaLookupKey("milon_za_owner_annual") === null,
  "firm ZA parser does not claim the owner annual price",
);
assert(isOwnerLookupKey("milon_solo_monthly") === false, "a firm lookup is not an owner price");

const usOwner = ownerCheckoutCharge({
  ownerMarket: { country: "US", regionCode: "CA" },
  requested: "za",
  billingCountry: "ZA",
  interval: "month",
});
assert(usOwner.ownerMarket === "us", "a US owner stays USD");
assert(
  usOwner.priceMarket === "us",
  "a US owner with ?market=za and ZA billing never gets the rand price",
);
assert(usOwner.lookupKey === "milon_owner_monthly", "a US owner uses the USD owner lookup");
assert(!usOwner.billingFallback, "a US owner is not a billing-country fallback");

const zaOwnerZaBill = ownerCheckoutCharge({
  ownerMarket: { country: "ZA" },
  requested: "us",
  billingCountry: "ZA",
  interval: "month",
});
assert(zaOwnerZaBill.priceMarket === "za", "ZA owner with ZA billing uses the rand price");
assert(
  zaOwnerZaBill.lookupKey === "milon_za_owner_monthly",
  "ZA owner lookup is the owner rand key",
);

const zaOwnerUsBill = ownerCheckoutCharge({
  ownerMarket: { country: "ZA" },
  requested: "za",
  billingCountry: "US",
  interval: "month",
});
assert(zaOwnerUsBill.ownerMarket === "za", "ZA owner market stays ZA");
assert(zaOwnerUsBill.priceMarket === "us", "ZA owner with non-ZA billing falls back to USD");
assert(
  zaOwnerUsBill.lookupKey === "milon_owner_monthly",
  "that fallback uses the USD owner lookup",
);
assert(zaOwnerUsBill.billingFallback, "the owner fallback is recorded");
assert(
  ownerCheckoutCharge({
    ownerMarket: { country: "ZA" },
    requested: "us",
    billingCountry: null,
    interval: "month",
  }).lookupKey === "milon_za_owner_monthly",
  "ZA owner with an unknown billing country stays on the rand lookup",
);
assert(
  resolveOwnerCheckoutMarket(null, "za", "US") === "us",
  "no owner row outside ZA ignores ?market=za",
);
assert(
  resolveOwnerCheckoutMarket({ country: "US", regionCode: "NY" }, "za", "ZA") === "us",
  "a stored US owner ignores ?market=za",
);
assert(
  ownerZarNeedsUsdFallback("milon_za_owner_monthly", "US"),
  "non-ZA billing drops the rand owner price",
);
assert(
  !ownerZarNeedsUsdFallback("milon_za_owner_monthly", "ZA"),
  "ZA billing keeps the rand owner price",
);
assert(
  !ownerZarNeedsUsdFallback("milon_owner_monthly", "US"),
  "a USD owner price is not a fallback",
);

function ownerPriceStripe(
  keys: Record<string, { id: string; currency: string; interval: "month" | "year" }>,
) {
  const created: Array<{
    line_items?: Array<{ price?: string }>;
    metadata?: Record<string, string>;
  }> = [];
  let lists = 0;
  return {
    created,
    lists: () => lists,
    prices: {
      list: async ({ lookup_keys }: { lookup_keys: string[] }) => {
        lists += 1;
        const key = lookup_keys[0] ?? "";
        const row = keys[key];
        if (!row) return { data: [] };
        return {
          data: [
            {
              id: row.id,
              lookup_key: key,
              currency: row.currency,
              unit_amount: key.includes("_za_") ? 29900 : 3900,
              recurring: { interval: row.interval },
            },
          ],
        };
      },
    },
    checkout: {
      sessions: {
        create: async (params: {
          line_items?: Array<{ price?: string }>;
          metadata?: Record<string, string>;
        }) => {
          created.push(params);
          return { url: "https://checkout.stripe.test/c/pay_owner" };
        },
      },
    },
  };
}

const monthlyOnly = ownerPriceStripe({
  milon_owner_monthly: { id: "price_owner_usd_month", currency: "usd", interval: "month" },
  milon_za_owner_monthly: { id: "price_owner_za_month", currency: "zar", interval: "month" },
  milon_solo_monthly: { id: "price_firm_solo", currency: "usd", interval: "month" },
});
const skippedAnnual = await findOwnerCatalogPrice(monthlyOnly, "us", "year");
assert(skippedAnnual === null, "a missing annual owner price is skipped");
const usdMonthly = await findOwnerCatalogPrice(monthlyOnly, "us", "month");
assert(usdMonthly?.price.id === "price_owner_usd_month", "monthly owner price still resolves");

const usCheckout = await planOwnerCheckout({
  stripe: monthlyOnly,
  interval: "month",
  requestedMarket: "za",
  ownerMarket: { country: "US", regionCode: "CA" },
  billingCountry: "ZA",
  userId: "user_us",
  email: "owner@example.com",
  origin: "https://www.milonfinance.com",
  firmCoverage: null,
});
assert(usCheckout.status === "checkout", "US owner opens Checkout");
if (usCheckout.status === "checkout") {
  assert(usCheckout.lookupKey === "milon_owner_monthly", "US Checkout uses the USD owner price");
  assert(usCheckout.priceMarket === "us", "US Checkout price market is USD");
}
assert(
  monthlyOnly.created[0]?.line_items?.[0]?.price === "price_owner_usd_month",
  "US session line is the USD owner price",
);
assert(
  monthlyOnly.created[0]?.metadata?.milon_lookup_key === "milon_owner_monthly",
  "US session metadata does not use a firm price",
);

const zaCheckoutStripe = ownerPriceStripe({
  milon_owner_monthly: { id: "price_owner_usd_month", currency: "usd", interval: "month" },
  milon_za_owner_monthly: { id: "price_owner_za_month", currency: "zar", interval: "month" },
});
const zaCheckout = await planOwnerCheckout({
  stripe: zaCheckoutStripe,
  interval: "month",
  requestedMarket: "us",
  ownerMarket: { country: "ZA" },
  billingCountry: "ZA",
  userId: "user_za",
  email: "za-owner@example.com",
  origin: "https://www.milonfinance.com",
  firmCoverage: null,
});
assert(
  zaCheckout.status === "checkout" && zaCheckout.lookupKey === "milon_za_owner_monthly",
  "ZA billing uses the rand owner price",
);
const zaParams = ownerCheckoutSessionParams({
  priceId: "price_owner_za_month",
  lookupKey: "milon_za_owner_monthly",
  interval: "month",
  origin: "https://www.milonfinance.com",
  userId: "user_za",
  email: "za-owner@example.com",
  market: "za",
  integrationIdentifier: ownerIntegrationIdentifier("month", "abcdefgh"),
});
assert(zaParams.adaptive_pricing?.enabled === false, "owner Checkout leaves adaptive pricing off");
assert(
  zaParams.automatic_tax?.enabled === false,
  "rand owner Checkout does not enable automatic tax",
);
assert(zaParams.allow_promotion_codes !== true, "owner Checkout hides the promotion box");
assert(!zaParams.discounts, "owner Checkout attaches no coupon");
assert(
  !JSON.stringify(zaParams).includes("MILON_ZA_50"),
  "owner Checkout does not stack the firm coupon",
);
assert(!/vat/i.test(JSON.stringify(zaParams)), "owner Checkout has no VAT wording");
assert(!zaParams.subscription_data?.trial_period_days, "owner Checkout has no trial");
assert(zaParams.metadata?.milon_plan === "owner", "owner session is marked owner");
assert(zaParams.payment_method_collection === "always", "owner Checkout collects a card");

const fallbackStripe = ownerPriceStripe({
  milon_owner_monthly: { id: "price_owner_usd_month", currency: "usd", interval: "month" },
  milon_za_owner_monthly: { id: "price_owner_za_month", currency: "zar", interval: "month" },
});
const fallback = await planOwnerCheckout({
  stripe: fallbackStripe,
  interval: "month",
  requestedMarket: "za",
  ownerMarket: { country: "ZA" },
  billingCountry: "GB",
  userId: "user_za",
  email: "za-owner@example.com",
  origin: "https://www.milonfinance.com",
  firmCoverage: null,
});
assert(
  fallback.status === "checkout" && fallback.lookupKey === "milon_owner_monthly",
  "ZA owner with non-ZA billing checks out on USD",
);

const coveredStripe = ownerPriceStripe({});
const covered = await planOwnerCheckout({
  stripe: coveredStripe,
  interval: "month",
  requestedMarket: "za",
  ownerMarket: { country: "ZA" },
  billingCountry: "ZA",
  userId: "user_covered",
  email: "covered@example.com",
  origin: "https://www.milonfinance.com",
  firmCoverage: { firmName: "Northline" },
});
assert(
  covered.status === "covered_by_firm" && covered.firm_name === "Northline",
  "a firm-covered owner skips Checkout",
);
assert(coveredStripe.lists() === 0, "firm coverage does not list Stripe prices");
assert(coveredStripe.created.length === 0, "firm coverage does not create a session");

const missingStripe = ownerPriceStripe({
  milon_solo_monthly: { id: "price_firm_solo", currency: "usd", interval: "month" },
});
const missingOwner = await planOwnerCheckout({
  stripe: missingStripe,
  interval: "month",
  requestedMarket: "us",
  ownerMarket: { country: "US", regionCode: "NY" },
  billingCountry: "US",
  userId: "user_us",
  email: "owner@example.com",
  origin: "https://www.milonfinance.com",
  firmCoverage: null,
});
assert(missingOwner.status === OWNER_PRICE_UNAVAILABLE, "a missing owner price is a typed error");
assert(missingStripe.created.length === 0, "a missing owner price does not open Checkout");
const missingAnnual = await planOwnerCheckout({
  stripe: monthlyOnly,
  interval: "year",
  requestedMarket: "us",
  ownerMarket: { country: "US", regionCode: "NY" },
  userId: "user_us",
  email: "owner@example.com",
  origin: "https://www.milonfinance.com",
  firmCoverage: null,
});
assert(
  missingAnnual.status === OWNER_PRICE_UNAVAILABLE,
  "a missing annual price is a typed error, not a firm price",
);

const zarWithoutUsd = ownerPriceStripe({
  milon_za_owner_monthly: { id: "price_owner_za_month", currency: "zar", interval: "month" },
});
const refusedZar = await planOwnerCheckout({
  stripe: zarWithoutUsd,
  interval: "month",
  requestedMarket: "za",
  ownerMarket: { country: "ZA" },
  billingCountry: "ZA",
  userId: "user_za",
  email: "za-owner@example.com",
  origin: "https://www.milonfinance.com",
  firmCoverage: null,
});
assert(
  refusedZar.status === OWNER_PRICE_UNAVAILABLE,
  "ZAR checkout is refused when the USD owner price is missing",
);
assert(zarWithoutUsd.created.length === 0, "a refused ZAR checkout does not open a session");

assert(
  !firmLinkCoversOwner({ firmId: "firm_paid", acceptedAt: null, grants: [] }),
  "a firm_id the owner wrote does not cover the owner",
);
assert(
  firmLinkCoversOwner({
    firmId: "firm_paid",
    acceptedAt: "2026-10-11T00:00:00.000Z",
    grants: [],
  }),
  "an invite or firm-created link with the acceptance marker covers the owner",
);
assert(
  firmLinkCoversOwner({
    firmId: "firm_paid",
    acceptedAt: null,
    grants: [{ firmId: "firm_paid", status: "active", grantedByMember: true }],
  }),
  "an active practice grant from a firm member covers the owner",
);
assert(
  !firmLinkCoversOwner({
    firmId: "firm_paid",
    acceptedAt: null,
    grants: [{ firmId: "firm_paid", status: "active", grantedByMember: false }],
  }),
  "a practice row granted by someone outside the firm does not cover the owner",
);
assert(
  !firmLinkCoversOwner({
    firmId: "firm_paid",
    acceptedAt: null,
    grants: [{ firmId: "firm_paid", status: "revoked", grantedByMember: true }],
  }),
  "a revoked practice grant does not cover the owner",
);

const now = 1_700_000_000;
assert(
  firmSubscriptionCoversOwner({ status: "active", metadata: { milon_plan: "solo" } }, now).covered,
  "an active firm plan covers the owner",
);
assert(
  firmSubscriptionCoversOwner({ status: "trialing", metadata: { milon_plan: "solo" } }, now)
    .covered,
  "a trialing firm plan covers the owner",
);
assert(
  firmSubscriptionCoversOwner(
    { status: "canceled", canceled_at: now - 3 * 86400, current_period_end: now - 3 * 86400 },
    now,
  ).covered,
  "three days after the firm churns is inside the 14-day grace",
);
assert(
  !firmSubscriptionCoversOwner(
    { status: "canceled", canceled_at: now - 15 * 86400, current_period_end: now - 15 * 86400 },
    now,
  ).covered,
  "fifteen days after the firm churns is outside the grace",
);
assert(OWNER_FIRM_GRACE_DAYS === 14, "firm grace is the 14-day CoS default");
assert(
  !firmSubscriptionCoversOwner({ status: "past_due", current_period_end: now - 86400 }, now)
    .covered,
  "past_due is not the post-churn grace",
);

let entitlement = getOwnerEntitlement({ stripe: null, firm: null });
assert(!entitlement.entitled && entitlement.source === "none", "no subscription is not entitled");
const createdSignal = ownerBillingEventSignal({
  type: "customer.subscription.created",
  data: {
    object: {
      id: "sub_owner",
      status: "active",
      customer: "cus_owner",
      metadata: {
        milon_plan: "owner",
        milon_user_id: "user_us",
        milon_lookup_key: "milon_owner_monthly",
        milon_market: "us",
        milon_interval: "month",
      },
      items: {
        data: [{ price: { id: "price_owner_usd_month", lookup_key: "milon_owner_monthly" } }],
      },
      current_period_end: now + 30 * 86400,
    },
  },
});
assert(createdSignal.owner, "owner subscription.created is an owner event");
let snapshot = applyOwnerStripeEvent(emptyOwnerStripeSnapshot(), {
  type: createdSignal.type,
  lookupKey: createdSignal.lookupKey,
  plan: "owner",
  status: createdSignal.status,
  market: createdSignal.market,
  interval: createdSignal.interval,
  currentPeriodEnd: createdSignal.currentPeriodEnd,
  customerId: createdSignal.customerId,
  subscriptionId: createdSignal.subscriptionId,
  priceId: createdSignal.priceId,
  userId: createdSignal.userId,
});
entitlement = getOwnerEntitlement({ stripe: snapshot, firm: null });
assert(
  entitlement.entitled && entitlement.source === "stripe",
  "an active owner subscription entitles",
);
assert(
  entitlement.plan === "owner" && entitlement.market === "us",
  "entitlement records the owner plan and market",
);
const pastDue = applyOwnerStripeEvent(snapshot, {
  type: "customer.subscription.updated",
  plan: "owner",
  lookupKey: "milon_owner_monthly",
  status: "past_due",
  subscriptionId: "sub_owner",
});
entitlement = getOwnerEntitlement({ stripe: pastDue, firm: null });
assert(
  !entitlement.entitled && entitlement.status === "past_due",
  "past_due owner subscription does not entitle",
);
const deleted = applyOwnerStripeEvent(pastDue, {
  type: "customer.subscription.deleted",
  plan: "owner",
  lookupKey: "milon_owner_monthly",
  subscriptionId: "sub_owner",
});
entitlement = getOwnerEntitlement({ stripe: deleted, firm: null });
assert(
  !entitlement.entitled && entitlement.status === "canceled",
  "subscription.deleted cancels the owner entitlement",
);
entitlement = getOwnerEntitlement({ stripe: deleted, firm: { firmName: "Northline" } });
assert(
  entitlement.entitled && entitlement.source === "firm",
  "firm coverage still entitles after the owner subscription is deleted",
);
assert(entitlement.firmName === "Northline", "firm coverage names the firm");
assert(
  !ownerBillingEventSignal({
    type: "customer.subscription.updated",
    data: {
      object: {
        id: "sub_firm",
        status: "active",
        metadata: { milon_plan: "solo", milon_lookup_key: "milon_solo_monthly" },
        items: {
          data: [
            {
              price: {
                id: "price_solo",
                lookup_key: "milon_solo_monthly",
                product: { metadata: { band: "solo" } },
              },
            },
          ],
        },
      },
    },
  }).owner,
  "a firm subscription is not an owner event",
);
const liveZaOwner = ownerBillingEventSignal({
  type: "customer.subscription.updated",
  data: {
    object: {
      id: "sub_za_owner",
      status: "active",
      items: {
        data: [
          {
            price: {
              id: "price_1UPTfiGXDN6PFbnzfAJ9I36b",
              lookup_key: "milon_za_owner_monthly",
              product: { id: "prod_VQKKjT1uyUzG2b", metadata: { plan: "owner" } },
            },
          },
        ],
      },
    },
  },
});
assert(liveZaOwner.owner, "the live ZA owner price is an owner event");
assert(
  liveZaOwner.lookupKey === "milon_za_owner_monthly",
  "the owner event keeps the ZA owner lookup key",
);
const productPlanOnly = ownerBillingEventSignal({
  type: "customer.subscription.updated",
  data: {
    object: {
      id: "sub_product_owner",
      status: "active",
      items: {
        data: [
          {
            price: {
              id: "price_1UPTfgGXDN6PFbnzzPyRVBi4",
              product: { id: "prod_VQKKjT1uyUzG2b", metadata: { plan: "owner" } },
            },
          },
        ],
      },
    },
  },
});
assert(
  productPlanOnly.owner,
  "product metadata plan=owner is an owner event without a lookup key",
);

let firmCatalogTouched = false;
const ownerZaLeftAlone = await enforceZaCheckoutBillingCountry(
  {
    mode: "subscription",
    subscription: "sub_za_owner",
    metadata: { milon_lookup_key: "milon_za_owner_monthly" },
    customer_details: { address: { country: "US" } },
  },
  {
    subscriptions: {
      retrieve: async () => {
        firmCatalogTouched = true;
        throw new Error("owner price must not be retrieved as a firm band");
      },
      update: async () => {
        firmCatalogTouched = true;
        throw new Error("owner price must not be moved onto a firm price");
      },
      cancel: async () => {
        throw new Error("unused");
      },
    },
    prices: {
      list: async () => {
        firmCatalogTouched = true;
        throw new Error("owner price must not be resolved as a firm band");
      },
    },
  },
);
assert(ownerZaLeftAlone === false && !firmCatalogTouched, "ZA owner checkout is not a firm band fallback");

let firmUpdated = false;
const skipped = await syncFirmSubscriptionBand("sub_owner", {
  subscriptions: {
    retrieve: async () => ({
      id: "sub_owner",
      status: "active",
      metadata: {},
      items: {
        data: [
          {
            id: "si_owner",
            price: {
              id: "price_1UPTfiGXDN6PFbnzfAJ9I36b",
              lookup_key: "milon_za_owner_monthly",
              product: { metadata: { plan: "owner" } },
            },
          },
        ],
      },
    }),
    update: async () => {
      firmUpdated = true;
      throw new Error("firm sync must not update an owner subscription");
    },
    cancel: async () => {
      firmUpdated = true;
      throw new Error("firm sync must not cancel from an owner subscription");
    },
  },
  prices: { list: async () => ({ data: [] }) },
});
assert(skipped.band === null && !firmUpdated, "firm band sync skips the owner product");
const firmLeak = applyOwnerStripeEvent(snapshot, {
  type: "customer.subscription.updated",
  plan: "solo",
  lookupKey: "milon_solo_monthly",
  status: "active",
});
assert(
  firmLeak?.lookupKey === snapshot?.lookupKey,
  "a firm price does not overwrite the owner entitlement",
);

const checkoutFnOwner = readFileSync(resolve("src/lib/stripe-checkout.functions.ts"), "utf8");
assert(
  checkoutFnOwner.includes("startOwnerCheckout"),
  "owner Checkout server function is exported",
);
assert(
  checkoutFnOwner.includes("getOwnerEntitlement"),
  "owner entitlement server function is exported",
);
assert(
  checkoutFnOwner.includes("owner_price_unavailable") ||
    checkoutFnOwner.includes("startOwnerCheckoutForUser"),
  "missing owner price stays on the owner path",
);
const webhookSrc = readFileSync(resolve("src/routes/api/stripe/webhook.ts"), "utf8");
assert(webhookSrc.includes("syncOwnerBillingEvent"), "webhook syncs owner subscriptions");
assert(
  webhookSrc.includes("customer.subscription.deleted"),
  "webhook documents owner subscription.deleted",
);
const syncSrc = readFileSync(resolve("src/lib/stripe-billing-sync.server.ts"), "utf8");
assert(syncSrc.includes("syncOwnerBillingEvent"), "billing sync handles owner subscriptions");
assert(syncSrc.includes('milon_plan === "owner"'), "firm band sync does not apply an owner price");

console.log("stripe-checkout ok");
