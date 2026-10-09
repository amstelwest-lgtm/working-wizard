/**
 * Stripe → firm-band sync.
 *
 * Endpoint: POST /api/stripe/webhook
 * Events: checkout.session.completed, customer.subscription.created,
 *         customer.subscription.updated
 *
 * Verifies Stripe-Signature with STRIPE_WEBHOOK_SECRET, then writes
 * milon_plan from the catalog lookup_key and cancels a replaced subscription
 * once the new one is active or trialing. A setup-mode Checkout session
 * (card collected for an existing subscription) updates that same
 * subscription and does not cancel it. A price whose client limit is below
 * the firm's current client count is not applied: milon_downgrade_blocked is
 * set and, when the event includes the previous price, that price is restored.
 * The dashboard return path runs the same sync, so the client limit does not
 * wait on this webhook.
 *
 * Dashboard → Developers → Webhooks → https://milonfinance.com/api/stripe/webhook
 * Do not change prices or the Customer Portal from this route.
 */

import { createFileRoute } from "@tanstack/react-router";
import { previousPriceIdFromSubscriptionEvent } from "@/lib/firm-band-upgrade";
import { readFirmSetupUpgrade } from "@/lib/stripe-checkout.core";
import { recordPaidZarInvoice } from "@/lib/pricing/za-revenue.server";
import {
  completeFirmSetupUpgrade,
  constructFirmBillingEvent,
  enforceZaCheckoutBillingCountry,
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
        if (event.type === "invoice.paid") {
          try {
            await recordPaidZarInvoice(
              event.data?.object as {
                id?: string;
                currency?: string | null;
                amount_paid?: number | null;
                status?: string | null;
                status_transitions?: { paid_at?: number | null } | null;
              },
            );
          } catch (err) {
            console.warn(
              "[stripe-webhook] revenue row skipped",
              err instanceof Error ? err.message : err,
            );
          }
          return Response.json({ received: true, recorded: true });
        }
        if (event.type === "checkout.session.completed") {
          const session = event.data?.object as {
            id?: string;
            mode?: string | null;
            customer?: unknown;
            setup_intent?: unknown;
            subscription?: string | { id?: string } | null;
            metadata?: Record<string, string> | null;
            customer_details?: { address?: { country?: string | null } | null } | null;
          };
          if (readFirmSetupUpgrade(session?.metadata)) {
            try {
              const result = await completeFirmSetupUpgrade(session);
              return Response.json({ received: true, setupUpgrade: true, ...result });
            } catch (err) {
              console.error(
                "[stripe-webhook] setup upgrade failed",
                err instanceof Error ? err.message : err,
              );
              return Response.json({ error: "Sync failed" }, { status: 500 });
            }
          }
        }
        const subscriptionId = stripeEventSubscriptionId(event);
        if (!subscriptionId) {
          return Response.json({ received: true, synced: false });
        }
        try {
          if (event.type === "checkout.session.completed") {
            const session = event.data?.object as {
              mode?: string | null;
              subscription?: string | { id?: string } | null;
              metadata?: Record<string, string> | null;
              customer_details?: { address?: { country?: string | null } | null } | null;
            };
            await enforceZaCheckoutBillingCountry(session);
          }
          const result = await syncFirmSubscriptionBand(subscriptionId, undefined, {
            previousPriceId: previousPriceIdFromSubscriptionEvent(event),
          });
          return Response.json({ received: true, ...result });
        } catch (err) {
          console.error("[stripe-webhook] sync failed", err instanceof Error ? err.message : err);
          return Response.json({ error: "Sync failed" }, { status: 500 });
        }
      },
    },
  },
});
