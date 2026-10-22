/**
 * Stripe Checkout + Customer Portal for firm-band billing.
 * Catalog prices are resolved by lookup_key. Spark (owner) stays free.
 *
 * In-app upgrades update the existing subscription or open Checkout.
 * STRIPE_WEBHOOK_SECRET verifies POST /api/stripe/webhook, which syncs milon_plan.
 */

import { waitUntil } from "@vercel/functions";
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
  readFirmSubscriptionHistory,
  syncStarterTrialMirrorForActor,
} from "@/lib/firm-client-cap.server";
import { readSubscriptionDiscountRefs } from "@/lib/stripe-discount";
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
  installMetadataFirmCustomerWrite,
  readFirmStripeCustomerId,
  writeFirmStripeCustomerId,
} from "@/lib/firm-stripe-customer.server";
import {
  assertNoManagedPaymentsOverride,
  firmCheckoutCharge,
  firmCheckoutSessionParams,
  firmIntegrationIdentifier,
  firmSetupCheckoutSessionParams,
  firmStartTrialCheckout,
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
import { readStripeCustomerCountry } from "@/lib/pricing/za-checkout";
import {
  completeFirmSetupUpgrade,
  enforceZaCheckoutBillingCountry,
  loadFirmClientMarkets,
  syncCheckoutSessionSubscription,
} from "@/lib/stripe-billing-sync.server";
import {
  classifyBillingCheckFailure,
  entitlementWhenBillingCheckFails,
  restoreLastFirmSuccess,
  FIRM_BILLING_ENTITLEMENT_SERVER_FN,
} from "@/lib/billing-check-failure";
import { readFirmBillingPlanKnown, writeFirmBillingPlanKnown } from "@/lib/firm-billing-plan.server";
import {
  entitlementFromStoredPlan,
  firmBillingStripeRefreshDue,
  noteFirmBillingStripeRefresh,
  readStoredFirmOpenFacts,
  type FirmBillingOpenResult,
} from "@/lib/firm-billing-open.server";
import {
  checkoutSessionUnlocksFirm,
  customerHasEntitlingSubscription,
  decideFirmBillingEntitlement,
  findFirmCustomerId,
  type FirmBillingEntitlement,
} from "@/lib/stripe-entitlement";

installMetadataFirmCustomerWrite();

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
          limit: (n: number) => Promise<{
            data: Array<{ id?: string; owner_user_id?: string | null }> | null;
          }>;
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

async function findBillingCustomerId(input: {
  email: string;
  userId?: string | null;
  firmId?: string | null;
}): Promise<string | undefined> {
  const storedCustomerId = input.firmId ? await readFirmStripeCustomerId(input.firmId) : null;
  return findFirmCustomerId(getStripe(), { ...input, storedCustomerId });
}

async function customerHasActiveSubscription(customerId: string): Promise<boolean> {
  return customerHasEntitlingSubscription(getStripe(), customerId);
}

const ENTITLEMENT_CACHE_TTL_MS = 60_000;
const NEGATIVE_ENTITLEMENT_TTL_MS = 5_000;
const entitlementCache = new Map<string, { value: FirmBillingOpenResult; at: number; ttl: number }>();
const entitlementInflight = new Map<string, Promise<FirmBillingEntitlement>>();
type EntitlementLastSuccess = {
  userId: string;
  email: string;
  firmId: string | null;
  value: FirmBillingEntitlement;
};
/** Survives the fresh TTL. A later Stripe failure can still return it. */
const lastSuccessByEmail = new Map<string, EntitlementLastSuccess>();
const lastSuccessByFirm = new Map<string, EntitlementLastSuccess>();
const PLAN_DISPLAY_CACHE_TTL_MS = 60_000;
const planDisplayCache = new Map<
  string,
  { at: number; value: Awaited<ReturnType<typeof loadFirmPlanDisplay>> }
>();
const planDisplayInflight = new Map<
  string,
  Promise<Awaited<ReturnType<typeof loadFirmPlanDisplay>>>
>();

function cachedEntitlement(email: string): FirmBillingOpenResult | undefined {
  const key = email.trim().toLowerCase();
  if (!key) return undefined;
  const hit = entitlementCache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > hit.ttl) {
    entitlementCache.delete(key);
    return undefined;
  }
  return hit.value;
}

