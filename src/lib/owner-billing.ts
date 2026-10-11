/**
 * Owner-plan entitlement decisions. No Stripe secret and no database.
 * Prices resolve in stripe-checkout.core; this module decides coverage,
 * Checkout results, and webhook state.
 */

import { isOwnerCatalogPrice } from "@/lib/owner-price";
import {
  assertNoManagedPaymentsOverride,
  findOwnerCatalogPrice,
  isOwnerLookupKey,
  ownerCheckoutCharge,
  ownerCheckoutSessionParams,
  ownerIntegrationIdentifier,
  ownerIntervalFromLookup,
  ownerMarketFromLookup,
  type PriceLister,
} from "@/lib/stripe-checkout.core";
import {
  bandIdFromLookupKey,
  isFirmBandId,
  type FirmInterval,
  type StripePlanMarket,
} from "@/lib/stripe-plans";
import type Stripe from "stripe";

/** CoS default: owner stays covered for 14 days after the firm plan churns. */
export const OWNER_FIRM_GRACE_DAYS = 14;
export const OWNER_FIRM_GRACE_SECONDS = OWNER_FIRM_GRACE_DAYS * 24 * 60 * 60;

export const OWNER_PRICE_UNAVAILABLE = "owner_price_unavailable" as const;

export type OwnerEntitlementSource = "stripe" | "firm" | "none";

export type OwnerEntitlement = {
  entitled: boolean;
  source: OwnerEntitlementSource;
  plan: "owner" | null;
  status: string | null;
  market: StripePlanMarket | null;
  interval: FirmInterval | null;
  currentPeriodEnd: string | null;
  firmName: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  lookupKey: string | null;
};

export type StartOwnerCheckoutResult =
  | { status: "covered_by_firm"; firm_name: string }
  | { status: "checkout"; url: string }
  | { status: "portal"; url: string }
  | { status: typeof OWNER_PRICE_UNAVAILABLE };

export type OwnerStripeSnapshot = {
  status: string | null;
  market: StripePlanMarket | null;
  interval: FirmInterval | null;
  currentPeriodEnd: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  lookupKey: string | null;
  userId: string | null;
};

export function emptyOwnerStripeSnapshot(): OwnerStripeSnapshot {
  return {
    status: null,
    market: null,
    interval: null,
    currentPeriodEnd: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    stripePriceId: null,
    lookupKey: null,
    userId: null,
  };
}

/**
 * Any explicit US business keeps the owner on the USD price.
 * No explicit country leaves the market unset so the edge can decide.
 */
export function storedOwnerMarket(clients: Array<{ market: unknown }>): unknown {
  let us: unknown = null;
  let za: unknown = null;
  for (const client of clients) {
    const market = client.market;
    if (!market || typeof market !== "object" || Array.isArray(market)) continue;
    const country = (market as { country?: unknown }).country;
    if (typeof country !== "string" || !country.trim()) continue;
    if (country.trim().toUpperCase() === "ZA") {
      if (!za) za = market;
    } else if (!us) {
      us = market;
    }
  }
  if (us) return us;
  if (za) return za;
  return null;
}

export type PracticeGrantEvidence = {
  firmId: string;
  status: string | null;
  /** requested_by or accountant_approved_by is a member of that firm. */
  grantedByMember: boolean;
};

/**
 * A firm plan covers the owner only after the firm accepted the link.
 * firm_id alone does not. Acceptance is the server-side marker from invite,
 * join, or firm-created clients, or an active practice grant by a firm member.
 */
export function firmLinkCoversOwner(input: {
  firmId: string | null;
  acceptedAt: string | null;
  grants?: PracticeGrantEvidence[];
}): boolean {
  const firmId = input.firmId?.trim() ?? "";
  if (!firmId) return false;
  if (input.acceptedAt?.trim()) return true;
  return (input.grants ?? []).some(
    (grant) => grant.firmId === firmId && grant.status === "active" && grant.grantedByMember,
  );
}

export function isFirmBandBillingSubscription(input: {
  lookupKey?: string | null;
  plan?: string | null;
}): boolean {
  const plan = input.plan?.trim() ?? "";
  const lookupKey = input.lookupKey?.trim() ?? "";
  if (plan === "owner" || isOwnerLookupKey(lookupKey)) return false;
  if (lookupKey && bandIdFromLookupKey(lookupKey)) return true;
  if (plan && isFirmBandId(plan)) return true;
  return false;
}

