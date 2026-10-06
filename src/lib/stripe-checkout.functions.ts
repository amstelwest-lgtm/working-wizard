/**
 * Stripe Checkout + Customer Portal for firm-band billing.
 * Catalog prices are resolved by lookup_key. Spark (owner) stays free.
 *
 * In-app upgrades update the existing subscription or open Checkout.
 * STRIPE_WEBHOOK_SECRET verifies POST /api/stripe/webhook, which syncs milon_plan.
 */

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AuthCtx } from "@/lib/owner-ops.guard";
import { getStripe, stripeConfigured } from "@/lib/stripe.server";
import { eligibleForIntroTrial } from "@/lib/firm-client-cap";
import {
  assertCallerCanUpgradeFirm,
  findEntitlingFirmSubscription,
  loadCallerFirmMarket,
  loadFirmPlanDisplay,
  syncStarterTrialMirrorForActor,
} from "@/lib/firm-client-cap.server";
import {
  isSaMarketFirm,
  readSubscriptionDiscountRefs,
  stripeZaCouponId,
} from "@/lib/firm-sa-market";
import { resolveFirmVoucher } from "@/lib/firm-voucher.server";
import {
  firmBandListCents,
  firmUpgradeDiscounts,
  firmUpgradeResultMessage,
  FIRM_VOUCHER_INVALID_MESSAGE,
  normalizeVoucherCode,
  stripeProductId,
} from "@/lib/firm-voucher";
import {
  FIRM_CHECKOUT_BANDS,
  FOUNDING_PROMO_CODE,
  assertFoundingMonthlyOnly,
  isFirmCheckoutBand,
  isFoundingCode,
  type FirmCheckoutBand,
  type FirmInterval,
  type StripePlanMarket,
} from "@/lib/stripe-plans";
import {
  assertNoManagedPaymentsOverride,
  firmCheckoutSessionParams,
  firmIntegrationIdentifier,
  firmSetupCheckoutSessionParams,
  firmUpgradeCheckoutSessionParams,
  readFirmSetupUpgrade,
  resolveFirmCatalogPrice,
} from "@/lib/stripe-checkout.core";
import {
  assertUpgradeTarget,
  decideFirmUpgradeRoute,
  firmSubscriptionUpgradeParams,
  readSubscriptionPrice,
  subscriptionHasCollectiblePaymentMethod,
  upgradeSuccessMessage,
  UPGRADE_FAILED_MESSAGE,
} from "@/lib/firm-band-upgrade";
import { requestAppOrigin } from "@/lib/app-origin";
import {
  completeFirmSetupUpgrade,
  syncCheckoutSessionSubscription,
} from "@/lib/stripe-billing-sync.server";
import {
  checkoutSessionUnlocksFirm,
  customerHasEntitlingSubscription,
  decideFirmBillingEntitlement,
  emailHasEntitlingSubscription,
  findCustomerIdByEmail as findStripeCustomerIdByEmail,
  type FirmBillingEntitlement,
} from "@/lib/stripe-entitlement";

function appOrigin(): string {
  try {
    return requestAppOrigin(getRequest());
  } catch {
    return requestAppOrigin(null);
  }
}

type BillingAuthCtx = AuthCtx & {
  supabase?: {
    auth: {
      getUser: () => Promise<{ data: { user: { email?: string | null } | null } }>;
    };
    from: (table: string) => {
      select: (columns: string) => {
        eq: (
          column: string,
          value: string,
        ) => {
          limit: (n: number) => Promise<{ data: Array<{ id?: string }> | null }>;
        };
      };
    };
  };
};

async function checkoutActor(context: unknown): Promise<{ userId: string; email: string }> {
  const ctx = context as BillingAuthCtx;
  const userId = ctx.userId;
  let email = (ctx.claims?.email ?? "").trim();
  if (!email && ctx.supabase) {
    const { data } = await ctx.supabase.auth.getUser();
    email = (data.user?.email ?? "").trim();
  }
  return { userId, email };
}

async function findCustomerIdByEmail(email: string): Promise<string | undefined> {
  return findStripeCustomerIdByEmail(getStripe(), email);
}

async function customerHasActiveSubscription(customerId: string): Promise<boolean> {
  return customerHasEntitlingSubscription(getStripe(), customerId);
}

