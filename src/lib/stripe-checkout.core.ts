/**
 * Pure Checkout / Portal helpers for firm-band billing.
 * Server functions call Stripe; tests call these without a live key.
 */

import type Stripe from "stripe";
import { appRedirectOrigin } from "@/lib/app-origin";
import {
  assertFoundingMonthlyOnly,
  FIRM_TRIAL_DAYS,
  firmLookupKey,
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
  integrationIdentifier: string;
  /**
   * First firm subscription only. A customer with any prior subscription
   * (canceled trial included) does not get another 14 days.
   */
  includeTrial: boolean;
};

/**
 * Checkout Session create payload for a firm band.
 * Adaptive Pricing is on so SA firms can pay ZAR against the USD catalog.
 * Managed Payments is left at the account default (do not force-disable).
 * automatic_tax is omitted unless registrations exist.
 *
 * Card is always collected. A first subscription starts a 14-day trial on the
 * chosen paid band. FOUNDING applies to the paid invoices after that trial,
 * not as a forever-free price.
 */
export function firmCheckoutSessionParams(
  input: FirmCheckoutSessionInput,
): Stripe.Checkout.SessionCreateParams {
  const origin = appRedirectOrigin([input.origin]);
  const monthlyPaid = input.interval === "month";
  const meta: Record<string, string> = {
    milon_plan: input.band,
    milon_interval: input.interval,
    milon_market: input.market,
    milon_user_id: input.userId,
    milon_lookup_key: input.lookupKey,
  };
  if (input.includeTrial) meta.milon_trial_days = String(FIRM_TRIAL_DAYS);

  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    adaptive_pricing: { enabled: true },
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

  // Promo box only on monthly paid Checkout so FOUNDING cannot be typed on yearly.
  // The coupon discounts invoices after the trial. It does not zero the plan forever.
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
  params.success_url = `${origin}/dashboard?addClient=1&upgrade=success&session_id={CHECKOUT_SESSION_ID}`;
  params.cancel_url = `${origin}/dashboard?addClient=1&upgrade=cancelled`;
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
};

/**
 * Collect a card for an existing subscription (a $0 Starter has none), then
 * the server updates that same subscription. This is not a second subscription.
 */
export function firmSetupCheckoutSessionParams(input: {
  origin: string;
  customerId: string;
  userId: string;
  subscriptionId: string;
  lookupKey: string;
  band: FirmCheckoutBand;
  interval: FirmInterval;
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
  return {
    mode: "setup",
    customer: input.customerId,
    currency: "usd",
    client_reference_id: input.userId,
    success_url: `${origin}/dashboard?addClient=1&upgrade=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/dashboard?addClient=1&upgrade=cancelled`,
    metadata,
    setup_intent_data: { metadata },
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
  return { subscriptionId, band, interval, lookupKey, userId };
}

export function assertNoManagedPaymentsOverride(params: Stripe.Checkout.SessionCreateParams): void {
  if ("managed_payments" in params && params.managed_payments != null) {
    throw new Error("Firm Checkout must not override managed_payments; leave the account default.");
  }
}

export { isFoundingCode, assertFoundingMonthlyOnly };
