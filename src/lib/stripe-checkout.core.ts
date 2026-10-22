/**
 * Pure Checkout / Portal helpers for firm-band billing.
 * Server functions call Stripe; tests call these without a live key.
 */

import type Stripe from "stripe";
import { appRedirectOrigin } from "@/lib/app-origin";
import { formatMoney } from "@/lib/market/format";
import { ZA_MARKET } from "@/lib/market/resolve";
import { firmUpgradeReturnPath, practiceDisplaysZarPlan } from "@/lib/firm-band-upgrade";
import {
  resolveCheckoutPriceMarket,
  resolveFirmMarket,
  resolveOwnerMarket,
} from "@/lib/pricing/market-resolution";
import { isZaCatalogLookup } from "@/lib/pricing/za-checkout";
import { zaLookupKey } from "@/lib/pricing/za-ladder";
import {
  FIRM_SETUP_PROMOTION_CODE,
  FIRM_SETUP_PROMOTION_CODE_ID,
  normalizeVoucherCode,
} from "@/lib/firm-voucher";
import { isZaOwnerLookup, OWNER_LOOKUP_KEYS, isOwnerLookupKey } from "@/lib/owner-price";
import { eligibleForIntroTrial } from "@/lib/firm-client-cap";
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
  // A $0 price id is an existing subscription, not the live Starter price.
  if (band === "starter" && price.unit_amount === 0) {
    throw new Error(`No active paid Stripe price for lookup_key ${lookupKey}.`);
  }
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
  /** Stamped on the subscription so an email change still finds this firm. */
  firmId?: string | null;
  email?: string;
  customerId?: string;
  market: StripePlanMarket;
  /** Stripe promotion_code id (promo_…), already resolved. */
  promotionCodeId?: string | null;
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
 * Stored firm market only. A missing firm is not ZA. Geo and the URL market
 * are not inputs. The charge currency is resolveCheckoutPriceMarket.
 */
export function resolveFirmCheckoutMarket(
  firmMarket: unknown,
  _requested?: StripePlanMarket,
  _geoCountry?: string | null,
): StripePlanMarket {
  return resolveFirmMarket(firmMarket);
}

/**
 * Currency for one Checkout. Rand follows resolveCheckoutPriceMarket.
 * A ZA firm with an unknown billing country still starts on rand, because
 * Checkout collects the address. A known non-ZA billing country is USD.
 */
export function firmCheckoutCharge(input: {
  firmMarket: unknown;
  clientMarkets?: readonly unknown[] | null;
  /** Ignored. The URL market does not choose the charge. */
  requested?: StripePlanMarket;
  billingCountry?: string | null;
  /** Ignored. Checkout does not read geo. */
  geoCountry?: string | null;
  band: FirmCheckoutBand;
  interval: FirmInterval;
}): {
  firmMarket: StripePlanMarket;
  priceMarket: StripePlanMarket;
  lookupKey: string;
  billingFallback: boolean;
} {
  const firmMarket = resolveFirmCheckoutMarket(input.firmMarket);
  const country = (input.billingCountry ?? "").trim().toUpperCase();
  const knownCountry = country.length > 0;
  const practiceListZar =
    firmMarket !== "za" &&
    practiceDisplaysZarPlan({
      firmMarket: input.firmMarket,
      clientMarkets: input.clientMarkets,
    });
  const priceMarket = resolveCheckoutPriceMarket({
    storedFirmMarket: input.firmMarket,
    billingCountry: input.billingCountry,
    practiceListZar,
  });
  const lookupKey =
    priceMarket === "za"
      ? zaLookupKey(input.band, input.interval)
      : firmLookupKey(input.band, input.interval);
  return {
    firmMarket,
    priceMarket,
    lookupKey,
    billingFallback:
      priceMarket === "us" && knownCountry && country !== "ZA" && (firmMarket === "za" || practiceListZar),
  };
}

export type FirmStartTrialCheckout =
  | { kind: "portal"; customerId: string }
  | { kind: "checkout"; customerId?: string; includeTrial: boolean };

/**
 * Start trial on the billing wall. A customer already found by the stable
 * key is attached to Checkout, so Stripe does not create a second customer.
 * Any prior subscription on that customer skips the intro trial. A live
 * firm subscription, or one that needs a card, opens the portal instead.
 */
