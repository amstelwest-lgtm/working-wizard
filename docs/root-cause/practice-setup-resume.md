# Practice setup resume loses the draft, and covered steps do not reload

## Cause

Answering two questions, leaving `/practice/setup`, and coming back shows the old confirmed plan ("Saved", the #927 steps) instead of the in-progress draft at question 3.

`PracticeSetupInterview` loads the confirmed plan and the draft together, then returns as soon as `saved.steps.length > 0`. The draft is only used when there is no plan. A firm that already confirmed a plan in #927 can never resume a later interview, even when the draft row is present.

The draft write itself is on the path the page uses. `firmInterviewTurn` posts `action: "firm_turn"`, and that handler calls `saveFirmInterviewDraft` after a question. The client read is `fetchFirmInterviewDraft` on `milon_brain_rules`. The private-row select policy allows any active private row for a firm member. It does not filter `task_type`, so `practice_setup_interview` is readable. The boot order throws that row away.

The same confirm path drops the "Already covered" rows on a later visit. `clientSetupBrainRows` writes only `bucket === "client_setup"`. Covered steps are in the plan shown at confirm time, then omitted from `milon_brain_rules`. `practicePlanFromConfirmRules` can only rebuild rows that were stored, so a revisit shows the two client-setup lines and not the two covered lines.

## Files

- `src/components/practice-setup-panel.tsx` (boot order)
- `src/lib/setup-partner-client.ts` (`fetchFirmSetupPlan`, `fetchFirmInterviewDraft`, `firmInterviewTurn`)
- `supabase/functions/setup-partner/index.ts` (`firm_turn` save, `confirm` clear)
- `src/lib/setup-partner-plan.ts` (`clientSetupBrainRows`, `practicePlanFromConfirmRules`)
- `supabase/migrations/20261109210000_milon_brain_rules_p1.sql` (select policy; no task filter)

## Why the earlier fix missed it

#929 stored the draft and reloaded it only when the firm had no confirmed plan. The AQA firm already had the #927 plan, so the new branch never ran. #929 also kept the #927 rule that covered steps are not stored, so a revisit could not show "Already covered".

## How it is verified

A panel boot with both a saved plan and a draft question stays on the interview and shows that question. `clientSetupBrainRows` stores a covered step and a client-setup step, and `practicePlanFromConfirmRules` returns both buckets.
