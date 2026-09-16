# Stripe Checkout (firm bands)

Firm billing uses the Stripe catalog documented in **[STRIPE_FIRM_BANDS.md](./STRIPE_FIRM_BANDS.md)**.

Owner Spark stays free. Orbit / Constellation are no longer inline `price_data` Checkout SKUs. Accounting firms subscribe on USD bands resolved by `lookup_key`, with Adaptive Pricing so SA firms can pay ZAR.

## Merchant of record and tax

Theo selected Stripe handling tax for a fee (**Managed Payments** account default) and set the Tax head office in Wilmington, DE. Catalog products already have `tax_code` `txcd_10103001`.

Firm Checkout **does not** pass `managed_payments: { enabled: false }`. Leave Managed Payments at the account default. `automatic_tax` is not enabled here unless active registrations exist.

## FOUNDING

Coupon `FOUNDING50` / code `FOUNDING` is **monthly only** and must not stack with annual ~20% off. Enforced in checkout create.

## Env

- `STRIPE_SECRET_KEY` (or `STRIPE_RESTRICTED_KEY`) — live secret for **Milon, Inc.** (`acct_1UEXnwGXDN6PFbnz`)
- `STRIPE_PUBLISHABLE_KEY` / `VITE_STRIPE_PUBLISHABLE_KEY`
- `STRIPE_WEBHOOK_SECRET` — optional until a webhook writes local entitlement

## Smoke

1. Open https://milonfinance.com, choose the accountant path, pick **Solo** (or Starter).
2. Create a firm account at `/auth` if needed.
3. Stripe Checkout should open on **Milon, Inc.** for the catalog price (ZAR presentment possible via Adaptive Pricing).
4. Success returns to `/billing/success`. Cancel charges nothing.
5. Practice Settings → **Manage billing** opens the Stripe Customer Portal.

## Auth redirect

Confirmation emails and Google return use the allowlisted `/auth/callback?checkout=&interval=&market=` URL. Do **not** set `emailRedirectTo` to `/billing/start`.
