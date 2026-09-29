# Stripe firm-band catalog (Checkout + Portal)

Paying customer is the **accounting firm**. Pricing is flat USD monthly or annual
bands by **ACTIVE client count**. Watchlist clients are free and are not Stripe
line items. Owner **Spark** stays free and does not create a Checkout Session.

Catalog lives in Stripe **TEST and LIVE** on **Milon, Inc.**
(`acct_1UEXnwGXDN6PFbnz`). Adaptive Pricing is on in the Dashboard (test + live)
so South African firms can pay ZAR against the USD catalog. The app never
hardcodes ZAR list prices.

Product tax code on every catalog product: `txcd_10103001` (SaaS — business use).
Head office for Stripe Tax is Wilmington, DE.

## Lookup keys (resolve via API — never hardcode `price_` IDs)

| Band | Active clients | Monthly | Annual (~20% off) | Lookup keys |
| --- | --- | --- | --- | --- |
| Starter (archived — not for new signups) | 3 | $0 | — | `milon_starter_monthly` (`active=false` on Live) |
| Solo | 15 | $99 | $950 | `milon_solo_monthly` / `milon_solo_yearly` |
| Small | 25 | $149 | $1,430 | `milon_small_monthly` / `milon_small_yearly` |
| Growing | 50 | $249 | $2,390 | `milon_growing_monthly` / `milon_growing_yearly` |
| Established | 75 | $349 | $3,350 | `milon_established_monthly` / `milon_established_yearly` |
| Larger | 125 | $499 | $4,790 | `milon_larger_monthly` / `milon_larger_yearly` |
| Advanced | 200 | $649 | $6,230 | `milon_advanced_monthly` / `milon_advanced_yearly` |
| Scale | 500 | $999 | $9,590 | `milon_scale_monthly` / `milon_scale_yearly` |
| Enterprise | unlimited | custom Quotes | — | product only, no public prices |

Resolve:

```ts
const prices = await stripe.prices.list({
  lookup_keys: ["milon_solo_monthly"],
  active: true,
  limit: 1,
});
```

App constants: `src/lib/stripe-plans.ts`. Session builder: `src/lib/stripe-checkout.core.ts`.

## Checkout Session rules

- `mode: "subscription"`
- `line_items[].price` = catalog price id from lookup_key (**not** inline `price_data`)
- `adaptive_pricing: { enabled: true }`
- **Do not** pass `managed_payments: { enabled: false }` — leave Managed Payments at the account default (Stripe handles tax for a fee).
- **Do not** enable `automatic_tax` unless active Tax registrations exist. Prefer Managed Payments default.
- `billing_address_collection: "required"` and `tax_id_collection: { enabled: true }`
- Omit `payment_method_types` (dynamic payment methods)
- `integration_identifier`: `milon-{band}-{interval}-{8 random letters}`
- `payment_method_collection: "always"` — card on file at signup
- First subscription: `subscription_data.trial_period_days: 14` on the chosen paid band (default Solo monthly). A customer with any prior subscription does not get a second trial.

If the signed-in email already has an **active** Stripe subscription, Checkout create opens the **Customer Portal** instead of a second subscription.

## FOUNDING promotion

- Coupon id: `FOUNDING50`
- Promotion code: `FOUNDING`
- **Monthly only.** FOUNDING applies to monthly prices only. It must not stack with the ~20% annual catalog discount.
- App enforcement:
  1. `assertFoundingMonthlyOnly` throws if FOUNDING / FOUNDING50 is passed with `interval=year`
  2. Yearly Checkout does **not** set `allow_promotion_codes`, so the code box is absent
  3. Monthly paid Checkout sets `allow_promotion_codes: true`

## New firm signup — 14-day trial

Every new firm is sent to Checkout on a **paid** band after `/auth` signup (email confirm and Google included). The default is Solo monthly (`milon_solo_monthly`). Starter $0 is not a new-signup path.

- Copy: **14-day free trial · up to 3 clients**. Do not write “3 free clients” or “free forever.”
- Card is required. The trial subscription status is `trialing`, which entitles `/dashboard` and the rest of the firm product.
- During the trial the app blocks the 4th client until the subscription is `active` on a band that allows it. The firm owner can end the trial from Add client (“Upgrade to paid plan”), which sets `trial_end: now` and bills the card.
- Paid Solo+ uses the catalog client limits (Solo 15, Small 25, …).
- FOUNDING / FOUNDING50 applies to monthly paid Solo+ invoices after the trial. It is not a free-forever coupon.
- When the trial ends unpaid or canceled (`past_due`, `unpaid`, `canceled`, `incomplete`), the firm is not entitled and resumes at `/billing/required`.

