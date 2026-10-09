/**
 * Pure Checkout / Portal helpers for firm-band billing.
 * Server functions call Stripe; tests call these without a live key.
 */

import type Stripe from "stripe";
import { appRedirectOrigin } from "@/lib/app-origin";
import { firmUpgradeReturnPath } from "@/lib/firm-band-upgrade";
import { isSaMarketFirm } from "@/lib/firm-sa-market";
import { isZaCatalogLookup, priceMarketForFirm } from "@/lib/pricing/za-checkout";
import { zaLookupKey } from "@/lib/pricing/za-ladder";
import {
  FIRM_SETUP_PROMOTION_CODE,
  FIRM_SETUP_PROMOTION_CODE_ID,
  normalizeVoucherCode,
} from "@/lib/firm-voucher";
import {
  assertFoundingMonthlyOnly,
  FIRM_BAND_CATALOG,
  FIRM_TRIAL_DAYS,
  firmLookupKey,
  formatUsdFromCents,
  isFirmCheckoutBand,
  isFoundingCode,
  type FirmCheckoutBand,
  type FirmInterval,
  type StripePlanMarket,
} from "@/lib/stripe-plans";

export type CatalogPrice = {
  id: string;
  lookup_key?: string | null;
  currency?: string | null;
  recurring?: { interval?: string | null } | null;
  unit_amount?: number | null;
  /** Stripe product id, or an expanded product. */
  product?: string | { id?: string | null } | null;
};

export type PriceLister = {
  prices: {
    list: (params: {
      lookup_keys: string[];
      active: boolean;
      limit: number;
    }) => Promise<{ data: CatalogPrice[] }>;
  };
};

export async function resolvePriceByLookupKey(
  stripe: PriceLister,
  lookupKey: string,
): Promise<CatalogPrice> {
  const listed = await stripe.prices.list({
    lookup_keys: [lookupKey],
    active: true,
    limit: 1,
  });
  const price = listed.data[0];
  if (!price?.id) {
    throw new Error(`No active Stripe price for lookup_key ${lookupKey}.`);
  }
  return price;
}

export async function resolveFirmCatalogPrice(
  stripe: PriceLister,
  band: FirmCheckoutBand,
  interval: FirmInterval,
  market: StripePlanMarket = "us",
): Promise<{ price: CatalogPrice; lookupKey: string }> {
  const lookupKey = market === "za" ? zaLookupKey(band, interval) : firmLookupKey(band, interval);
  const price = await resolvePriceByLookupKey(stripe, lookupKey);
  const priceInterval = price.recurring?.interval;
  if (priceInterval && priceInterval !== interval) {
    throw new Error(`Stripe price ${lookupKey} is ${priceInterval}, expected ${interval}.`);
  }
  return { price, lookupKey };
}

