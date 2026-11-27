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
- Eighth Schedule capital gains are signed off below for 2026 and 2027
  only. Any other year of assessment stays blank. Paragraph 20 is unchanged
  and is still not signed off.
- A due date on a weekend or public holiday moves to the last business day
  before it (G01, "last working day prior to the public holiday or weekend"). `docs/tax-specialist-plan.md` says the next business day;
  the sheet follows SARS.

## Eighth Schedule

Fetched on 27 November 2026. The disposal register uses these figures only.
The death-year exclusion is published and is not applied. The inclusion-rate
page on sars.gov.za tables 2018 and 2019 only, so it is not the source for
these years.

| Year of assessment | Period the source covers | Annual exclusion | Primary residence exclusion | Inclusion, individual | Inclusion, company |
| --- | --- | --- | --- | --- | --- |
| 2026 | 1 March 2025 – 28 February 2026 | R40 000 | R2 000 000 | 40% | 80% |
| 2027 | 1 March 2026 – 28 February 2027 | R50 000 | R3 000 000 | 40% | 80% |

2026 exclusions. The Budget tax guide for 2025/26, updated 21 May 2025, covers
1 March 2025 to 28 February 2026. It says “Two million rand gain or loss on
the disposal of a primary residence” and “Annual exclusion of R40 000 capital
gain, or capital loss”. Fetched 27 November 2026 from
https://www.sars.gov.za/wp-content/uploads/20256/Budget-tax-guide-21-May-2025.pdf.
The annual-exclusion page gives a natural person R40 000 for 2017 to 2026.
Fetched 27 November 2026 from
https://www.sars.gov.za/types-of-tax/capital-gains-tax/proceeds/calculation-of-taxable-capital-gains-and-assessed-capital-losses/annual-exclusion/.

2027 exclusions. The Budget tax guide for 2026/27 covers 1 March 2026 to
28 February 2027. It says “R3 000 000 gain or loss on the disposal of a
primary residence” and “Annual exclusion of R50 000”. Fetched 27 November
2026 from
https://www.sars.gov.za/wp-content/uploads/Docs/Budget/Budget2026/Budget-tax-guide-2026-web-version.pdf.
The same annual-exclusion page gives a natural person R50 000 for 2027. The
Capital Gains Tax rates page, last updated 26 February 2026, says the
25 February 2026 budget changed exclusions and not percentages, and lists
R3 000 000 and R50 000. Fetched 27 November 2026 from
https://www.sars.gov.za/tax-rates/income-tax/capital-gains-tax-cgt/.
The Budget 2026 questions page says the exclusions from 2 March 2026 are
R50 000, up from R40 000, and R3 000 000, up from R2 000 000. Fetched
27 November 2026 from
https://www.sars.gov.za/about/sars-tax-and-customs-system/budget/budget-2026-frequently-asked-questions/.

Inclusion rates, both years. The Tax Guide for Share Owners, Issue 9,
6 August 2026, is written for the 2027 year of assessment and states the
2026 annual exclusion beside it. It says 40% of the net capital gain is
included for a natural person, and that the inclusion rate is 40% for natural
persons and special trusts and 80% for companies. It also says a company
includes 80%, an effective 21.6%, for a year of assessment commencing on or
after 1 April 2022, which covers 2026 and 2027. Fetched 27 November 2026 from
https://www.sars.gov.za/wp-content/uploads/Ops/Guides/Legal-Pub-Guide-IT11-Tax-guide-for-share-owners.pdf.
The Capital Gains Tax rates page shows the same effective rates for 2026 and
2027, 18% for an individual and 21.6% for a company, and says the percentages
did not change.

The sheet is our own layout. It does not copy the SARS form artwork or logo.
