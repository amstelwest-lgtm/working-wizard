# QuickBooks Online — day-1 connect

OAuth2 **web app** (authorization code + refresh). Same shape as Xero: connect,
disconnect, and sync into `clients.financials` and `client_financial_snapshots`
with `source = 'qbo'`.

Sync requests two Profit and Loss reports, each with explicit `start_date` and
`end_date`. It does not send `summarize_column_by` (that would add unlabeled
month columns).

- Month to date: the 1st of the current UTC month through today. This is the
  figure on the profitability waterfall (`periodMonths = 1`). The snapshot
  label is both dates, for example `1 Sep 2026 – 21 Sep 2026`, never `Sep 2026`.
- Financial year to date: from the 1st of `CompanyInfo.FiscalYearStartMonth`
  through today. If that read fails, the companion is calendar year to date
  (1 Jan through today) and is labeled calendar, not financial year.
- When the two ranges are the same month, only the month is stored.
- Balance sheet: `date` = the month-to-date end. The amount is the first Money
  column (or the column titled Total). A trailing `0.00` is not the total.

Both ranges are stored with start and end (`periodStart` / `periodEnd`, and
`ytdPeriodStart` / `ytdPeriodEnd`) plus `statementSource = qbo`. The connect
card, the accountant briefing, and the waterfall show those dates.

Tokens sit in `qbo_connections`: RLS enabled with no policies, service role
only. Never log them.

## Env vars (only these)

Set on the Vercel project **working-wizard2**, Production and Preview. Do not
prefix `VITE_`. Redeploy after saving. Do not put the values in git.

| Name | Value |
| --- | --- |
| `QBO_CLIENT_ID` | Intuit app Client ID for the environment you are using |
| `QBO_CLIENT_SECRET` | Intuit app Client Secret |
| `QBO_REDIRECT_URI` | `https://milonfinance.com/api/qbo/callback` |
| `QBO_ENVIRONMENT` | `production` for live companies. `sandbox` only for an Intuit sandbox company |

Paste the ID and secret through the CoS secure fields, or set them yourself in
Vercel → working-wizard2 → Settings → Environment Variables. This repo never
stores them.

## Redirect URI (Intuit Developer + Vercel)

```
https://milonfinance.com/api/qbo/callback
```

Register that exact string. Intuit rejects a mismatch, including `www` and a
trailing slash. Optional extras only if you actually use them:

- `http://localhost:5000/api/qbo/callback`
- `https://<preview>.vercel.app/api/qbo/callback`

The production app should use the production host above.

## Scope

Tick **Accounting** only. The OAuth scope string is:

```
com.intuit.quickbooks.accounting
```

That covers CompanyInfo, Profit and Loss, Balance Sheet, and Cash Flow. Do not
add Payments, Payroll, or OpenID.

## What Theo does in the Intuit Developer portal

1. Open [developer.intuit.com](https://developer.intuit.com) → your app (or
   **Create an app** → QuickBooks Online).
2. **Keys & credentials**. Use **Production** keys for live books. Development
   keys only talk to sandbox companies, and then `QBO_ENVIRONMENT` must be
   `sandbox`.
3. Add the redirect URI `https://milonfinance.com/api/qbo/callback` on that
   same environment (Production or Development). Intuit keeps those lists
   separate.
4. Confirm the scope is Accounting (`com.intuit.quickbooks.accounting`).
5. Copy Client ID and Client Secret into the four Vercel env vars above.
   `QBO_ENVIRONMENT=production` when the keys are Production keys.
6. Redeploy working-wizard2.

## Database

Apply migration `20260921200000_qbo_oauth_return_path.sql` on Supabase project
`jxclnsbsqpixxqlbcapl` (Milon real) before the first connect. It adds
`qbo_oauth_states.return_path` so the owner board returns to `/app` and the
accountant studio returns to `/clients/<id>`.

The `qbo_connections`, `qbo_oauth_states`, and `qbo_sync_data` tables already
exist. RLS stays on with no policies. Do not add a public read policy. No new
Supabase secrets.

## After it is live

On the owner board and the client studio, QuickBooks sits next to Xero. Connect,
then Sync. The card should show month-to-date dates and, when the year is
longer, the year-to-date dates and revenue. Disconnect revokes the Intuit token
and deletes the local connection. Synced snapshots stay.
