# J2 retest: a balance sheet is blocked, and Add as Q3 never lands

Prod @ `13a72c3f`, after PR #676 (merged as `07995439`). Fresh firm 1020D, client `24149d9c-4e27-4fc2-9b98-1a92767e3bc3`.

1. Import `demo-pl-sep-2026.csv` (read as Jan 1 – Sep 30 2026), then `demo-bs-30sep-2026.csv`. Review says `Importing as Sep 2026 (period end 2026-09-30)` and shows cash 46,300. Confirm & import and Retry both return `Couldn't read the period in this file. The books show Jan 1 – Sep 30, 2026. Set the start and end dates before importing.` The screen only has Month and Year. Cash and Assets never arrive, so Health never gets the fourth pillar.
2. A Q3 P&L (`pl-q3-dmy-long.csv`) asks the right question (`This file covers Jul 1 – Sep 30, 2026 (3 months). The books show Jan 1 – Sep 30, 2026 (9 months). Replace the year-to-date figures, or add this as Q3?`). Add as Q3 does not import. The same question comes back.
3. `pl-unreadable-period.csv` does not hold Confirm. It says `Period not detected. Choose the month and year…` and Confirm is enabled. There are no start or end fields.

ZA `01/07/2026-30/09/2026` and `Q3 2026` still read as Jul 1 – Sep 30. The #673 budget window is unchanged.

## (a) Why a balance sheet is asked for a period range

A balance sheet is a point in time. `parsePeriod` in `src/lib/statement-parse.ts` treats `As of September 30 2026` as an end date only: `start` and `months` stay null. That parse is correct. `statementSpan` then refuses anything that is not a start and an end, so the file span is null.

`planStatementImport` in `src/lib/statement-import-plan.ts` runs this before it looks at the statement kind:

```
if (!fileSpan && liveSpan) return { action: "block", ... }
```

The Jan–Sep P&L already stored a span, so a balance sheet with a real period end is classified as “period unreadable” and blocked. The same gate is what `liveCoverageForImport` uses: once books have a span, a missing range is not filled, and the plan never reaches the balance-sheet merge. Nothing in that path treats a point-in-time statement differently from a P&L. A detected period end on a balance sheet is enough to import. The range check exists only because #676 reused the P&L guard for every kind.

## (b) Why the start and end fields never render

The block sentence says `Set the start and end dates before importing.` Neither upload surface has those inputs.

- Accountant `src/components/upload-financials.tsx` renders a Month `<select>` and a Year input. Confirm is enabled when a month is chosen (`disabled={!acceptedQuality || !chosenPeriod || applying}`). An unknown P&L therefore shows `Period not detected. Choose the month and year…` with Confirm on. A balance sheet whose end date was read still confirms, then the handler blocks.
- Owner `src/components/extraction-review-modal.tsx` prints a period label (`As of …` or `Period unknown`). There is no date control. Confirm is enabled once the quality checkbox is ticked.

The copy was written in the plan module. The panels were not given the fields the copy names.

## (c) Why Add as Q3 loops

The question is produced correctly. `planStatementImport` returns `action: "choose"` until `choice` is `add_period` or `replace_ytd`. `UploadFinancials` does pass that choice as the fourth argument of `onConfirm`. The accountant page drops it:

```
onConfirm={(result, prefs, period) => handleConfirmFinancials(result, prefs, period)}
```

`handleConfirmFinancials` in `src/routes/_authenticated/clients.$clientId.tsx` therefore calls the plan with `choice: null`. The spans still differ, so the plan returns `choose` again. Nothing is written, and the same question is painted again. Retry calls confirm with no choice, so it loops the same way. Replace takes the same dropped argument, so it loops too.

The owner modal does forward `periodChoice` into `planStatementImport`. The loop AQA hit is the accountant adapter, not the plan. #676’s test called `planStatementImport({ choice: "add_period" })` directly and never clicked the button through `clients.$clientId.tsx`.

## Why #676 and the earlier fixes missed it

#656 stopped a missing cash line from becoming $0. It did not compare periods, so a quarter could still replace year-to-date.

#676 added the unknown-span block so a P&L with no readable range would not be expanded to financial-year-to-date over existing books. The check is kind-blind, and a balance sheet’s as-of date has no range, so the block fires on the second file of the normal P&L-then-BS sequence. The tests asserted the plan function, not the accountant `onConfirm` adapter, so a choice that the plan accepts and the page discards still passed. The block message was not checked against the controls on the screen.