function forgetEntitlement(email: string): void {
  const key = email.trim().toLowerCase();
  if (!key) return;
  entitlementCache.delete(key);
  lastSuccessByEmail.delete(key);
  for (const [id, record] of lastSuccessByFirm) {
    if (record.email === key) lastSuccessByFirm.delete(id);
  }
}

function forgetPlanDisplayCache(): void {
  planDisplayCache.clear();
}

function rememberLastSuccess(
  userId: string,
  email: string,
  firmId: string | null,
  value: FirmBillingEntitlement,
): void {
  if (value.reason === "stripe_error" || value.checkFailed) return;
  const key = email.trim().toLowerCase();
  const record: EntitlementLastSuccess = {
    userId,
    email: key,
    firmId,
    value: {
      entitled: value.entitled,
      reason: value.reason,
      introTrialEligible: value.introTrialEligible,
    },
  };
  if (key) lastSuccessByEmail.set(key, record);
  if (userId && firmId) lastSuccessByFirm.set(`${userId}:${firmId}`, record);
}

function lookupLastFirmEntitlement(
  userId: string,
  email: string,
  firmId: string | null,
): FirmBillingEntitlement | null {
  if (userId && firmId) {
    const exact = lastSuccessByFirm.get(`${userId}:${firmId}`);
    if (exact) {
      return restoreLastFirmSuccess({
        requestedFirmId: firmId,
        storedFirmId: exact.firmId,
        prior: exact.value,
      });
    }
  }
  const key = email.trim().toLowerCase();
  const byEmail = key ? lastSuccessByEmail.get(key) : undefined;
  if (!byEmail || byEmail.userId !== userId) return null;
  return restoreLastFirmSuccess({
    requestedFirmId: firmId,
    storedFirmId: byEmail.firmId,
    prior: byEmail.value,
  });
}

function rememberEntitlement(
  email: string,
  value: FirmBillingOpenResult,
  userId = "",
  firmId: string | null = null,
): void {
  const key = email.trim().toLowerCase();
  if (!key || value.reason === "stripe_error" || value.checkFailed) return;
  // A paid result can sit for a minute. An unpaid result must not: a firm
  // that just added a card was bounced until the old 60s entry expired.
  const ttl = value.entitled ? ENTITLEMENT_CACHE_TTL_MS : NEGATIVE_ENTITLEMENT_TTL_MS;
  entitlementCache.set(key, { value, at: Date.now(), ttl });
  rememberLastSuccess(userId, email, firmId, value);
}

async function countOwnedFirms(
  supabase: BillingAuthCtx["supabase"],
  userId: string,
): Promise<number> {
  if (!supabase) return 0;
  const { data } = await supabase.from("firms").select("id").eq("owner_user_id", userId).limit(1);
  return data?.length ?? 0;
}

async function callerOwnedFirmId(
  supabase: BillingAuthCtx["supabase"],
  userId: string,
): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.from("firms").select("id").eq("owner_user_id", userId).limit(1);
  const id = data?.[0]?.id;
  return typeof id === "string" && id ? id : null;
}

/**
 * Firm id and the Stripe user id for this actor.
 * A client-sent firm id is kept only when this signed-in user's row can read
 * that firm. The Stripe user id is the owner on that row, not the request body.
 * A firm the user cannot read is dropped.
 */
