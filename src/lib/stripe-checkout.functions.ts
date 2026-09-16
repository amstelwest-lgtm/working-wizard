/**
 * Stripe Checkout + Customer Portal for firm-band billing.
 * Catalog prices are resolved by lookup_key. Spark (owner) stays free.
 *
 * Optional later: STRIPE_WEBHOOK_SECRET for checkout.session.completed.
 */

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AuthCtx } from "@/lib/owner-ops.guard";
import { getStripe, stripeConfigured } from "@/lib/stripe.server";
import {
  FOUNDING_PROMO_CODE,
  assertFoundingMonthlyOnly,
  isFoundingCode,
  type FirmCheckoutBand,
  type FirmInterval,
  type StripePlanMarket,
} from "@/lib/stripe-plans";
import {
  assertNoManagedPaymentsOverride,
  firmCheckoutSessionParams,
  firmIntegrationIdentifier,
  resolveFirmCatalogPrice,
} from "@/lib/stripe-checkout.core";

function appOrigin(): string {
  const fromEnv = (process.env.SITE_URL || process.env.VITE_APP_URL || "")
    .trim()
    .replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  try {
    return new URL(getRequest().url).origin;
  } catch {
    return "https://milonfinance.com";
  }
}

async function checkoutActor(context: unknown): Promise<{ userId: string; email: string }> {
  const ctx = context as AuthCtx & {
    supabase?: {
      auth: {
        getUser: () => Promise<{ data: { user: { email?: string | null } | null } }>;
      };
    };
  };
  const userId = ctx.userId;
  let email = (ctx.claims?.email ?? "").trim();
  if (!email && ctx.supabase) {
    const { data } = await ctx.supabase.auth.getUser();
    email = (data.user?.email ?? "").trim();
  }
  return { userId, email };
}

async function findCustomerIdByEmail(email: string): Promise<string | undefined> {
  if (!email) return undefined;
  const listed = await getStripe().customers.list({ email, limit: 1 });
  return listed.data[0]?.id;
}

async function customerHasActiveSubscription(customerId: string): Promise<boolean> {
  const listed = await getStripe().subscriptions.list({
    customer: customerId,
    status: "active",
    limit: 1,
  });
  return listed.data.length > 0;
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
    return_url: `${origin.replace(/\/$/, "")}/settings`,
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
  market: StripePlanMarket;
  promo?: string | null;
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

  const { price, lookupKey } = await resolveFirmCatalogPrice(
    stripe,
    input.plan,
    input.interval,
  );
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
    integrationIdentifier: firmIntegrationIdentifier(input.plan, input.interval),
  });
  assertNoManagedPaymentsOverride(params);

  const session = await stripe.checkout.sessions.create(params);
  if (!session.url) {
    throw new Error("Stripe Checkout did not return a URL.");
  }
  return { url: session.url, kind: "checkout" };
}

const checkoutInput = z.object({
  plan: z.enum([
    "starter",
    "solo",
    "small",
    "growing",
    "established",
    "larger",
    "advanced",
    "scale",
  ]),
  interval: z.enum(["month", "year"]).default("month"),
  market: z.enum(["za", "us"]).default("us"),
  promo: z.string().trim().max(40).optional(),
});

/** Signed-in Checkout for a firm band. Owner Spark is not a valid plan. */
export const createStripeCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => checkoutInput.parse(input))
  .handler(async ({ data, context }) => {
    const { userId, email } = await checkoutActor(context);
    return createPaidCheckoutSession({
      userId,
      email,
      plan: data.plan as FirmCheckoutBand,
      interval: data.interval as FirmInterval,
      market: data.market as StripePlanMarket,
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