export function randomIntegrationSuffix(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  let suffix = "";
  for (let i = 0; i < 8; i += 1) {
    suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return suffix;
}

export function firmIntegrationIdentifier(
  band: FirmCheckoutBand,
  interval: FirmInterval,
  suffix = randomIntegrationSuffix(),
): string {
  return `milon-${band}-${interval}-${suffix}`;
}

export function foundingRejectedOnYearly(interval: FirmInterval, promo?: string | null): boolean {
  try {
    assertFoundingMonthlyOnly(interval, promo);
    return false;
  } catch {
    return true;
  }
}

export type FirmCheckoutSessionInput = {
  priceId: string;
  lookupKey: string;
  band: FirmCheckoutBand;
  interval: FirmInterval;
  origin: string;
  userId: string;
  email?: string;
  customerId?: string;
  market: StripePlanMarket;
  /** Stripe promotion_code id (promo_…), already resolved. */
  promotionCodeId?: string | null;
  /**
   * Ignored. The rand price replaces the old coupon, so Checkout never
   * attaches it. Kept so older callers still type-check.
   */
  zaCouponId?: string | null;
  /** SA firm whose billing country is already known and is not ZA. */
  billingFallback?: boolean;
  integrationIdentifier: string;
  /**
   * First firm subscription only. A customer with any prior subscription
   * (canceled trial included) does not get another 14 days.
   */
  includeTrial: boolean;
};

/** Both markets pin the catalog currency. A rand price must not be toggled. */
export function adaptivePricingForMarket(_market: StripePlanMarket): boolean {
  return false;
}

export function adaptivePricingNote(_market: StripePlanMarket): string | null {
  return null;
}

/**
 * A stored US firm stays USD even if the request says za.
 * No firm row yet: trust an explicit za request, otherwise us.
 */
export function resolveFirmCheckoutMarket(
  firmMarket: unknown,
  requested: StripePlanMarket,
): StripePlanMarket {
  if (firmMarket == null) return requested === "za" ? "za" : "us";
  return isSaMarketFirm({ market: firmMarket }) ? "za" : "us";
}

/**
 * Currency for one Checkout. The firm row wins over the URL market.
 * A US firm stays on the USD lookup even when the billing country is ZA.
 * A ZA firm with a known non-ZA billing country falls back to USD.
 */
export function firmCheckoutCharge(input: {
  firmMarket: unknown;
  requested: StripePlanMarket;
  billingCountry?: string | null;
  band: FirmCheckoutBand;
  interval: FirmInterval;
}): {
  firmMarket: StripePlanMarket;
  priceMarket: StripePlanMarket;
  lookupKey: string;
  billingFallback: boolean;
} {
  const firmMarket = resolveFirmCheckoutMarket(input.firmMarket, input.requested);
  const priceMarket = priceMarketForFirm({
    firmMarket,
    billingCountry: input.billingCountry,
  });
  const lookupKey =
    priceMarket === "za"
      ? zaLookupKey(input.band, input.interval)
      : firmLookupKey(input.band, input.interval);
  return {
    firmMarket,
    priceMarket,
    lookupKey,
    billingFallback: firmMarket === "za" && priceMarket === "us",
  };
}

/**
 * Checkout Session create payload for a firm band.
 * Adaptive Pricing stays off. A rand lookup is the line item for an SA firm.
 * That session does not collect tax and does not open the promotion box.
 * Managed Payments is left at the account default (do not force-disable).
 *
 * Card is always collected. A first subscription starts a 14-day trial on the
 * chosen paid band. FOUNDING applies to monthly USD invoices after that trial,
 * not as a forever-free price, and not on a rand price.
 */
export function firmCheckoutSessionParams(
  input: FirmCheckoutSessionInput,
): Stripe.Checkout.SessionCreateParams {
  const origin = appRedirectOrigin([input.origin]);
  const monthlyPaid = input.interval === "month";
  const localZar = isZaCatalogLookup(input.lookupKey);
  const meta: Record<string, string> = {
    milon_plan: input.band,
    milon_interval: input.interval,
    milon_market: input.market,
    milon_user_id: input.userId,
    milon_lookup_key: input.lookupKey,
  };
  if (input.includeTrial) meta.milon_trial_days = String(FIRM_TRIAL_DAYS);
  if (input.billingFallback) meta.milon_za_billing_fallback = "usd";

  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    adaptive_pricing: { enabled: false },
    billing_address_collection: "required",
    tax_id_collection: { enabled: true },
    payment_method_collection: "always",
    line_items: [{ price: input.priceId, quantity: 1 }],
    success_url: `${origin}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/billing/cancel`,
    client_reference_id: input.userId,
    metadata: meta,
    subscription_data: input.includeTrial
      ? {
          metadata: meta,
          trial_period_days: FIRM_TRIAL_DAYS,
          trial_settings: {
            end_behavior: { missing_payment_method: "cancel" },
          },
        }
      : { metadata: meta },
    integration_identifier: input.integrationIdentifier,
  };

  if (input.customerId) {
    params.customer = input.customerId;
  } else if (input.email) {
    params.customer_email = input.email;
  }

  if (localZar) {
    params.automatic_tax = { enabled: false };
    if (input.promotionCodeId) {
      params.discounts = [{ promotion_code: input.promotionCodeId }];
    }
    return params;
  }

  // Promo box only on monthly USD Checkout so FOUNDING cannot be typed on yearly.
  if (monthlyPaid) {
    params.allow_promotion_codes = true;
  }

  if (input.promotionCodeId) {
    params.discounts = [{ promotion_code: input.promotionCodeId }];
    delete params.allow_promotion_codes;
  }

  return params;
}