const ENTITLEMENT_CACHE_TTL_MS = 45_000;
const entitlementCache = new Map<string, { value: FirmBillingEntitlement; at: number }>();

function cachedEntitlement(email: string): FirmBillingEntitlement | undefined {
  const key = email.trim().toLowerCase();
  if (!key) return undefined;
  const hit = entitlementCache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > ENTITLEMENT_CACHE_TTL_MS) {
    entitlementCache.delete(key);
    return undefined;
  }
  return hit.value;
}

function forgetEntitlement(email: string): void {
  const key = email.trim().toLowerCase();
  if (key) entitlementCache.delete(key);
}

function rememberEntitlement(email: string, value: FirmBillingEntitlement): void {
  const key = email.trim().toLowerCase();
  if (!key) return;
  if (!value.entitled) {
    entitlementCache.delete(key);
    return;
  }
  entitlementCache.set(key, { value, at: Date.now() });
}

async function countOwnedFirms(
  supabase: BillingAuthCtx["supabase"],
  userId: string,
): Promise<number> {
  if (!supabase) return 0;
  const { data } = await supabase.from("firms").select("id").eq("owner_user_id", userId).limit(1);
  return data?.length ?? 0;
}

async function countFirmMemberships(
  supabase: BillingAuthCtx["supabase"],
  userId: string,
): Promise<number> {
  if (!supabase) return 0;
  const { data } = await supabase
    .from("firm_memberships")
    .select("id")
    .eq("user_id", userId)
    .limit(1);
  return data?.length ?? 0;
}

async function resolveFirmBillingEntitlement(
  context: unknown,
  refresh: boolean,
): Promise<FirmBillingEntitlement> {
  if (!stripeConfigured()) {
    return { entitled: true, reason: "stripe_unconfigured" };
  }
  const ctx = context as BillingAuthCtx;
  const { userId, email } = await checkoutActor(ctx);
  if (!refresh) {
    const cached = cachedEntitlement(email);
    if (cached) return cached;
  }
  try {
    const [hasEntitlingSubscription, owned, memberships] = await Promise.all([
      emailHasEntitlingSubscription(getStripe(), email),
      countOwnedFirms(ctx.supabase, userId),
      countFirmMemberships(ctx.supabase, userId),
    ]);
    const result = decideFirmBillingEntitlement({
      stripeConfigured: true,
      hasEntitlingSubscription,
      ownsFirm: owned > 0,
      isFirmMember: memberships > 0,
    });
    rememberEntitlement(email, result);
    await syncStarterTrialMirrorForActor({ supabase: ctx.supabase, userId, email });
    return result;
  } catch (err) {
    console.warn(
      "[stripe-entitlement] live check failed",
      err instanceof Error ? err.message : err,
    );
    return { entitled: false, reason: "stripe_error" };
  }
}

async function resolveFoundingPromotionCodeId(promo?: string | null): Promise<string | undefined> {
  if (!isFoundingCode(promo)) return undefined;
  const listed = await getStripe().promotionCodes.list({
    code: FOUNDING_PROMO_CODE,
    active: true,
    limit: 1,
  });
  const id = listed.data[0]?.id;
  if (!id) {
    throw new Error("FOUNDING promotion is not available on this Stripe account.");
  }
  return id;
}

async function createPortalUrl(customerId: string, origin: string): Promise<string> {
  const session = await getStripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: `${origin.replace(/\/$/, "")}/dashboard`,
  });
  if (!session.url) {
    throw new Error("Stripe Customer Portal did not return a URL.");
  }
  return session.url;
}

function zaCouponIdForMarket(market: unknown): string | null {
  if (!isSaMarketFirm({ market })) return null;
  return stripeZaCouponId(process.env.STRIPE_ZA_COUPON_ID);
}

