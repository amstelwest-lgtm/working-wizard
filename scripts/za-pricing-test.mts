/**
 * Rand ladder, billing-country integrity, and the price lines Checkout shows.
 * Run: pnpm test:za-pricing
 */
import { FIRM_BAND_CATALOG, FIRM_CHECKOUT_BANDS, bandIdFromLookupKey, intervalFromLookupKey } from "../src/lib/stripe-plans";
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

assert(perClientRands(799, 15) === 53, "Solo is about R53 per client");
assert(perClientRands(1199, 25) === 48, "Small is about R48 per client");
assert(perClientRands(1999, 50) === 40, "Growing is about R40 per client");
assert(perClientRands(2799, 75) === 37, "Established is about R37 per client");
assert(perClientRands(3999, 125) === 32, "Larger is about R32 per client");
assert(perClientRands(5299, 200) === 26, "Advanced is about R26 per client");
assert(perClientRands(7999, 500) === 16, "Scale is about R16 per client");

const copy = loadSaPricingCopy();
assert(copy.heading === "South African pricing, in rand", "heading");
assert(copy.heroNote === "Plans from R799/mo for SA firms after day 14.", "hero");
assert(copy.labels.solo.month === "R799/mo · about R53 per client", "solo monthly line");
assert(!copy.labels.solo.month.toLowerCase().includes("vat"), "price line has no tax wording");
assert(copy.labels.small.month === "R1,199/mo · about R48 per client", "small monthly line");
assert(zaCatalogEntries().length === 14, "seven bands, monthly and annual");
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
  zaCouponId: "MILON_ZA_50",
  integrationIdentifier: "milon-solo-month-abcdefgh",
  includeTrial: true,
});
assert(zar.adaptive_pricing?.enabled === false, "rand checkout does not use adaptive pricing");
assert(zar.automatic_tax?.enabled === false, "rand checkout does not enable automatic tax");
assert(!zar.line_items?.some((item) => "tax_rates" in item && item.tax_rates), "no tax rates");
assert(zar.allow_promotion_codes !== true, "rand checkout hides the promotion box");
assert(!JSON.stringify(zar.discounts ?? []).includes("MILON_ZA_50"), "the old coupon is not attached");
assert(!JSON.stringify(zar.discounts ?? []).includes("promo_founding"), "FOUNDING is not stacked on rand");

const cleared = firmUpgradeDiscounts({
  zaCouponId: "MILON_ZA_50",
  existing: [{ id: "di_za", couponId: "MILON_ZA_50" }],
});
assert(JSON.stringify(cleared) === "[]", "an existing coupon is cleared");
assert(
  firmUpgradeDiscounts({ zaCouponId: "MILON_ZA_50", existing: [] }) == null,
  "nothing to clear stays untouched",
);

console.log("za-pricing-test: ok", expectedAnnual.solo);
