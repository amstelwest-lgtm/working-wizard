# Sage Business Cloud Accounting (South Africa)

Sage One — the South African product. Basic auth against
`https://accounting.sageone.co.za/api/2.0.0`. Connect stores a username, an
encrypted password, and a company id. Sync reads that row.

Sync pulls month-to-date and year-to-date profit and loss, the balance sheet,
bank-account balances, and aged customer and supplier summaries. It writes
`clients.financials` and `client_financial_snapshots` with `source = 'sage'`.
The owner board and the accountant studio then run the same auto-populate
path as a QuickBooks or Xero sync, and only when the write says the figures
are real.

An empty dated report (revenue, cash, assets, and equity all zero or missing)
does not replace figures already on the file. The connection is marked in
error and the overview stays as it was.

## Env (Vercel, not git)

| Name                   | Required             | Where                                                           |
| ---------------------- | -------------------- | --------------------------------------------------------------- |
| `SAGE_SA_API_KEY`      | Yes, for a live call | Vercel Production and Preview. Query `apikey`. Never `VITE_`.   |
| `SAGE_SA_PASSWORD_KEY` | No                   | When set, password encryption uses this instead of the API key. |

Sync refuses to call Sage when `SAGE_SA_API_KEY` is missing. Nothing on the
client is zeroed.

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

After a real write, the owner board and the accountant studio call
`runSyncAutoPopulate` with the returned fields — the same hand-off as
QuickBooks. Sync does not draft those deliverables itself.

Company/Get and Login/Validate stay on the connect side. Sync does not call
them. Year-to-date uses `clients.financial_year_start_month` when that is
1–12, and calendar year to date otherwise.
