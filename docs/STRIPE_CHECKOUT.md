# Stripe Checkout (Orbit / Constellation)

Spark stays free. Orbit and Constellation use Stripe Checkout (`mode: subscription`) with inline `price_data` from `src/lib/stripe-plans.ts`. No Dashboard product catalog is required.

## Env (Vercel, production)

Already required:

- `STRIPE_SECRET_KEY` (or `STRIPE_RESTRICTED_KEY`) — live secret for **Milon, Inc.** (`acct_1UEXnwGXDN6PFbnz`)
- `STRIPE_PUBLISHABLE_KEY` / `VITE_STRIPE_PUBLISHABLE_KEY` — live publishable key

Optional, not needed to go live:

- `STRIPE_WEBHOOK_SECRET` — only if you later add a `checkout.session.completed` webhook. This PR does not register one. Paid sessions are still created; Stripe Dashboard remains the source of truth until a webhook writes local entitlement.

## Smoke (production)

1. Open https://milonfinance.com and pick **United States**.
2. On pricing, click **Start Orbit**.
3. If you are not signed in, create an account or sign in. You should not land on Spark.
4. Stripe Checkout should open on **Milon, Inc.** for **$39/month**.
5. Success returns to `/billing/success`. Cancel returns to pricing and charges nothing.

ZA Orbit is R699/month; Constellation is $75 / R1 299.
