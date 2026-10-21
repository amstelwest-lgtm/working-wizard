/**
 * Firm-band catalog lookup keys and USD list amounts.
 * Run: pnpm test:stripe-plans
 */
import { readFileSync } from "node:fs";
import {
  decideFirmClientCreate,
  eligibleForIntroTrial,
  firmAddClientDestination,
  formatFirmPlanStatus,
} from "../src/lib/firm-client-cap";
import {
  ALL_FIRM_LOOKUP_KEYS,
  FIRM_BAND_CATALOG,
  FIRM_CHECKOUT_BANDS,
  FIRM_TRIAL_SENTENCE,
  FOUNDING_COUPON_ID,
  FOUNDING_PROMO_CODE,
  STRIPE_SAAS_BUSINESS_TAX_CODE,
  assertFoundingMonthlyOnly,
  firmLookupKey,
  firmSignupCheckoutIntent,
  firmUsdListPrice,
  firmUsdPublicLine,
  isFirmCheckoutBand,
  starterClientLimit,
  isFoundingCode,
} from "../src/lib/stripe-plans";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(firmLookupKey("starter", "month") === "milon_starter_monthly", "starter monthly key");
assert(firmLookupKey("starter", "year") === "milon_starter_yearly", "starter yearly key");
assert(firmLookupKey("solo", "month") === "milon_solo_monthly", "solo monthly key");
assert(firmLookupKey("solo", "year") === "milon_solo_yearly", "solo yearly key");
assert(firmLookupKey("scale", "year") === "milon_scale_yearly", "scale yearly key");

assert(FIRM_BAND_CATALOG.starter.clientLimit === 5, "Starter covers 5 active clients");
assert(FIRM_BAND_CATALOG.starter.monthlyUsdCents === 3_900, "Starter monthly is $39");
assert(
  FIRM_BAND_CATALOG.starter.yearlyUsdCents === 37_000,
  "Starter yearly is the live $370 price",
);
assert(isFirmCheckoutBand("starter"), "Starter is a Checkout band");
assert(
  (FIRM_CHECKOUT_BANDS as readonly string[])[0] === "starter" &&
    (FIRM_CHECKOUT_BANDS as readonly string[]).includes("solo"),
  "checkout bands start at Starter",
);
assert(starterClientLimit(0) === 3, "a $0 price id keeps the legacy 3-client cap");
assert(starterClientLimit(3_900) === 5, "the paid Starter price caps at 5");
assert(
  firmUsdPublicLine("starter", "month") === "$39/mo · about $8 per client",
  "starter per-client line",
);
assert(firmSignupCheckoutIntent().plan === "starter", "signup Checkout defaults to Starter");
assert(firmSignupCheckoutIntent().interval === "month", "signup Checkout is monthly");
assert(FIRM_TRIAL_SENTENCE === "14-day free trial · up to 5 clients", "locked trial sentence");
assert(
  FIRM_TRIAL_SENTENCE.includes(String(FIRM_BAND_CATALOG.starter.clientLimit)),
  "trial cap is Starter's cap",
);
assert(!FIRM_TRIAL_SENTENCE.toLowerCase().includes("3 free"), "never say 3 free clients");
assert(FIRM_BAND_CATALOG.solo.monthlyUsdCents === 9_900, "Solo monthly is $99");
assert(FIRM_BAND_CATALOG.solo.yearlyUsdCents === 95_000, "Solo yearly is $950");
assert(FIRM_BAND_CATALOG.small.clientLimit === 25, "Small is 25 active clients");
assert(FIRM_BAND_CATALOG.scale.clientLimit === 500, "Scale is 500 active clients");
assert(FIRM_BAND_CATALOG.enterprise.customQuote, "Enterprise is quotes only");
assert(FIRM_BAND_CATALOG.enterprise.lookup.month === null, "Enterprise has no public price");