async function createPaidCheckoutSession(input: {
  userId: string;
  email: string;
  plan: FirmCheckoutBand;
  interval: FirmInterval;
  market: StripePlanMarket;
  promo?: string | null;
  /** From the firm row. Never the client market flag. */
  zaCouponId?: string | null;
}): Promise<{ url: string; kind: "checkout" | "portal" }> {
  if (!stripeConfigured()) {
    throw new Error("STRIPE_SECRET_KEY is not set on this deploy.");
  }

  assertFoundingMonthlyOnly(input.interval, input.promo);

  const stripe = getStripe();
  const origin = appOrigin();
  const customerId = await findCustomerIdByEmail(input.email);

  if (customerId && (await customerHasActiveSubscription(customerId))) {
    return { url: await createPortalUrl(customerId, origin), kind: "portal" };
  }

  let includeTrial = true;
  if (customerId) {
    const prior = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 20,
    });
    const needsPaymentOnExisting = prior.data.some(
      (sub) =>
        sub.status === "past_due" ||
        sub.status === "unpaid" ||
        sub.status === "incomplete" ||
        sub.status === "paused",
    );
    if (needsPaymentOnExisting) {
      return { url: await createPortalUrl(customerId, origin), kind: "portal" };
    }
    includeTrial = eligibleForIntroTrial(prior.data.length);
  }

  const { price, lookupKey } = await resolveFirmCatalogPrice(stripe, input.plan, input.interval);
  const promotionCodeId = await resolveFoundingPromotionCodeId(input.promo);

  const params = firmCheckoutSessionParams({
    priceId: price.id,
    lookupKey,
    band: input.plan,
    interval: input.interval,
    origin,
    userId: input.userId,
    email: input.email,
    customerId,
    market: input.market,
    promotionCodeId,
    zaCouponId: input.zaCouponId,
    integrationIdentifier: firmIntegrationIdentifier(input.plan, input.interval),
    includeTrial,
  });
  assertNoManagedPaymentsOverride(params);

  const session = await stripe.checkout.sessions.create(params);
  if (!session.url) {
    throw new Error("Stripe Checkout did not return a URL.");
  }
  return { url: session.url, kind: "checkout" };
}

const checkoutInput = z.object({
  plan: z.enum(FIRM_CHECKOUT_BANDS),
  interval: z.enum(["month", "year"]).default("month"),
  market: z.enum(["za", "us"]).default("us"),
  promo: z.string().trim().max(40).optional(),
});

/** Signed-in Checkout for a firm band. Owner Spark is not a valid plan. */
export const createStripeCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => checkoutInput.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as BillingAuthCtx;
    const { userId, email } = await checkoutActor(ctx);
    const firmMarket = await loadCallerFirmMarket({ supabase: ctx.supabase, userId });
    return createPaidCheckoutSession({
      userId,
      email,
      plan: data.plan as FirmCheckoutBand,
      interval: data.interval as FirmInterval,
      market: data.market as StripePlanMarket,
      promo: data.promo,
      zaCouponId: zaCouponIdForMarket(firmMarket),
    });
  });

/** Alias kept for the Lighthouse test button. Same signed-in Checkout path. */
export const createOwnerStripeCheckout = createStripeCheckout;

export const createBillingPortalSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (!stripeConfigured()) {
      throw new Error("STRIPE_SECRET_KEY is not set on this deploy.");
    }
    const { email } = await checkoutActor(context);
    const customerId = await findCustomerIdByEmail(email);
    if (!customerId) {
      throw new Error("No Stripe customer yet. Start a firm plan from pricing first.");
    }
    return { url: await createPortalUrl(customerId, appOrigin()) };
  });

export const getCheckoutSessionStatus = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ sessionId: z.string().regex(/^cs_[a-zA-Z0-9_]+/) }).parse(input),
  )
  .handler(async ({ data }) => {
    if (!stripeConfigured()) {
      return { ok: false as const, reason: "not_configured" };
    }
    const session = await getStripe().checkout.sessions.retrieve(data.sessionId);
    return {
      ok: true as const,
      status: session.status,
      paymentStatus: session.payment_status,
    };
  });

/**
 * End a trialing firm subscription now so the card on file is billed and the
 * paid band's client limit applies. Owner email only — staff cannot charge it.
 */
export const endFirmTrialNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (!stripeConfigured()) {
      throw new Error("STRIPE_SECRET_KEY is not set on this deploy.");
    }
    const { email } = await checkoutActor(context);
    const sub = await findEntitlingFirmSubscription(email);
    if (!sub || sub.phase !== "trialing") {
      throw new Error(
        "No trial subscription to upgrade. Open Manage billing if the paid plan is already active.",
      );
    }
    await getStripe().subscriptions.update(sub.id, {
      trial_end: "now",
      payment_behavior: "error_if_incomplete",
    });
    forgetEntitlement(email);
    return { ok: true as const };
  });