/**
 * Attach the SA coupon once. Clears allow_promotion_codes and any promotion
 * code so Checkout cannot stack a second discount. A second call is a no-op.
 */
export function withFirmZaCoupon<T extends Stripe.Checkout.SessionCreateParams>(
  params: T,
  couponId: string | null | undefined,
): T {
  const id = couponId?.trim() ?? "";
  if (!id) return params;
  const current = params.discounts ?? [];
  const already = current.some((entry) => "coupon" in entry && entry.coupon === id);
  params.discounts = already
    ? current.filter((entry) => !("promotion_code" in entry))
    : [...current.filter((entry) => !("promotion_code" in entry)), { coupon: id }];
  delete params.allow_promotion_codes;
  return params;
}

/**
 * Checkout for a firm that already exists but has no card (Starter $0) or no
 * subscription. Does not send them to the Customer Portal. No second trial.
 * Success reopens Add client on the dashboard.
 */
export function firmUpgradeCheckoutSessionParams(
  input: FirmCheckoutSessionInput & { replacesSubscriptionId?: string | null },
): Stripe.Checkout.SessionCreateParams {
  const origin = appRedirectOrigin([input.origin]);
  const params = firmCheckoutSessionParams({ ...input, includeTrial: false });
  params.success_url = `${origin}${firmUpgradeReturnPath("success")}`;
  params.cancel_url = `${origin}${firmUpgradeReturnPath("cancelled")}`;
  const replaced = input.replacesSubscriptionId?.trim();
  if (replaced) {
    params.metadata = { ...(params.metadata ?? {}), milon_replaces_subscription: replaced };
    if (params.subscription_data) {
      params.subscription_data.metadata = {
        ...(params.subscription_data.metadata ?? {}),
        milon_replaces_subscription: replaced,
      };
    }
  }
  return params;
}

export type FirmSetupUpgradeRequest = {
  subscriptionId: string;
  band: FirmCheckoutBand;
  interval: FirmInterval;
  lookupKey: string;
  userId: string;
  promotionCodeId: string | null;
  promotionCode: string | null;
};

/** Stripe custom_text.submit.message max length. */
export const FIRM_SETUP_CHECKOUT_TEXT_MAX = 1200;

function formatSetupAmount(cents: number, currency: string): string {
  if (currency === "zar") {
    const rands = cents / 100;
    const body = Number.isInteger(rands)
      ? rands.toLocaleString("en-US")
      : rands.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `R${body}`;
  }
  return formatUsdFromCents(cents);
}

/**
 * Copy on the card-setup Checkout page, shown once above Save.
 * Amount and interval come from the resolved Stripe price.
 */
export function firmSetupCheckoutMessage(input: {
  bandName: string;
  clientLimit: number;
  unitAmount: number;
  currency: string;
  interval: FirmInterval;
  saMarket: boolean;
  /** Set when a voucher changes the amount shown above Save. */
  voucherPreview?: string | null;
}): string {
  const currency = input.currency.trim().toLowerCase();
  const amount = formatSetupAmount(input.unitAmount, currency);
  const billed = currency === "usd" ? "USD" : "the price currency";
  const preview = input.voucherPreview?.trim() ?? "";
  const priced = preview ? preview : `${amount}/${input.interval}`;
  const message = `Saving this card moves you to MILŌN ${input.bandName} at ${priced} (${input.clientLimit} clients). Billed in ${billed}, cancel anytime.`;
  return message.length <= FIRM_SETUP_CHECKOUT_TEXT_MAX
    ? message
    : message.slice(0, FIRM_SETUP_CHECKOUT_TEXT_MAX);
}

function setupPriceInterval(
  priceInterval: string | null | undefined,
  requested: FirmInterval,
): FirmInterval {
  if (priceInterval === "month" || priceInterval === "year") return priceInterval;
  return requested;
}

