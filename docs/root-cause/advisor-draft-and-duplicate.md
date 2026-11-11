# Advisor draft reason is dropped, and debt-to-equity is two stored rows

## Cause

Retry on "Reduce short-term debt by refinancing into longer-term facilities" ends as "Advisor couldn't draft this, no draft was saved". The Advisor's `record_draft` call is refused in `prepareDraftRecord` when the title or detail cites a number that is not in the books just read, or when the insert fails. That string is stored on the trace step (`detail`) and returned to the model. `recordHandoffFinish` does not read the trace. If no finding row is written, it saves the generic sentence from an empty run summary. `agent_runs.error` is cleared on the success path, so the refusal never reaches the action row.

"Bring debt-to-equity under the target" appears twice because two `action_items` rows display as that title. One row is stored as that title (`debtToEquity`). The other is stored as "Target a D/E below 1×…", and `actionDisplayTitle` rewrites it to the same words. They have different ids and different raw titles, so `actionTitleKey` does not group them. Suggested — confirm prints every open row through `actionDisplayTitle`, so both lines look identical. The #927 dedupe only collapsed the in-memory playbook list inside `rankStrategicMoves`. It did not look at rows already stored, and it did not change the key the suggestion list uses.

## Files

- `supabase/functions/_shared/agent-desk.ts` (`prepareDraftRecord`, `recordAgentDraft`)
- `supabase/functions/_shared/agent-core/job.ts` (`recordHandoffFinish`)
- `src/lib/owner-handoff.ts` (`handoffCouldNotDraftSentence`, `handoffFinding`)
- `src/lib/action-plan-automation.ts` (`planAutomation`, `actionTitleKey`)
- `src/lib/strategic-moves.ts` (`actionDisplayTitle`)
- `src/components/action-plan-automation.tsx` (Suggested — confirm)

## Why the #927 fix missed it

#927 saved a finding from a finished summary when no figures were pooled. The live run does not get that far: `record_draft` fails first, the model stops, and the summary passed into the finish note is empty. The tool error stays in the trace. The duplicate fix rewrote the catalog's action array. Chill Pepper already has two rows in `action_items`. Display still maps both through `actionDisplayTitle` and the suggestion list still keys duplicates on the raw title.

## How it is verified

`scripts/owner-handoff-test.mts` feeds a trace whose `record_draft` step failed with a citation error and an empty summary. The finish reason is that citation error, not "no draft was saved". `scripts/action-plan-automation-test.mts` groups "Bring debt-to-equity under the target" with "Target a D/E below 1× for conservative businesses, below 2× for growth" as one duplicate, and Suggested — confirm keeps a single row. The edge writes that reason onto `agent_runs.error`.
