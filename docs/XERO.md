# Xero — day-1 connect

OAuth2 **web app** (authorization code + refresh). Not a Custom Connection.
Connect one org, pull P&L + balance sheet, write `clients.financials` and a
snapshot with `source = 'xero'`. Same path as a statement upload.

Sync requests two Profit and Loss reports, each with explicit `fromDate` and
`toDate` and `standardLayout=true`. It does not send `periods` or `timeframe`.

- Month to date: the 1st of the current UTC month through today. This is the
  figure on the profitability waterfall (`periodMonths = 1`).
- Financial year to date: from the day after the organisation's
  `FinancialYearEndDay` / `FinancialYearEndMonth` (`GET /Organisation`) through
  today. If that read fails, the companion is calendar year to date (1 Jan
  through today) and is labeled calendar, not financial year.
- When the two ranges are the same month, only the month is stored.
- Balance sheet: `date` = the month-to-date end, `standardLayout=true`, one
  amount column. Amounts are the first figure cell. A trailing `0.00` is not
  the total.

Both ranges are stored with start and end (`periodStart` / `periodEnd`, and
`ytdPeriodStart` / `ytdPeriodEnd`) plus `statementSource = xero`. The waterfall
and the accountant briefing show those dates next to the revenue. A previous
sync that saved a multi-month total with no dates stays until the next Sync.

## Env vars (only these)

| Name | Where |
| --- | --- |
| `XERO_CLIENT_ID` | Vercel (Production + Preview) |
| `XERO_CLIENT_SECRET` | Vercel (Production + Preview) |
| `XERO_REDIRECT_URI` | Vercel. Production: `https://milonfinance.com/api/xero/callback` |

Do not prefix `VITE_`. Redeploy after saving. No extra Supabase secrets — apply
migration `20260921120000_xero_tables.sql` and use the existing service role.

## Redirect URI (Xero portal + Vercel)

```
https://milonfinance.com/api/xero/callback
```

Optional extras if you actually use them: `https://<preview>.vercel.app/api/xero/callback`,
`http://localhost:5000/api/xero/callback`.

## Scopes to tick in the Xero app

```
offline_access
accounting.settings.read
accounting.reports.profitandloss.read
accounting.reports.balancesheet.read
```

## What Theo creates in the Xero developer portal

1. Go to [developer.xero.com/app/manage](https://developer.xero.com/app/manage).
2. **New app** → type **Web app** (OAuth 2.0 authorization code). Do **not**
   choose Custom Connection.
3. Paste redirect URI `https://milonfinance.com/api/xero/callback`.
4. Enable the four scopes above.
5. Copy Client ID and Client secret into the Vercel env vars.

P&L / balance-sheet report scopes on a brand-new app may require Xero App
Partner enrolment. Every Accounting API call sends `Xero-tenant-id` (stored
after `GET https://api.xero.com/connections`) — you do not paste a tenant id.

Tokens sit in `xero_connections` the same way QBO does: RLS deny-all, service
role only, disk encrypted at rest. Never log them.
