/**
 * Firm-band catalog lookup keys and USD list amounts.
 * Run: pnpm test:stripe-plans
 */
import { decideFirmClientCreate, eligibleForIntroTrial } from "../src/lib/firm-client-cap";
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
  isFirmCheckoutBand,
  isFoundingCode,
} from "../src/lib/stripe-plans";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(firmLookupKey("starter", "month") === "milon_starter_monthly", "starter monthly key");
assert(firmLookupKey("solo", "month") === "milon_solo_monthly", "solo monthly key");
assert(firmLookupKey("solo", "year") === "milon_solo_yearly", "solo yearly key");
assert(firmLookupKey("scale", "year") === "milon_scale_yearly", "scale yearly key");

let starterYearFailed = false;
try {
  firmLookupKey("starter", "year");
} catch {
  starterYearFailed = true;
}
assert(starterYearFailed, "starter has no yearly price");

assert(FIRM_BAND_CATALOG.starter.monthlyUsdCents === 0, "archived Starter price is still $0");
assert(!isFirmCheckoutBand("starter"), "Starter is not a new-signup Checkout band");
assert(
  (FIRM_CHECKOUT_BANDS as readonly string[]).includes("solo") &&
    !(FIRM_CHECKOUT_BANDS as readonly string[]).includes("starter"),
  "checkout bands start at Solo",
);
assert(firmSignupCheckoutIntent().plan === "solo", "signup Checkout defaults to Solo");
assert(firmSignupCheckoutIntent().interval === "month", "signup Checkout is monthly");
assert(FIRM_TRIAL_SENTENCE === "14-day free trial · up to 3 clients", "locked trial sentence");
assert(!FIRM_TRIAL_SENTENCE.toLowerCase().includes("3 free"), "never say 3 free clients");
assert(FIRM_BAND_CATALOG.solo.monthlyUsdCents === 9_900, "Solo monthly is $99");
assert(FIRM_BAND_CATALOG.solo.yearlyUsdCents === 95_000, "Solo yearly is $950");
assert(FIRM_BAND_CATALOG.small.clientLimit === 25, "Small is 25 active clients");
assert(FIRM_BAND_CATALOG.scale.clientLimit === 500, "Scale is 500 active clients");
assert(FIRM_BAND_CATALOG.enterprise.customQuote, "Enterprise is quotes only");
assert(FIRM_BAND_CATALOG.enterprise.lookup.month === null, "Enterprise has no public price");

assert(firmUsdListPrice("starter", "month") === "$0", "archived Starter displays $0, not Free");
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
  clientCount: 3,
});
assert(!trialBlock.allowed && trialBlock.code === "trial_client_cap", "trial blocks the 4th client");
assert(
  !trialBlock.allowed && trialBlock.message.includes(FIRM_TRIAL_SENTENCE),
  "trial block uses the locked sentence",
);
assert(
  decideFirmClientCreate({
    stripeConfigured: true,
    phase: "trialing",
    band: "solo",
    clientCount: 2,
  }).allowed,
  "trial allows the 3rd client",
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
    clientCount: 3,
  }).allowed === false,
  "legacy active Starter still caps at 3",
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