## Starter price — archive, do not delete

`milon_starter_monthly` stays in the catalog map so a legacy subscription still resolves to a 3-client band. New Checkout never requests it (`prices.list` uses `active: true`).

### Stripe Live ops checklist (coordinator)

Account: **Milon, Inc.** `acct_1UEXnwGXDN6PFbnz` (Live). This VM does not mutate Live Stripe. The app only resolves `lookup_key`s.

1. Do **not** delete prices or products.
2. Archive the Starter $0 price so it cannot be used for new Checkout:

   ```bash
   stripe prices list --lookup-keys milon_starter_monthly
   stripe prices update price_XXX --active=false
   ```

   Dashboard: Product catalog → Starter price → Archive. `active=false`. Existing subscriptions on that price keep running.
3. Leave paid band prices **active**: `milon_solo_monthly`, `milon_solo_yearly`, and the same pattern for small, growing, established, larger, advanced, scale.
4. Leave `tax_behavior=exclusive` and Adaptive Pricing (SA ZAR) unchanged.
5. Do not attach FOUNDING50 to the Starter price. FOUNDING stays 50% off **monthly paid** prices only. FOUNDING applies to monthly invoices after the trial.
6. Customer Portal should allow the firm to update the subscription (change band / pay).
7. The app sets `trial_period_days: 14` and `payment_method_collection: always` on Checkout. A Dashboard trial on the Solo price is optional; the app path does not depend on it. Do not put a trial on the archived Starter price.

## Customer Portal

Dashboard Customer Portal is already configured for self-serve band / interval changes.

- Server: `createBillingPortalSession` in `src/lib/stripe-checkout.functions.ts`
- UI: Practice **Settings → Manage billing**
- Looks up the Stripe Customer by the signed-in email (no local customer-id column)

## Owner Spark vs firm bands

Dual pricing used to be owner Orbit / Constellation (inline `price_data`) plus unpublished firm 150 / unlimited seats. The paying model is now **firm bands**. Owner Spark remains the free owner path. Orbit / Constellation on the owner landing are no longer Checkout SKUs.

## Env (Vercel, production)

- `STRIPE_SECRET_KEY` (or `STRIPE_RESTRICTED_KEY`) — Milon, Inc.
- `STRIPE_PUBLISHABLE_KEY` / `VITE_STRIPE_PUBLISHABLE_KEY`
- `STRIPE_WEBHOOK_SECRET` — optional until a `checkout.session.completed` webhook writes local entitlement. Stripe Dashboard remains source of truth until then.

## Auth redirect

Confirmation emails and Google return use the allowlisted
`/auth/callback?checkout=&interval=&market=` URL. Do **not** set
`emailRedirectTo` to `/billing/start` (see `docs/AUTH_CUSTOM_DOMAIN.md`).

After account creation (or sign-in), `/billing/start` creates the Checkout
session (or a Portal session if a subscription already exists).

## Accountant product gate

Failed or skipped Checkout must not leave a firm with an open accountant
workspace. Auth account creation can still happen before Checkout; after login,
**firm product UI requires an entitling Stripe subscription**.

- **Gated:** `/dashboard`, `/clients/*`, `/reports*`, `/settings/team`,
  `/settings/brand` for accountant / firm **owners**.
- **Entitled when:** Stripe customer for the signed-in email has a subscription
  with status `active` or `trialing`. A 14-day trial counts (`trialing`).
  Checkout success includes `complete` / `paid` / `no_payment_required`
  (the trial’s first invoice is $0; the card is still collected).
- **Not gated:** Owner Spark (`/app`), owner invite-accept, public/marketing,
  `/auth/callback` mid-checkout, `/billing/*` (start, success, cancel, required),
  Customer Portal start, shared `/settings` (so billing can be completed),
  `/ops`, invited firm **staff** who are members but not the firm owner.
- Live check: `customers.list` by email + `subscriptions.list` (same helpers as
  Checkout). Brief in-memory cache of **positive** results only. No local
  entitlement table until a webhook writes one.
- Unpaid owners, and owners whose trial ended without an `active` subscription,
  land on `/billing/required` (“Finish firm billing to open your practice”) and
  can resume Checkout (pending band, default Solo monthly, no second intro trial).