## How to verify

One test drives the accountant confirm the page actually calls, then the owner confirm:

- After the Jan–Sep demo P&L, `demo-bs-30sep-2026.csv` imports. Live cash is 46,300, assets are present, and the result is not the block sentence.
- Add as Q3 is passed through the page adapter and the second call returns `history`, not `choose`. Replace returns `live` with the quarter’s own dates.
- An unknown-period P&L, with books already on file, renders start and end fields on both upload surfaces, and Confirm stays disabled until both are set. The server sentence does not ask for a control the screen does not show.

`01/07/2026-30/09/2026` and `Q3 2026` still parse as Jul 1 – Sep 30. No migration.

## Files

`src/lib/statement-import-plan.ts`, `src/lib/statement-parse.ts`, `src/components/upload-financials.tsx`, `src/components/extraction-review-modal.tsx`, `src/components/import-apply-notice.tsx`, `src/routes/_authenticated/clients.$clientId.tsx`, `src/routes/app.tsx`, `src/components/accountant-ratios.tsx`.

## Addendum: Add as Q3 throws `sn is not a function`

Prod after #683 (`472231a1`), US and ZA clients. A year-to-date P&L for Jan 1 – Sep 30 is on file. A Q3-only P&L shows `Replace year-to-date` / `Add as Q3`. Add as Q3 paints a red `Import failed. sn is not a function`. Retry asks the same question. Replace, a balance sheet after the year-to-date P&L, and an unknown period still import. The same throw happens for a ZA client, so it is not the market formatter.

### Cause

`sn` is the minified name of the local `statementSpan` in `ClientView`, not a missing export.

`src/routes/_authenticated/clients.$clientId.tsx` imports the function `statementSpan` from `src/lib/statement-import-plan.ts` (line 91). Later in the same function it declares a books label with the same name (line 1724):

```
const statementSpan = statementSpanLabel({ ... })
```

`statementSpanLabel` (`src/lib/statement-period.ts` line 101) returns `string | null`. That `const` is in scope for the whole of `ClientView`, so it hides the import. The Add-as-Q3 branch is the only confirm path that calls it (line 2994):

```
const stored = statementSpan(row.financials?.periodStart, row.financials?.periodEnd)
```

That call runs the label string. The production chunk `clients._clientId-CYB_RMPg.js` minifies the binding to `sn` and the history lookup is `sn(co.financials?.periodStart, co.financials?.periodEnd)`. V8 reports `sn is not a function`. Nothing was written, so the books stay Jan–Sep. Retry confirms again with no choice, the plan returns `choose`, and the same question comes back.

Replace, the balance-sheet merge, and the unknown-period block never call `statementSpan` inside `handleConfirmFinancials`, so they do not hit the shadowed name.

### Why #676 and #683 missed it

#676 tested `planStatementImport({ choice: "add_period" })` as a function call. The plan returns `history`. The throw is after that, in the page’s snapshot lookup.

#683’s `scripts/j2-period-import-test.mts` clicks Add as Q3 on `UploadFinancials` and `ExtractionReviewModal`, but `onConfirm` is a test double. That double calls `confirmUploadedStatement` and returns. It never renders `ClientView`, so it never executes line 2994. The file check only asserts that the source contains `passStatementChoice(handleConfirmFinancials)`. A choice the plan accepts still passes while the page calls a string.

### Owner path

`src/routes/app.tsx` imports `statementSpan` (line 144) and calls it in the history branch (line 6934). It does not declare another `statementSpan`. In `app-CM55Pkuh.js` that import is `gj as Lr`, and the history lookup is `Lr(...)`. Owner Add as Q3 does not throw this TypeError. `accountant-ratios.tsx` does not call `statementSpan` when it files a period.

### How to verify

- Resolve the `statementSpan(...)` call inside `handleConfirmFinancials` to the import from `statement-import-plan.ts`, then call that function. While line 1724 still uses the name `statementSpan`, the call is the label and this fails.
- Click Add as Q3 on the accountant upload and the owner review. The confirm that runs is the real `confirmUploadedStatement` plus the real `statementSpan` snapshot match, not a double that stops at the plan.
- Check the minified history lookup still calls a function.
- After a failed import, choosing another file or reopening the dialog clears `Import failed…` and the button reads Confirm again, on the accountant upload and the owner review.
- No migration.