/**
 * Read-only plan and trial line for practice Settings.
 * Uses the same subscription lookup as the billing gate. Does not create Stripe objects.
 */
export const getFirmPlanDisplay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ firmId: z.string().uuid().nullable().optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as BillingAuthCtx;
    const { userId, email } = await checkoutActor(ctx);
    return loadFirmPlanDisplay({
      supabase: ctx.supabase,
      userId,
      email,
      firmId: data.firmId ?? null,
    });
  });

async function paymentMethodOnFile(
  customerId: string,
  subscription: {
    hasDefaultPaymentMethod: boolean;
  },
): Promise<boolean> {
  if (subscription.hasDefaultPaymentMethod) return true;
  const stripe = getStripe();
  const customer = await stripe.customers.retrieve(customerId);
  if (customer.deleted) return false;
  const listed = await stripe.paymentMethods.list({ customer: customerId, limit: 1 });
  return subscriptionHasCollectiblePaymentMethod({
    subscriptionPaymentMethod: null,
    subscriptionSource: null,
    customerPaymentMethod: customer.invoice_settings?.default_payment_method,
    customerSource: customer.default_source,
    attachedPaymentMethodCount: listed.data.length,
  });
}

/**
 * Check a voucher before Checkout. Does not redeem it and does not change the firm.
 * Invalid codes return an inline message. A Stripe outage is thrown so the
 * caller can ask them to retry instead of treating a good code as bad.
 */
export const validateFirmVoucher = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        firmId: z.string().uuid(),
        band: z.enum(FIRM_CHECKOUT_BANDS),
        interval: z.enum(["month", "year"]).default("month"),
        code: z.string().trim().min(1).max(40),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    if (!stripeConfigured()) {
      throw new Error("STRIPE_SECRET_KEY is not set on this deploy.");
    }
    const ctx = context as unknown as BillingAuthCtx;
    const { userId, email } = await checkoutActor(ctx);
    const { billingEmail } = await assertCallerCanUpgradeFirm({
      supabase: ctx.supabase,
      userId,
      email,
      firmId: data.firmId,
    });
    const code = normalizeVoucherCode(data.code);
    if (!code) return { ok: false as const, message: FIRM_VOUCHER_INVALID_MESSAGE };
    const stripe = getStripe();
    const band = data.band as FirmCheckoutBand;
    const interval = data.interval as FirmInterval;
    const { price } = await resolveFirmCatalogPrice(stripe, band, interval);
    const listCents =
      typeof price.unit_amount === "number"
        ? price.unit_amount
        : (firmBandListCents(band, interval) ?? 0);
    const sub = await findEntitlingFirmSubscription(billingEmail);
    const firmCustomerId = sub?.customerId ?? (await findCustomerIdByEmail(billingEmail)) ?? null;
    const voucher = await resolveFirmVoucher(stripe, {
      code,
      firmCustomerId,
      productId: stripeProductId(price.product),
      listCents,
      interval,
    });
    if (!voucher.ok) {
      if (voucher.reason === "unavailable") throw new Error(voucher.message);
      return { ok: false as const, message: FIRM_VOUCHER_INVALID_MESSAGE };
    }
    return {
      ok: true as const,
      promotionCodeId: voucher.promotionCodeId,
      preview: voucher.preview,
    };
  });

/**
 * Move an existing firm onto a larger band that covers the current clients.
 * An existing subscription is updated in place. A subscription with no card
 * (a $0 Starter) opens Checkout in setup mode, then that same subscription
 * is updated once the card is saved. A new subscription Checkout is only
 * used when there is no entitling subscription, and that path still cancels
 * the subscription it replaces. Owner or firm admin only.
 */
