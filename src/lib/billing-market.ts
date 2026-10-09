/**
 * Firm-band Checkout market from firms.market.country.
 * A URL `market` param is not an input. No firm row is not ZA.
 * This module stays free of pricing sentences so the landing bundle can import it.
 */

import type { PendingCheckout } from "@/lib/pending-checkout";
import {
  isFirmCheckoutBand,
  type FirmCheckoutBand,
  type FirmInterval,
  type StripePlanMarket,
} from "@/lib/stripe-plans";

export function stripePlanMarketFromFirm(firmMarket: unknown): StripePlanMarket {
  if (!firmMarket || typeof firmMarket !== "object" || Array.isArray(firmMarket)) return "us";
  const country = (firmMarket as { country?: unknown }).country;
  if (typeof country !== "string") return "us";
  return country.trim().toUpperCase() === "ZA" ? "za" : "us";
}

export function firmBillingResumeIntent(
  firmMarket: unknown,
  pending?: {
    plan?: string | null;
    interval?: string | null;
    promo?: string | null;
  } | null,
): PendingCheckout {
  const market = stripePlanMarketFromFirm(firmMarket);
  const plan: FirmCheckoutBand =
    pending?.plan && isFirmCheckoutBand(pending.plan) ? pending.plan : "solo";
  const interval: FirmInterval = pending?.interval === "year" ? "year" : "month";
  const promo =
    typeof pending?.promo === "string" && pending.promo.trim() ? pending.promo.trim() : undefined;
  return { plan, interval, market, ...(promo ? { promo } : {}) };
}

/** Resolved "za" | "us" from the server quote, already ignoring the URL. */
export function billingIntentForResolvedMarket(
  market: StripePlanMarket,
  pending?: {
    plan?: string | null;
    interval?: string | null;
    promo?: string | null;
  } | null,
): PendingCheckout {
  return firmBillingResumeIntent(market === "za" ? { country: "ZA" } : { country: "US" }, pending);
}

/**
 * When this user already has a firm row, the stored country wins.
 * No row yet: the visitor pack (server geo). A za URL does not stick.
 */
export async function checkoutIntentForUser(
  userId: string,
  pending: PendingCheckout | null,
  visitorMarket: StripePlanMarket,
): Promise<PendingCheckout> {
  const { fetchUserFirm } = await import("@/lib/firm-brand");
  const firm = await fetchUserFirm(userId);
  if (firm) return firmBillingResumeIntent(firm.market, pending);
  const market: StripePlanMarket = visitorMarket === "za" ? "za" : "us";
  if (pending) return { ...pending, market };
  return { plan: "solo", interval: "month", market };
}
