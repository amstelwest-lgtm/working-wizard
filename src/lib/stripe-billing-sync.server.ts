/**
 * Keep the Stripe subscription's milon_plan metadata aligned with the catalog
 * price, and retire a replaced Starter (or other) subscription once the new
 * one is entitling. The client cap reads this live — no local band column.
 */

import type Stripe from "stripe";
import {
  billedBandFromPrice,
  downgradeDropsBelowUsage,
  firmSubscriptionUpgradeParams,
  idOfStripeRef,
  metadataPatchForPrice,
  readSubscriptionPrice,
  shouldCancelReplacedSubscription,
  shouldRevertBlockedDowngrade,
  UPGRADE_FAILED_MESSAGE,
  zarCentsFromPrice,
  type ZarBandAmounts,
} from "@/lib/firm-band-upgrade";
import { readFirmSetupUpgrade, resolveFirmCatalogPrice } from "@/lib/stripe-checkout.core";
import {
  isSaMarketFirm,
  readSubscriptionDiscountRefs,
  stripeZaCouponId,
} from "@/lib/firm-sa-market";
import { resolveFirmVoucher, type FirmVoucherStripe } from "@/lib/firm-voucher.server";
import {
  firmBandListCents,
  firmSetupUpdateAccepted,
  firmUpgradeDiscounts,
  FIRM_VOUCHER_NOT_APPLIED_MESSAGE,
  isBenignZeroInvoiceError,
  isPromotionCodeStripeError,
  readFirmSetupInvoice,
  stripeProductId,
} from "@/lib/firm-voucher";
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
  discount?: unknown;
  discounts?: unknown;
  latest_invoice?: unknown;
  items?: { data?: Array<{ id?: string; price?: unknown }> };
};

type SubscriptionUpdateParams = {
  metadata?: Record<string, string>;
  items?: Array<{ id: string; price: string }>;
  proration_behavior?: "none" | "create_prorations";
  payment_behavior?: "error_if_incomplete";
  billing_cycle_anchor?: "now";
  trial_end?: "now";
  default_payment_method?: string;
  discounts?: Array<{ discount: string } | { coupon: string } | { promotion_code: string }>;
  expand?: string[];
};