export const upgradeFirmBand = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        firmId: z.string().uuid(),
        band: z.enum(FIRM_CHECKOUT_BANDS),
        interval: z.enum(["month", "year"]).default("month"),
        voucherCode: z.string().trim().max(40).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    if (!stripeConfigured()) {
      throw new Error("STRIPE_SECRET_KEY is not set on this deploy.");
    }
    const ctx = context as unknown as BillingAuthCtx;
    const { userId, email } = await checkoutActor(ctx);
    const {
      billingEmail,
      clientCount,
      market: firmMarket,
    } = await assertCallerCanUpgradeFirm({
      supabase: ctx.supabase,
      userId,
      email,
      firmId: data.firmId,
    });
    const zaCouponId = zaCouponIdForMarket(firmMarket);
    const band = data.band as FirmCheckoutBand;
    const interval = data.interval as FirmInterval;
    const sub = await findEntitlingFirmSubscription(billingEmail);
    assertUpgradeTarget({
      phase: sub?.phase ?? "none",
      current: sub?.band ?? null,
      target: band,
      clientCount,
    });

    const stripe = getStripe();
    const { price, lookupKey } = await resolveFirmCatalogPrice(stripe, band, interval);
    const voucherCode = normalizeVoucherCode(data.voucherCode);
    if (data.voucherCode?.trim() && !voucherCode) {
      throw new Error(FIRM_VOUCHER_INVALID_MESSAGE);
    }
    const listCents =
      typeof price.unit_amount === "number"
        ? price.unit_amount
        : (firmBandListCents(band, interval) ?? 0);
    let voucherPromotionCodeId: string | null = null;
    let voucherPreview: string | null = null;
    if (voucherCode) {
      const firmCustomerId = sub?.customerId ?? (await findCustomerIdByEmail(billingEmail)) ?? null;
      const voucher = await resolveFirmVoucher(stripe, {
        code: voucherCode,
        firmCustomerId,
        productId: stripeProductId(price.product),
        listCents,
        interval,
      });
      if (!voucher.ok) {
        throw new Error(
          voucher.reason === "unavailable" ? voucher.message : FIRM_VOUCHER_INVALID_MESSAGE,
        );
      }
      voucherPromotionCodeId = voucher.promotionCodeId;
      voucherPreview = voucher.preview;
    }
    const hasPaymentMethod = sub ? await paymentMethodOnFile(sub.customerId, sub) : false;
    const route = decideFirmUpgradeRoute({
      hasEntitlingSubscription: Boolean(sub),
      hasPaymentMethod,
    });

    let itemId = sub?.itemId ?? null;
    let existingDiscounts = sub?.discounts ?? [];
    if (
      route === "update_subscription" &&
      sub &&
      (zaCouponId || voucherPromotionCodeId || !itemId)
    ) {
      const fresh = await stripe.subscriptions.retrieve(sub.id, {
        expand: ["items.data.price"],
      });
      if (!itemId) itemId = readSubscriptionPrice(fresh).itemId;
      if (zaCouponId) existingDiscounts = readSubscriptionDiscountRefs(fresh);
    }

    if (route === "update_subscription" && sub && itemId) {
      const params = firmSubscriptionUpgradeParams({
        itemId,
        priceId: price.id,
        band,
        interval,
        lookupKey,
        metadata: sub.metadata,
        endTrial: sub.phase === "trialing",
        current: {
          status: sub.phase,
          lookupKey: sub.lookupKey,
          unitAmount: sub.unitAmount,
        },
        discounts: firmUpgradeDiscounts({
          promotionCodeId: voucherPromotionCodeId,
          zaCouponId: voucherPromotionCodeId ? null : zaCouponId,
          existing: existingDiscounts,
        }),
      });
      try {
        await stripe.subscriptions.update(sub.id, params);
      } catch (err) {
        const message = err instanceof Error ? err.message : UPGRADE_FAILED_MESSAGE;
        throw new Error(message || UPGRADE_FAILED_MESSAGE);
      }
      forgetEntitlement(billingEmail);
      forgetEntitlement(email);
      return {
        kind: "updated" as const,
        band,
        message: upgradeSuccessMessage(band),
      };
    }

    const origin = appOrigin();
    if (route === "setup_checkout" && sub) {
      const params = firmSetupCheckoutSessionParams({
        origin,
        customerId: sub.customerId,
        userId,
        subscriptionId: sub.id,
        lookupKey,
        band,
        interval,
        price,
        saMarket: isSaMarketFirm({ market: firmMarket }) && !voucherPromotionCodeId,
        promotionCodeId: voucherPromotionCodeId,
        promotionCode: voucherPromotionCodeId ? voucherCode : null,
        voucherPreview,
      });
      assertNoManagedPaymentsOverride(params);
      let session: { url: string | null };
      try {
        session = await stripe.checkout.sessions.create(params);
      } catch (err) {
        const message = err instanceof Error ? err.message : UPGRADE_FAILED_MESSAGE;
        throw new Error(message || UPGRADE_FAILED_MESSAGE);
      }
      if (!session.url) throw new Error("Stripe Checkout did not return a URL.");
      return { kind: "checkout" as const, url: session.url };
    }

    if (route !== "checkout") {
      throw new Error(UPGRADE_FAILED_MESSAGE);
    }

    const customerId = await findCustomerIdByEmail(billingEmail);
    let replacesSubscriptionId: string | undefined;
    if (customerId) {
      try {
        const listed = await stripe.subscriptions.list({
          customer: customerId,
          status: "all",
          limit: 20,
        });
        replacesSubscriptionId = listed.data.find(
          (row) => row.status !== "canceled" && row.status !== "incomplete_expired",
        )?.id;
      } catch (err) {
        console.warn(
          "[stripe] could not list subscriptions to replace",
          err instanceof Error ? err.message : err,
        );
      }
    }
    const checkoutMarket: StripePlanMarket = zaCouponId ? "za" : "us";
    const params = firmUpgradeCheckoutSessionParams({
      priceId: price.id,
      lookupKey,
      band,
      interval,
      origin,
      userId,
      email: billingEmail,
      customerId,
      market: checkoutMarket,
      integrationIdentifier: firmIntegrationIdentifier(band, interval),
      includeTrial: false,
      replacesSubscriptionId,
      promotionCodeId: voucherPromotionCodeId,
      zaCouponId: voucherPromotionCodeId ? null : zaCouponId,
    });
    assertNoManagedPaymentsOverride(params);
    let session: { url: string | null };
    try {
      session = await stripe.checkout.sessions.create(params);
    } catch (err) {
      const message = err instanceof Error ? err.message : UPGRADE_FAILED_MESSAGE;
      throw new Error(message || UPGRADE_FAILED_MESSAGE);
    }
    if (!session.url) throw new Error("Stripe Checkout did not return a URL.");
    return { kind: "checkout" as const, url: session.url };
  });

