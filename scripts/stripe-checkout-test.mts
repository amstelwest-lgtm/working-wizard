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
import { STRIPE_SAAS_BUSINESS_TAX_CODE, firmLookupKey } from "../src/lib/stripe-plans";
import {
  assertFoundingMonthlyOnly,
  adaptivePricingForMarket,
  adaptivePricingNote,
  firmCheckoutSessionParams,
  firmIntegrationIdentifier,
  firmUpgradeCheckoutSessionParams,
  foundingRejectedOnYearly,
  resolveFirmCheckoutMarket,
  resolvePriceByLookupKey,
} from "../src/lib/stripe-checkout.core";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(firmLookupKey("solo", "month") === "milon_solo_monthly", "resolve solo monthly lookup_key");
assert(firmLookupKey("growing", "year") === "milon_growing_yearly", "resolve growing yearly lookup_key");

const fakeStripe = {
  prices: {
    list: async ({ lookup_keys }: { lookup_keys: string[] }) => {
      const key = lookup_keys[0];
      if (key === "milon_solo_monthly") {
        return {
          data: [{ id: "price_test_solo_month", lookup_key: key, recurring: { interval: "month" } }],
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
assert(!("managed_payments" in monthly) || monthly.managed_payments == null, "MP not force-disabled");
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
assert(yearly.subscription_data?.trial_period_days === 14, "chosen yearly band also trials 14 days");

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
assert(parsePendingCheckout({ plan: "orbit", market: "us" }) === null, "legacy orbit is not a firm band");
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
assert(checkoutFn.includes("customerHasEntitlingSubscription"), "active/trialing helper used for Checkout and the gate");
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
  checkoutFn.includes("resolveFirmCheckoutMarket"),
  "checkout market follows the firm, not a tampered US request",
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
assert(zaWithCoupon.adaptive_pricing?.enabled === false, "a rand session does not use Adaptive Pricing");
assert(zaWithCoupon.automatic_tax?.enabled === false, "a rand session does not enable automatic tax");
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
assert(checkoutDocs.includes("txcd_10103001") || checkoutDocs.includes("STRIPE_FIRM_BANDS"), "docs name tax / catalog");
assert(checkoutDocs.includes("Milon, Inc."), "docs say Milon, Inc.");
assert(checkoutDocs.includes("FOUNDING"), "docs mention FOUNDING");

const bandDocs = readFileSync(resolve("docs/STRIPE_FIRM_BANDS.md"), "utf8");
assert(bandDocs.includes("milon_starter_monthly"), "band docs list starter lookup_key");
assert(bandDocs.includes("FOUNDING applies to monthly"), "band docs: FOUNDING monthly-only");
assert(bandDocs.includes("adaptive_pricing"), "band docs: Adaptive Pricing");
assert(bandDocs.includes("Wilmington"), "band docs: tax head office");
assert(bandDocs.includes("Do not") && bandDocs.includes("managed_payments"), "band docs: do not force-disable MP");
assert(bandDocs.includes("Accountant product gate"), "band docs: firm product requires an active Stripe subscription");

const landing = [
  readFileSync(resolve("src/routes/index.tsx"), "utf8"),
  readFileSync(resolve("src/components/landing/register-form.tsx"), "utf8"),
].join("\n");
assert(landing.includes("FirmBandPricingTable"), "landing accountant path shows the band table");
assert(landing.includes("startFirmPlan"), "landing firm CTAs share one checkout starter");
assert(landing.includes("goToFirmSignup"), "landing has a direct firm signup helper");
assert(landing.includes("promptSignInToFinishFirmBilling"), "already-registered firm signup opens billing sign-in");
assert(landing.includes("FIRM_BILLING_SIGNIN_MESSAGE"), "firm already-registered copy mentions finishing billing");
assert(landing.includes("signupLooksAlreadyRegistered"), "register treats User already registered as sign-in, not a dead-end");
assert(landing.includes('useState("Accountant / Advisory firm")'), "register defaults to accountant");
assert(landing.includes("Create firm account"), "landing has a create-firm CTA");
assert(landing.includes("Business owners: start free"), "owner Spark is a secondary path");
assert(!landing.includes("accountant pricing — shown via body class set by quiz"), "firm prices are not quiz-gated in markup");
assert(!landing.includes("See firm bands"), "owner Orbit/Constellation cards no longer hide prices behind /for-accountants");
assert(!landing.includes("Start Orbit"), "landing no longer Checkouts Orbit");
assert(!landing.includes("Start Constellation"), "landing no longer Checkouts Constellation");
assert(!landing.includes("Join waitlist"), "landing no longer waitlists paid plans");
assert(!landing.includes("billing is not live yet"), "landing no longer says billing is waitlist");
assert(landing.includes("Spark — Free early access"), "register keeps Spark");
assert(!landing.includes('option value="Orbit"'), "register no longer Checkouts Orbit through signup");
assert(landing.includes("checkoutEmailRedirectTo"), "signup confirmation uses the allowlisted callback");
assert(landing.includes("register-error"), "register errors render in the form, not only as a toast");
assert(!landing.includes("${window.location.origin}${billingStartPath"), "signup does not emailRedirectTo /billing/start");
const heroCta = landing.slice(landing.indexOf("hero-cta"), landing.indexOf("dash-stage"));
assert(heroCta.includes("HERO_CTA_LABEL"), "hero primary CTA uses the shared trial label");
assert(heroCta.includes('goToFirmSignup({ scrollTo: "register" })'), "hero primary still routes to firm signup");
assert(!heroCta.includes("see MILŌN for my clients"), "old accountant secondary CTA is gone from the hero");
assert(!heroCta.includes("__mq_start"), "hero primary does not launch the quiz");
assert(landing.includes("FIRM_CARD_TIMING"), "landing states when the first figures and the card happen");
assert(
  readFileSync(resolve("src/components/firm-band-pricing.tsx"), "utf8").includes("FIRM_TRIAL_SENTENCE"),
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
assert(landingCss.includes("[data-sonner-toaster]"), "landing pins toaster above the page and below the header");
assert(landingCss.includes("scroll-margin-top:88px"), "register hash scroll clears the sticky nav");
assert(landingCss.includes(".reg-error"), "register form has an in-flow error banner");
assert(landingCss.includes(".firm-bands-table"), "landing styles the firm band table");
assert(landingCss.includes(".acc-pricing{display:block"), "firm band table is visible without a quiz");
assert(!landingCss.includes("body.persona-accountant .acc-pricing"), "persona CSS does not gate firm prices");
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
assert(success.includes("subscription is active") || success.includes("Payment received"), "success tells the truth");
assert(success.includes('to="/dashboard"'), "success returns to the practice portal");
assert(success.includes("checkoutSessionUnlocksFirm"), "success treats completed trial Checkout as unlock");

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
assert(callback.includes("firmSignupCheckoutIntent"), "fresh accountant Google signup still stashes Solo");

const settings = readFileSync(resolve("src/routes/_authenticated/settings.index.tsx"), "utf8");
assert(settings.includes("createBillingPortalSession"), "practice settings can open Customer Portal");

assert(existsSync(resolve("src/routes/billing.start.tsx")), "billing start route exists");

console.log("stripe-checkout ok");
