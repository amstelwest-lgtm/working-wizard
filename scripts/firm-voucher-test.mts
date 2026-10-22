/**
 * Firm upgrade vouchers: Stripe promotion codes.
 * Run: pnpm test:firm-voucher
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FirmBandUpgrade } from "../src/components/firm-band-upgrade";
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
  readCheckoutUpgradeDiscounts,
  firmVoucherPricePreview,
  voucherDiscountedCents,
  FIRM_VOUCHER_INVALID_MESSAGE,
  FIRM_VOUCHER_NOT_APPLIED_MESSAGE,
  isBenignZeroInvoiceError,
} from "../src/lib/firm-voucher";
import { resolveFirmVoucher } from "../src/lib/firm-voucher.server";
import {
  LEGACY_ZA_COUPON_ID,
  LEGACY_ZA_COUPON_ON_UPGRADE,
  readSubscriptionDiscountRefs,
  UnexpandedStripeDiscountError,
} from "../src/lib/stripe-discount";
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
    existing: [{ id: "di_old", couponId: "coupon_old", promotionCodeId: null }],
  })?.length === 1 &&
    JSON.stringify(
      firmUpgradeDiscounts({
        promotionCodeId: "promo_free",
        existing: [{ id: "di_old", couponId: "coupon_old", promotionCodeId: null }],
      }),
    ) === JSON.stringify([{ promotion_code: "promo_free" }]),
  "a voucher replaces every other discount",
);
assert(
  firmUpgradeDiscounts({ promotionCodeId: null, existing: [] }) == null,
  "without a voucher, discounts are left alone",
);
assert(
  firmUpgradeDiscounts({
    promotionCodeId: null,
    existing: [{ id: "di_old", couponId: "coupon_old" }],
  }) == null,
  "without a voucher, a non-legacy discount is not rewritten",
);

const legacyOnly = [{ id: "di_za", couponId: LEGACY_ZA_COUPON_ID, promotionCodeId: null }];
const legacyPlusOther = [
  ...legacyOnly,
  { id: "di_other", couponId: "coupon_other", promotionCodeId: null },
];
assert(LEGACY_ZA_COUPON_ON_UPGRADE === "clear", "the upgrade switch defaults to clear");
assert(
  JSON.stringify(
    firmUpgradeDiscounts({ promotionCodeId: null, existing: legacyOnly, legacyZaCoupon: "clear" }),
  ) === "[]",
  "checkout path clear drops a lone legacy coupon",
);
assert(
  JSON.stringify(
    firmUpgradeDiscounts({
      promotionCodeId: null,
      existing: legacyPlusOther,
      legacyZaCoupon: "clear",
    }),
  ) === JSON.stringify([{ discount: "di_other" }]),
  "checkout path clear keeps a non-legacy discount",
);
assert(
  firmUpgradeDiscounts({ promotionCodeId: null, existing: legacyOnly, legacyZaCoupon: "keep" }) ==
    null,
  "checkout path keep leaves the legacy coupon",
);
assert(
  JSON.stringify(
    firmUpgradeDiscounts({ promotionCodeId: null, existing: legacyOnly, legacyZaCoupon: "clear" }),
  ) === "[]",
  "billing sync path clear drops a lone legacy coupon",
);
assert(
  firmUpgradeDiscounts({ promotionCodeId: null, existing: legacyOnly, legacyZaCoupon: "keep" }) ==
    null,
  "billing sync path keep leaves the legacy coupon",
);
assert(
  JSON.stringify(firmUpgradeDiscounts({ promotionCodeId: null, existing: legacyOnly })) === "[]",
  "the default switch clears the legacy coupon",
);

const dahliaLegacySub = {
  discounts: [
    {
      id: "di_za",
      object: "discount",
      source: { type: "coupon", coupon: "MILON_ZA_50" },
    },
  ],
};
const dahliaLegacyRefs = readSubscriptionDiscountRefs(dahliaLegacySub);
assert(
  dahliaLegacyRefs.length === 1 && dahliaLegacyRefs[0]?.couponId === LEGACY_ZA_COUPON_ID,
  "a Dahlia discount coupon is read from source.coupon",
);
assert(
  JSON.stringify(
    firmUpgradeDiscounts({
      promotionCodeId: null,
      existing: dahliaLegacyRefs,
      legacyZaCoupon: "clear",
    }),
  ) === "[]",
  "checkout path clear drops a Dahlia MILON_ZA_50",
);
assert(
  firmUpgradeDiscounts({
    promotionCodeId: null,
    existing: dahliaLegacyRefs,
    legacyZaCoupon: "keep",
  }) == null,
  "checkout path keep preserves a Dahlia MILON_ZA_50",
);
assert(
  JSON.stringify(
    firmUpgradeDiscounts({
      promotionCodeId: null,
      existing: dahliaLegacyRefs,
      legacyZaCoupon: "clear",
    }),
  ) === "[]",
  "billing sync path clear drops a Dahlia MILON_ZA_50",
);
assert(
  firmUpgradeDiscounts({
    promotionCodeId: null,
    existing: dahliaLegacyRefs,
    legacyZaCoupon: "keep",
  }) == null,
  "billing sync path keep preserves a Dahlia MILON_ZA_50",
);

const legacyCouponObject = readSubscriptionDiscountRefs({
  discounts: [{ id: "di_old_shape", coupon: { id: LEGACY_ZA_COUPON_ID } }],
});
assert(
  legacyCouponObject[0]?.couponId === LEGACY_ZA_COUPON_ID &&
    JSON.stringify(
      firmUpgradeDiscounts({
        promotionCodeId: null,
        existing: legacyCouponObject,
        legacyZaCoupon: "clear",
      }),
    ) === "[]",
  "an older discount.coupon object still clears",
);

const dahliaVoucherRefs = readSubscriptionDiscountRefs({
  discounts: [
    {
      id: "di_voucher",
      object: "discount",
      promotion_code: "promo_free",
      source: { type: "coupon", coupon: "coupon_free" },
    },
  ],
});
assert(
  dahliaVoucherRefs[0]?.couponId === "coupon_free" &&
    dahliaVoucherRefs[0]?.promotionCodeId === "promo_free" &&
    firmUpgradeDiscounts({ promotionCodeId: "promo_free", existing: dahliaVoucherRefs }) == null,
  "a Dahlia voucher already on the subscription is left alone",
);
const fallbackCouponRefs = readSubscriptionDiscountRefs({
  discounts: [
    {
      id: "di_voucher",
      object: "discount",
      promotion_code: { id: "promo_free" },
      source: { type: "coupon", coupon: null },
      coupon: { id: "coupon_free" },
    },
  ],
});
assert(
  fallbackCouponRefs[0]?.couponId === "coupon_free" &&
    fallbackCouponRefs[0]?.promotionCodeId === "promo_free" &&
    firmUpgradeDiscounts({ promotionCodeId: "promo_free", existing: fallbackCouponRefs }) == null,
  "a null source.coupon falls back to discount.coupon and the voucher stays applied",
);

let bareIdThrew = false;
try {
  readSubscriptionDiscountRefs({ discounts: ["di_za"] });
} catch (err) {
  bareIdThrew = err instanceof UnexpandedStripeDiscountError;
}
assert(bareIdThrew, "an unexpanded discount id is not treated as no discount");
assert(
  readSubscriptionDiscountRefs({ discounts: [] }).length === 0 &&
    readSubscriptionDiscountRefs({}).length === 0,
  "a subscription with no discounts stays empty",
);

const checkoutUpgrade = readFileSync(resolve("src/lib/stripe-checkout.functions.ts"), "utf8");
const syncUpgrade = readFileSync(resolve("src/lib/stripe-billing-sync.server.ts"), "utf8");
const capList = readFileSync(resolve("src/lib/firm-client-cap.server.ts"), "utf8");
assert(
  checkoutUpgrade.includes("LEGACY_ZA_COUPON_ON_UPGRADE") &&
    checkoutUpgrade.includes("clearLegacyZaCoupon") &&
    checkoutUpgrade.includes("readCheckoutUpgradeDiscounts") &&
    checkoutUpgrade.includes('expand: ["items.data.price", "discounts"]') &&
    !checkoutUpgrade.includes("readSubscriptionDiscountRefs"),
  "checkout re-reads expanded discounts and does not throw on a bare id",
);

const bareFirmId = "11111111-1111-4111-8111-111111111111";
const bareExpands: string[][] = [];
const bareWarnings: string[] = [];
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => {
  bareWarnings.push(args.map((part) => String(part)).join(" "));
};
let bareCheckoutThrew = false;
let bareCheckoutDecision: unknown = "unset";
try {
  bareCheckoutDecision = await readCheckoutUpgradeDiscounts({
    firmId: bareFirmId,
    subscriptionId: "sub_bare",
    fresh: { discounts: ["di_za"], customer: "cus_secret", email: "owner@example.com" },
    promotionCodeId: "promo_free",
    legacyZaCoupon: "clear",
    retrieve: async (_id, params) => {
      bareExpands.push(params.expand);
      return { discounts: ["di_za"] };
    },
  });
} catch {
  bareCheckoutThrew = true;
} finally {
  console.warn = originalWarn;
}
assert(!bareCheckoutThrew, "a bare discount id on checkout does not throw");
assert(bareCheckoutDecision == null, "a still-bare checkout keeps existing discounts");
assert(
  bareExpands.length === 1 && bareExpands[0]?.length === 1 && bareExpands[0]?.[0] === "discounts",
  "checkout re-retrieves a bare discount id with expand discounts",
);
assert(
  bareWarnings.length === 1 &&
    bareWarnings[0] === `[stripe] unexpanded discounts kept firm=${bareFirmId}`,
  "a still-bare checkout warns with the firm id only",
);

const recoveredExpands: string[][] = [];
const recoveredWarnings: string[] = [];
console.warn = (...args: unknown[]) => {
  recoveredWarnings.push(args.map((part) => String(part)).join(" "));
};
let recovered: unknown;
try {
  recovered = await readCheckoutUpgradeDiscounts({
    firmId: bareFirmId,
    subscriptionId: "sub_recover",
    fresh: { discounts: ["di_za"] },
    promotionCodeId: null,
    legacyZaCoupon: "clear",
    retrieve: async (_id, params) => {
      recoveredExpands.push(params.expand);
      return {
        discounts: [
          {
            id: "di_za",
            object: "discount",
            source: { type: "coupon", coupon: "MILON_ZA_50" },
          },
        ],
      };
    },
  });
} finally {
  console.warn = originalWarn;
}
assert(
  recoveredExpands.length === 1 && JSON.stringify(recovered) === "[]" && recoveredWarnings.length === 0,
  "checkout clear drops MILON_ZA_50 once the re-retrieve expands it",
);
assert(
  syncUpgrade.includes("legacyZaCoupon: LEGACY_ZA_COUPON_ON_UPGRADE") &&
    syncUpgrade.includes('expand: ["items.data.price.product", "customer", "discounts"]') &&
    syncUpgrade.includes('expand: ["items.data.price", "discounts"]'),
  "billing sync expands discounts on the main and fallback subscription fetches",
);
assert(
  capList.includes('expand: ["data.items.data.price", "data.discounts"]') &&
    capList.includes('expand: ["data.discounts"]'),
  "the firm plan list expands discounts before they are read",
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

function upgradedSub(invoice: unknown, lookupKey = "milon_solo_monthly") {
  const local = lookupKey.includes("_za_");
  return {
    id: "sub_starter",
    status: "active",
    metadata: { milon_plan: "solo", milon_lookup_key: lookupKey },
    latest_invoice: invoice,
    items: {
      data: [
        {
          id: "si_1",
          price: {
            id: local ? "price_za" : "price_solo",
            lookup_key: lookupKey,
            unit_amount: local ? 79900 : 9900,
            currency: local ? "zar" : "usd",
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
        list: async (params?: { lookup_keys?: string[] }) => {
          const key = params?.lookup_keys?.[0] ?? "milon_solo_monthly";
          const local = key.includes("_za_");
          return {
            data: [
              {
                id: local ? "price_za" : "price_solo",
                lookup_key: key,
                unit_amount: local ? 79900 : 9900,
                currency: local ? "zar" : "usd",
                recurring: { interval: "month" },
                product: "prod_solo",
              },
            ],
          };
        },
      },
      promotionCodes: {
        list: async () => ({ data: input.promos }),
      },
      invoices: {
        list: async () => ({ data: input.invoices ?? [] }),
      },
    },
  };
}

const saVoucher = stripeFor({
  promos: [promo()],
  onUpdate: (params) => upgradedSub(zeroInvoice, String(params.metadata?.milon_lookup_key ?? "milon_solo_monthly")),
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
  !JSON.stringify(saVoucher.calls[0]?.discounts ?? []).includes("coupon"),
  "the voucher update does not stack a coupon",
);
assert(
  saApplied &&
    isBenignZeroInvoiceError(new Error("Invoice amount is 0 and no payment is required")),
  "zero invoice errors are recognized",
);

const saPlain = stripeFor({
  promos: [],
  onUpdate: (params) =>
    upgradedSub(
      { id: "in_1", amount_due: 79900, total: 79900, status: "paid", paid: true },
      String(params.metadata?.milon_lookup_key ?? "milon_za_solo_monthly"),
    ),
});
const saKept = await completeFirmSetupUpgrade(session(), saPlain.stripe as never, {
  firmMarket: { country: "ZA" },
});
assert(saKept?.notice == null, "an SA upgrade without a voucher has no voucher notice");
assert(saPlain.calls[0]?.discounts == null, "an SA upgrade does not attach the old coupon");

const dahliaExpands: string[][] = [];
const dahliaSync = stripeFor({
  promos: [],
  beforeUpdateSub: () => ({
    ...starterSub(),
    discounts: [
      {
        id: "di_za",
        object: "discount",
        source: { type: "coupon", coupon: "MILON_ZA_50" },
      },
    ],
  }),
  onUpdate: (params) =>
    upgradedSub(
      { id: "in_dahlia", amount_due: 79900, total: 79900, status: "paid", paid: true },
      String(params.metadata?.milon_lookup_key ?? "milon_za_solo_monthly"),
    ),
});
const dahliaRetrieve = dahliaSync.stripe.subscriptions.retrieve;
dahliaSync.stripe.subscriptions.retrieve = async (id: string, params?: { expand?: string[] }) => {
  dahliaExpands.push(params?.expand ?? []);
  return dahliaRetrieve(id, params);
};
const dahliaCleared = await completeFirmSetupUpgrade(session(), dahliaSync.stripe as never, {
  firmMarket: { country: "ZA" },
});
assert(dahliaCleared?.updated === true, "billing sync still upgrades when a Dahlia coupon is present");
assert(
  JSON.stringify(dahliaSync.calls[0]?.discounts) === "[]",
  "billing sync clear sends [] for a Dahlia MILON_ZA_50",
);
assert(
  dahliaExpands.some((expand) => expand.includes("discounts")),
  "billing sync retrieve expands discounts",
);

let bareSyncThrew = false;
try {
  const bareSync = stripeFor({
    promos: [],
    beforeUpdateSub: () => ({ ...starterSub(), discounts: ["di_za"] }),
    onUpdate: () =>
      upgradedSub({ id: "in_bare", amount_due: 9900, total: 9900, status: "paid", paid: true }),
  });
  await completeFirmSetupUpgrade(session(), bareSync.stripe as never, {
    firmMarket: { country: "US" },
  });
} catch (err) {
  bareSyncThrew = err instanceof UnexpandedStripeDiscountError;
}
assert(bareSyncThrew, "billing sync does not treat an unexpanded discount id as no discount");

const dahliaVoucherSync = stripeFor({
  promos: [promo()],
  beforeUpdateSub: () => ({
    ...starterSub(),
    discounts: [
      {
        id: "di_voucher",
        object: "discount",
        promotion_code: "promo_free",
        source: { type: "coupon", coupon: "coupon_100" },
      },
    ],
  }),
  onUpdate: (params) =>
    upgradedSub(
      zeroInvoice,
      String(params.metadata?.milon_lookup_key ?? "milon_solo_monthly"),
    ),
});
const voucherKept = await completeFirmSetupUpgrade(
  session({ milon_promotion_code_id: "promo_free", milon_promotion_code: "FREEMONTH" }),
  dahliaVoucherSync.stripe as never,
  { firmMarket: { country: "US" } },
);
assert(voucherKept?.updated === true, "an already-applied Dahlia voucher still changes the price");
assert(
  dahliaVoucherSync.calls[0]?.discounts == null,
  "billing sync leaves a Dahlia voucher that is already the only discount",
);
assert(
  saPlain.calls[0]?.metadata?.milon_lookup_key === "milon_za_solo_monthly",
  "an SA upgrade bills the rand lookup key",
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
assert(usPlain.calls[0]?.discounts == null, "a US firm is not given a coupon");
assert(
  !JSON.stringify(usPlain.calls[0]).includes("coupon"),
  "the US update payload has no coupon",
);

const wrong = stripeFor({
  promos: [promo({ customer: "cus_other" })],
  onUpdate: (params) =>
    upgradedSub(
      { id: "in_sa", amount_due: 79900, status: "paid", paid: true },
      String(params.metadata?.milon_lookup_key ?? "milon_za_solo_monthly"),
    ),
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
assert(wrong.calls[0]?.discounts == null, "a rejected voucher does not fall back to the old coupon");
assert(
  firmUpgradeResultMessage(upgradeSuccessMessage("solo"), wrongResult?.notice).includes(
    FIRM_VOUCHER_NOT_APPLIED_MESSAGE,
  ),
  "the return message includes the voucher notice",
);

const inactiveUpgrade = stripeFor({
  promos: [],
  onUpdate: (params) =>
    upgradedSub(
      { id: "in_sa", amount_due: 79900, status: "paid", paid: true },
      String(params.metadata?.milon_lookup_key ?? "milon_za_solo_monthly"),
    ),
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
    onUpgrade: () => undefined,
    onValidateVoucher: async () => ({ ok: false, message: FIRM_VOUCHER_INVALID_MESSAGE }),
  }),
);
assert(picker.includes("Have a voucher code?"), "the band picker offers a voucher");
assert(picker.includes("<details"), "the voucher field is a disclosure");
assert(!picker.includes("<details open"), "the voucher field is collapsed");
assert(!picker.includes("50% off"), "a US picker does not show a percent-off note");
assert(!picker.includes("$49.50"), "a US picker does not show the halved price");
assert(!picker.includes("50% off"), "a US picker has no discount text");

const saPicker = renderToStaticMarkup(
  createElement(FirmBandUpgrade, {
    currentBand: "starter",
    interval: "month",
    priceCurrency: "USD",
    canUpgrade: true,
    clientCount: 1,
    zaLabels: {
      solo: { month: "R799/mo · about R53 per client", year: "R7,667/yr · about R53 per client" },
    },
    onUpgrade: () => undefined,
    onValidateVoucher: async () => ({ ok: false, message: FIRM_VOUCHER_INVALID_MESSAGE }),
  }),
);
assert(saPicker.includes("R799/mo · about R53 per client"), "an SA picker shows the rand price");
assert(!saPicker.includes("50% off"), "an SA picker does not show a percent-off note");
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