/**
 * Collect a card for an existing subscription (a $0 Starter has none), then
 * the server updates that same subscription. This is not a second subscription.
 * The plan line is custom_text.submit only. after_submit repeated it under Save.
 */
export function firmSetupCheckoutSessionParams(input: {
  origin: string;
  customerId: string;
  userId: string;
  subscriptionId: string;
  lookupKey: string;
  band: FirmCheckoutBand;
  interval: FirmInterval;
  price: {
    unit_amount?: number | null;
    currency?: string | null;
    recurring?: { interval?: string | null } | null;
  };
  saMarket: boolean;
  promotionCodeId?: string | null;
  promotionCode?: string | null;
  voucherPreview?: string | null;
}): Stripe.Checkout.SessionCreateParams {
  const origin = appRedirectOrigin([input.origin]);
  const metadata: Record<string, string> = {
    milon_setup_upgrade: "1",
    milon_subscription_id: input.subscriptionId,
    milon_lookup_key: input.lookupKey,
    milon_plan: input.band,
    milon_interval: input.interval,
    milon_user_id: input.userId,
  };
  const promotionCodeId = input.promotionCodeId?.trim() ?? "";
  const promotionCode = normalizeVoucherCode(input.promotionCode);
  if (promotionCodeId.startsWith("promo_") && promotionCode) {
    metadata[FIRM_SETUP_PROMOTION_CODE_ID] = promotionCodeId;
    metadata[FIRM_SETUP_PROMOTION_CODE] = promotionCode;
  }
  const unitAmount = input.price.unit_amount;
  const currency = input.price.currency?.trim().toLowerCase() ?? "";
  const band = FIRM_BAND_CATALOG[input.band];
  if (typeof unitAmount !== "number" || !currency || band.clientLimit == null) {
    throw new Error("Setup Checkout needs the resolved Stripe price amount.");
  }
  const message = firmSetupCheckoutMessage({
    bandName: band.name,
    clientLimit: band.clientLimit,
    unitAmount,
    currency,
    interval: setupPriceInterval(input.price.recurring?.interval, input.interval),
    saMarket: input.saMarket,
    voucherPreview: input.voucherPreview,
  });
  return {
    mode: "setup",
    customer: input.customerId,
    currency: currency === "zar" ? "zar" : "usd",
    client_reference_id: input.userId,
    success_url: `${origin}${firmUpgradeReturnPath("success")}`,
    cancel_url: `${origin}${firmUpgradeReturnPath("cancelled")}`,
    metadata,
    setup_intent_data: { metadata },
    custom_text: {
      submit: { message },
    },
  };
}

export function readFirmSetupUpgrade(
  metadata: Record<string, string> | null | undefined,
): FirmSetupUpgradeRequest | null {
  if (!metadata || metadata.milon_setup_upgrade !== "1") return null;
  const subscriptionId = metadata.milon_subscription_id?.trim() ?? "";
  const band = metadata.milon_plan?.trim() ?? "";
  const interval = metadata.milon_interval?.trim() ?? "";
  const lookupKey = metadata.milon_lookup_key?.trim() ?? "";
  const userId = metadata.milon_user_id?.trim() ?? "";
  if (!subscriptionId || !lookupKey || !userId) return null;
  if (!isFirmCheckoutBand(band)) return null;
  if (interval !== "month" && interval !== "year") return null;
  const promotionCodeId = metadata[FIRM_SETUP_PROMOTION_CODE_ID]?.trim() ?? "";
  const promotionCode = normalizeVoucherCode(metadata[FIRM_SETUP_PROMOTION_CODE]);
  return {
    subscriptionId,
    band,
    interval,
    lookupKey,
    userId,
    promotionCodeId: promotionCodeId.startsWith("promo_") ? promotionCodeId : null,
    promotionCode,
  };
}

export function assertNoManagedPaymentsOverride(params: Stripe.Checkout.SessionCreateParams): void {
  if ("managed_payments" in params && params.managed_payments != null) {
    throw new Error("Firm Checkout must not override managed_payments; leave the account default.");
  }
}

export { isFoundingCode, assertFoundingMonthlyOnly };
