# J2 repeat: P&L-only quarter replaces the year-to-date books

Prod @ `58982e1d`, after PR #656. Client `AQA Gate Throwaway 1020B` (`7b111d2a…`). Books were Jan 1 – Sep 30 2026 (score 75, cash $46,300, GP $241,000, NP $38,200) plus an earlier balance sheet. Uploading `pl-only-q3-2026.csv` (Jul 1 – Sep 30 2026, no balance sheet) and confirming replaced the P&L with the quarter (GP $106,000, NP $37,000) while every label still said Jan 1 – Sep 30, 2026. Cash left the Financial Manager card (`CRITICAL Receivables are the strain`), the Cash pillar fell to 34, and the score went 75 → 63. The toast was only `Imported, income statement updated`.

## Cause

The file’s covered dates never reach the write, so a 3-month P&L is stored on the 9-month span.

1. `parsePeriod` in `src/lib/statement-parse.ts` understands `January - September 2026` and a single `Sep 30, 2026`. It does not understand `Jul 1 - Sep 30 2026`. On `Profit and Loss,Jul 1 - Sep 30 2026` the date cell is taken as the company name, and a parse is kept only when `parsed.label` is set. `extractFinancials` (owner CSV) therefore returns no `periodStart` and no `periodMonths`.
2. The accountant confirm (`UploadFinancials` → `handleConfirmFinancials` in `src/routes/_authenticated/clients.$clientId.tsx`) does not use a start date. The reviewer picks a month. `importPeriodFromParts` forces month-end, and `defaultPeriodCoverage` with only `2026-09-30` expands a month-end to financial-year-to-date (1 Jan–30 Sep, 9 months). The portal extractor `extractFinancialsFromPDF` never runs the CSV parser, so Claude’s `period_end` is the only date the screen sees.
3. Labels are formatted from the stored `periodStart` / `periodEnd`. Those stay Jan 1 – Sep 30. The income figures are the quarter. A quarter is shown as nine months.
4. Debtor days, creditor days, and working-capital days sit on the Cash pillar and use revenue. Assets and Financing mix the same P&L with the old balance sheet. Revenue falls to a quarter while the cover stays nine months, so Cash is rescored (receivables strain) even though the cash line itself was not in the file. The card then quotes the strain instead of cash.
5. Income lines the quarter does not contain stay on the books. `mergeStatementFinancials` will not replace a figure with a blank, so the previous operating expenses ($189,000) stay beside the new revenue ($182,000). Fixed cost ratio is 189,000 / 182,000 = 103.8%. Tax is not in the file, and net profit is filled from profit before tax, so tax burden is 37,000 / 37,000 = 100%.
6. The owner Budget tab then annualises that mixed blob as nine months. Chart revenue is 182,000 × 12/9 = $242,667. The verdict’s nine-month slice round-trips to $182,000. Chart net $69,232 × 9/12 = $51,924 under Profit vs budget, while the year table still shows the previous operating income $52,000 as Net profit. “No prior year on file.” is true, and the how-built line still says the plan was built from last year’s actuals.

## Why #656 missed it

#656 (`mergeStatementFinancials`, `liveHealthFromBooks`) stops a missing cash line from becoming $0 and leaves that pillar unscored when the file has never had a balance sheet. It does not compare the incoming period length with the books, does not keep the file’s own dates, and does not stop a later P&L from rescoring Cash, Assets, or Financing while an earlier balance sheet is still the position on file. The toast names the statement that updated and does not say the balance sheet was absent.

## Fix

One gate, both upload sides.

- Read a day-bounded range from the file, including a market numeric range (`01/07/2026-30/09/2026` in ZA, `07/01/2026-09/30/2026` in the US, with spaces, an en-dash, or `.` / `-` separators) and `Q1`–`Q4 YYYY` (including `Q3 FY2026`). The parser wins over the model for CSV text, including the span.
- A file whose period cannot be read never writes the live books when those books already have a span. The confirm asks for the start and end instead of expanding a month-end into the financial year. That expansion stays only for a first import.
- A different span never writes the live P&L by itself. The panel asks: replace the year-to-date figures, or add this quarter as its own period (Q3 when the span is a calendar quarter).
- Replace stores the file’s own dates, so the label matches the figures, and keeps the previous balance-sheet position. Cash, Assets, and Financing stay on the scores from before that P&L. The note is `as at <market date>, from earlier statement`.
- Add-as-period writes a snapshot only. Live books, the score, and sign-off do not move.
- The toast and the review name what changed, that the balance sheet was missing, and one next action: `Upload a balance sheet to keep cash current.`
- A live replace still bumps `financials_updated_at`, so the owner chip stays `Financials: signed off · figures changed`. A history-only add does not.
- On that replace, income lines the file does not contain are cleared. The previous fixed costs, operating profit, tax, and net profit do not stay beside the quarter. Balance-sheet amounts stay. Cash, Assets, and Financing scores stay on the earlier statement. A line that says profit before tax, with no tax and no profit after tax, is not filled in as net profit. A management account that never had a tax section still ends on the derived profit.
- A ratio that needs a missing line, or that would mix the new P&L with the earlier balance sheet, is not a number. The row says `Not enough data`.
- The owner Budget tab (and the accountant budget chart) totals the same months the verdict compares. When the comparison is statement pace, the year table’s net profit is that same window. The how-built line says the plan came from last year only when a prior year is on file.

## How to verify

`pnpm test:pl-only-period` with the Q3 CSV against the Jan–Sep demo books: the import asks instead of writing; replace keeps cash and the Cash pillar and labels Jul 1 – Sep 30; add-as-Q3 does not touch the live blob. The same test renders the owner Budget tab: verdict, chart totals, and the year-table net profit are one window, and the how-built line does not claim a prior year that is not on file. Fixed cost ratio and tax burden read `Not enough data`. US and ZA dates go through `formatDateRange`. `pnpm test:statement-parse`, `test:statement-import`, `test:statement-notes`, `test:pl-only-cash`, and `test:budget-figures-parity` still pass.

## Files

`src/lib/statement-parse.ts`, `src/lib/statement-financials.ts`, `src/lib/statement-import-plan.ts`, `src/lib/statement-import-apply.ts`, `src/lib/health-score.ts`, `src/lib/ratios.ts`, `src/lib/report-coherence.ts`, `src/lib/extractFinancials.server.ts`, `src/lib/financialSchema.ts`, `src/lib/statement-notes.ts`, `src/lib/owner-answers.ts`, `src/lib/financial-manager-brief.ts`, `src/lib/budget.bridges.ts`, `src/lib/budget.types.ts`, `src/lib/budget-year-compare.ts`, `src/components/upload-financials.tsx`, `src/components/extraction-review-modal.tsx`, `src/components/import-apply-notice.tsx`, `src/components/budget/budget-simple-view.tsx`, `src/components/budget/budget-chart-table.tsx`, `src/components/budget/budget-workspace.tsx`, `src/routes/_authenticated/clients.$clientId.tsx`, `src/routes/app.tsx`, `src/components/accountant-ratios.tsx`, `src/components/owner-door/owner-door.tsx`, `supabase/functions/milon-bot/execute.ts`, `supabase/functions/agent-analyst/execute.ts`, `supabase/functions/_shared/agent-desk.ts`.

No migration. No new RPC. No ledger writes.
