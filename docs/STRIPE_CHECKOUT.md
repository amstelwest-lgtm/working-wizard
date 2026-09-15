# Stripe Checkout (Orbit / Constellation)

Spark stays free. Orbit and Constellation use Stripe Checkout (`mode: subscription`) with inline `price_data` from `src/lib/stripe-plans.ts`. No Dashboard product catalog is required.

## Merchant of record and Managed Payments

Stripe turns **Managed Payments** on by default for new Checkout Sessions. With MP on, **Stripe** is the merchant of record and every line item needs an [eligible product tax code](https://docs.stripe.com/payments/managed-payments/eligibility#product-tax-code-requirements). Inline `price_data` without `tax_code` is rejected (`Invalid line_items[0]: the product tax code is missing`).

Theo wants Checkout to charge as **Milon, Inc.** (`acct_1UEXnwGXDN6PFbnz`). This integration therefore does both:

1. **`managed_payments: { enabled: false }`** on session create — Milon, Inc. stays merchant of record even if the Dashboard default is on. Account setting: [Managed Payments](https://dashboard.stripe.com/settings/managed-payments).
2. **`line_items[].price_data.product_data.tax_code`** = `txcd_10103001` (Software as a service (SaaS) — business use). Confirmed on Stripe’s [tax code list](https://docs.stripe.com/tax/tax-codes) and on the [Managed Payments eligible list](https://docs.stripe.com/payments/managed-payments/eligibility#product-tax-code-requirements). Constant: `STRIPE_SAAS_BUSINESS_TAX_CODE` in `src/lib/stripe-plans.ts`.

`automatic_tax` is **not** enabled here. Without an active Stripe Tax registration it would collect nothing. Tax collection is a later finance step.

### If you later want Stripe as merchant of record

1. Confirm products stay on an eligible tax code (`txcd_10103001` already is).
2. Enable Managed Payments in the Dashboard, **or** pass `managed_payments: { enabled: true }` on session create.
3. Review [how Managed Payments works](https://docs.stripe.com/payments/managed-payments/how-it-works) (Stripe remits indirect tax; invoices and support change).

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

## Auth redirect

Confirmation emails and Google return use the allowlisted `/auth/callback?checkout=&market=` URL (same hop as Google OAuth). Do **not** set `emailRedirectTo` to `/billing/start` — that path is not on the Auth redirect allowlist (see `docs/AUTH_CUSTOM_DOMAIN.md`), and signup then fails with an error toast.

After account creation (or sign-in), `/billing/start` creates the Checkout session.
