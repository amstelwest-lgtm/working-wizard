/**
 * Keep the Stripe subscription's milon_plan metadata aligned with the catalog
 * price, and retire a replaced Starter (or other) subscription once the new
 * one is entitling. The client cap reads this live — no local band column.
 */

import type Stripe from "stripe";
import {
  billedBandFromPrice,
  downgradeDropsBelowUsage,
  metadataPatchForPrice,
  readSubscriptionPrice,
  shouldCancelReplacedSubscription,
  shouldRevertBlockedDowngrade,
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

type RetrievedSubscription = {
  id: string;
  status: string;
  currency?: string | null;
  metadata?: Record<string, string> | null;
  customer?: unknown;
  items?: { data?: Array<{ id?: string; price?: unknown }> };
};

type SubscriptionUpdateParams = {
  metadata?: Record<string, string>;
  items?: Array<{ id: string; price: string }>;
  proration_behavior?: "none";
};

type StripeLike = {
  subscriptions: {
    retrieve: (id: string, params?: { expand?: string[] }) => Promise<RetrievedSubscription>;
    update: (id: string, params: SubscriptionUpdateParams) => Promise<unknown>;
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

function customerEmailOf(customer: unknown): string | null {
  if (!customer || typeof customer !== "object") return null;
  if ("deleted" in customer && (customer as { deleted?: unknown }).deleted === true) return null;
  const email = (customer as { email?: unknown }).email;
  return typeof email === "string" && email.trim() ? email.trim() : null;
}

/**
 * Client count for the firm that owns this subscription. Unknown (no admin
 * client, no user, no firm) returns null so the sync does not invent a block.
 */
export async function firmClientCountForBilling(input: {
  userId?: string | null;
  email?: string | null;
}): Promise<number | null> {
  try {
    const { getSupabaseAdminOrNull } = await import("@/integrations/supabase/client.server");
    const admin = getSupabaseAdminOrNull();
    if (!admin) return null;
    let userId = input.userId?.trim() ?? "";
    if (!userId && input.email?.trim()) {
      const { data } = await admin
        .from("profiles")
        .select("id")
        .ilike("email", input.email.trim())
        .maybeSingle();
      userId = data?.id ? String(data.id) : "";
    }
    if (!userId) return null;
    const owned = await admin.from("firms").select("id").eq("owner_user_id", userId).limit(1);
    let firmId = owned.data?.[0]?.id ? String(owned.data[0].id) : "";
    if (!firmId) {
      const membership = await admin
        .from("firm_memberships")
        .select("firm_id")
        .eq("user_id", userId)
        .in("role", ["owner", "admin"])
        .limit(1);
      firmId = membership.data?.[0]?.firm_id ? String(membership.data[0].firm_id) : "";
    }
    if (!firmId) return null;
    const { count, error } = await admin
      .from("clients")
      .select("id", { count: "exact", head: true })
      .eq("firm_id", firmId);
    if (error) {
      console.warn("[stripe] client count failed", error.message);
      return null;
    }
    return count ?? 0;
  } catch (err) {
    console.warn("[stripe] client count unavailable", err instanceof Error ? err.message : err);
    return null;
  }
}

async function retrieveFirmSubscription(
  stripe: StripeLike,
  subscriptionId: string,
): Promise<RetrievedSubscription> {
  try {
    return await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ["items.data.price", "customer"],
    });
  } catch (err) {
    console.warn("[stripe] subscription expand failed", err instanceof Error ? err.message : err);
    return stripe.subscriptions.retrieve(subscriptionId, {
      expand: ["items.data.price"],
    });
  }
}

export async function syncFirmSubscriptionBand(
  subscriptionId: string,
  stripe: StripeLike = getStripe() as unknown as StripeLike,
  options?: {
    previousPriceId?: string | null;
    /** Session metadata, used when the new subscription has not copied milon_replaces_subscription yet. */
    replacesSubscriptionId?: string | null;
    clientCount?: number | null;
  },
): Promise<{ band: string | null; cancelledReplaced: boolean; downgradeBlocked: boolean }> {
  const sub = await retrieveFirmSubscription(stripe, subscriptionId);
  const price = readSubscriptionPrice(sub as Parameters<typeof readSubscriptionPrice>[0]);
  const metadata = { ...(sub.metadata ?? {}) };
  const replacesFromSession = options?.replacesSubscriptionId?.trim();
  if (replacesFromSession && !metadata.milon_replaces_subscription) {
    metadata.milon_replaces_subscription = replacesFromSession;
  }
  const clientCount =
    options?.clientCount !== undefined
      ? options.clientCount
      : await firmClientCountForBilling({
          userId: metadata.milon_user_id,
          email: customerEmailOf(sub.customer),
        });
  const billedBand = billedBandFromPrice({
    lookupKey: price.lookupKey,
    productBand: price.productBand,
  });
  const downgradeBlocked = downgradeDropsBelowUsage(billedBand, clientCount);
  const patch = metadataPatchForPrice({
    lookupKey: price.lookupKey,
    productBand: price.productBand,
    metadata,
    clientCount,
  });
  const revert = shouldRevertBlockedDowngrade({
    blocked: downgradeBlocked,
    currentPriceId: price.priceId,
    previousPriceId: options?.previousPriceId,
    itemId: price.itemId,
  });
  if (patch || revert) {
    const params: SubscriptionUpdateParams = {};
    if (patch) params.metadata = patch;
    if (revert && price.itemId && options?.previousPriceId) {
      params.items = [{ id: price.itemId, price: options.previousPriceId }];
      params.proration_behavior = "none";
    }
    try {
      await stripe.subscriptions.update(subscriptionId, params);
    } catch (err) {
      if (!params.items || !patch) throw err;
      console.warn(
        "[stripe] could not restore the previous price after a blocked downgrade",
        err instanceof Error ? err.message : err,
      );
      await stripe.subscriptions.update(subscriptionId, { metadata: patch });
    }
  }
  const replaced = (patch ?? metadata).milon_replaces_subscription;
  let cancelledReplaced = false;
  if (
    !downgradeBlocked &&
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
  const band = downgradeBlocked
    ? (metadata.milon_plan ?? null)
    : ((patch ?? metadata).milon_plan ?? null);
  return { band, cancelledReplaced, downgradeBlocked };
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
  return syncFirmSubscriptionBand(subscriptionId, stripe, {
    replacesSubscriptionId: session.metadata?.milon_replaces_subscription,
  });
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
