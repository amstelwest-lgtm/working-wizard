/**
 * Server-only Stripe client. Import from server functions / API routes only —
 * never from browser code.
 *
 * Instantiates a Stripe client with the secret/restricted key from env.
 * Do not assign `stripe.api_key` (deprecated global pattern).
 */

import Stripe from "stripe";

const STRIPE_API_VERSION = "2026-07-29.dahlia" satisfies Stripe.LatestApiVersion;

function stripeSecretKey(): string {
  const key = (
    process.env.STRIPE_SECRET_KEY ||
    process.env.STRIPE_RESTRICTED_KEY ||
    ""
  ).trim();
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY (or STRIPE_RESTRICTED_KEY) is not set",
    );
  }
  return key;
}

export function stripeConfigured(): boolean {
  return Boolean(
    (
      process.env.STRIPE_SECRET_KEY ||
      process.env.STRIPE_RESTRICTED_KEY ||
      ""
    ).trim(),
  );
}

let client: Stripe | undefined;

/** Shared Stripe client for server-side API calls. */
export function getStripe(): Stripe {
  if (!client) {
    client = new Stripe(stripeSecretKey(), {
      apiVersion: STRIPE_API_VERSION,
      typescript: true,
      appInfo: {
        name: "Milon",
        url: "https://milonfinance.com",
      },
    });
  }
  return client;
}
