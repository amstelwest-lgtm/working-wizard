/**
 * Stripe Checkout Sessions for paid Milōn plans (Orbit, Constellation).
 * Any signed-in customer may start Checkout. Spark stays free / no session.
 *
 * Go-live does not require a webhook or Billing portal. Optional later:
 * STRIPE_WEBHOOK_SECRET for checkout.session.completed (not used yet).
 */

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AuthCtx } from "@/lib/owner-ops.guard";
import { getStripe, stripeConfigured } from "@/lib/stripe.server";
import {
  STRIPE_SAAS_BUSINESS_TAX_CODE,
  stripePlanPrice,
  type StripePaidPlan,
  type StripePlanMarket,
} from "@/lib/stripe-plans";

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

function integrationIdentifier(plan: StripePaidPlan): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  let suffix = "";
  for (let i = 0; i < 8; i += 1) {
    suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `milon-${plan}-${suffix}`;
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

async function createPaidCheckoutSession(input: {
  userId: string;
  email: string;
  plan: StripePaidPlan;
  market: StripePlanMarket;
}): Promise<{ url: string }> {
  if (!stripeConfigured()) {
    throw new Error("STRIPE_SECRET_KEY is not set on this deploy.");
  }

  const price = stripePlanPrice(input.plan, input.market);
  const origin = appOrigin();
  const stripe = getStripe();
  const meta = {
    milon_plan: input.plan,
    milon_market: input.market,
    milon_user_id: input.userId,
  };

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    // Milon, Inc. is merchant of record. Account-level Managed Payments would
    // make Stripe the MoR and also require a product tax_code on every item.
    managed_payments: { enabled: false },
    line_items: [
      {
        price_data: {
          currency: price.currency,
          unit_amount: price.unitAmount,
          recurring: { interval: "month" },
          product_data: {
            name: `Milōn ${price.name}`,
            tax_code: STRIPE_SAAS_BUSINESS_TAX_CODE,
          },
        },
        quantity: 1,
      },
    ],
    success_url: `${origin}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/billing/cancel`,
    client_reference_id: input.userId,
    customer_email: input.email || undefined,
    metadata: meta,
    subscription_data: { metadata: meta },
    integration_identifier: integrationIdentifier(input.plan),
  });

  if (!session.url) {
    throw new Error("Stripe Checkout did not return a URL.");
  }
  return { url: session.url };
}

const checkoutInput = z.object({
  plan: z.enum(["orbit", "constellation"]),
  market: z.enum(["za", "us"]).default("za"),
});

/** Signed-in Checkout for Orbit / Constellation. Spark is not a valid plan. */
export const createStripeCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => checkoutInput.parse(input))
  .handler(async ({ data, context }) => {
    const { userId, email } = await checkoutActor(context);
    return createPaidCheckoutSession({
      userId,
      email,
      plan: data.plan as StripePaidPlan,
      market: data.market as StripePlanMarket,
    });
  });

/** Alias kept for the Lighthouse test button. Same signed-in Checkout path. */
export const createOwnerStripeCheckout = createStripeCheckout;

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
