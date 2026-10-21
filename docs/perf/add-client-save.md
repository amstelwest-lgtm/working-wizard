# Add client save — timing

QA on prod `2856d305` (after #730) measured the Add client button stuck on “Saving…” for about **9.3s (US firm)** and **8s (ZA firm)**, with no progress. The save then left the browser on `/clients#wizard-add-client` and a short toast. This note is the create path, what is serial, what hits Stripe, and what hits Postgres.

The 8–9s is one server call, `createFirmClient`, waiting on a live Stripe cap check before it inserts the client. The Stripe calls are already capped and do not retry. Their budgets still add up because they run one after another, and a price-expand failure starts a second subscription list with its own 3s budget.

## Path

1. **Clients list.** `/clients` renders `PracticeBoard`. The rail link is `/clients#wizard-add-client` (`src/components/practice-rail.tsx`). The hash only scrolls to the button. The drawer is `AddClientDialog` (`src/components/practice-board.tsx`).
2. **Opening the drawer** calls `getFirmClientCreateAllowance` (`src/components/practice-board.tsx:551`). That is the same `loadFirmClientCreateAllowance` as the save. The form stays on “Checking your plan…” until it returns. That call is what usually writes `firms.starter_trial_generation_blocked`. It is a separate request from the save, so it does not fill the save’s Stripe cache (the cache is per isolate, 45s — `STRIPE_ISOLATE_CACHE_TTL_MS` in `src/lib/firm-client-cap.server.ts`).
3. **Save** posts `createFirmClient` (`src/lib/firm-clients.functions.ts`). The button used to say “Saving…” for the whole request.
4. **Cap, then insert.** The handler now runs `runFirmClientCreate` (`src/lib/firm-client-create-gate.ts`). Two DB reads run together. Live Stripe runs only when those rows cannot prove the firm is under the tightest cap. The `create_firm_client` RPC starts after the gate allows it.

## What runs on the save

### Parallel (Eng1 — this change)

`resolveFirmClientCreateGate` (`src/lib/firm-client-create-gate.ts`) `Promise.all`s:

| Read | Where | Store |
| --- | --- | --- |
| `readStoredCreateEntitlement` | `src/lib/firm-client-create.server.ts` | Postgres `firms.billing_plan_known`, `firms.starter_trial_generation_blocked` |
| `countFirmClientsForCreate` | same file | Postgres `clients` (non-demo, same collapse as the live cap) |

A thrown read is treated as “not fresh” and does not fail the save.

Stored rows skip live Stripe only when all of these hold (`storedEntitlementSkipsLiveCap`):

- `billing_plan_known` is `entitled` (a finished check wrote it; `none` and null do not grant a cap)
- `starter_trial_generation_blocked` is `false` (a sync wrote “not blocked”; null is unsynced; true is the trial-ended block)
- the active client count is **under 3** (`LEGACY_FREE_STARTER_CLIENT_LIMIT` in `src/lib/stripe-plans.ts`)

3 is the tightest published cap (legacy $0 Starter). Trial and paid Starter are 5; every larger band is higher. A firm under 3 cannot be over any band. At 3 or above, the band is not stored on the row, so the live check still runs. There is no `checked_at` on the firm row, so “fresh” here means both mirrors have been written, not a clock. See Eng2 follow-up.

US and ZA use the same rule. The shortcut does not read prices and does not render currency. Success copy does not say ZAR or rand. The client Home Step 1 dialog already picks USD or ZAR from the client market (`isUsCopy` in `src/routes/_authenticated/clients.$clientId.tsx`).

### Serial, and this is the 8–9s (Eng2 — not changed)

When the shortcut does not apply, `loadFirmClientCreateAllowance` (`src/lib/firm-client-cap.server.ts`) runs to completion before the insert. Order:

| Step | Kind | Notes |
| --- | --- | --- |
| Optional `auth.getUser` | DB / Auth | Only when the caller email is empty |
| `loadFirm` | DB | `firms` select, then `firm_memberships` when the actor is not the owner (`actorCanUseFirm`) |
| `countFirmClients`, `billingEmailForFirm`, `loadMembershipRole` | DB | Already `Promise.all`. Owner email is local. A different owner’s email is `auth.admin.getUserById` |
| `findEntitlingFirmSubscription` → `readFirmSubscriptionHistory` | DB then Stripe | `storedCustomerId` is not passed, so this awaits `readFirmStripeCustomerId` (another `firms` select) before Stripe. Isolate cache is 45s and misses on a new instance |
| `buildUpgradeSnapshot` | Stripe, ZA only | `loadZarCatalogAmounts` when the billing currency is `zar` |
| `writeStarterTrialGenerationBlock`, then `writePrecardCapApplies` | DB | Two awaited writes. They do not change the allow/deny result |
| `decideFirmClientCreate` | CPU | `src/lib/firm-client-cap.ts` |

`create_firm_client` (`supabase/migrations/20261013160000_link_client_firm_execute_lock.sql`) then runs in one RPC: auth, optional `ensure_practice_firm` (that function inserts `firm_memberships` / `user_roles` when it has to provision a firm), firm membership check, market check, `generate_client_code()` (`supabase/migrations/20260824120000_client_code_ensure_firm.sql`, `MLN-` plus 6 chars, uniqueness loop), and one `clients` insert. The insert sets `owner_user_id` to the accountant, `firm_id`, market, financial-year start (month 1 for US, month 3 for ZA), and the firm-link timestamps. It does not seed financials and it does not insert a separate client-membership row.

No step in the RPC calls Stripe.

### Stripe budgets (0 retries)

From `src/lib/stripe-entitlement.ts` and `listCustomerSubscriptions` in `src/lib/firm-client-cap.server.ts`:

| Call | Cap | Retries |
| --- | --- | --- |
| `customers.retrieve` for `firms.stripe_customer_id` | `STORED_CUSTOMER_READ_BUDGET_MS` = **1s** | 0. A timeout keeps the stored id and does not search |
| Email `customers.list` plus subscription and customer metadata search, when there is no trusted stored id | One shared `FIRM_CUSTOMER_SEARCH_BUDGET_MS` = **4s** | 0 |
| `subscriptions.list` with `expand: ["data.items.data.price"]` | `SUBSCRIPTION_LIST_BUDGET_MS` = **3s**, and `maxNetworkRetries: 0` | 0 |
| Second `subscriptions.list` without expand | Another **3s**, same options | 0. Started only when the expand call fails for a reason other than timeout. A timeout throws `FirmCustomerLookupUnknown` and does not start the second list |

`findFirmCustomerId` is the customer step. `listCustomerSubscriptions` is the one or two lists. They are not parallel. A slow expand that errors just inside the first 3s, then a second list that uses its own 3s, is **2 × 3s** on top of the customer lookup.

`customerHasEntitlingSubscription` (active list, then trialing list, each 3s) is a different helper. The Add client cap does not call it. It lists `status: "all"` once, or twice when the expand fails.

`loadZarCatalogAmounts` (`src/lib/stripe-billing-sync.server.ts`) pages `prices.list` in batches of 10 across `ALL_FIRM_LOOKUP_KEYS`. It runs only when `billingCurrencyCode` is `zar` (`src/lib/firm-band-upgrade.ts`: a Stripe currency wins, otherwise ZA market is zar and anything else is usd). A US firm whose Stripe currency is usd does not take this branch and is not shown ZAR.

## Why QA saw ~8–9s

The button waited on one `createFirmClient` invocation. On a cold isolate the in-memory 45s history does not apply, so the save repeats the drawer’s Stripe work.

A successful save that sits near the budgets, without throwing, looks like:

- customer step about **1s** (stored id retrieve) or up to **4s** (no trusted stored id, email then metadata search)
- subscription list about **3s** (the expand call finishing near its cap)
- plus **0** or another **~3s** when the expand errors and the plain list runs
- plus the serial DB in front (firm row, membership, count, then another customer-id select) and the two mirror writes and the RPC after

1s + 3s + 3s is 7s of Stripe before those DB round trips. From a region that is not next to the Stripe API, the DB hops and the customer search are enough to land at **8–9s**. US at ~9.3s fits a customer search that used more of the 4s budget (stored id missing or not trusted — the case #730 was fixing). ZA at ~8s fits a trusted stored id (1s retrieve) plus one list near 3s, the serial DB, and sometimes the ZAR price pages. The ZAR catalog is not what made the US save slower: that branch does not run for a usd subscription.

The old client then closed the drawer and stayed on `/clients#wizard-add-client`. Navigation to `/clients/$clientId?onboard=1` ran only for the first client.

## What this change does

- The stored plan and the client count are read together. Two 1s fakes finish in about 1s (`scripts/add-client-save-test.mts`).
- Under the rules above, the save does not call Stripe.
- The button moves through “Checking your plan…”, “Creating the client…”, and “Opening their Home…”.
- Every successful create navigates to that client’s Home with `onboard=1`, which opens Step 1 (upload or connect). The toast names the client and that next step, and it does not name a currency.

Firms with 3 or more active clients, a missing plan, an unsynced trial mirror, or a trial-ended mirror still pay the live Stripe check.

## Eng2 follow-up

Do not edit `firm-client-cap.server.ts` or `stripe-entitlement.ts` for this. The remaining save latency is inside them.

1. **One budget for both subscription lists.** `listCustomerSubscriptions` gives the expanded `subscriptions.list` and the fallback list each `SUBSCRIPTION_LIST_BUDGET_MS` (3s) and `maxNetworkRetries: 0`. A non-timeout expand failure spends ~3s and then another ~3s. Share one 3s budget, or list without `expand: ["data.items.data.price"]` first. Keep the current behavior that a timeout throws and does not start the second list.
2. **Pass `stripe_customer_id` in.** `findEntitlingFirmSubscription` is called without `storedCustomerId`, so `readFirmSubscriptionHistory` awaits `readFirmStripeCustomerId` before `findFirmCustomerId`. Select the column in `loadFirm` (`FIRM_SELECT`) and pass it through. A trusted stored id should take the 1s retrieve, not the 4s email/metadata search (`FIRM_CUSTOMER_SEARCH_BUDGET_MS`).
3. **Do not await the mirror writes on this response.** `writeStarterTrialGenerationBlock` and `writePrecardCapApplies` run one after another after Stripe and do not affect allow/deny. Run them together, or with `waitUntil`, off the create response.
4. **Do not load the ZAR catalog on the cap check.** `buildUpgradeSnapshot` calls `loadZarCatalogAmounts` whenever the billing currency is zar. The create decision does not need price labels. Cache the catalog if Settings still wants it. US firms must stay on the usd branch.
5. **Store the band on the firm row.** Eng1 can skip Stripe only under the tightest cap (3) because `billing_plan_known` is `entitled` or `none` and has no `checked_at`, phase, band, or `unit_amount`. Persist those from the same live check that writes `billing_plan_known`. A `checked_at` older than a few minutes should force the live fallback, so a trial that ended after the last sync cannot add a client. With phase and band stored, a count under that band’s real limit can skip Stripe too, including firms that already have 3 or more clients.