export function firmStartTrialCheckout(input: {
  customerId?: string | null;
  priorSubscriptionCount: number;
  hasEntitlingSubscription: boolean;
  needsPaymentOnExisting: boolean;
}): FirmStartTrialCheckout {
  const customerId = input.customerId?.trim() || undefined;
  if (customerId && (input.hasEntitlingSubscription || input.needsPaymentOnExisting)) {
    return { kind: "portal", customerId };
  }
  return {
    kind: "checkout",
    customerId,
    includeTrial: customerId ? eligibleForIntroTrial(input.priorSubscriptionCount) : true,
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
  const firmId = input.firmId?.trim() ?? "";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(firmId)) {
    meta.firm_id = firmId;
  }
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
    return formatMoney(
      rands,
      ZA_MARKET,
      Number.isInteger(rands) ? undefined : { minimumFractionDigits: 2, maximumFractionDigits: 2 },
    );
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

export { isOwnerLookupKey, isZaOwnerLookup, OWNER_LOOKUP_KEYS } from "@/lib/owner-price";

export const OWNER_MONTHLY_USD_CENTS = 3_900;
/** Rand monthly amount in cents. The letters of the currency code stay out of this file. */
export const OWNER_MONTHLY_ZA_CENTS = 29_900;

/** Annual charge is monthly × 12 × 0.8, in cents. */
export function ownerAnnualCents(monthlyCents: number): number {
  return Math.round((monthlyCents * 12 * 4) / 5);
}

export function ownerLookupKey(market: StripePlanMarket, interval: FirmInterval): string {
  const keys = market === "za" ? OWNER_LOOKUP_KEYS.za : OWNER_LOOKUP_KEYS.us;
  return interval === "year" ? keys.year : keys.month;
}

export function ownerMarketFromLookup(
  lookupKey: string | null | undefined,
): StripePlanMarket | null {
  if (!isOwnerLookupKey(lookupKey)) return null;
  return isZaOwnerLookup(lookupKey) ? "za" : "us";
}

export function ownerIntervalFromLookup(lookupKey: string | null | undefined): FirmInterval | null {
  const key = lookupKey?.trim() ?? "";
  if (!isOwnerLookupKey(key)) return null;
  return key.includes("_annual") ? "year" : "month";
}

/**
 * Currency for one owner Checkout. Stored owner market wins over the URL.
 * A US owner stays on the USD lookup even when the billing country is ZA.
 * A ZA owner with a known non-ZA billing country falls back to USD.
 */
export function ownerCheckoutCharge(input: {
  ownerMarket: unknown;
  requested: StripePlanMarket;
  billingCountry?: string | null;
  geoCountry?: string | null;
  interval: FirmInterval;
}): {
  ownerMarket: StripePlanMarket;
  priceMarket: StripePlanMarket;
  lookupKey: string;
  billingFallback: boolean;
} {
  const ownerMarket = resolveOwnerMarket({
    storedMarket: input.ownerMarket,
    geoCountry: input.geoCountry,
  });
  const priceMarket = resolveCheckoutPriceMarket({
    storedFirmMarket: ownerMarket === "za" ? { country: "ZA" } : { country: "US" },
    billingCountry: input.billingCountry,
  });
  return {
    ownerMarket,
    priceMarket,
    lookupKey: ownerLookupKey(priceMarket, input.interval),
    billingFallback: ownerMarket === "za" && priceMarket === "us",
  };
}

/**
 * Active owner catalog price for one lookup key.
 * Missing annual (or monthly) returns null. Never throws and never returns a firm price.
 */
export async function findOwnerCatalogPrice(
  stripe: PriceLister,
  market: StripePlanMarket,
  interval: FirmInterval,
): Promise<{ price: CatalogPrice; lookupKey: string } | null> {
  const lookupKey = ownerLookupKey(market, interval);
  const listed = await stripe.prices.list({
    lookup_keys: [lookupKey],
    active: true,
    limit: 1,
  });
  const price = listed.data.find((row) => (row.lookup_key ?? lookupKey) === lookupKey) ?? null;
  if (!price?.id || !isOwnerLookupKey(price.lookup_key ?? lookupKey)) return null;
  const currency = price.currency?.trim().toLowerCase() ?? "";
  if (currency === "zar" && market !== "za") return null;
  if (currency === "usd" && market !== "us") return null;
  if (currency && currency !== "zar" && currency !== "usd") return null;
  return { price, lookupKey };
}

export function ownerIntegrationIdentifier(
  interval: FirmInterval,
  suffix = randomIntegrationSuffix(),
): string {
  return `milon-owner-${interval}-${suffix}`;
}

export type OwnerCheckoutSessionInput = {
  priceId: string;
  lookupKey: string;
  interval: FirmInterval;
  origin: string;
  userId: string;
  email?: string;
  customerId?: string;
  /** Stored owner market, not the URL. */
  market: StripePlanMarket;
  billingFallback?: boolean;
  integrationIdentifier: string;
};

/**
 * Owner Checkout. Adaptive Pricing stays off. A rand lookup is the line item
 * only when the charge already selected it. No coupon, no promotion box,
 * no trial. Tax matches the rand firm price: automatic tax off, no tax rates.
 */
export function ownerCheckoutSessionParams(
  input: OwnerCheckoutSessionInput,
): Stripe.Checkout.SessionCreateParams {
  const origin = appRedirectOrigin([input.origin]);
  const localZar = isZaOwnerLookup(input.lookupKey);
  const meta: Record<string, string> = {
    milon_plan: "owner",
    milon_interval: input.interval,
    milon_market: input.market,
    milon_user_id: input.userId,
    milon_lookup_key: input.lookupKey,
  };
  if (input.billingFallback) meta.milon_za_billing_fallback = "usd";

  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    adaptive_pricing: { enabled: false },
    billing_address_collection: "required",
    tax_id_collection: { enabled: true },
    payment_method_collection: "always",
    line_items: [{ price: input.priceId, quantity: 1 }],
    success_url: `${origin}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/billing/cancel?plan=owner`,
    client_reference_id: input.userId,
    metadata: meta,
    subscription_data: { metadata: meta },
    integration_identifier: input.integrationIdentifier,
  };

  if (input.customerId) {
    params.customer = input.customerId;
  } else if (input.email) {
    params.customer_email = input.email;
  }

  if (localZar) {
    params.automatic_tax = { enabled: false };
  }

  return params;
}

/** After Checkout, a rand owner price stays only when the billing country is ZA. */
export function ownerZarNeedsUsdFallback(
  lookupKey: string | null | undefined,
  billingCountry: string | null | undefined,
): boolean {
  if (!isZaOwnerLookup(lookupKey)) return false;
  return (billingCountry ?? "").trim().toUpperCase() !== "ZA";
}
