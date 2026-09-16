/**
 * Pure Checkout / Portal helpers for firm-band billing.
 * Server functions call Stripe; tests call these without a live key.
 */

import type Stripe from "stripe";
import {
  assertFoundingMonthlyOnly,
  firmLookupKey,
  isFoundingCode,
  type FirmCheckoutBand,
  type FirmInterval,
  type StripePlanMarket,
} from "@/lib/stripe-plans";

export type CatalogPrice = {
  id: string;
  lookup_key?: string | null;
  recurring?: { interval?: string | null } | null;
  unit_amount?: number | null;
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
): Promise<{ price: CatalogPrice; lookupKey: string }> {
  const lookupKey = firmLookupKey(band, interval);
  const price = await resolvePriceByLookupKey(stripe, lookupKey);
  const priceInterval = price.recurring?.interval;
  if (priceInterval && priceInterval !== interval) {
    throw new Error(
      `Stripe price ${lookupKey} is ${priceInterval}, expected ${interval}.`,
    );
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

export function foundingRejectedOnYearly(
  interval: FirmInterval,
  promo?: string | null,
): boolean {
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
  integrationIdentifier: string;
};

/**
 * Checkout Session create payload for a firm band.
 * Adaptive Pricing is on so SA firms can pay ZAR against the USD catalog.
 * Managed Payments is left at the account default (do not force-disable).
 * automatic_tax is omitted unless registrations exist.
 */
export function firmCheckoutSessionParams(
  input: FirmCheckoutSessionInput,
): Stripe.Checkout.SessionCreateParams {
  const origin = input.origin.replace(/\/$/, "");
  const paid = input.band !== "starter";
  const monthlyPaid = paid && input.interval === "month";
  const meta = {
    milon_plan: input.band,
    milon_interval: input.interval,
    milon_market: input.market,
    milon_user_id: input.userId,
    milon_lookup_key: input.lookupKey,
  };

  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    adaptive_pricing: { enabled: true },
    billing_address_collection: "required",
    tax_id_collection: { enabled: true },
    line_items: [{ price: input.priceId, quantity: 1 }],
    success_url: `${origin}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/billing/cancel`,
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

  if (input.band === "starter") {
    params.payment_method_collection = "if_required";
  }

  // Promo box only on monthly paid Checkout so FOUNDING cannot be typed on yearly.
  if (monthlyPaid) {
    params.allow_promotion_codes = true;
  }

  if (input.promotionCodeId) {
    params.discounts = [{ promotion_code: input.promotionCodeId }];
    delete params.allow_promotion_codes;
  }

  return params;
}

export function assertNoManagedPaymentsOverride(
  params: Stripe.Checkout.SessionCreateParams,
): void {
  if ("managed_payments" in params && params.managed_payments != null) {
    throw new Error("Firm Checkout must not override managed_payments; leave the account default.");
  }
}

export { isFoundingCode, assertFoundingMonthlyOnly };
