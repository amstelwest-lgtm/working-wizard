# Xero scope gap

Compared with `XERO_DEFAULT_SCOPES` in `src/lib/xero.ts` on this branch, and with what Sync actually calls.

OAuth scopes are **not** expanded in this change. `accounting.reports.banksummary.read` was already requested. A refresh token keeps only the scopes from the last consent, so a connection made before that scope was granted still needs disconnect + connect. This table is the map for later phases.

`offline_access` is requested and is not in the developer-portal list below. It is what lets Sync refresh the token. Keep it.

| Scope | Requested | Used now | Phase | Deliverable |
| --- | --- | --- | --- | --- |
| offline_access | yes | yes — refresh token | P0 | Sync (all) |
| accounting.settings.read | yes | yes — `GET /Organisation` financial year end | P0 | Health (period labels) |
| accounting.reports.profitandloss.read | yes | yes — month-to-date and year-to-date P&L | P0 | Health, Bot |
| accounting.reports.balancesheet.read | yes | yes — balance sheet; cash fallback when Bank Summary has no accounts | P0 | Health, Cash |
| accounting.reports.banksummary.read | yes | yes — 13-week Bank Summary. Closing balances seed opening cash. Cash received and cash spent seed a weekly run-rate when the forecast has no typed amounts | P0 | Cash, Health (runway once lines exist) |
| app.connections | no | no — `GET /connections` uses the user token | P2 ignore | — |
| accounting.settings | no | no — write | P2 ignore | Do not post settings back to Xero |
| accounting.contacts | no | no — write | P2 ignore | — |
| accounting.contacts.read | no | no | P1 | Action Plan, Bot — customer and supplier names, after invoices or aged detail exist |
| accounting.attachments | no | no — write | P2 ignore | — |
| accounting.attachments.read | no | no | P2 ignore | — |
| accounting.budgets.read | no | no | P1 | Budget |
| accounting.payments | no | no — write | P2 ignore | — |
| accounting.payments.read | no | no | P2 | Cash — only after bank transactions, for which payment settled which bill |
| accounting.invoices | no | no — write | P2 ignore | — |
| accounting.invoices.read | no | no | P1 | Cash, Action Plan — open invoices and due dates. Statement-depth copy must stay free of named invoices until this is actually synced |
| accounting.banktransactions | no | no — write | P2 ignore | — |
| accounting.banktransactions.read | no | no | P1 | Cash — replace the even weekly run-rate with real weeks. Not required for Bank Summary |
| accounting.manualjournals | no | no — write | P2 ignore | — |
| accounting.manualjournals.read | no | no | P2 ignore | — |
| accounting.reports.aged.read | no | no | P1 | Health, Cash, Action Plan — aged debtors and creditors. The statement-depth disclosure already points at this report |
| accounting.reports.budgetsummary.read | no | no | P1 | Budget — budget versus actual |
| accounting.reports.executivesummary.read | no | no | P2 | Health already uses P&L and the balance sheet |
| accounting.reports.trialbalance.read | no | no | P2 | Bot — tie-out, not a board figure |
| accounting.reports.taxreports.read | no | no | P2 ignore | — |
| accounting.reports.tenninetynine.read | no | no | P2 ignore | — |
| payroll.employees | no | no — write | P2 ignore | — |
| payroll.employees.read | no | no | P2 | Action Plan — headcount, not this sync |
| payroll.payruns | no | no — write | P2 ignore | — |
| payroll.payruns.read | no | no | P2 | Action Plan |
| payroll.payslip | no | no — write | P2 ignore | — |
| payroll.payslip.read | no | no | P2 ignore | Payslip detail is out of scope |
| payroll.settings | no | no — write | P2 ignore | — |
| payroll.settings.read | no | no | P2 | Action Plan — only with the other payroll reads |
| payroll.timesheets | no | no — write | P2 ignore | — |
| payroll.timesheets.read | no | no | P2 ignore | — |
| files | no | no — write | P2 ignore | — |
| files.read | no | no | P2 ignore | — |
| assets | no | no — write | P2 ignore | — |
| assets.read | no | no | P2 ignore | — |
| projects | no | no — write | P2 ignore | — |
| projects.read | no | no | P2 ignore | — |

## Phase meaning

- **P0** — requested today. Sync uses them. Bank Summary cash in and cash out now land on the 13-week forecast when that is safe.
- **P1** — next connect, one deliverable at a time. Do not add these to `XERO_DEFAULT_SCOPES` until the fetch exists. Existing connections must reconnect after the scope list changes.
- **P2 ignore** — leave unticked in the consent screen even though the developer app allows them. Write scopes, payroll, files, assets, and projects do not feed Health, Cash, Budget, Action Plan, or Bot yet.

## Suggested P1 order

1. `accounting.reports.aged.read` — Health days, Cash collections, Action Plan.
2. `accounting.banktransactions.read` — Cash weeks, instead of the flat run-rate.
3. `accounting.budgets.read` and `accounting.reports.budgetsummary.read` — Budget.
4. `accounting.invoices.read`, then `accounting.contacts.read` — Action Plan and Bot, with transaction-depth copy only after the rows are stored.
