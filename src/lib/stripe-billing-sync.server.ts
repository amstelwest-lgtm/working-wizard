/**
 * Keep the Stripe subscription's milon_plan metadata aligned with the catalog
 * price, and retire a replaced Starter (or other) subscription once the new
 * one is entitling. The client cap reads this live — no local band column.
 */

import type Stripe from "stripe";
import {
  metadataPatchForPrice,
  readSubscriptionPrice,
  shouldCancelReplacedSubscription,
  zarCentsFromPrice,
  type ZarBandAmounts,
} from "@/lib/firm-band-upgrade";
import {
  ALL_FIRM_LOOKUP_KEYS,
  bandIdFromLookupKey,
  intervalFromLookupKey,
  type FirmBandId,
} from "@/lib/stripe-plans";
import { getStripe } from "@/lib/stripe.server";

type StripeLike = {
  subscriptions: {
    retrieve: (
      id: string,
      params?: { expand?: string[] },
    ) => Promise<{
      id: string;
      status: string;
      metadata?: Record<string, string> | null;
      items?: { data?: Array<{ id?: string; price?: unknown }> };
    }>;
    update: (id: string, params: { metadata: Record<string, string> }) => Promise<unknown>;
    cancel: (id: string) => Promise<unknown>;
  };
  prices: {
    list: (params: { lookup_keys: string[]; limit: number; expand?: string[] }) => Promise<{
      data: Array<{
        lookup_key?: string | null;
        currency?: string | null;
        unit_amount?: number | null;
        currency_options?: { zar?: { unit_amount?: number | null } | null } | null;
      }>;
    }>;
  };
};

export async function loadZarCatalogAmounts(
  stripe: StripeLike = getStripe() as unknown as StripeLike,
): Promise<Partial<Record<FirmBandId, ZarBandAmounts>>> {
  const out: Partial<Record<FirmBandId, ZarBandAmounts>> = {};
  for (let i = 0; i < ALL_FIRM_LOOKUP_KEYS.length; i += 10) {
    const lookup_keys = ALL_FIRM_LOOKUP_KEYS.slice(i, i + 10);
    const listed = await stripe.prices.list({
      lookup_keys,
      limit: 10,
      expand: ["data.currency_options"],
    });
    for (const price of listed.data) {
      const band = bandIdFromLookupKey(price.lookup_key);
      const interval = intervalFromLookupKey(price.lookup_key);
      if (!band || !interval) continue;
      const cents = zarCentsFromPrice(price);
      const slot = out[band] ?? { month: null, year: null };
      slot[interval] = cents;
      out[band] = slot;
    }
  }
  return out;
}

export async function syncFirmSubscriptionBand(
  subscriptionId: string,
  stripe: StripeLike = getStripe() as unknown as StripeLike,
): Promise<{ band: string | null; cancelledReplaced: boolean }> {
  const sub = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ["items.data.price"],
  });
  const price = readSubscriptionPrice(sub as Parameters<typeof readSubscriptionPrice>[0]);
  const metadata = sub.metadata ?? {};
  const patch = metadataPatchForPrice({ lookupKey: price.lookupKey, metadata });
  if (patch) {
    await stripe.subscriptions.update(subscriptionId, { metadata: patch });
  }
  const replaced = (patch ?? metadata).milon_replaces_subscription;
  let cancelledReplaced = false;
  if (
    replaced &&
    shouldCancelReplacedSubscription({
      newStatus: sub.status,
      replacedId: replaced,
      newId: sub.id,
    })
  ) {
    try {
      await stripe.subscriptions.cancel(replaced);
      cancelledReplaced = true;
    } catch (err) {
      console.warn(
        "[stripe] could not cancel replaced subscription",
        err instanceof Error ? err.message : err,
      );
    }
  }
  const band = (patch ?? metadata).milon_plan ?? null;
  return { band, cancelledReplaced };
}

export async function syncCheckoutSessionSubscription(
  session: {
    mode?: string | null;
    subscription?: string | { id?: string } | null;
    metadata?: Record<string, string> | null;
  },
  stripe?: StripeLike,
): Promise<{ band: string | null; cancelledReplaced: boolean } | null> {
  if (session.mode && session.mode !== "subscription") return null;
  const subscriptionId =
    typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
  if (!subscriptionId) return null;
  return syncFirmSubscriptionBand(subscriptionId, stripe);
}

export function stripeEventSubscriptionId(event: {
  type?: string;
  data?: { object?: unknown };
}): string | null {
  const object = event.data?.object;
  if (!object || typeof object !== "object") return null;
  const record = object as Record<string, unknown>;
  if (event.type === "checkout.session.completed") {
    const subscription = record.subscription;
    if (typeof subscription === "string") return subscription;
    return null;
  }
  if (
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.created"
  ) {
    return typeof record.id === "string" ? record.id : null;
  }
  return null;
}

export const FIRM_BILLING_WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
] as const;

export function isFirmBillingWebhookEvent(type: string | undefined): boolean {
  return (FIRM_BILLING_WEBHOOK_EVENTS as readonly string[]).includes(type ?? "");
}

/** Signature helper so the route stays a thin wrapper. */
export function constructFirmBillingEvent(
  stripe: { webhooks: { constructEvent: Stripe["webhooks"]["constructEvent"] } },
  payload: string,
  signature: string,
  secret: string,
): Stripe.Event {
  return stripe.webhooks.constructEvent(payload, signature, secret);
}
