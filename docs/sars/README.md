# SARS sources for the Tax Specialist

Downloaded on 29 October 2026 from sars.gov.za. The IRP6 preparation sheet
(`src/lib/tax-specialist/forms/irp6.ts`) follows these two guides.

| File | Source | Version |
| --- | --- | --- |
| `GEN-PT-01-G01-Guide-for-Provisional-Tax-External-Guide.pdf` | https://www.sars.gov.za/wp-content/uploads/Ops/Guides/GEN-PT-01-G01-Guide-for-Provisional-Tax-External-Guide.pdf | Revision 28, effective 16 October 2026 |
| `GEN-PT-01-G02-How-to-eFile-your-Provisional-Tax-Return-External-Guide.pdf` | https://www.sars.gov.za/wp-content/uploads/Ops/Guides/GEN-PT-01-G02-How-to-eFile-your-Provisional-Tax-Return-External-Guide.pdf | Revision 5, effective 27 June 2025 |

The G02 guide ("How to eFile your Provisional Tax Return") is the current SARS
guide to completing the IRP6. It lists the eFiling field names the sheet maps to.
The G01 guide ("Guide for Provisional Tax") covers the periods, the basic
amount, the 80% and 90% estimate tests, and the due dates.

What the sheet takes from them:

- Company particulars on eFiling: Year of assessment, Period, Taxpayer reference
  number, Registered name.
- Company estimate on eFiling: Gross Income (Turnover/Sales/Other Income),
  Estimated taxable income, Employees' tax for this period (mandatory, 0.00 when
  nil), Foreign tax credits for this period.
- Worked out by eFiling: Tax on estimated taxable income, Tax for the full year,
  Provisional tax paid for the first period, Tax payable for this period.
- Basic amount (Fourth Schedule paragraph 19(1)(d)): taxable income on the
  latest preceding assessment, excluding taxable capital gains, lump sums,
  severance benefits and retirement-fund withdrawals. When that assessment's
  year ended more than 18 months before the end of the year of assessment,
  the sheet adds 8% of the reduced amount for each completed year in the gap.
  Without the assessment year end, the sheet flags the uplift and does not
  invent it.
- Paragraph 20 underestimation penalty is calculated for the second period.
  It is not signed off here for any year of assessment, so the sheet, the
  PDF, and the CSV do not show a rand penalty.
- Eighth Schedule capital gains. These guides do not state an inclusion
  rate, an annual exclusion, or a primary residence exclusion for any year
  of assessment. Those figures are not signed off. The disposal register
  still records each gain or loss. The taxable capital gain stays blank on
  the sheet, the PDF, and the CSV until a year is signed off here.
- A due date on a weekend or public holiday moves to the last business day
  before it (G01, "last working day prior to the public holiday or weekend"). `docs/tax-specialist-plan.md` says the next business day;
  the sheet follows SARS.

The sheet is our own layout. It does not copy the SARS form artwork or logo.