assert(firmUsdListPrice("starter", "month") === "$39", "Starter monthly display");
assert(firmUsdListPrice("starter", "year") === "$370", "Starter yearly display is $370");
assert(
  firmUsdPublicLine("starter", "year") === "$370/yr · about $8 per client",
  "starter annual line keeps the per-client clause",
);
assert(
  formatFirmPlanStatus({ phase: "trialing", band: "starter" }).detail ===
    `Starter · ${FIRM_TRIAL_SENTENCE}`,
  "a Starter trial uses the locked sentence",
);
assert(
  formatFirmPlanStatus({ phase: "active", band: "starter" }).detail === "Up to 5 active clients",
  "an active Starter plan shows 5 clients",
);
assert(
  formatFirmPlanStatus({ phase: "trialing", band: "solo" }).detail ===
    `Starter · ${FIRM_TRIAL_SENTENCE}`,
  "every band's trial is the Starter sentence",
);
assert(firmUsdListPrice("solo", "month") === "$99", "Solo monthly display");
assert(firmUsdListPrice("scale", "year") === "$9,590", "Scale yearly display");

assert(
  ALL_FIRM_LOOKUP_KEYS.includes("milon_growing_monthly") &&
    ALL_FIRM_LOOKUP_KEYS.includes("milon_advanced_yearly"),
  "lookup key list includes growing + advanced",
);
assert(!ALL_FIRM_LOOKUP_KEYS.some((k) => k.startsWith("price_")), "never list price_ IDs");

assert(FOUNDING_COUPON_ID === "FOUNDING50", "FOUNDING coupon id");
assert(FOUNDING_PROMO_CODE === "FOUNDING", "FOUNDING code");
assert(isFoundingCode("founding"), "FOUNDING is case-insensitive");
assert(isFoundingCode("FOUNDING50"), "FOUNDING50 counts as founding");
assert(!isFoundingCode("SAVE20"), "other codes are not founding");

assertFoundingMonthlyOnly("month", "FOUNDING");
let yearlyBlocked = false;
try {
  assertFoundingMonthlyOnly("year", "FOUNDING");
} catch (err) {
  yearlyBlocked = err instanceof Error && /monthly prices only/i.test(err.message);
}
assert(yearlyBlocked, "FOUNDING is rejected on yearly");
assertFoundingMonthlyOnly("year", undefined);

assert(
  STRIPE_SAAS_BUSINESS_TAX_CODE === "txcd_10103001",
  "SaaS business tax code matches Stripe tax-codes + Managed Payments eligibility",
);