export type FirmSubscriptionLike = {
  status?: string | null;
  canceled_at?: number | null;
  ended_at?: number | null;
  current_period_end?: number | null;
  items?: { data?: Array<{ current_period_end?: number | null }> } | null;
  metadata?: Record<string, string> | null;
  lookupKey?: string | null;
};

function unixSeconds(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

export function firmSubscriptionPeriodEnd(sub: FirmSubscriptionLike): number | null {
  const top = unixSeconds(sub.current_period_end);
  if (top) return top;
  return unixSeconds(sub.items?.data?.[0]?.current_period_end);
}

/**
 * Active or trialing firm plans cover the owner. A churned firm plan
 * (canceled, unpaid, or incomplete_expired) covers until 14 days after
 * the later of cancel time and period end.
 */
export function firmSubscriptionCoversOwner(
  sub: FirmSubscriptionLike,
  nowSec: number,
  graceSeconds = OWNER_FIRM_GRACE_SECONDS,
): { covered: boolean; graceUntil: string | null; currentPeriodEnd: string | null } {
  const periodEnd = firmSubscriptionPeriodEnd(sub);
  const currentPeriodEnd = periodEnd ? new Date(periodEnd * 1000).toISOString() : null;
  const status = sub.status ?? "";
  if (status === "active" || status === "trialing") {
    return { covered: true, graceUntil: null, currentPeriodEnd };
  }
  if (status !== "canceled" && status !== "unpaid" && status !== "incomplete_expired") {
    return { covered: false, graceUntil: null, currentPeriodEnd };
  }
  const churn = unixSeconds(sub.canceled_at) ?? unixSeconds(sub.ended_at) ?? periodEnd;
  if (churn == null) return { covered: false, graceUntil: null, currentPeriodEnd };
  const anchor = periodEnd != null ? Math.max(periodEnd, churn) : churn;
  const graceUntilSec = anchor + graceSeconds;
  const graceUntil = new Date(graceUntilSec * 1000).toISOString();
  if (nowSec > graceUntilSec) return { covered: false, graceUntil, currentPeriodEnd };
  return { covered: true, graceUntil, currentPeriodEnd };
}

export function pickCoveringFirmSubscription(
  subs: FirmSubscriptionLike[],
  nowSec: number,
): { covered: boolean; graceUntil: string | null; currentPeriodEnd: string | null } | null {
  let grace: {
    covered: boolean;
    graceUntil: string | null;
    currentPeriodEnd: string | null;
  } | null = null;
  for (const sub of subs) {
    const lookupKey = sub.lookupKey ?? sub.metadata?.milon_lookup_key ?? null;
    const plan = sub.metadata?.milon_plan ?? null;
    if (!isFirmBandBillingSubscription({ lookupKey, plan })) continue;
    const decision = firmSubscriptionCoversOwner(sub, nowSec);
    if (!decision.covered) continue;
    if (sub.status === "active" || sub.status === "trialing") return decision;
    if (!grace) grace = decision;
  }
  return grace;
}

export type OwnerCheckoutPlanner = PriceLister & {
  checkout: {
    sessions: {
      create: (params: Stripe.Checkout.SessionCreateParams) => Promise<{ url: string | null }>;
    };
  };
};

/**
 * Signed-in owner Checkout, without auth or the database.
 * Firm coverage returns before any Stripe call. A missing owner lookup key
 * is owner_price_unavailable — not a throw, and not a firm price.
 */
export async function planOwnerCheckout(input: {
  stripe: OwnerCheckoutPlanner;
  interval: FirmInterval;
  requestedMarket: StripePlanMarket;
  ownerMarket: unknown;
  billingCountry?: string | null;
  geoCountry?: string | null;
  userId: string;
  email?: string;
  customerId?: string;
  origin: string;
  firmCoverage: { firmName: string } | null;
}): Promise<
  | { status: "covered_by_firm"; firm_name: string }
  | {
      status: "checkout";
      url: string;
      lookupKey: string;
      priceMarket: StripePlanMarket;
    }
  | { status: typeof OWNER_PRICE_UNAVAILABLE }
> {
  const firmName = input.firmCoverage?.firmName.trim() ?? "";
  if (firmName) return { status: "covered_by_firm", firm_name: firmName };

  const charge = ownerCheckoutCharge({
    ownerMarket: input.ownerMarket,
    requested: input.requestedMarket,
    billingCountry: input.billingCountry,
    geoCountry: input.geoCountry,
    interval: input.interval,
  });
  const found = await findOwnerCatalogPrice(input.stripe, charge.priceMarket, input.interval);
  if (!found || !isOwnerLookupKey(found.lookupKey)) {
    return { status: OWNER_PRICE_UNAVAILABLE };
  }
  // A non-ZA billing country swaps a rand session onto the USD owner price.
  // Without that USD price, refuse the rand session instead of leaving it.
  if (charge.priceMarket === "za") {
    const usd = await findOwnerCatalogPrice(input.stripe, "us", input.interval);
    if (!usd || !isOwnerLookupKey(usd.lookupKey)) {
      return { status: OWNER_PRICE_UNAVAILABLE };
    }
  }
  const params = ownerCheckoutSessionParams({
    priceId: found.price.id,
    lookupKey: found.lookupKey,
    interval: input.interval,
    origin: input.origin,
    userId: input.userId,
    email: input.email,
    customerId: input.customerId,
    market: charge.ownerMarket,
    billingFallback: charge.billingFallback,
    integrationIdentifier: ownerIntegrationIdentifier(input.interval),
  });
  assertNoManagedPaymentsOverride(params);
  const session = await input.stripe.checkout.sessions.create(params);
  if (!session.url) throw new Error("Stripe Checkout did not return a URL.");
  return {
    status: "checkout",
    url: session.url,
    lookupKey: found.lookupKey,
    priceMarket: charge.priceMarket,
  };
}

export function getOwnerEntitlement(input: {
  stripe: OwnerStripeSnapshot | null;
  firm: { firmName: string; graceUntil?: string | null } | null;
}): OwnerEntitlement {
  const firmName = input.firm?.firmName.trim() ?? "";
  if (firmName) {
    return {
      entitled: true,
      source: "firm",
      plan: "owner",
      status: "active",
      market: input.stripe?.market ?? null,
      interval: null,
      currentPeriodEnd: input.firm?.graceUntil ?? input.stripe?.currentPeriodEnd ?? null,
      firmName,
      stripeCustomerId: input.stripe?.stripeCustomerId ?? null,
      stripeSubscriptionId: input.stripe?.stripeSubscriptionId ?? null,
      lookupKey: null,
    };
  }
  const stripe = input.stripe;
  const status = stripe?.status ?? null;
  if (!stripe || !status) {
    return {
      entitled: false,
      source: "none",
      plan: null,
      status: null,
      market: null,
      interval: null,
      currentPeriodEnd: null,
      firmName: null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      lookupKey: null,
    };
  }
  const entitled = status === "active" || status === "trialing";
  return {
    entitled,
    source: "stripe",
    plan: "owner",
    status,
    market: stripe.market,
    interval: stripe.interval,
    currentPeriodEnd: stripe.currentPeriodEnd,
    firmName: null,
    stripeCustomerId: stripe.stripeCustomerId,
    stripeSubscriptionId: stripe.stripeSubscriptionId,
    lookupKey: stripe.lookupKey,
  };
}

export function applyOwnerStripeEvent(
  previous: OwnerStripeSnapshot | null,
  event: {
    type: string;
    lookupKey?: string | null;
    plan?: string | null;
    status?: string | null;
    market?: StripePlanMarket | null;
    interval?: FirmInterval | null;
    currentPeriodEnd?: string | null;
    customerId?: string | null;
    subscriptionId?: string | null;
    priceId?: string | null;
    userId?: string | null;
  },
): OwnerStripeSnapshot | null {
  const lookup = event.lookupKey?.trim() || previous?.lookupKey || "";
  const owner =
    event.plan === "owner" || isOwnerLookupKey(lookup) || isOwnerLookupKey(previous?.lookupKey);
  if (!owner) return previous;
  if (
    lookup &&
    !isOwnerLookupKey(lookup) &&
    event.plan !== "owner" &&
    !isOwnerLookupKey(previous?.lookupKey)
  ) {
    return previous;
  }
  const base = previous ?? emptyOwnerStripeSnapshot();
  if (event.type === "customer.subscription.deleted") {
    return {
      ...base,
      status: "canceled",
      stripeCustomerId: event.customerId ?? base.stripeCustomerId,
      stripeSubscriptionId: event.subscriptionId ?? base.stripeSubscriptionId,
      userId: event.userId ?? base.userId,
    };
  }
  const nextLookup = isOwnerLookupKey(lookup) ? lookup : base.lookupKey;
  const market =
    event.market ?? (nextLookup ? ownerMarketFromLookup(nextLookup) : null) ?? base.market;
  const interval =
    event.interval ?? (nextLookup ? ownerIntervalFromLookup(nextLookup) : null) ?? base.interval;
  return {
    status: event.status ?? base.status,
    market,
    interval,
    currentPeriodEnd: event.currentPeriodEnd ?? base.currentPeriodEnd,
    stripeCustomerId: event.customerId ?? base.stripeCustomerId,
    stripeSubscriptionId: event.subscriptionId ?? base.stripeSubscriptionId,
    stripePriceId: event.priceId ?? base.stripePriceId,
    lookupKey: nextLookup,
    userId: event.userId ?? base.userId,
  };
}

export type OwnerBillingEventSignal = {
  owner: boolean;
  type: string;
  subscriptionId: string | null;
  lookupKey: string | null;
  userId: string | null;
  customerId: string | null;
  status: string | null;
  market: StripePlanMarket | null;
  interval: FirmInterval | null;
  currentPeriodEnd: string | null;
  priceId: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown> | null, key: string): string | null {
  if (!record) return null;
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function metadataOf(record: Record<string, unknown> | null): Record<string, string> {
  const raw = asRecord(record?.metadata);
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

function isoFromUnix(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return new Date(value * 1000).toISOString();
}

function priceOf(record: Record<string, unknown> | null): {
  lookupKey: string | null;
  priceId: string | null;
  productPlan: string | null;
} {
  const items = asRecord(record?.items);
  const data = Array.isArray(items?.data) ? items.data : [];
  const first = asRecord(data[0]);
  const price = first?.price;
  if (typeof price === "string" && price.trim()) {
    return { lookupKey: null, priceId: price.trim(), productPlan: null };
  }
  const priceRecord = asRecord(price);
  const product = asRecord(priceRecord?.product);
  return {
    lookupKey: stringField(priceRecord, "lookup_key"),
    priceId: stringField(priceRecord, "id"),
    productPlan: metadataOf(product).plan ?? null,
  };
}

function periodEndIso(record: Record<string, unknown> | null): string | null {
  const top = isoFromUnix(record?.current_period_end);
  if (top) return top;
  const items = asRecord(record?.items);
  const data = Array.isArray(items?.data) ? items.data : [];
  const first = asRecord(data[0]);
  return isoFromUnix(first?.current_period_end);
}

function refId(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  return stringField(asRecord(value), "id");
}

/** Reads an owner Checkout or subscription event. Firm prices are not owner events. */
export function ownerBillingEventSignal(event: {
  type?: string;
  data?: { object?: unknown };
}): OwnerBillingEventSignal {
  const type = event.type ?? "";
  const record = asRecord(event.data?.object);
  const metadata = metadataOf(record);
  const price = priceOf(record);
  const lookupKey = metadata.milon_lookup_key?.trim() || price.lookupKey || null;
  const plan = metadata.milon_plan?.trim() || "";
  const owner =
    plan === "owner" || isOwnerCatalogPrice({ lookupKey, productPlan: price.productPlan });
  const marketField = metadata.milon_market?.trim() ?? "";
  const intervalField = metadata.milon_interval?.trim() ?? "";
  const market: StripePlanMarket | null =
    marketField === "za" || marketField === "us" ? marketField : ownerMarketFromLookup(lookupKey);
  const interval: FirmInterval | null =
    intervalField === "month" || intervalField === "year"
      ? intervalField
      : ownerIntervalFromLookup(lookupKey);
  const subscriptionId =
    type === "checkout.session.completed" ? refId(record?.subscription) : stringField(record, "id");
  return {
    owner,
    type,
    subscriptionId,
    lookupKey: isOwnerLookupKey(lookupKey) ? lookupKey : null,
    userId: metadata.milon_user_id?.trim() || stringField(record, "client_reference_id"),
    customerId: refId(record?.customer),
    status: type === "customer.subscription.deleted" ? "canceled" : stringField(record, "status"),
    market,
    interval,
    currentPeriodEnd: periodEndIso(record),
    priceId: price.priceId,
  };
}
