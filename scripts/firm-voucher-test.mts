/**
 * Firm upgrade vouchers: Stripe promotion codes replace the SA 50% coupon.
 * Run: pnpm test:firm-voucher
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FirmBandUpgrade } from "../src/components/firm-band-upgrade";
import { SA_FIRM_DISCOUNT_NOTE } from "../src/lib/firm-sa-market";
import { FOUNDING_PROMOTION_CODE_ID, FOUNDING_SA_ONLY_MESSAGE } from "../src/lib/stripe-plans";
import {
  firmSetupCheckoutMessage,
  firmSetupCheckoutSessionParams,
  readFirmSetupUpgrade,
} from "../src/lib/stripe-checkout.core";
import { checkoutSessionUnlocksFirm } from "../src/lib/stripe-entitlement";
import { completeFirmSetupUpgrade } from "../src/lib/stripe-billing-sync.server";
import {
  assessFirmVoucher,
  firmUpgradeDiscounts,
  firmUpgradeResultMessage,
  firmVoucherPricePreview,
  voucherDiscountedCents,
  FIRM_VOUCHER_INVALID_MESSAGE,
  FIRM_VOUCHER_NOT_APPLIED_MESSAGE,
  isBenignZeroInvoiceError,
} from "../src/lib/firm-voucher";
import { resolveFirmVoucher } from "../src/lib/firm-voucher.server";
import { upgradeSuccessMessage } from "../src/lib/firm-band-upgrade";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const NOW = 1_700_000_000;

function coupon(overrides: Record<string, unknown> = {}) {
  return {
    id: "coupon_100",
    valid: true,
    percent_off: 100,
    amount_off: null,
    currency: null,
    duration: "once",
    duration_in_months: null,
    applies_to: { products: ["prod_solo"] },
    ...overrides,
  };
}

function promo(overrides: Record<string, unknown> = {}) {
  return {
    id: "promo_free",
    code: "FREEMONTH",
    active: true,
    customer: null,
    expires_at: null,
    times_redeemed: 0,
    max_redemptions: null,
    restrictions: {
      first_time_transaction: false,
      minimum_amount: null,
      minimum_amount_currency: null,
    },
    promotion: { type: "coupon", coupon: coupon() },
    ...overrides,
  };
}

const baseCheck = {
  firmCustomerId: "cus_firm",
  productId: "prod_solo",
  hasPriorTransaction: false,
  listCents: 9_900,
  nowSeconds: NOW,
};

function foundingPromo(overrides: Record<string, unknown> = {}) {
  return promo({
    id: FOUNDING_PROMOTION_CODE_ID,
    code: "FOUNDING",
    customer: null,
    max_redemptions: 100,
    times_redeemed: 0,
    promotion: {
      type: "coupon",
      coupon: coupon({
        id: "FOUNDING50",
        percent_off: 50,
        duration: "forever",
        applies_to: null,
      }),
    },
    ...overrides,
  });
}

const usFounding = assessFirmVoucher({
  promotionCode: foundingPromo(),
  ...baseCheck,
  saMarket: false,
});
assert(
  !usFounding.ok &&
    usFounding.reason === "sa_only" &&
    usFounding.message === FOUNDING_SA_ONLY_MESSAGE,
  "a US firm cannot use FOUNDING",
);

const usFoundingAlias = assessFirmVoucher({
  promotionCode: foundingPromo({
    id: "promo_alias",
    code: "WELCOME50",
  }),
  ...baseCheck,
  saMarket: false,
});
assert(
  !usFoundingAlias.ok && usFoundingAlias.reason === "sa_only",
  "a US firm cannot use another code on coupon FOUNDING50",
);

const zaFounding = assessFirmVoucher({
  promotionCode: foundingPromo(),
  ...baseCheck,
  saMarket: true,
});
assert(
  zaFounding.ok && zaFounding.promotionCodeId === FOUNDING_PROMOTION_CODE_ID,
  "a ZA firm can use FOUNDING",
);
assert(
  zaFounding.ok && zaFounding.preview === "$49.50/mo",
  "FOUNDING 50% off Solo monthly previews $49.50/mo",
);

const usOther = assessFirmVoucher({
  promotionCode: promo(),
  ...baseCheck,
  saMarket: false,
});
assert(usOther.ok && usOther.promotionCodeId === "promo_free", "a US firm can still use another code");

const valid = assessFirmVoucher({ promotionCode: promo(), ...baseCheck });
assert(valid.ok, "a matching active code is valid");
assert(valid.ok && valid.promotionCodeId === "promo_free", "the promotion code id is returned");
assert(
  firmVoucherPricePreview({
    listCents: 9_900,
    interval: "month",
    coupon: valid.ok
      ? valid.coupon
      : {
          percentOff: 100,
          amountOff: null,
          currency: null,
          duration: "once",
          durationInMonths: null,
        },
  }) === "$0 for your first month, then $99/mo",
  "a 100% once coupon previews the free first month",
);

const wrongCustomer = assessFirmVoucher({
  promotionCode: promo({ customer: "cus_other" }),
  ...baseCheck,
});
assert(
  !wrongCustomer.ok &&
    wrongCustomer.reason === "wrong_customer" &&
    wrongCustomer.message === FIRM_VOUCHER_INVALID_MESSAGE,
  "a code locked to another customer is rejected",
);

const inactive = assessFirmVoucher({
  promotionCode: promo({ active: false }),
  ...baseCheck,
});
assert(!inactive.ok && inactive.reason === "inactive", "an inactive code is rejected");
assert(
  inactive.ok === false && inactive.message === FIRM_VOUCHER_INVALID_MESSAGE,
  "inactive uses the plan message",
);

const expired = assessFirmVoucher({
  promotionCode: promo({ expires_at: NOW - 10 }),
  ...baseCheck,
});
assert(!expired.ok && expired.reason === "expired", "an expired code is rejected");

const wrongProduct = assessFirmVoucher({
  promotionCode: promo({
    promotion: { type: "coupon", coupon: coupon({ applies_to: { products: ["prod_other"] } }) },
  }),
  ...baseCheck,
});
assert(
  !wrongProduct.ok && wrongProduct.reason === "wrong_product",
  "a coupon for another product is rejected",
);

const firstTime = assessFirmVoucher({
  promotionCode: promo({ restrictions: { first_time_transaction: true } }),
  ...baseCheck,
  hasPriorTransaction: true,
});
assert(
  !firstTime.ok && firstTime.reason === "first_time_transaction",
  "a prior payment blocks a first-time code",
);

const firstTimeFresh = assessFirmVoucher({
  promotionCode: promo({ restrictions: { first_time_transaction: true } }),
  ...baseCheck,
  hasPriorTransaction: false,
});
assert(firstTimeFresh.ok, "no prior payment can use a first-time code");

assert(
  firmUpgradeDiscounts({
    promotionCodeId: "promo_free",
    zaCouponId: "MILON_ZA_50",
    existing: [{ id: "di_za", couponId: "MILON_ZA_50", promotionCodeId: null }],
  })?.length === 1 &&
    JSON.stringify(
      firmUpgradeDiscounts({
        promotionCodeId: "promo_free",
        zaCouponId: "MILON_ZA_50",
        existing: [{ id: "di_za", couponId: "MILON_ZA_50", promotionCodeId: null }],
      }),
    ) === JSON.stringify([{ promotion_code: "promo_free" }]),
  "an SA firm with a voucher keeps only the voucher",
);
assert(
  JSON.stringify(
    firmUpgradeDiscounts({ promotionCodeId: null, zaCouponId: "MILON_ZA_50", existing: [] }),
  ) === JSON.stringify([{ coupon: "MILON_ZA_50" }]),
  "an SA firm without a voucher still gets 50% off",
);
assert(
  firmUpgradeDiscounts({ promotionCodeId: null, zaCouponId: null, existing: [] }) == null,
  "a US firm never gets the SA coupon",
);

const listed: Array<Record<string, unknown>> = [];
const resolved = await resolveFirmVoucher(
  {
    promotionCodes: {
      list: async (params) => {
        listed.push(params as Record<string, unknown>);
        return { data: [promo()] };
      },
    },
    invoices: { list: async () => ({ data: [{ amount_paid: 0, total: 0, status: "paid" }] }) },
  },
  {
    code: "FREEMONTH",
    firmCustomerId: "cus_firm",
    productId: "prod_solo",
    listCents: 9_900,
    interval: "month",
    nowSeconds: NOW,
  },
);
assert(
  resolved.ok && resolved.preview === "$0 for your first month, then $99/mo",
  "list resolves the free month preview",
);
assert(
  listed[0]?.code === "FREEMONTH" && listed[0]?.active === true && listed[0]?.limit === 1,
  "lookup lists the code active",
);
assert(
  Array.isArray(listed[0]?.expand) &&
    (listed[0]?.expand as string[]).includes("data.promotion.coupon"),
  "lookup expands the coupon",
);

const prior = await resolveFirmVoucher(
  {
    promotionCodes: {
      list: async () => ({
        data: [promo({ restrictions: { first_time_transaction: true } })],
      }),
    },
    invoices: {
      list: async () => ({ data: [{ amount_paid: 2_500, total: 2_500, status: "paid" }] }),
    },
  },
  {
    code: "FREEMONTH",
    firmCustomerId: "cus_firm",
    productId: "prod_solo",
    listCents: 9_900,
    interval: "month",
    nowSeconds: NOW,
  },
);
assert(
  !prior.ok && prior.reason === "first_time_transaction",
  "a paid invoice violates first-time",
);

const zeroHistory = await resolveFirmVoucher(
  {
    promotionCodes: {
      list: async () => ({
        data: [promo({ restrictions: { first_time_transaction: true } })],
      }),
    },
    invoices: { list: async () => ({ data: [{ amount_paid: 0, total: 0, status: "paid" }] }) },
  },
  {
    code: "FREEMONTH",
    firmCustomerId: "cus_firm",
    productId: "prod_solo",
    listCents: 9_900,
    interval: "month",
    nowSeconds: NOW,
  },
);
assert(zeroHistory.ok, "a $0 Starter invoice is not a prior transaction");

const soloCoupon = {
  id: "r7GdhcFy",
  valid: true,
  percent_off: 98.99,
  amount_off: null,
  currency: null,
  duration: "once",
  duration_in_months: null,
  applies_to: { products: ["prod_VGnVsFM8alfRNY"] },
};
let retrievedCouponId = "";
const benSolo = await resolveFirmVoucher(
  {
    promotionCodes: {
      list: async () => ({
        data: [
          {
            id: "promo_1UNRGyGXDN6PFbnzX8zUFjgr",
            code: "BEN-SOLO-E2E",
            active: true,
            customer: "cus_VIlgPYllDAilft",
            max_redemptions: 1,
            times_redeemed: 0,
            restrictions: { first_time_transaction: false },
            promotion: { type: "coupon", coupon: "r7GdhcFy" },
          },
        ],
      }),
    },
    coupons: {
      retrieve: async (id: string) => {
        retrievedCouponId = id;
        return soloCoupon;
      },
    },
  },
  {
    code: "BEN-SOLO-E2E",
    firmCustomerId: "cus_VIlgPYllDAilft",
    productId: "prod_VGnVsFM8alfRNY",
    listCents: 9_900,
    interval: "month",
    nowSeconds: NOW,
  },
);
assert(retrievedCouponId === "r7GdhcFy", "validation retrieves coupon r7GdhcFy");
assert(
  benSolo.ok && benSolo.preview === "$1 for your first month, then $99/mo",
  "98.99% off Solo $99 previews $1.00 for the first month",
);
assert(
  voucherDiscountedCents(9_900, { percentOff: 98.99 }) === 100,
  "98.99% off 9900 cents is 100 cents",
);

const benWrongCustomer = await resolveFirmVoucher(
  {
    promotionCodes: {
      list: async () => ({
        data: [
          {
            id: "promo_1UNRGyGXDN6PFbnzX8zUFjgr",
            code: "BEN-SOLO-E2E",
            active: true,
            customer: "cus_VIlgPYllDAilft",
            promotion: { type: "coupon", coupon: "r7GdhcFy" },
          },
        ],
      }),
    },
    coupons: { retrieve: async () => soloCoupon },
  },
  {
    code: "BEN-SOLO-E2E",
    firmCustomerId: "cus_other",
    productId: "prod_VGnVsFM8alfRNY",
    listCents: 9_900,
    interval: "month",
    nowSeconds: NOW,
  },
);
assert(!benWrongCustomer.ok && benWrongCustomer.reason === "wrong_customer", "BEN-SOLO-E2E is locked to one customer");

const benWrongProduct = await resolveFirmVoucher(
  {
    promotionCodes: {
      list: async () => ({
        data: [
          {
            id: "promo_1UNRGyGXDN6PFbnzX8zUFjgr",
            code: "BEN-SOLO-E2E",
            active: true,
            customer: "cus_VIlgPYllDAilft",
            promotion: {
              type: "coupon",
              coupon: { id: "r7GdhcFy", valid: true, percent_off: 100, duration: "once" },
            },
          },
        ],
      }),
    },
    coupons: { retrieve: async () => soloCoupon },
  },
  {
    code: "BEN-SOLO-E2E",
    firmCustomerId: "cus_VIlgPYllDAilft",
    productId: "prod_other",
    listCents: 9_900,
    interval: "month",
    nowSeconds: NOW,
  },
);
assert(
  !benWrongProduct.ok && benWrongProduct.reason === "wrong_product",
  "retrieved applies_to rejects a band other than Solo",
);

const foundingCoupon = {
  id: "FOUNDING50",
  valid: true,
  percent_off: 50,
  amount_off: null,
  currency: null,
  duration: "forever",
  duration_in_months: null,
  applies_to: null,
};
const usResolvedFounding = await resolveFirmVoucher(
  {
    promotionCodes: {
      list: async () => ({
        data: [
          {
            id: FOUNDING_PROMOTION_CODE_ID,
            code: "FOUNDING",
            active: true,
            customer: null,
            max_redemptions: 100,
            times_redeemed: 0,
            promotion: { type: "coupon", coupon: "FOUNDING50" },
          },
        ],
      }),
    },
    coupons: { retrieve: async () => foundingCoupon },
  },
  {
    code: "FOUNDING",
    firmCustomerId: "cus_us",
    productId: "prod_solo",
    listCents: 9_900,
    interval: "month",
    saMarket: false,
  },
);
assert(
  !usResolvedFounding.ok &&
    usResolvedFounding.reason === "sa_only" &&
    usResolvedFounding.message === FOUNDING_SA_ONLY_MESSAGE,
  "resolving FOUNDING for a US firm returns the South Africa message",
);
const zaResolvedFounding = await resolveFirmVoucher(
  {
    promotionCodes: {
      list: async () => ({
        data: [
          {
            id: FOUNDING_PROMOTION_CODE_ID,
            code: "FOUNDING",
            active: true,
            customer: null,
            max_redemptions: 100,
            times_redeemed: 0,
            promotion: { type: "coupon", coupon: "FOUNDING50" },
          },
        ],
      }),
    },
    coupons: { retrieve: async () => foundingCoupon },
  },
  {
    code: "FOUNDING",
    firmCustomerId: "cus_za",
    productId: "prod_solo",
    listCents: 9_900,
    interval: "month",
    saMarket: true,
  },
);
assert(
  zaResolvedFounding.ok && zaResolvedFounding.promotionCodeId === FOUNDING_PROMOTION_CODE_ID,
  "resolving FOUNDING for a ZA firm is accepted",
);
const usResolvedOther = await resolveFirmVoucher(
  {
    promotionCodes: { list: async () => ({ data: [promo()] }) },
  },
  {
    code: "FREEMONTH",
    firmCustomerId: "cus_firm",
    productId: "prod_solo",
    listCents: 9_900,
    interval: "month",
    saMarket: false,
    nowSeconds: NOW,
  },
);
assert(usResolvedOther.ok, "resolving another code for a US firm is unchanged");

let legacyRetrieved = "";
const legacyCoupon = await resolveFirmVoucher(
  {
    promotionCodes: {
      list: async () => ({
        data: [
          {
            id: "promo_legacy",
            code: "LEGACY",
            active: true,
            customer: null,
            promotion: { type: "other", coupon: "ignored" },
            coupon: "r7GdhcFy",
          },
        ],
      }),
    },
    coupons: {
      retrieve: async (id: string) => {
        legacyRetrieved = id;
        return soloCoupon;
      },
    },
  },
  {
    code: "LEGACY",
    firmCustomerId: "cus_VIlgPYllDAilft",
    productId: "prod_VGnVsFM8alfRNY",
    listCents: 9_900,
    interval: "month",
    nowSeconds: NOW,
  },
);
assert(legacyRetrieved === "r7GdhcFy", "a top-level coupon id is retrieved when promotion.type is not coupon");
assert(legacyCoupon.ok && legacyCoupon.preview === "$1 for your first month, then $99/mo", "the legacy coupon shape uses the retrieved percent");

const missing = await resolveFirmVoucher(
  { promotionCodes: { list: async () => ({ data: [] }) } },
  {
    code: "GONE",
    firmCustomerId: "cus_firm",
    productId: "prod_solo",
    listCents: 9_900,
    interval: "month",
  },
);
assert(
  !missing.ok && missing.message === FIRM_VOUCHER_INVALID_MESSAGE,
  "an unknown code is not valid for the plan",
);

type UpdateCall = Record<string, unknown>;

function starterSub() {
  return {
    id: "sub_starter",
    status: "active",
    metadata: { milon_plan: "starter" },
    discounts: [],
    items: {
      data: [
        {
          id: "si_1",
          price: {
            id: "price_starter",
            lookup_key: "milon_starter_monthly",
            unit_amount: 0,
            currency: "usd",
            recurring: { interval: "month" },
            product: "prod_starter",
          },
        },
      ],
    },
  };
}

function upgradedSub(invoice: unknown) {
  return {
    id: "sub_starter",
    status: "active",
    metadata: { milon_plan: "solo" },
    latest_invoice: invoice,
    items: {
      data: [
        {
          id: "si_1",
          price: {
            id: "price_solo",
            lookup_key: "milon_solo_monthly",
            unit_amount: 9900,
            currency: "usd",
            recurring: { interval: "month" },
            product: "prod_solo",
          },
        },
      ],
    },
  };
}

const zeroInvoice = {
  id: "in_0",
  amount_due: 0,
  total: 0,
  status: "paid",
  paid: true,
  payment_intent: null,
};

function session(extra: Record<string, string> = {}) {
  return {
    mode: "setup" as const,
    customer: "cus_firm",
    setup_intent: { payment_method: "pm_card" },
    metadata: {
      milon_setup_upgrade: "1",
      milon_subscription_id: "sub_starter",
      milon_lookup_key: "milon_solo_monthly",
      milon_plan: "solo",
      milon_interval: "month",
      milon_user_id: "user_1",
      ...extra,
    },
  };
}

function paidSmallSub() {
  return {
    id: "sub_small",
    status: "active",
    metadata: { milon_plan: "small" },
    discounts: [],
    items: {
      data: [
        {
          id: "si_small",
          price: {
            id: "price_small_current",
            lookup_key: "milon_small_monthly",
            unit_amount: 14900,
            currency: "usd",
            recurring: { interval: "month" },
            product: "prod_small",
          },
        },
      ],
    },
  };
}

function stripeFor(input: {
  promos: unknown[];
  invoices?: Array<{ amount_paid?: number; total?: number; status?: string }>;
  onUpdate: (params: UpdateCall) => unknown | Promise<unknown>;
  beforeUpdateSub?: () => unknown;
  afterUpdateSub?: () => unknown;
  productId?: string;
  couponRetrieve?: (id: string) => Promise<unknown>;
}) {
  let updates = 0;
  const calls: UpdateCall[] = [];
  return {
    calls,
    stripe: {
      customers: { update: async () => ({}) },
      subscriptions: {
        retrieve: async () =>
          updates > 0 && input.afterUpdateSub
            ? input.afterUpdateSub()
            : (input.beforeUpdateSub ?? starterSub)(),
        update: async (_id: string, params: UpdateCall) => {
          updates += 1;
          calls.push(params);
          return input.onUpdate(params);
        },
        cancel: async () => ({}),
      },
      prices: {
        list: async () => ({
          data: [
            {
              id: "price_solo",
              lookup_key: "milon_solo_monthly",
              unit_amount: 9900,
              currency: "usd",
              recurring: { interval: "month" },
              product: input.productId ?? "prod_solo",
            },
          ],
        }),
      },
      promotionCodes: {
        list: async () => ({ data: input.promos }),
      },
      invoices: {
        list: async () => ({ data: input.invoices ?? [] }),
      },
      ...(input.couponRetrieve ? { coupons: { retrieve: input.couponRetrieve } } : {}),
    },
  };
}

const saVoucher = stripeFor({
  promos: [promo()],
  onUpdate: () => upgradedSub(zeroInvoice),
});
const saApplied = await completeFirmSetupUpgrade(
  session({ milon_promotion_code_id: "promo_free", milon_promotion_code: "FREEMONTH" }),
  saVoucher.stripe as never,
  { firmMarket: { country: "ZA" } },
);
assert(
  saApplied?.band === "solo" && saApplied.updated && saApplied.notice == null,
  "SA voucher upgrade lands on Solo",
);
assert(
  JSON.stringify(saVoucher.calls[0]?.discounts) ===
    JSON.stringify([{ promotion_code: "promo_free" }]),
  "the subscription update applies only the promotion code",
);
assert(
  saVoucher.calls[0]?.billing_cycle_anchor === "now" &&
    saVoucher.calls[0]?.proration_behavior === "none" &&
    saVoucher.calls[0]?.payment_behavior === "error_if_incomplete",
  "a Starter voucher upgrade bills the discounted price today",
);
assert(
  !JSON.stringify(saVoucher.calls[0]?.discounts ?? []).includes("MILON_ZA_50"),
  "the SA coupon is not stacked",
);
assert(
  saApplied &&
    isBenignZeroInvoiceError(new Error("Invoice amount is 0 and no payment is required")),
  "zero invoice errors are recognized",
);

const saPlain = stripeFor({
  promos: [],
  onUpdate: () =>
    upgradedSub({ id: "in_1", amount_due: 4950, total: 4950, status: "paid", paid: true }),
});
const saKept = await completeFirmSetupUpgrade(session(), saPlain.stripe as never, {
  firmMarket: { country: "ZA" },
});
assert(saKept?.notice == null, "an SA upgrade without a voucher has no voucher notice");
assert(
  JSON.stringify(saPlain.calls[0]?.discounts) === JSON.stringify([{ coupon: "MILON_ZA_50" }]),
  "SA 50% still applies when no voucher is entered",
);

const usPlain = stripeFor({
  promos: [],
  onUpdate: () =>
    upgradedSub({ id: "in_us", amount_due: 9900, total: 9900, status: "paid", paid: true }),
});
const usResult = await completeFirmSetupUpgrade(session(), usPlain.stripe as never, {
  firmMarket: { country: "US" },
});
assert(usResult?.band === "solo" && usResult.notice == null, "a US firm upgrades without a notice");
assert(usPlain.calls[0]?.discounts == null, "a US firm is not given the SA coupon");
assert(
  !JSON.stringify(usPlain.calls[0]).includes("MILON_ZA_50"),
  "the US update payload has no SA coupon",
);

const usFoundingUpgrade = stripeFor({
  promos: [foundingPromo()],
  onUpdate: () =>
    upgradedSub({ id: "in_us_founding", amount_due: 9900, total: 9900, status: "paid", paid: true }),
});
const usFoundingResult = await completeFirmSetupUpgrade(
  session({
    milon_promotion_code_id: FOUNDING_PROMOTION_CODE_ID,
    milon_promotion_code: "FOUNDING",
  }),
  usFoundingUpgrade.stripe as never,
  { firmMarket: { country: "US" } },
);
assert(
  usFoundingResult?.notice === FOUNDING_SA_ONLY_MESSAGE,
  "a US setup upgrade tells the firm FOUNDING is South Africa only",
);
assert(
  usFoundingUpgrade.calls[0]?.discounts == null,
  "a US setup upgrade does not apply FOUNDING",
);
assert(
  !JSON.stringify(usFoundingUpgrade.calls[0]).includes("MILON_ZA_50"),
  "rejecting FOUNDING does not attach the SA coupon to a US firm",
);

const zaFoundingUpgrade = stripeFor({
  promos: [foundingPromo()],
  onUpdate: () =>
    upgradedSub({ id: "in_za_founding", amount_due: 4950, total: 4950, status: "paid", paid: true }),
});
const zaFoundingResult = await completeFirmSetupUpgrade(
  session({
    milon_promotion_code_id: FOUNDING_PROMOTION_CODE_ID,
    milon_promotion_code: "FOUNDING",
  }),
  zaFoundingUpgrade.stripe as never,
  { firmMarket: { country: "ZA" } },
);
assert(zaFoundingResult?.notice == null, "a ZA setup upgrade accepts FOUNDING");
assert(
  JSON.stringify(zaFoundingUpgrade.calls[0]?.discounts) ===
    JSON.stringify([{ promotion_code: FOUNDING_PROMOTION_CODE_ID }]),
  "a ZA setup upgrade applies the FOUNDING promotion code",
);
assert(
  !JSON.stringify(zaFoundingUpgrade.calls[0]?.discounts ?? []).includes("MILON_ZA_50"),
  "FOUNDING still replaces the SA coupon instead of stacking",
);

const usOtherUpgrade = stripeFor({
  promos: [promo()],
  onUpdate: () => upgradedSub(zeroInvoice),
});
const usOtherResult = await completeFirmSetupUpgrade(
  session({ milon_promotion_code_id: "promo_free", milon_promotion_code: "FREEMONTH" }),
  usOtherUpgrade.stripe as never,
  { firmMarket: { country: "US" } },
);
assert(usOtherResult?.notice == null, "a US firm can still apply another voucher");
assert(
  JSON.stringify(usOtherUpgrade.calls[0]?.discounts) ===
    JSON.stringify([{ promotion_code: "promo_free" }]),
  "another voucher is unaffected by the FOUNDING rule",
);

const BEN_PROMO_ID = "promo_1UNRGyGXDN6PFbnzX8zUFjgr";
const BEN_CUSTOMER = "cus_VIlgPYllDAilft";
const BEN_PRODUCT = "prod_VGnVsFM8alfRNY";
const priorSetup = firmSetupCheckoutSessionParams({
  origin: "https://www.milonfinance.com",
  customerId: BEN_CUSTOMER,
  userId: "user_1",
  subscriptionId: "sub_starter",
  lookupKey: "milon_solo_monthly",
  band: "solo",
  interval: "month",
  price: { unit_amount: 9900, currency: "usd", recurring: { interval: "month" } },
  saMarket: false,
  promotionCodeId: BEN_PROMO_ID,
  promotionCode: "BEN-SOLO-E2E",
  voucherPreview: "$1 for your first month, then $99/mo",
});
const priorMeta = priorSetup.metadata ?? {};
assert(
  JSON.stringify(Object.keys(priorMeta).sort()) ===
    JSON.stringify([
      "milon_interval",
      "milon_lookup_key",
      "milon_plan",
      "milon_promotion_code",
      "milon_promotion_code_id",
      "milon_setup_upgrade",
      "milon_subscription_id",
      "milon_user_id",
    ]),
  "setup Checkout metadata has no new fields, so a session opened before this deploy still parses",
);
assert(
  priorMeta.milon_promotion_code === "BEN-SOLO-E2E" &&
    priorMeta.milon_promotion_code_id === BEN_PROMO_ID &&
    readFirmSetupUpgrade(priorMeta)?.promotionCode === "BEN-SOLO-E2E",
  "the pre-deploy metadata still names the BEN-SOLO-E2E promotion code",
);
const benUpgrade = stripeFor({
  promos: [
    {
      id: BEN_PROMO_ID,
      code: "BEN-SOLO-E2E",
      active: true,
      customer: BEN_CUSTOMER,
      max_redemptions: 1,
      times_redeemed: 0,
      restrictions: { first_time_transaction: false },
      promotion: { type: "coupon", coupon: "r7GdhcFy" },
    },
  ],
  productId: BEN_PRODUCT,
  couponRetrieve: async () => soloCoupon,
  onUpdate: () =>
    upgradedSub({ id: "in_ben", amount_due: 100, total: 100, status: "paid", paid: true }),
});
const openedBefore = {
  mode: "setup" as const,
  customer: BEN_CUSTOMER,
  setup_intent: { payment_method: "pm_card" },
  metadata: { ...priorMeta },
};
const benResult = await completeFirmSetupUpgrade(openedBefore, benUpgrade.stripe as never, {
  firmMarket: { country: "US" },
});
assert(
  benResult?.band === "solo" && benResult.updated && benResult.notice == null,
  "a US firm BEN-SOLO-E2E setup session completes on Save",
);
assert(
  !String(benResult?.notice ?? "").includes("South African"),
  "BEN-SOLO-E2E is not rejected as South Africa only",
);
assert(
  JSON.stringify(benUpgrade.calls[0]?.discounts) ===
    JSON.stringify([{ promotion_code: BEN_PROMO_ID }]),
  "BEN-SOLO-E2E reaches the subscription update as discounts[{promotion_code}]",
);
assert(
  !JSON.stringify(benUpgrade.calls[0]).includes("MILON_ZA_50") &&
    !JSON.stringify(benUpgrade.calls[0]).includes("FOUNDING50"),
  "the US BEN-SOLO-E2E update has no SA coupon and no FOUNDING50",
);

const wrong = stripeFor({
  promos: [promo({ customer: "cus_other" })],
  onUpdate: () => upgradedSub({ id: "in_sa", amount_due: 4950, status: "paid", paid: true }),
});
const wrongResult = await completeFirmSetupUpgrade(
  session({ milon_promotion_code_id: "promo_free", milon_promotion_code: "FREEMONTH" }),
  wrong.stripe as never,
  { firmMarket: { country: "ZA" } },
);
assert(
  wrongResult?.notice === FIRM_VOUCHER_NOT_APPLIED_MESSAGE,
  "a wrong-customer voucher is dropped with a notice",
);
assert(
  JSON.stringify(wrong.calls[0]?.discounts) === JSON.stringify([{ coupon: "MILON_ZA_50" }]),
  "the SA coupon remains when the voucher does not apply",
);
assert(
  firmUpgradeResultMessage(upgradeSuccessMessage("solo"), wrongResult?.notice).includes(
    FIRM_VOUCHER_NOT_APPLIED_MESSAGE,
  ),
  "the return message includes the voucher notice",
);

const inactiveUpgrade = stripeFor({
  promos: [],
  onUpdate: () => upgradedSub({ id: "in_sa", amount_due: 4950, status: "paid", paid: true }),
});
const inactiveResult = await completeFirmSetupUpgrade(
  session({ milon_promotion_code_id: "promo_dead", milon_promotion_code: "DEAD" }),
  inactiveUpgrade.stripe as never,
  { firmMarket: { country: "ZA" } },
);
assert(
  inactiveResult?.notice === FIRM_VOUCHER_NOT_APPLIED_MESSAGE,
  "an inactive code is not applied silently",
);
assert(
  !JSON.stringify(inactiveUpgrade.calls[0]?.discounts ?? []).includes("promo_"),
  "the inactive code is not sent",
);

const zeroThrow = stripeFor({
  promos: [promo()],
  onUpdate: () => {
    throw new Error("No payment is required for an invoice amount of 0");
  },
  afterUpdateSub: () => upgradedSub(zeroInvoice),
});
const zeroResult = await completeFirmSetupUpgrade(
  session({ milon_promotion_code_id: "promo_free", milon_promotion_code: "FREEMONTH" }),
  zeroThrow.stripe as never,
  { firmMarket: { country: "US" } },
);
assert(
  zeroResult?.band === "solo" && zeroResult.notice == null,
  "a $0 invoice still activates the band",
);
assert(
  checkoutSessionUnlocksFirm({ status: "complete", paymentStatus: "no_payment_required" }),
  "setup Checkout with nothing to pay still unlocks the firm",
);

let declined = false;
try {
  const decline = stripeFor({
    promos: [],
    onUpdate: () => {
      throw new Error("Your card was declined.");
    },
  });
  await completeFirmSetupUpgrade(session(), decline.stripe as never, {
    firmMarket: { country: "US" },
  });
} catch (err) {
  declined = err instanceof Error && /declined/i.test(err.message);
}
assert(declined, "a card decline still fails the upgrade");

const paidChange = stripeFor({
  promos: [],
  beforeUpdateSub: paidSmallSub,
  onUpdate: () =>
    upgradedSub({ id: "in_solo", amount_due: 5000, total: 5000, status: "paid", paid: true }),
});
const paidResult = await completeFirmSetupUpgrade(session(), paidChange.stripe as never, {
  firmMarket: { country: "US" },
});
assert(paidResult?.updated === true, "a paid band can still move to another paid band");
assert(
  paidChange.calls[0]?.proration_behavior === "create_prorations" &&
    paidChange.calls[0]?.billing_cycle_anchor == null &&
    paidChange.calls[0]?.payment_behavior === "error_if_incomplete",
  "a paid band keeps prorations and its billing date",
);

const setup = firmSetupCheckoutSessionParams({
  origin: "https://milonfinance.com",
  customerId: "cus_firm",
  userId: "user_1",
  subscriptionId: "sub_starter",
  lookupKey: "milon_solo_monthly",
  band: "solo",
  interval: "month",
  price: { unit_amount: 9_900, currency: "usd", recurring: { interval: "month" } },
  saMarket: false,
  promotionCodeId: "promo_free",
  promotionCode: "FREEMONTH",
  voucherPreview: "$0 for your first month, then $99/mo",
});
assert(
  setup.metadata?.milon_promotion_code_id === "promo_free",
  "setup Checkout carries the promotion code id",
);
assert(
  setup.metadata?.milon_promotion_code === "FREEMONTH",
  "setup Checkout carries the code for re-check",
);
assert(
  setup.custom_text?.submit?.message?.includes("$0 for your first month, then $99/mo"),
  "setup Checkout shows the voucher price",
);
assert(
  !setup.custom_text?.submit?.message?.includes("South Africa") &&
    !setup.custom_text?.submit?.message?.includes("50% off"),
  "a voucher replaces the SA line on Checkout",
);
const readBack = readFirmSetupUpgrade(setup.metadata as Record<string, string>);
assert(
  readBack?.promotionCodeId === "promo_free" && readBack.promotionCode === "FREEMONTH",
  "setup metadata round-trips",
);

const usCopy = firmSetupCheckoutMessage({
  bandName: "Solo",
  clientLimit: 15,
  unitAmount: 9_900,
  currency: "usd",
  interval: "month",
  saMarket: false,
});
assert(
  !usCopy.includes("50% off") && !usCopy.includes("South Africa"),
  "US setup copy has no SA discount",
);

const picker = renderToStaticMarkup(
  createElement(FirmBandUpgrade, {
    currentBand: "starter",
    interval: "month",
    priceCurrency: "USD",
    canUpgrade: true,
    clientCount: 1,
    saDiscount: false,
    onUpgrade: () => undefined,
    onValidateVoucher: async () => ({ ok: false, message: FIRM_VOUCHER_INVALID_MESSAGE }),
  }),
);
assert(picker.includes("Have a voucher code?"), "the band picker offers a voucher");
assert(picker.includes("<details"), "the voucher field is a disclosure");
assert(!picker.includes("<details open"), "the voucher field is collapsed");
assert(!picker.includes(SA_FIRM_DISCOUNT_NOTE), "a US picker does not show the SA note");
assert(!picker.includes("$49.50"), "a US picker does not show the halved price");
assert(!picker.includes("50% off"), "a US picker has no discount text");

const saPicker = renderToStaticMarkup(
  createElement(FirmBandUpgrade, {
    currentBand: "starter",
    interval: "month",
    priceCurrency: "USD",
    canUpgrade: true,
    clientCount: 1,
    saDiscount: true,
    onUpgrade: () => undefined,
    onValidateVoucher: async () => ({ ok: false, message: FIRM_VOUCHER_INVALID_MESSAGE }),
  }),
);
assert(
  saPicker.includes(SA_FIRM_DISCOUNT_NOTE),
  "an SA picker still shows 50% off before a voucher",
);
assert(saPicker.includes("Have a voucher code?"), "an SA picker can enter a voucher");

const lookup = readFileSync(resolve("src/lib/firm-voucher.server.ts"), "utf8");
assert(lookup.includes("promotionCodes.list"), "validation lists promotion codes");
assert(lookup.includes("active: true"), "validation asks for active codes");
assert(lookup.includes("limit: 1"), "validation takes one code");
const fn = readFileSync(resolve("src/lib/stripe-checkout.functions.ts"), "utf8");
assert(fn.includes("validateFirmVoucher"), "the band picker has a voucher check");
assert(fn.includes("firmUpgradeResultMessage"), "checkout return surfaces a dropped voucher");
const sync = readFileSync(resolve("src/lib/stripe-billing-sync.server.ts"), "utf8");
assert(sync.includes("promotion_code"), "completion can apply a promotion code");
assert(sync.includes("isBenignZeroInvoiceError"), "a $0 invoice is not treated as a failed charge");

console.log("firm-voucher ok");
