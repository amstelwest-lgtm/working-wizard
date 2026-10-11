# Sage Business Cloud Accounting (South Africa)

Sage One — the South African product. Basic auth against
`https://accounting.sageone.co.za/api/2.0.0` unless `SAGE_SA_BASE_URL` is an
https `*.sageone.co.za` host (the reseller sandbox). Connect stores a username,
an encrypted password, and a company id. Sync reads that row.

Sync pulls month-to-date and year-to-date profit and loss, the balance sheet,
bank-account balances, and aged customer and supplier summaries. It writes
`clients.financials` and `client_financial_snapshots` with `source = 'sage'`.
The owner board and the accountant studio then run the same auto-populate
path as a QuickBooks or Xero sync, and only when the write says the figures
are real.

An empty dated report (revenue, cash, assets, and equity all zero or missing)
does not replace figures already on the file. The connection stays idle with
"Connected, no transactions yet". A mapped statement that contradicts the
report is different: gross profit must equal sales minus cost of sales (other
income sits below gross profit and is left out of that check), a non-zero
"Total for Sales" line must not map to zero revenue, and equity must not equal
total assets while liabilities are outstanding. That sync is marked in error
and nothing is written.

## Env (Vercel, not git)

| Name                   | Required             | Where                                                                                                                                                          |
| ---------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SAGE_SA_API_KEY`      | Yes, for a live call | Vercel Production and Preview. Query `apikey`. Never `VITE_`. Sandbox and live keys differ.                                                                    |
| `SAGE_SA_PASSWORD_KEY` | Yes, for connect     | The only key that writes `password_enc`. Legacy rows encrypted with the API key still decrypt and are re-encrypted on the next good sync.                      |
| `SAGE_SA_BASE_URL`     | No                   | API host. Unset is the live host above. Only https `*.sageone.co.za` is accepted; anything else falls back to live. Preview can point at the reseller sandbox. |

Sync refuses to call Sage when `SAGE_SA_API_KEY` or `SAGE_SA_PASSWORD_KEY` is
missing. Nothing on the client is zeroed.

## Connection row Eng2 owns

Table `sage_connections`, one row per client. Service role only (RLS on, no
policies). Columns sync reads and writes:

| Column           | Sync                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------ |
| `username`       | Sage login email. Basic auth user.                                                                     |
| `password_enc`   | `enc:v1:` from `encryptSagePassword` in `src/lib/sage-password.ts`. Not plaintext. Not an OAuth token. |
| `company_id`     | Sage `CompanyId` (digits).                                                                             |
| `sync_status`    | `idle` / `syncing` / `error`.                                                                          |
| `sync_error`     | Last failure. Empty after a good sync.                                                                 |
| `last_synced_at` | Set only after figures are saved.                                                                      |

`sage_sync_data` caches `pl`, `bs`, `bank`, `aged_ar`, and `aged_ap` the same
way QuickBooks does. Connect's migration `20261007170000_sage_sa_connections.sql`
creates both tables. Sync does not add a second migration or token columns.

## Who calls sync

The connect card calls `triggerSageSync` in `src/lib/sage.functions.ts`. That
function runs `executeSageSync`. `POST /api/sage/sync` with `{ "clientId" }`
and the same `Authorization: Bearer` the app already sends runs the same
function. An empty report returns `populated: false` and does not write the book.
A mapping contradiction does the same and is not a neutral empty company.

After a real write, the owner board and the accountant studio call
`runSyncAutoPopulate` with the returned fields — the same hand-off as
QuickBooks. Sync does not draft those deliverables itself.

Company/Get and Login/Validate stay on the connect side. Sync does not call
them. Customer/Get and Supplier/Get supply the names and balances behind the
ageing totals. Year-to-date uses `clients.financial_year_start_month` when
that is 1–12. Otherwise sync reads `FinancialYear/GetCurrent` and uses
`YearStart` (a March start is March–today, not January–today). If that read
fails for a reason other than a rejected login, the companion is calendar
year to date.

Month-to-date is stored as `periodMonths` 1 even when the month is still open
(an 11-day October is still 1). Xero and QuickBooks do the same: the
waterfall month is 1, and `periodStart` / `periodEnd` carry the partial span.
Year-to-date uses the month count, so March through October is 8.

Aged customer and supplier summaries bucket by calendar month of the invoice
date (`Current`, `Days30`, `Days60`, …). The API accepts `AgeingPeriod` and
`BasedOnDueDate`, and the help text does not define a day width. The seeded
company (`AgeMonthly`, `AgeingPeriod` 0, `BasedOnDueDate` false) puts a bill
dated 28 September into `Days30` on 11 October, so those buckets are labelled
as months and are not counted as overdue. The totals row is stored as
`{ basis: "calendar_month", current, month_1, month_2, month_3, older }` on
the aged snapshot and on `clients.financials` (`sageArMonthBuckets`,
`sageApMonthBuckets`). `olderThanCurrentMonth` is the sum of the months after
the current one. `totalOverdue` stays the days-past-due figure, which this
report does not provide. Customer/Get and Supplier/Get give a balance only, so
a party gets month columns only when its own ageing row has them. Summary true
and summary false both return one totals object. Zero balances are omitted.
Derived money (EBIT, EBITDA, and the other computed statement fields) is
rounded to cents before it is stored. `BankAccount/Get` supplies cash. If it
fails, the error is logged and cash falls back to the balance-sheet lines of
type 6 (the account name, for example "FNB Business Cheque").