/**
 * After Checkout returns to the dashboard, align milon_plan with the price
 * and cancel the replaced subscription so the client cap sees the new band.
 */
export const finalizeFirmBandCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ sessionId: z.string().regex(/^cs_[a-zA-Z0-9_]+/) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    if (!stripeConfigured()) {
      return { ok: false as const, message: UPGRADE_FAILED_MESSAGE };
    }
    const { userId, email } = await checkoutActor(context);
    const session = await getStripe().checkout.sessions.retrieve(data.sessionId, {
      expand: ["setup_intent"],
    });
    const ownerId = session.client_reference_id || session.metadata?.milon_user_id || "";
    if (ownerId && ownerId !== userId) {
      throw new Error("This checkout session belongs to a different account.");
    }
    if (
      !checkoutSessionUnlocksFirm({ status: session.status, paymentStatus: session.payment_status })
    ) {
      return { ok: false as const, message: UPGRADE_FAILED_MESSAGE };
    }
    if (readFirmSetupUpgrade(session.metadata)) {
      const applied = await completeFirmSetupUpgrade(session);
      forgetEntitlement(email);
      const band = applied?.band ?? null;
      const base =
        band && isFirmCheckoutBand(band)
          ? upgradeSuccessMessage(band)
          : "Plan updated. You can add another client.";
      const message = firmUpgradeResultMessage(base, applied?.notice);
      return { ok: true as const, message, band, notice: applied?.notice ?? null };
    }
    const synced = await syncCheckoutSessionSubscription({
      mode: session.mode,
      subscription:
        typeof session.subscription === "string" ? session.subscription : session.subscription?.id,
      metadata: session.metadata ?? undefined,
    });
    forgetEntitlement(email);
    const band = synced?.band ?? null;
    const message =
      band && isFirmCheckoutBand(band)
        ? upgradeSuccessMessage(band)
        : "Plan updated. You can add another client.";
    return { ok: true as const, message, band };
  });

/** Live Stripe entitlement for the accountant firm shell. */
export const getFirmBillingEntitlement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ refresh: z.boolean().optional() }).parse(input ?? {}))
  .handler(async ({ data, context }) => {
    return resolveFirmBillingEntitlement(context, Boolean(data?.refresh));
  });
