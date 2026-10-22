# J4 ZA Analyst header eats the pro-rata months

AQA gate FAIL on prod `715486a7`, firm 1020F. The Analyst page header read:

> Gross profit is R 187 444. Net profit is R 29 711. Mar–Full year on file, pro-rated from your Jan–Full year on file.

Expected: `Mar–Sep 2026, pro-rated from your Jan–Sep 2026 statement`. The Home card and the Budget header already showed that sentence.

## Cause

`proratedPeriodLabel` (`src/lib/firm-year-label.ts`, Deno twin `supabase/functions/_shared/firm-year-label.ts`) builds `Mar–Sep 2026, pro-rated from your Jan–Sep 2026 statement`.

`rewriteSavedMonthStamp` turns `<Mon YYYY> statement` into `Full year on file`. `rewriteDraftMonthStamp` does that and then turns any remaining `Mon YYYY` into the same phrase (`src/lib/statement-period.ts`). Both `Sep 2026` spans in the label match.

The Analyst header runs that rewrite on a sentence that already contains the label:

- Accountant client file: `homeLines` → `MilonTeamPane` → `rewriteDraftMonthStamp` → `AgentStage`.
- Accountant practice thread: `PracticeAgentThread` → `rewriteDraftMonthStamp`.
- Owner chat lede: `findingSentence` → `formatFindingProse` → `rewriteDraftMonthStamp`.

There is no second copy of these rewrites under `supabase/functions`. `brain-deliverable-draft` imports `rewriteSavedMonthStamp` from `src/lib/statement-period.ts`, so the same shield covers that path.

## Why #793 missed it

#793 attached the pro-rata sentence where the label is applied after period formatting. The Budget header inserts `fiscalStatementSlice().label` in `budgetCaptionActuals`. Home builds the profit sentence in `owner-answers` and renders it directly. Neither of those strings then passes through the month-stamp rewrite.

The Analyst header does the opposite. The label is already in the sentence, and the rewrite runs afterwards. #793 did not change `rewriteSavedMonthStamp` or `rewriteDraftMonthStamp`.

## Fix

Before either rewrite, a span that `isProratedPeriodLabel` accepts is masked and restored afterwards. A plain `Sep 2026 statement` is still `Full year on file`.

`src/lib/firm-year-label.ts` is Eng2-owned and imports `@/`. This file is on the Deno graph (`ask-ai`, `milon-bot`, `brain-propose`, `brain-deliverable-draft`), so the matcher is imported from the twin, which has no `@/` import. The function is not copied.

## Verification

`pnpm test:j4-za-analyst-prorata`

- The 1020F sentence fails on base (`Mar–Full year on file, pro-rated from your Jan–Full year on file.`) and stays intact after the fix, for both rewrites.
- `Sep 2026 statement` still becomes `Full year on file`.
- A stamp beside a pro-rata label is still rewritten. A dated day stays. A cross-year label stays.
