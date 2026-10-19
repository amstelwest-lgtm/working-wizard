# Tax Specialist v1 — South Africa / SARS

This is the plan for the real product. The screen shipped with it is a labelled SAMPLE. It does not sign in to SARS, call a SARS API, submit a return, or write to Xero, QuickBooks, or Sage.

## Scope

v1 is company income tax for a standard resident company, at 27%, for a year of assessment ending on or after 31 March 2023. The accountant remains the filer. Milōn prepares a worksheet the accountant can check.

In scope:

- Accounting profit for one year of assessment, turned into taxable income with the adjustments the accountant confirms.
- Normal tax at 27%.
- An ITR14-style company worksheet: taxable income, tax, provisional tax already counted, and the balance on that worksheet.
- An IRP6-style provisional worksheet: the full-year estimate, period 1, period 2, the 80% comparison, and the optional third top-up.
- A deadlines tracker from the company's year end: first IRP6, second IRP6, optional third payment, and the ITR14.
- A hand-off from the Financial Manager so the tax pack has an owner. A person still approves anything that leaves Milōn.

Out of scope for v1:

- Individuals, trusts, and partnerships.
- Small business corporations and the gold-mining formula. Those rates are not 27% flat. The accountant must classify the company before a later version computes them.
- Personal service providers, REITs, long-term insurers, and other special regimes.
- VAT (VAT201), employees' tax (EMP201), dividends tax, and provisional tax for natural persons.
- Assessing a penalty or interest figure and showing it as an amount due. The sample may show the 80% comparison. A rand penalty waits until the Fourth Schedule rule is confirmed for that year.
- SARS eFiling login, a SARS API, or submission of ITR14 or IRP6.
- Any write back to Xero, QuickBooks, or Sage: no journals, no tax codes, no invoices, no payments.

Years of assessment ending before 31 March 2023 used 28% for a standard company. v1 does not compute those years.

## Data needed from Xero, QuickBooks, and Sage

Reads only. Milōn already syncs a month profit and loss, a year-to-date profit and loss, and a balance sheet into `clients.financials`. That is enough to show a year end and a profit figure. It is not enough to compute taxable income. Taxable income is accounting profit plus and minus adjustments the books do not label as tax.

### Already on the file after Sync

| Need                                                | Xero                                                         | QuickBooks                         | Sage Business Cloud Accounting (South Africa) |
| --------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------- | --------------------------------------------- |
| Year end                                            | Organisation `FinancialYearEndMonth` / `FinancialYearEndDay` | `CompanyInfo.FiscalYearStartMonth` | Company financial year on the Sage company    |
| Profit before tax                                   | Year profit and loss                                         | Year profit and loss               | Year profit and loss                          |
| Depreciation and interest, if the report names them | Profit and loss lines                                        | Profit and loss lines              | Profit and loss lines                         |
| Balance sheet totals                                | Balance sheet                                                | Balance sheet                      | Balance sheet                                 |

Sync today stores the totals the health score and the cash view use. It does not store a trial balance or an account-level profit and loss. v1 of the real worksheet needs that next read, still read-only.

### Read to add before a live worksheet

| Need                                                                     | Why                                                                                |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Profit and loss by account for the year of assessment, not month-to-date | Adjustments attach to accounts                                                     |
| Trial balance for the same dates                                         | Ties the profit to the balance sheet                                               |
| Chart of accounts (code, name, type)                                     | The accountant maps an account to an adjustment once                               |
| Fixed asset cost and accumulated depreciation, if the report has them    | Wear-and-tear starts from assets, not from the accounting depreciation total alone |
| Tax control accounts, if the books recorded provisional tax payments     | IRP6 payments already made                                                         |

No new write scope. Do not ask Xero, Intuit, or Sage for a scope that can post.

### Not in the books

The accountant types these, or a later version stores them on the client. None of them come from Sync:

- Company registration number and whether it is a standard company, an SBC, or something else.
- Prior assessed taxable income and the assessment date (the basic amount, and whether the 8% uplift applies).
- Assessed loss brought forward that SARS has agreed.
- Wear-and-tear asset register when the book depreciation is not the tax register.
- Section 18A receipts, and donations that are not deductible.
- Fines, penalties, and private expenses that sit inside a general expense account.
- Exempt income that is not obvious from the account name.
- Provisional payments that were never coded to a tax control account.

