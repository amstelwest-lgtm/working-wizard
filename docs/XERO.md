# Xero integration

MILŌN connects one Xero organisation (tenant) per client, pulls **statement-level**
P&amp;L, balance sheet and bank summary, and writes the totals into
`clients.financials` plus a `client_financial_snapshots` row with `source = 'xero'`.
Health, ratios, cash forecast seeding, advisory pack and Next Step then run on
those figures — no PDF upload required.

Invoice / transaction pull is **Phase 2**, behind `XERO_SYNC_INVOICES`. It must
not block a statement sync.

## Token storage

Same pattern as QuickBooks (`qbo_connections`):

- Tokens live in `xero_connections.access_token` / `refresh_token` as `TEXT`.
- RLS is enabled with **no policies**, so the anon and authenticated keys cannot
  read them. Server functions use the Supabase service role and must check
  client access (`assertClientScope` + a user-scoped `clients` SELECT) before
  touching a row.
- Supabase encrypts the disk at rest. There is no separate vault column for QBO
  or Xero. Do not log tokens, `client_secret`, or raw callback bodies.

Xero **rotates refresh tokens** on every refresh. The new pair is written before
any report call continues.

## Create the Xero app

1. Sign in at [developer.xero.com](https://developer.xero.com/app/manage) and
   create a **Web app**.
2. OAuth 2.0 grant: **Authorization Code**.
3. Redirect URI — paste **exactly** (scheme, host, path, no trailing slash):

   | Environment | Redirect URI |
   | --- | --- |
   | Production | `https://milonfinance.com/api/xero/callback` |
   | Vercel preview | `https://<preview-host>.vercel.app/api/xero/callback` |
   | Local | `http://localhost:5000/api/xero/callback` |

   Add each URI you will actually use. Xero rejects mismatches.
4. Scopes (apps created after 2 March 2026 use **granular** report scopes):

   ```
   offline_access
   accounting.settings.read
   accounting.reports.profitandloss.read
   accounting.reports.balancesheet.read
   accounting.reports.banksummary.read
   ```

   Optional Phase 2: `accounting.invoices.read`.

   Xero may require **App Partner** enrolment before P&amp;L / balance-sheet
   report scopes appear on a brand-new app. If the portal still shows the
   legacy `accounting.reports.read` grant, set `XERO_SCOPES` to that plus
   `offline_access` and `accounting.settings.read`.
5. Copy the **Client ID** and **Client secret**. Never commit them.

## Secrets to paste

### Vercel (Production + Preview)

| Name | Value |
| --- | --- |
| `XERO_CLIENT_ID` | from the Xero app |
| `XERO_CLIENT_SECRET` | from the Xero app |
| `XERO_REDIRECT_URI` | `https://milonfinance.com/api/xero/callback` on Production; the matching preview URL on Preview |

Optional:

| Name | Value |
| --- | --- |
| `XERO_SCOPES` | space-separated override |
| `XERO_SYNC_INVOICES` | `1` to cache recent invoices (Phase 2) |

Redeploy after saving. These are **server-only** — do not prefix `VITE_`.

### Supabase

No extra Supabase secrets are required for Xero. Apply migration
`20260921120000_xero_tables.sql` (`xero_oauth_states`, `xero_connections`,
`xero_sync_data`). The app already uses `SUPABASE_SERVICE_ROLE_KEY` for token
rows, same as QBO.

### Xero developer portal

- Redirect URI: `https://milonfinance.com/api/xero/callback`
- Tenant header: every Accounting API call sends `Xero-tenant-id` (stored per
  client after `GET https://api.xero.com/connections`). You do not paste a
  tenant id into Vercel.

## What syncs in Phase 1

| Xero report | Milōn fields |
| --- | --- |
| Profit and Loss (YTD) | `revenue`, `cogs`, `ebit`, `ebt`, `netIncome`, `ebitda`, `fixedCosts`, `periodMonths` |
| Balance Sheet | `totalAssets`, `equity`, `receivables`, `inventory`, `payables` |
| Bank Summary | `cash` (closing) |

`operatingCashflow` is left blank: Xero’s Reports API has no cash-flow
statement. `data_depth` stays `statement` until Phase 2 invoices succeed.

## Where it appears

- Accountant client studio → Financials (next to QuickBooks)
- Owner app → Upload / data sources, first-data nudge, empty board
- Firm dashboard → `XO` badge when a tenant is connected