type StripeLike = {
  subscriptions: {
    retrieve: (id: string, params?: { expand?: string[] }) => Promise<RetrievedSubscription>;
    update: (id: string, params: SubscriptionUpdateParams) => Promise<RetrievedSubscription>;
    cancel: (id: string) => Promise<unknown>;
  };
  prices: {
    list: (params: {
      lookup_keys: string[];
      limit: number;
      active?: boolean;
      expand?: string[];
    }) => Promise<{
      data: Array<{
        id?: string;
        lookup_key?: string | null;
        currency?: string | null;
        unit_amount?: number | null;
        recurring?: { interval?: string | null } | null;
        currency_options?: { zar?: { unit_amount?: number | null } | null } | null;
      }>;
    }>;
  };
  setupIntents?: {
    retrieve: (id: string) => Promise<{ payment_method?: unknown; status?: string }>;
  };
  customers?: {
    update: (
      id: string,
      params: { invoice_settings: { default_payment_method: string } },
    ) => Promise<unknown>;
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
  try {
    const { syncStarterTrialMirrorForActor } = await import("@/lib/firm-client-cap.server");
    await syncStarterTrialMirrorForActor({
      supabase: null,
      userId: typeof metadata.milon_user_id === "string" ? metadata.milon_user_id : "",
      email: customerEmailOf(sub.customer) ?? "",
    });
  } catch (err) {
    console.warn("[starter-trial] mirror sync skipped", err instanceof Error ? err.message : err);
  }
  return { band, cancelledReplaced, downgradeBlocked };
}

/** Firm market JSON for the billing user. Null when the row cannot be read. */
async function firmMarketForBillingUser(userId: string | null | undefined): Promise<unknown> {
  const id = userId?.trim() ?? "";
  if (!id) return null;
  try {
    const { getSupabaseAdminOrNull } = await import("@/integrations/supabase/client.server");
    const admin = getSupabaseAdminOrNull();
    if (!admin) return null;
    const owned = await admin.from("firms").select("market").eq("owner_user_id", id).limit(1);
    if (owned.data?.[0]) return (owned.data[0] as { market?: unknown }).market ?? null;
    const membership = await admin
      .from("firm_memberships")
      .select("firm_id")
      .eq("user_id", id)
      .in("role", ["owner", "admin"])
      .limit(1);
    const firmId = membership.data?.[0]?.firm_id ? String(membership.data[0].firm_id) : "";
    if (!firmId) return null;
    const firm = await admin.from("firms").select("market").eq("id", firmId).maybeSingle();
    return (firm.data as { market?: unknown } | null)?.market ?? null;
  } catch (err) {
    console.warn("[stripe] firm market unavailable", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Setup Checkout collected a card for an existing subscription. Attach it as
 * the customer and subscription default, then move that same subscription
 * onto the catalog price. Does not create or cancel a subscription.
 */
export type FirmSetupUpgradeOptions = {
  /** When set, skips the firms.market read. Tests pass the firm market here. */
  firmMarket?: unknown;
};

function updateAcceptance(updated: RetrievedSubscription, expectedLookupKey: string) {
  const price = readSubscriptionPrice(updated as Parameters<typeof readSubscriptionPrice>[0]);
  const invoice = readFirmSetupInvoice(updated.latest_invoice);
  const accepted = firmSetupUpdateAccepted({
    status: updated.status ?? null,
    amountDue: invoice?.amountDue ?? null,
    invoiceStatus: invoice?.status ?? null,
    paid: invoice?.paid ?? false,
  });
  return {
    lookupKey: price.lookupKey,
    onPrice: price.lookupKey === expectedLookupKey,
    ...accepted,
  };
}

/**
 * Setup Checkout collected a card for an existing subscription. Attach it as
 * the customer and subscription default, then move that same subscription
 * onto the catalog price. Does not create or cancel a subscription.
 *
 * A voucher stored on the Checkout session is checked again here. It replaces
 * the SA coupon. If that check fails, the band still changes and the notice
 * says the voucher was not used. A paid $0 invoice (100% off) is a completed
 * upgrade: there is no PaymentIntent to confirm.
 */
export async function completeFirmSetupUpgrade(
  session: {
    id?: string;
    mode?: string | null;
    customer?: unknown;
    setup_intent?: unknown;
    metadata?: Record<string, string> | null;
  },
  stripe: StripeLike = getStripe() as unknown as StripeLike,
  options?: FirmSetupUpgradeOptions,
): Promise<{ band: string | null; updated: boolean; notice: string | null } | null> {
  if (session.mode && session.mode !== "setup") return null;
  const intent = readFirmSetupUpgrade(session.metadata ?? null);
  if (!intent) return null;
  const customerId = idOfStripeRef(session.customer);
  if (!customerId) throw new Error("Setup Checkout has no customer.");

  let paymentMethod: string | null = null;
  if (session.setup_intent && typeof session.setup_intent === "object") {
    paymentMethod = idOfStripeRef(
      (session.setup_intent as { payment_method?: unknown }).payment_method,
    );
  }
  const setupIntentId = idOfStripeRef(session.setup_intent);
  if (!paymentMethod && setupIntentId) {
    if (!stripe.setupIntents) throw new Error("Setup Checkout did not collect a payment method.");
    const retrieved = await stripe.setupIntents.retrieve(setupIntentId);
    paymentMethod = idOfStripeRef(retrieved.payment_method);
  }
  if (!paymentMethod) throw new Error("Setup Checkout did not collect a payment method.");
  if (!stripe.customers) throw new Error("Setup Checkout could not save the payment method.");

  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: paymentMethod },
  });

  const sub = await retrieveFirmSubscription(stripe, intent.subscriptionId);
  const priceSnap = readSubscriptionPrice(sub as Parameters<typeof readSubscriptionPrice>[0]);
  const { price, lookupKey } = await resolveFirmCatalogPrice(
    stripe as unknown as Parameters<typeof resolveFirmCatalogPrice>[0],
    intent.band,
    intent.interval,
  );
  if (!priceSnap.itemId) throw new Error("Subscription has no item to update.");

  const firmMarket =
    options && "firmMarket" in options
      ? options.firmMarket
      : await firmMarketForBillingUser(intent.userId);
  const saMarket = isSaMarketFirm({ market: firmMarket });
  const zaCouponId = saMarket ? stripeZaCouponId(process.env.STRIPE_ZA_COUPON_ID) : null;
  const existing = readSubscriptionDiscountRefs(sub);
  const listCents =
    typeof price.unit_amount === "number"
      ? price.unit_amount
      : (firmBandListCents(intent.band, intent.interval) ?? 0);

  let notice: string | null = null;
  let promotionCodeId: string | null = null;
  if (intent.promotionCode || intent.promotionCodeId) {
    const decision = await resolveFirmVoucher(stripe as unknown as FirmVoucherStripe, {
      code: intent.promotionCode,
      promotionCodeId: intent.promotionCodeId,
      firmCustomerId: customerId,
      productId: stripeProductId(price.product),
      listCents,
      interval: intent.interval,
      saMarket,
    });
    if (decision.ok) {
      promotionCodeId = decision.promotionCodeId;
    } else {
      notice = decision.reason === "sa_only" ? decision.message : FIRM_VOUCHER_NOT_APPLIED_MESSAGE;
      console.warn("[stripe] firm voucher not applied", decision.reason);
    }
  }

  const discountsFor = (promo: string | null) =>
    firmUpgradeDiscounts({
      promotionCodeId: promo,
      zaCouponId: promo ? null : zaCouponId,
      existing,
    });

  const already = priceSnap.lookupKey === lookupKey;
  const applyUpdate = async (promo: string | null) => {
    const discounts = discountsFor(promo);
    if (!already) {
      const params = firmSubscriptionUpgradeParams({
        itemId: priceSnap.itemId as string,
        priceId: price.id,
        band: intent.band,
        interval: intent.interval,
        lookupKey,
        metadata: sub.metadata,
        endTrial: sub.status === "trialing",
        current: {
          status: sub.status,
          lookupKey: priceSnap.lookupKey,
          unitAmount: priceSnap.unitAmount,
        },
        discounts,
      });
      return stripe.subscriptions.update(intent.subscriptionId, {
        ...params,
        default_payment_method: paymentMethod,
        expand: ["latest_invoice", "items.data.price"],
      });
    }
    return stripe.subscriptions.update(intent.subscriptionId, {
      default_payment_method: paymentMethod,
      ...(discounts ? { discounts } : {}),
      expand: ["latest_invoice", "items.data.price"],
    });
  };

  const recoverZeroInvoice = async (err: unknown) => {
    const fresh = await stripe.subscriptions.retrieve(intent.subscriptionId, {
      expand: ["latest_invoice", "items.data.price"],
    });
    const landed = updateAcceptance(fresh, lookupKey);
    if (
      landed.zeroInvoice &&
      landed.onPrice &&
      (fresh.status === "active" || fresh.status === "trialing")
    ) {
      return fresh;
    }
    throw err;
  };

  let updated: RetrievedSubscription;
  try {
    updated = await applyUpdate(promotionCodeId);
  } catch (err) {
    if (promotionCodeId && isPromotionCodeStripeError(err)) {
      notice = FIRM_VOUCHER_NOT_APPLIED_MESSAGE;
      console.warn(
        "[stripe] firm voucher rejected at upgrade",
        err instanceof Error ? err.message : err,
      );
      try {
        updated = await applyUpdate(null);
      } catch (retryErr) {
        updated = await recoverZeroInvoice(retryErr);
      }
    } else if (isBenignZeroInvoiceError(err)) {
      updated = await recoverZeroInvoice(err);
    } else {
      throw err;
    }
  }

  const landed = updateAcceptance(updated, lookupKey);
  if (!landed.accepted || (landed.lookupKey && !landed.onPrice)) {
    throw new Error(UPGRADE_FAILED_MESSAGE);
  }

  try {
    const { syncStarterTrialMirrorForActor } = await import("@/lib/firm-client-cap.server");
    await syncStarterTrialMirrorForActor({
      supabase: null,
      userId: intent.userId,
      email: customerEmailOf(session.customer) ?? "",
    });
  } catch (err) {
    console.warn("[starter-trial] mirror sync skipped", err instanceof Error ? err.message : err);
  }
  return { band: intent.band, updated: !already, notice };
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