async function firmBillingIdsForActor(
  supabase: BillingAuthCtx["supabase"],
  userId: string,
  requestedFirmId: string | null,
): Promise<{ firmId: string | null; ownerUserId: string }> {
  if (!supabase) return { firmId: null, ownerUserId: userId };
  const requested = requestedFirmId?.trim() ?? "";
  if (requested) {
    const { data } = await supabase.from("firms").select("id, owner_user_id").eq("id", requested).limit(1);
    const row = data?.[0];
    if (!row?.id) return { firmId: null, ownerUserId: userId };
    const owner =
      typeof row.owner_user_id === "string" && row.owner_user_id.trim()
        ? row.owner_user_id.trim()
        : userId;
    return { firmId: String(row.id), ownerUserId: owner };
  }
  const owned = await callerOwnedFirmId(supabase, userId);
  return { firmId: owned, ownerUserId: userId };
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

/** A finished check only. A timeout must not write "none". */
function rememberConfirmedFirmPlan(
  firmId: string | null,
  result: FirmBillingEntitlement,
): void {
  if (!firmId || result.checkFailed || result.reason === "stripe_error") return;
  if (result.reason === "active_subscription") {
    void writeFirmBillingPlanKnown(firmId, "entitled");
    return;
  }
  if (result.reason === "no_active_subscription") {
    void writeFirmBillingPlanKnown(firmId, "none");
  }
}

function storedPlanValue(value: unknown): "entitled" | "none" | null {
  if (value === "entitled" || value === "none") return value;
  return null;
}

/**
 * The caller's firm row, when this client can read billing_plan_known.
 * A miss falls through to the service-role read. Tests pass the fixture
 * rows on this client instead of replacing the plan reader.
 */
async function readStoredPlanFromClient(
  supabase: BillingAuthCtx["supabase"],
  firmId: string | null,
): Promise<"entitled" | "none" | null> {
  const id = firmId?.trim() ?? "";
  if (!id || !supabase) return null;
  try {
    const query = supabase.from("firms").select("billing_plan_known").eq("id", id) as {
      maybeSingle?: () => Promise<{
        data: { billing_plan_known?: unknown } | null;
        error: { message?: string } | null;
      }>;
    };
    if (!query.maybeSingle) return null;
    const { data, error } = await query.maybeSingle();
    if (error) return null;
    return storedPlanValue(data?.billing_plan_known);
  } catch {
    return null;
  }
}

export async function resolveFirmBillingEntitlement(
  context: unknown,
  refresh: boolean,
  firmId: string | null = null,
): Promise<FirmBillingOpenResult> {
  if (!stripeConfigured()) {
    return { entitled: true, reason: "stripe_unconfigured" };
  }
  const ctx = context as BillingAuthCtx;
  const { userId, email } = await checkoutActor(ctx);
  const key = email.trim().toLowerCase();
  if (!refresh && key) {
    const cached = cachedEntitlement(email);
    if (cached) return cached;
    const pending = entitlementInflight.get(key);
    if (pending) return pending;
  }
  const work = (async (): Promise<FirmBillingEntitlement> => {
    const billingIds = await firmBillingIdsForActor(ctx.supabase, userId, firmId);
    const actorPlan = await readStoredPlanFromClient(ctx.supabase, billingIds.firmId);
    const storedPlan = actorPlan ?? (await readFirmBillingPlanKnown(billingIds.firmId));
    const firmKey = billingIds.firmId;
    // A stored plan answers the open. Creating `live` starts Stripe immediately,
    // so this return stays above that function. Checkout and the webhook still
    // refresh, and a stamp older than the window may refresh once.
    if (
      !refresh &&
      storedPlan &&
      firmKey &&
      !firmBillingStripeRefreshDue(firmKey)
    ) {
      noteFirmBillingStripeRefresh(firmKey);
      const facts = await readStoredFirmOpenFacts(ctx.supabase, firmKey);
      const stored = entitlementFromStoredPlan(storedPlan, facts);
      rememberEntitlement(email, stored, userId, firmKey);
      console.warn(`[stripe-entitlement] stored plan ${storedPlan} firm=${firmKey}`);
      return stored;
    }
    const refreshStored = !refresh && Boolean(storedPlan && firmKey && firmBillingStripeRefreshDue(firmKey));
    if (refreshStored && firmKey) noteFirmBillingStripeRefresh(firmKey);
    const live = (async (): Promise<FirmBillingOpenResult> => {
    try {
      // One isolate-cached Stripe list. The mirror below reads that same
      // entry. It must not be awaited: a second scan used to sit on the response.
      const [history, owned, memberships] = await Promise.all([
        readFirmSubscriptionHistory(email, {
          fresh: refresh,
          userId: billingIds.ownerUserId,
          firmId: billingIds.firmId,
        }),
        countOwnedFirms(ctx.supabase, userId),
        countFirmMemberships(ctx.supabase, userId),
      ]);
      const result: FirmBillingEntitlement = {
        ...decideFirmBillingEntitlement({
          stripeConfigured: true,
          hasEntitlingSubscription: history.entitling != null,
          ownsFirm: owned > 0,
          isFirmMember: memberships > 0,
        }),
        introTrialEligible: eligibleForIntroTrial(history.priorSubscriptionCount),
      };
      rememberEntitlement(email, result, userId, billingIds.firmId);
      rememberConfirmedFirmPlan(billingIds.firmId, result);
      const mirror = syncStarterTrialMirrorForActor({ supabase: ctx.supabase, userId, email }).catch((err) => {
        console.warn(
          "[stripe-entitlement] trial mirror sync failed",
          err instanceof Error ? err.message : err,
        );
      });
      // waitUntil keeps the mirror alive after the response. The 3s race
      // stops a hung Stripe scan from holding the isolate open.
      const bounded = Promise.race([
        mirror,
        new Promise<void>((resolve) => {
          setTimeout(resolve, 3_000);
        }),
      ]);
      try {
        waitUntil(bounded);
      } catch (err) {
        console.warn(
          "[stripe-entitlement] waitUntil unavailable",
          err instanceof Error ? err.message : err,
        );
        void bounded;
      }
      return result;
    } catch (err) {
      const kind = classifyBillingCheckFailure(err);
      // Stripe's client times out at 8s and retries once, so one list can
      // outlive the shell's 8s gate. dub1 calling the US Stripe API is the
      // usual timeout. A 5xx is Stripe or this server function itself.
      console.warn("[stripe-entitlement] live check failed", {
        kind,
        serverFn: FIRM_BILLING_ENTITLEMENT_SERVER_FN,
        message: err instanceof Error ? err.message : err,
      });
      // Unknown is not unpaid. Caching this as entitled:false sent the shell
      // to the trial card. A previous success for this user and firm stays.
      return entitlementWhenBillingCheckFails({
        storedPlan,
        prior: lookupLastFirmEntitlement(userId, email, billingIds.firmId),
        kind,
      });
    }
    })();
    const reported = live.then((result) => {
      if (refresh && !result.checkFailed) {
        const outcome = result.entitled ? "entitled" : "none";
        console.warn(
          `[stripe-entitlement] refresh firm=${billingIds.firmId ?? ""} result=${outcome}`,
        );
      }
      return result;
    });
    // Open already returned above when the stored plan is inside the window.
    // A due stamp awaits one refresh. Checkout (`refresh`) still returns the
    // stored entitled plan and lets the list finish behind the response.
    // /billing/required calls refresh: true. The log above is the success line.
    if (refreshStored || storedPlan !== "entitled") return reported;
    console.warn(`[stripe-entitlement] stored plan entitled firm=${billingIds.firmId ?? ""}`);
    // A known entitled plan is the answer. The Stripe list refreshes behind
    // it. waitUntil is a no-op in api/server.js, so this must not be awaited,
    // and a rejection must not escape the request.
    void reported.catch((err) => {
      console.warn(
        "[stripe-entitlement] stored-plan refresh failed",
        err instanceof Error ? err.message : err,
      );
    });
    const stored: FirmBillingEntitlement = {
      entitled: true,
      reason: "active_subscription",
    };
    rememberEntitlement(email, stored, userId, billingIds.firmId);
    return stored;
  })();
  if (key) {
    entitlementInflight.set(key, work);
    void work.finally(() => {
      if (entitlementInflight.get(key) === work) entitlementInflight.delete(key);
    });
  }
  return work;
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

async function createPaidCheckoutSession(input: {
  userId: string;
  email: string;
  plan: FirmCheckoutBand;
  interval: FirmInterval;
  /** URL / client request. Ignored when a firm row exists. */
  requested: StripePlanMarket;
  /** Raw firms.market. Null when this user has no firm yet. */
  firmMarket: unknown;
  promo?: string | null;
  firmId?: string | null;
  /** Client market JSON. The practice helper uses this for the ZAR price. */
  clientMarkets?: readonly unknown[] | null;
}): Promise<{ url: string; kind: "checkout" | "portal" }> {
  if (!stripeConfigured()) {
    throw new Error("STRIPE_SECRET_KEY is not set on this deploy.");
  }

  assertFoundingMonthlyOnly(input.interval, input.promo);

  const stripe = getStripe();
  const origin = appOrigin();
  const customerId = await findBillingCustomerId({
    email: input.email,
    userId: input.userId,
    firmId: input.firmId,
  });
  if (input.firmId && customerId) {
    await writeFirmStripeCustomerId(input.firmId, customerId);
  }

  let priorSubscriptionCount = 0;
  let needsPaymentOnExisting = false;
  let hasEntitlingSubscription = false;
  if (customerId) {
    hasEntitlingSubscription = await customerHasActiveSubscription(customerId);
    if (!hasEntitlingSubscription) {
      const prior = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 20,
      });
      priorSubscriptionCount = prior.data.length;
      needsPaymentOnExisting = prior.data.some(
        (sub) =>
          sub.status === "past_due" ||
          sub.status === "unpaid" ||
          sub.status === "incomplete" ||
          sub.status === "paused",
      );
    }
  }
  const action = firmStartTrialCheckout({
    customerId,
    priorSubscriptionCount,
    hasEntitlingSubscription,
    needsPaymentOnExisting,
  });
  if (action.kind === "portal") {
    return { url: await createPortalUrl(action.customerId, origin), kind: "portal" };
  }

  const billingCountry = await readStripeCustomerCountry(stripe, customerId);
  const charge = firmCheckoutCharge({
    firmMarket: input.firmMarket,
    clientMarkets: input.clientMarkets,
    requested: input.requested,
    billingCountry,
    band: input.plan,
    interval: input.interval,
  });
  const { price, lookupKey } = await resolveFirmCatalogPrice(
    stripe,
    input.plan,
    input.interval,
    charge.priceMarket,
  );
  const promotionCodeId =
    charge.priceMarket === "za" ? undefined : await resolveFoundingPromotionCodeId(input.promo);

  const params = firmCheckoutSessionParams({
    priceId: price.id,
    lookupKey,
    band: input.plan,
    interval: input.interval,
    origin,
    userId: input.userId,
    firmId: input.firmId,
    email: input.email,
    customerId: action.customerId,
    market: charge.firmMarket,
    promotionCodeId,
    billingFallback: charge.billingFallback,
    integrationIdentifier: firmIntegrationIdentifier(input.plan, input.interval),
    includeTrial: action.includeTrial,
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
    const firmId = await callerOwnedFirmId(ctx.supabase, userId);
    const clientMarkets = await loadFirmClientMarkets(ctx.supabase, firmId);
    return createPaidCheckoutSession({
      userId,
      email,
      firmId,
      clientMarkets,
      plan: data.plan as FirmCheckoutBand,
      interval: data.interval as FirmInterval,
      requested: data.market as StripePlanMarket,
      firmMarket,
      promo: data.promo,
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
    const { userId, email } = await checkoutActor(context);
    const firmId = await callerOwnedFirmId(
      (context as unknown as BillingAuthCtx).supabase,
      userId,
    );
    const customerId = await findBillingCustomerId({ email, userId, firmId });
    if (!customerId) {
      throw new Error("No Stripe customer yet. Start a firm plan from pricing first.");
    }
    if (firmId) await writeFirmStripeCustomerId(firmId, customerId);
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
      plan: session.metadata?.milon_plan === "owner" ? ("owner" as const) : null,
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
    const { userId, email } = await checkoutActor(context);
    const firmId = await callerOwnedFirmId(
      (context as unknown as BillingAuthCtx).supabase,
      userId,
    );
    const sub = await findEntitlingFirmSubscription(email, { userId, firmId });
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
    forgetPlanDisplayCache();
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
    const firmId = data.firmId ?? null;
    const key = `${userId}:${firmId ?? ""}`;
    const hit = planDisplayCache.get(key);
    if (hit && Date.now() - hit.at < PLAN_DISPLAY_CACHE_TTL_MS) return hit.value;
    const pending = planDisplayInflight.get(key);
    if (pending) return pending;
    const work = loadFirmPlanDisplay({
      supabase: ctx.supabase,
      userId,
      email,
      firmId,
    }).then(
      (value) => {
        planDisplayCache.set(key, { at: Date.now(), value });
        planDisplayInflight.delete(key);
        return value;
      },
      (err: unknown) => {
        planDisplayInflight.delete(key);
        throw err;
      },
    );
    planDisplayInflight.set(key, work);
    return work;
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
    const { billingEmail, ownerUserId } = await assertCallerCanUpgradeFirm({
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
    const sub = await findEntitlingFirmSubscription(billingEmail, {
      userId: ownerUserId,
      firmId: data.firmId,
    });
    const firmCustomerId =
      sub?.customerId ??
      (await findBillingCustomerId({ email: billingEmail, userId: ownerUserId, firmId: data.firmId })) ??
      null;
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
    forgetEntitlement(email);
    forgetPlanDisplayCache();
    const {
      billingEmail,
      clientCount,
      ownerUserId,
      market: firmMarket,
    } = await assertCallerCanUpgradeFirm({
      supabase: ctx.supabase,
      userId,
      email,
      firmId: data.firmId,
    });
    const band = data.band as FirmCheckoutBand;
    const interval = data.interval as FirmInterval;
    const sub = await findEntitlingFirmSubscription(billingEmail, {
      userId: ownerUserId,
      firmId: data.firmId,
    });
    assertUpgradeTarget({
      phase: sub?.phase ?? "none",
      current: sub?.band ?? null,
      target: band,
      clientCount,
    });

    const stripe = getStripe();
    const countryCustomerId =
      sub?.customerId ??
      (await findBillingCustomerId({ email: billingEmail, userId: ownerUserId, firmId: data.firmId }));
    const billingCountry = await readStripeCustomerCountry(stripe, countryCustomerId);
    const clientMarkets = await loadFirmClientMarkets(ctx.supabase, data.firmId);
    const charge = firmCheckoutCharge({
      firmMarket,
      clientMarkets,
      billingCountry,
      band,
      interval,
    });
    const priceMarket = charge.priceMarket;
    const { price, lookupKey } = await resolveFirmCatalogPrice(stripe, band, interval, priceMarket);
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
      const firmCustomerId =
        sub?.customerId ??
        (await findBillingCustomerId({ email: billingEmail, userId: ownerUserId, firmId: data.firmId })) ??
        null;
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
    if (route === "update_subscription" && sub && (voucherPromotionCodeId || !itemId)) {
      const fresh = await stripe.subscriptions.retrieve(sub.id, {
        expand: ["items.data.price"],
      });
      if (!itemId) itemId = readSubscriptionPrice(fresh).itemId;
      if (voucherPromotionCodeId) existingDiscounts = readSubscriptionDiscountRefs(fresh);
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

    const customerId = await findBillingCustomerId({
      email: billingEmail,
      userId: ownerUserId,
      firmId: data.firmId,
    });
    if (customerId) await writeFirmStripeCustomerId(data.firmId, customerId);
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
    const params = firmUpgradeCheckoutSessionParams({
      priceId: price.id,
      lookupKey,
      band,
      interval,
      origin,
      userId,
      email: billingEmail,
      customerId,
      market: charge.firmMarket,
      integrationIdentifier: firmIntegrationIdentifier(band, interval),
      includeTrial: false,
      replacesSubscriptionId,
      promotionCodeId: voucherPromotionCodeId,
      billingFallback: charge.billingFallback,
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
    await enforceZaCheckoutBillingCountry({
      mode: session.mode,
      subscription:
        typeof session.subscription === "string" ? session.subscription : session.subscription?.id,
      metadata: session.metadata ?? undefined,
      customer_details: session.customer_details ?? null,
    });
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

const ownerCheckoutInput = z.object({
  interval: z.enum(["month", "year"]).default("month"),
  market: z.enum(["za", "us"]).default("us"),
});

/**
 * Signed-in owner Checkout. Firm coverage skips Stripe. A missing owner
 * lookup key returns owner_price_unavailable and does not use a firm price.
 */
export const startOwnerCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => ownerCheckoutInput.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { startOwnerCheckoutForUser } = await import("@/lib/owner-billing.server");
    const ctx = context as unknown as BillingAuthCtx;
    const { userId, email } = await checkoutActor(ctx);
    let geoCountry = "";
    try {
      geoCountry = (getRequest().headers.get("x-vercel-ip-country") ?? "").trim();
    } catch {
      // No request scope.
    }
    if (!geoCountry && process.env.NODE_ENV !== "production") {
      geoCountry = (process.env.MILON_DEV_GEO ?? "").trim();
    }
    return startOwnerCheckoutForUser({
      userId,
      email,
      interval: data.interval,
      requestedMarket: data.market,
      origin: appOrigin(),
      geoCountry: geoCountry || null,
    });
  });

/** Owner entitlement for the plan UI. Stripe, covering firm, or none. */
export const getOwnerEntitlement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({}).parse(input ?? {}))
  .handler(async ({ context }) => {
    const { loadOwnerEntitlement } = await import("@/lib/owner-billing.server");
    const { userId } = await checkoutActor(context);
    return loadOwnerEntitlement(userId);
  });

export type { OwnerEntitlement, StartOwnerCheckoutResult } from "@/lib/owner-billing";

/** Live Stripe entitlement for the accountant firm shell. */
export const getFirmBillingEntitlement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        refresh: z.boolean().optional(),
        firmId: z.string().nullable().optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    return resolveFirmBillingEntitlement(context, Boolean(data?.refresh), data?.firmId ?? null);
  });
