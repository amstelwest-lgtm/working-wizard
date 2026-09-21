# Xero — day-1 connect

OAuth2 **web app** (authorization code + refresh). Not a Custom Connection.
Connect one org, pull P&L + balance sheet, write `clients.financials` and a
snapshot with `source = 'xero'`. Same path as a statement upload.

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
