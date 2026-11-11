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

## Addendum: why #928 missed it

The 11 Nov 16:56 UTC Advisor run `a9326f0b-ff59-44ab-b883-7d6f5387dbc4` on action `a518b7e6-b5dd-4ffe-91f9-813590f72d47` still finished with an empty `agent_runs.error` and the summary "Advisor couldn't draft this, no draft was saved for this action". The trace is not empty. `record_draft` failed first with "The title or detail cites R 97,050, R 41,793, R 50 000, R 95,895, which is not in the books that were read." A second `record_draft` then returned ok and deduped, so this run still has no finding of its own. The deployed advisor function stayed on v33, so the #928 finish path that copies the trace detail onto `agent_runs.error` and the note did not run. The pill reads the stored note, which stayed the generic sentence.

The refusal is also a misfire. The draft says week 1 closes at -R 41,793 and the low is -R 97,050. The saved cashflow stores those closings as -41793 and -97050. The citation parser dropped the minus that sits before R, so it looked for the positive amounts and missed. R 50 000 is the saved `capexAmount`, which the cashflow reader never copied into the figure pool. #928 only tried to show that refusal. It did not make the numbers match the books, and each retry inserted another "Handed to" note and another failure note.

## Addendum 2: why #930 missed it

The 11 Nov 20:42 SAST Advisor run `2bced2f2-284f-4185-aa1f-0776c1c07d8f` finished `partial` / `no_draft` in about 11 seconds. `agent_runs.error` is `no draft was saved for this action`. The trace has the usual reads, then two `record_draft` calls. Both returned `recorded: true`, `deduped: true`, `to_agent: financial_manager`, finding `952dabf2-4652-49f2-be50-e804f28c8b07`. That finding is an older cashflow draft ("The saved cashflow goes negative from week 1…"). This run inserted no new finding for the refinancing action.

#930 fixed the sign and the capex pool, and it copies a failed `record_draft` detail onto the note. These calls did not fail. The finish then treats "Drafts are recorded" as not a reason, so it writes the generic sentence. A deduped hand-off is not a draft of this action, and nothing asked the model to draft the action or to say why it would not. `lowest_closing` is -97049.5, so a cited 97,050 is the nearest rand and must match.

## How the follow-up is verified

A run whose only writes are deduped hand-offs asks once more, with tool choice left on auto, to draft the action or state why it cannot. If that still saves nothing, the note names the hand-off, for example "Advisor passed this to the Financial Manager: <finding title>". A stored -97049.5 matches a cited 97,050, and `R 40,000-R 50,000` stays two positive amounts.