The SAMPLE ignores the live ledger. Its profit, adjustments, estimate, and prior assessment are fixed numbers.

## SARS deadlines

Dates below are the statutory last day. When that day is a weekend or a SARS public holiday, payment and submission move to the next business day. v1 must apply that shift from the SARS calendar before it tells a client a date. The SAMPLE shows the statutory day and says the shift is not applied.

For a company year of assessment:

| Item                                           | When                                                                                                                  |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| IRP6 period 1                                  | Last day of the sixth month of the year                                                                               |
| IRP6 period 2                                  | The year end                                                                                                          |
| Optional third payment (section 89quat top-up) | 30 September when the year ends on the last day of February. Otherwise the last day of the sixth month after year end |
| ITR14                                          | Twelve months after the financial year end                                                                            |

A February 2026 year end, the SAMPLE company, is therefore 31 August 2025, 28 February 2026, 30 September 2026, and 28 February 2027. 31 August 2025 was a Sunday. A live tracker would not present that Sunday as the day a payment can be made.

Provisional tax is an estimate of the full year's taxable income. Period 1 is half of the tax on that estimate. Period 2 brings the payments to the full estimate. The third payment is optional and is how a company can align payments with the eventual taxable income and limit section 89quat interest. This plan does not compute that interest.

The second estimate is compared with 80% of actual taxable income. Above R1 million of taxable income, the basic-amount safe harbour does not apply. Confirm the current Fourth Schedule wording before any live screen shows a penalty.

## Risks

- **Wrong company class.** 27% is wrong for an SBC, a gold miner, and a year that still used 28%. The worksheet must show the class it assumed.
- **Management accounts are not the return.** A synced profit and loss can be mid-year, cash-basis, or missing the audit adjustments. The accountant has to mark the year as final.
- **Adjustments are the tax.** Depreciation, wear and tear, exemptions, donations, and the assessed loss move the number more than the 27% rate does. A blank adjustment list that taxes accounting profit is not a return.
- **Underestimation.** A low second estimate can draw a penalty. The SAMPLE only shows the comparison. It does not tell the user they are safe to file that estimate.
- **Deadline shift.** A Sunday statutory date is not the SARS due date. Shipping the unshifted date as a reminder would be wrong.
- **Stale basic amount.** The prior assessment may be more than 18 months old, in which case the basic amount increases. v1 must not invent that uplift.
- **Filing the sample.** Every figure on the sample screen is labelled SAMPLE. A later saved worksheet needs the same separation until an accountant signs it.
- **Ledger writes.** A tax journal posted back to Xero, QuickBooks, or Sage would change the books the rest of Milōn reads. v1 does not post.
- **SARS credentials.** A password or eFiling token does not belong in this version. Submission stays in eFiling, done by the accountant.
- **US bundle.** The sample is a separate client chunk, loaded only when the resolved market is ZA. US visitors do not see the card, and the US-reachable assets must not contain the chunk.

## Phases

1. **SAMPLE, this change.** Fixed company, 27%, ITR14 and IRP6 worksheets, deadlines, and a Financial Manager hand-off. ZA only. No model call, no SARS, no ledger write. No database migration.
2. **Year from the books already synced.** Show the stored year-end and the stored profit beside empty adjustment lines the accountant fills in. Still no submission and no write to the ledger.
3. **Account-level read.** Profit and loss by account and a trial balance from Xero, QuickBooks, and Sage South Africa, read-only. The accountant maps accounts to adjustments. The mapping is stored on the client, not pushed back.
4. **Saved year.** One worksheet per client per year of assessment, with the deadlines on the practice calendar. Reminders use the business-day shift. The accountant still files outside Milōn.
5. **Pack for eFiling.** Export the worksheet the accountant uses while filing. SARS login, a SARS API, and submission are a separate decision and are not part of v1.

## What the sample demonstrates

Harbour & Co (Pty) Ltd, year ended 28 February 2026, looked at on 19 October 2026. Accounting profit R 1 850 000.00, adjustments as on the worksheet, taxable income R 1 828 500.00, tax at 27% R 493 695.00. The IRP6 estimate is R 1 700 000.00 of taxable income, split into two payments of R 229 500.00, with an optional top-up of R 34 695.00. The estimate clears 80% of the sample taxable income. Those figures are computed in `src/lib/tax-specialist/sample-compute.ts` and do not change from one visit to the next.
