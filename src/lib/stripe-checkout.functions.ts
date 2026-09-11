/**
 * Stripe Checkout Sessions for paid Milōn plans.
 * Owner-only until public billing is switched on.
 */

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertPlatformOwner, type AuthCtx } from "@/lib/owner-ops.guard";
import { getStripe, stripeConfigured } from "@/lib/stripe.server";
import { stripePlanPrice, type StripePaidPlan, type StripePlanMarket } from "@/lib/stripe-plans";

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

export const createOwnerStripeCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        plan: z.enum(["orbit", "constellation"]),
        market: z.enum(["za", "us"]).default("za"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId, email } = await assertPlatformOwner(context as AuthCtx);
    if (!stripeConfigured()) {
      throw new Error("STRIPE_SECRET_KEY is not set on this deploy.");
    }

    const plan = data.plan as StripePaidPlan;
    const market = data.market as StripePlanMarket;
    const price = stripePlanPrice(plan, market);
    const origin = appOrigin();
    const stripe = getStripe();

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [
        {
          price_data: {
            currency: price.currency,
            unit_amount: price.unitAmount,
            recurring: { interval: "month" },
            product_data: { name: `Milōn ${price.name}` },
          },
          quantity: 1,
        },
      ],
      success_url: `${origin}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/billing/cancel`,
      client_reference_id: userId,
      customer_email: email || undefined,
      integration_identifier: integrationIdentifier(plan),
    });

    if (!session.url) {
      throw new Error("Stripe Checkout did not return a URL.");
    }
    return { url: session.url };
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