const trialBlock = decideFirmClientCreate({
  stripeConfigured: true,
  phase: "trialing",
  band: "solo",
  clientCount: 5,
});
assert(
  !trialBlock.allowed && trialBlock.code === "trial_client_cap",
  "trial blocks the 6th client",
);
assert(
  !trialBlock.allowed &&
    trialBlock.message.includes(FIRM_TRIAL_SENTENCE) &&
    trialBlock.message.includes("Starter"),
  "trial block uses the locked sentence on Starter",
);
assert(
  decideFirmClientCreate({
    stripeConfigured: true,
    phase: "trialing",
    band: "solo",
    clientCount: 4,
  }).allowed,
  "trial allows a 5th client on every band",
);
assert(
  decideFirmClientCreate({
    stripeConfigured: true,
    phase: "trialing",
    band: "scale",
    clientCount: 4,
  }).allowed,
  "a Scale trial still uses the Starter cap",
);
assert(
  decideFirmClientCreate({
    stripeConfigured: true,
    phase: "active",
    band: "solo",
    clientCount: 3,
  }).allowed,
  "paid Solo allows more than 3",
);
// Card-free enforced firm: the first client can be created. A second one
// does not. Add client goes to the Start trial wall.
const cardFreeSecond = decideFirmClientCreate({
  stripeConfigured: true,
  phase: "none",
  band: null,
  clientCount: 1,
  noPlanTrialEnforced: true,
});
assert(
  !cardFreeSecond.allowed && cardFreeSecond.code === "billing_required",
  "enforced, no subscription, 1 client routes to billing_required",
);
assert(
  firmAddClientDestination(cardFreeSecond) === "/billing/required",
  "Add client follows billing_required to /billing/required",
);
assert(
  decideFirmClientCreate({
    stripeConfigured: true,
    phase: "none",
    band: null,
    clientCount: 0,
    noPlanTrialEnforced: true,
  }).allowed,
  "enforced, no subscription, 0 clients is allowed",
);
assert(
  FIRM_TRIAL_SENTENCE === "14-day free trial · up to 5 clients",
  "trialing firms keep the short trial sentence",
);
const practiceBoard = readFileSync(new URL("../src/components/practice-board.tsx", import.meta.url), "utf8");
assert(
  practiceBoard.includes("firmAddClientDestination") && practiceBoard.includes("billingStartSearch"),
  "the practice board Add client follows the billing_required decision",
);
// 1020E shape: starter_trial_enforced true, precard_cap_applies true, no Stripe customer.
const noPlanCap = decideFirmClientCreate({
  stripeConfigured: true,
  phase: "none",
  band: null,
  clientCount: 5,
  starterTrialExpired: false,
  noPlanTrialEnforced: true,
});
assert(
  !noPlanCap.allowed && noPlanCap.code === "billing_required",
  "a card-free enforced firm with 5 clients still does not create another",
);
const noPlanSix = decideFirmClientCreate({
  stripeConfigured: true,
  phase: "none",
  band: null,
  clientCount: 6,
  noPlanTrialEnforced: true,
});
assert(
  !noPlanSix.allowed && noPlanSix.code === "billing_required",
  "a card-free enforced firm with 6 clients still routes to billing",
);
assert(
  !decideFirmClientCreate({
    stripeConfigured: true,
    phase: "none",
    band: null,
    clientCount: 4,
    noPlanTrialEnforced: true,
  }).allowed,
  "card-free enforced trial does not allow a 5th client before a subscription",
);
assert(!trialBlock.message.toLowerCase().includes("vat"), "the trial-limit sentence does not mention VAT");
assert(
  decideFirmClientCreate({
    stripeConfigured: true,
    phase: "none",
    band: null,
    clientCount: 9,
    noPlanTrialEnforced: false,
  }).allowed,
  "an exempt no-plan firm is not capped",
);
assert(
  !decideFirmClientCreate({
    stripeConfigured: true,
    phase: "active",
    band: null,
    clientCount: 5,
    noPlanTrialEnforced: true,
  }).allowed,
  "an enforced firm whose band could not be read fails closed at 5",
);
const soloCap = decideFirmClientCreate({
  stripeConfigured: true,
  phase: "active",
  band: "solo",
  clientCount: 15,
});
assert(!soloCap.allowed && soloCap.code === "band_client_cap", "paid Solo stops at 15");
assert(
  decideFirmClientCreate({
    stripeConfigured: true,
    phase: "active",
    band: "starter",
    clientCount: 4,
    unitAmount: 0,
  }).allowed,
  "Starter allows a 5th client; the band limit is 5",
);
assert(
  !decideFirmClientCreate({
    stripeConfigured: true,
    phase: "active",
    band: "starter",
    clientCount: 5,
    unitAmount: 0,
  }).allowed,
  "Starter stops at 5 even when the price amount is 0",
);
assert(
  decideFirmClientCreate({
    stripeConfigured: true,
    phase: "trialing",
    band: "starter",
    clientCount: 4,
  }).allowed,
  "a Starter trial allows a 5th client",
);
assert(
  !decideFirmClientCreate({
    stripeConfigured: true,
    phase: "trialing",
    band: "starter",
    clientCount: 5,
  }).allowed,
  "a Starter trial stops at 5",
);
const paidStarterRoom = decideFirmClientCreate({
  stripeConfigured: true,
  phase: "active",
  band: "starter",
  clientCount: 4,
  unitAmount: 3_900,
});
assert(paidStarterRoom.allowed, "paid Starter allows a 5th client");
const paidStarterCap = decideFirmClientCreate({
  stripeConfigured: true,
  phase: "active",
  band: "starter",
  clientCount: 5,
  unitAmount: 3_900,
});
assert(
  !paidStarterCap.allowed &&
    paidStarterCap.code === "band_client_cap" &&
    paidStarterCap.message.includes("Upgrade to Solo"),
  "paid Starter at 5 prompts an upgrade to Solo",
);
assert(
  decideFirmClientCreate({
    stripeConfigured: false,
    phase: "trialing",
    band: "solo",
    clientCount: 9,
  }).allowed,
  "unconfigured Stripe does not invent a cap",
);
assert(eligibleForIntroTrial(0), "first subscription gets the intro trial");
assert(!eligibleForIntroTrial(1), "a prior subscription does not get another trial");

console.log("stripe-plans ok");
