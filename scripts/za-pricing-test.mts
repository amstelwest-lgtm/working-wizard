/**
 * Rand ladder, billing-country integrity, and the price lines Checkout shows.
 * Run: pnpm test:za-pricing
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { FIRM_BAND_CATALOG, FIRM_CHECKOUT_BANDS, FIRM_TRIAL_CARD_NOTE, FIRM_TRIAL_SENTENCE, bandIdFromLookupKey, intervalFromLookupKey } from "../src/lib/stripe-plans";
import {
  annualZarCents,
  perClientRands,
  ZA_MONTHLY_RANDS,
  zaLookupKey,
} from "../src/lib/pricing/za-ladder";
import { zaBandAmountCents, zaCatalogEntries } from "../src/lib/pricing/za-ladder-amounts";
import { priceMarketForFirm, zarBillingCountryOk } from "../src/lib/pricing/za-checkout";
import { loadSaPricingCopy } from "../src/lib/pricing/za-pricing-chunk.server";
import { firmCheckoutSessionParams } from "../src/lib/stripe-checkout.core";
import { firmUpgradeDiscounts } from "../src/lib/firm-voucher";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const expectedAnnual: Record<string, number> = {};
for (const band of FIRM_CHECKOUT_BANDS) {
  const entry = FIRM_BAND_CATALOG[band];
  const annual = zaBandAmountCents(band, "year");
  expectedAnnual[band] = annual;
  assert(annual % 100 === 0, `${band} annual is whole rands`);
  assert(
    annual ===
      annualZarCents(ZA_MONTHLY_RANDS[band] * 100, entry.yearlyUsdCents ?? 0, entry.monthlyUsdCents ?? 0),
    `${band} annual uses the USD ratio`,
  );
  assert(bandIdFromLookupKey(zaLookupKey(band, "month")) === band, `${band} monthly key maps`);
  assert(intervalFromLookupKey(zaLookupKey(band, "year")) === "year", `${band} annual key maps`);
  assert(bandIdFromLookupKey(`milon_${band}_monthly`) === band, `USD ${band} key still maps`);
}

assert(perClientRands(299, 5) === 60, "Starter is about R60 per client");
assert(perClientRands(799, 15) === 53, "Solo is about R53 per client");
assert(perClientRands(1199, 25) === 48, "Small is about R48 per client");
assert(perClientRands(1999, 50) === 40, "Growing is about R40 per client");
assert(perClientRands(2799, 75) === 37, "Established is about R37 per client");
assert(perClientRands(3999, 125) === 32, "Larger is about R32 per client");
assert(perClientRands(5299, 200) === 26, "Advanced is about R26 per client");
assert(perClientRands(7999, 500) === 16, "Scale is about R16 per client");

const copy = loadSaPricingCopy();
assert(copy.heading === "Pricing in rand", "heading");
assert(
  copy.heroNote === `${FIRM_TRIAL_SENTENCE} on Starter. ${FIRM_TRIAL_CARD_NOTE} Then R 299/mo.`,
  "hero",
);
assert(
  copy.trialAfter === `On Starter. ${FIRM_TRIAL_CARD_NOTE} Then R 299/mo.`,
  "pricing bar rand line",
);
assert(copy.labels.starter.month === "R 299/mo · about R 60 per client", "starter monthly line");
assert(copy.labels.starter.year === "R 2 837/yr · about R 60 per client", "starter annual matches Stripe");
assert(zaBandAmountCents("starter", "year") === 283_700, "starter annual rand is R2,837");
assert(copy.ownerMonthly === "R 299/mo", "owner monthly is R299");
assert(copy.ownerHomepageCost.includes("R 299/mo"), "owner homepage sentence is R299");

const retiredOwnerRand = "R" + "199";
function walkText(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walkText(path, out);
    else if (/\.(ts|tsx|mjs|mts|md|js|jsx)$/.test(name)) out.push(path);
  }
  return out;
}
const retiredHits = ["src", "docs", "scripts"]
  .flatMap((dir) => walkText(resolve(dir)))
  .filter((path) => readFileSync(path, "utf8").includes(retiredOwnerRand));
assert(retiredHits.length === 0, `retired owner rand remains in ${retiredHits.join(", ")}`);
assert(copy.labels.solo.month === "R 799/mo · about R 53 per client", "solo monthly line");
assert(!copy.labels.solo.month.toLowerCase().includes("vat"), "price line has no tax wording");
assert(copy.labels.small.month === "R 1 199/mo · about R 48 per client", "small monthly line");
assert(zaCatalogEntries().length === 16, "eight bands, monthly and annual");
assert(
  zaCatalogEntries().every((row) => row.currency === "zar" && !("tax_rates" in row)),
  "catalog entries are zar and carry no tax rate",
);

assert(priceMarketForFirm({ firmMarket: "us", billingCountry: "ZA" }) === "us", "US firm stays USD");
assert(priceMarketForFirm({ firmMarket: "za", billingCountry: null }) === "za", "unknown country starts on rand");
assert(priceMarketForFirm({ firmMarket: "za", billingCountry: "ZA" }) === "za", "ZA billing stays on rand");
assert(priceMarketForFirm({ firmMarket: "za", billingCountry: "US" }) === "us", "non-ZA billing falls back");
assert(zarBillingCountryOk("ZA"), "ZA country keeps the rand price");
assert(!zarBillingCountryOk(""), "a missing country does not keep the rand price");
assert(!zarBillingCountryOk("US"), "US billing does not keep the rand price");

const zar = firmCheckoutSessionParams({
  priceId: "price_za_solo",
  lookupKey: "milon_za_solo_monthly",
  band: "solo",
  interval: "month",
  origin: "https://www.milonfinance.com",
  userId: "user_1",
  email: "firm@example.com",
  market: "za",
  integrationIdentifier: "milon-solo-month-abcdefgh",
  includeTrial: true,
});
assert(zar.adaptive_pricing?.enabled === false, "rand checkout does not use adaptive pricing");
assert(zar.automatic_tax?.enabled === false, "rand checkout does not enable automatic tax");
assert(!zar.line_items?.some((item) => "tax_rates" in item && item.tax_rates), "no tax rates");
assert(zar.allow_promotion_codes !== true, "rand checkout hides the promotion box");
assert(!JSON.stringify(zar.discounts ?? []).includes("coupon"), "a coupon is not attached");
assert(!JSON.stringify(zar.discounts ?? []).includes("promo_founding"), "FOUNDING is not stacked on rand");
assert(
  firmUpgradeDiscounts({ promotionCodeId: null, existing: [{ id: "di_old", couponId: "coupon_old" }] }) == null,
  "without a voucher, discounts are left alone",
);

console.log("za-pricing-test: ok", expectedAnnual.solo);
