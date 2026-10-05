/**
 * Stripe → firm-band sync.
 *
 * Endpoint: POST /api/stripe/webhook
 * Events: checkout.session.completed, customer.subscription.created,
 *         customer.subscription.updated
 *
 * Verifies Stripe-Signature with STRIPE_WEBHOOK_SECRET, then writes
 * milon_plan from the catalog lookup_key and cancels a replaced subscription
 * once the new one is active or trialing. The dashboard return path runs the
 * same sync, so the client limit does not wait on this webhook.
 *
 * Dashboard → Developers → Webhooks → https://milonfinance.com/api/stripe/webhook
 * Do not change prices or the Customer Portal from this route.
 */

import { createFileRoute } from "@tanstack/react-router";
import {
  constructFirmBillingEvent,
  isFirmBillingWebhookEvent,
  stripeEventSubscriptionId,
  syncFirmSubscriptionBand,
} from "@/lib/stripe-billing-sync.server";
import { getStripe, stripeConfigured } from "@/lib/stripe.server";

export const Route = createFileRoute("/api/stripe/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!stripeConfigured()) {
          return Response.json({ error: "Stripe is not configured" }, { status: 503 });
        }
        const secret = (process.env.STRIPE_WEBHOOK_SECRET ?? "").trim();
        if (!secret) {
          console.error("STRIPE_WEBHOOK_SECRET is not configured");
          return Response.json({ error: "Webhook not configured" }, { status: 503 });
        }
        const payload = await request.text();
        const signature = request.headers.get("stripe-signature") ?? "";
        let event;
        try {
          event = constructFirmBillingEvent(getStripe(), payload, signature, secret);
        } catch (err) {
          console.warn(
            "[stripe-webhook] signature rejected",
            err instanceof Error ? err.message : err,
          );
          return Response.json({ error: "Invalid signature" }, { status: 400 });
        }
        if (!isFirmBillingWebhookEvent(event.type)) {
          return Response.json({ received: true, ignored: event.type });
        }
        const subscriptionId = stripeEventSubscriptionId(event);
        if (!subscriptionId) {
          return Response.json({ received: true, synced: false });
        }
        try {
          const result = await syncFirmSubscriptionBand(subscriptionId);
          return Response.json({ received: true, ...result });
        } catch (err) {
          console.error("[stripe-webhook] sync failed", err instanceof Error ? err.message : err);
          return Response.json({ error: "Sync failed" }, { status: 500 });
        }
      },
    },
  },
});
