# Xero — statements and bank position

OAuth2 **web app** (authorization code + refresh). Not a Custom Connection.
Connect one org, pull P&L, the balance sheet, and bank account balances.
Writes `clients.financials`, the cash-forecast opening balance, and a snapshot
with `source = 'xero'`. Same path as a statement upload.

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
  the total. Mapped into the fields ratios and the cash forecast read: cash,
  receivables, payables, inventory, current assets, current liabilities,
  total assets, and equity. Debt-to-equity uses total assets and equity
  (debt = assets − equity). The parsed loan total is kept on the balance-sheet
  cache; it is not a separate ratio input.
- Bank Summary: `fromDate` / `toDate` covering the 13 weeks ending on that
  balance-sheet date. Each bank account's name and closing balance. The sum of
  closing balances is starting cash for the 13-week forecast (an overdraft
  stays negative). Cash received and cash spent in that window are cached.
  When the forecast has no typed amounts, those two totals are seeded as a
  weekly run-rate (total ÷ 13) on lines marked `forecastLinesSource:
  xero-bank-summary`. A typed opening is not replaced. Any non-zero forecast
  line that is not one of those two Xero lines is left as it is, and the Xero
  card says so. Editing a seeded line clears the marker on the next save, so
  the following Sync will not overwrite it. Individual bank transactions are
  not pulled.

After Sync the Xero card and the client briefing state the Bank Summary
window, how many accounts came back, whether opening cash was applied or
skipped, and whether the weekly lines were seeded or left alone. A missing
bank-summary scope still saves the P&L and balance sheet; the card says to
disconnect and connect again.

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

Do not prefix `VITE_`. Redeploy after saving. No extra Supabase secrets.

Bank balances are cached in the existing `xero_sync_data` table
(`data_type = 'bank'`). No new migration. Production `jxclnsbsqpixxqlbcapl`
already has `20260921120000_xero_tables.sql` — nothing further to apply.
Row level security stays deny-all; the service role reads and writes the cache.

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
accounting.reports.banksummary.read
accounting.reports.aged.read
accounting.contacts.read
```

`accounting.reports.banksummary.read` is the Bank Summary report (account names
and balances). `accounting.reports.aged.read` is Aged Receivables by contact
and Aged Payables by contact. `accounting.contacts.read` supplies the customer
and supplier names for those reports. Do not enable
`accounting.banktransactions`, `accounting.invoices`, or a bank-feed scope for
this sync. Collections does not write invoices or send email. Payables does
not send a payment or record a bill.

Aged receivables are cached on the existing `xero_sync_data` row
`data_type = 'aged_ar'`. Aged payables use `data_type = 'aged_ap'` on the same
table. Those upserts do not rewrite the P&L, balance sheet, or bank rows. No
new table. A connection that already granted the aged and contacts scopes for
Collections does not need another consent for payables.

**Existing connections must reconnect.** A Xero refresh token keeps only the
scopes granted at the last consent. After a new scope is ticked, disconnect
the organisation in Milōn and connect it again. Until then, Sync still saves
P&L, the balance sheet, and bank balances. The card says bank balances need a
reconnect when that scope is missing, and aged receivables or aged payables
need a reconnect when the aged or contacts scope is missing. Statement sync
still saves if either aged report is skipped.

## What Theo creates in the Xero developer portal

1. Go to [developer.xero.com/app/manage](https://developer.xero.com/app/manage).
2. Open the existing **Web app** (OAuth 2.0 authorization code). Do **not**
   switch it to a Custom Connection.
3. Confirm redirect URI `https://milonfinance.com/api/xero/callback`.
4. Enable the scopes above, including `accounting.reports.banksummary.read`, `accounting.reports.aged.read`, and `accounting.contacts.read`.
5. Client ID and Client secret stay in the Vercel env vars — no new variable.
6. In Milōn, disconnect Yankees Demo Company (Global) and connect it again so
   the consent screen grants the bank summary scope. Then Sync.

P&L / balance-sheet report scopes on a brand-new app may require Xero App
Partner enrolment. Every Accounting API call sends `Xero-tenant-id` (stored
after `GET https://api.xero.com/connections`) — you do not paste a tenant id.

Tokens sit in `xero_connections` the same way QBO does: RLS deny-all, service
role only, disk encrypted at rest. Never log them.
