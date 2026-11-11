# Why the settled pill stayed "Couldn't draft"

Chill Pepper action `a518b7e6-b5dd-4ffe-91f9-813590f72d47`, after Retry, with advisor v36, owner-handoff v25, and Financial Manager v41. The note `Advisor passed this to the Financial Manager: Reduce short-term debt…` was stored. The chip still said Couldn't draft, and the row said `Advisor couldn't finish this one · Retry`.

## What each surface reads

The chip and the row label both come from `describeActionHandoff` in `src/lib/action-handoff.ts`. The same result is passed to the owner action plan and the accountant action plan (`ItemRow`).

- The chip is `phaseLabel`. `phaseForAction` looks at `agent_runs.status`. A settled run (`succeeded`, `partial`, `failed`, `dead`) with no finding is phase `failed`, and `handoffPhaseLabel` turns that into `Couldn't draft`. `handoffSettledPill` replaces that only when the text it is given matches `passed this to the …`.
- That text is `result.text`, else `agent_runs.summary`. `result.text` is `latestHandoffResult`, which keeps only a note containing ` finished: `. The pass-along note has no ` finished: `, so it is skipped. An older `Advisor finished: …` or cost-ceiling note wins. When that body contains `Stopped before another model call so the run stays within its cost ceiling.`, the row caption is `handoffCouldNotFinish`: `Advisor couldn't finish this one`, and Retry is drawn because the caption contains `couldn't finish this one`.
- `recordHandoffFinish` does write the pass-along sentence onto `agent_runs.summary` and `agent_runs.error`, with `status: partial` and `stop_reason: no_draft`. The client SELECT in `use-agent-activity` loads `summary` and does not load `stop_reason` or `error`. Even when `summary` is the pass-along sentence, the older ` finished: ` note is preferred, so the pill never sees it.
- While `phaseLabel` is null (the new run is not in the snapshot yet, or the assignee does not match the run), the health chip falls through to the action health label `Off track`, and the sent column renders `Not sent`. That is the flash after Working.
- The red toast is not `agent_runs`. Owner Retry in `action-plan.tsx` calls `commitActionHandoff` and, when `result.ok && result.noted !== true`, toasts `Couldn't hand this over`. A retry that finds the hand-off already open returns `{ ok: true, reused: true, noted: false, runId, status }` from owner-handoff (`handoffRunToKeep` or the idempotency collision). Hand to on both sides returns before that toast. The Retry button does not. `handoffFailureMessage` also maps any snake_case error code to the same sentence, but this spot is the `noted !== true` branch.

## Why #932 did not change the settled row

#932 taught `handoffSettledPill` to read `passed this to the`. It still fed that function `latestHandoffResult` first. That reader never returns the pass-along note. The Retry toast and the null-phase health fallback were not in that change. Owner and accountant rows share `describeActionHandoff` and `ItemRow`; only the Retry handler was owner-only, so the toast was the owner row.

## What the hand-off path writes

owner-handoff queues `agent_runs` with `status: queued` and writes or updates the `Handed to` `action_updates` row. The response is `{ ok: true, noted: true, runId, status: "queued" }`, or `{ ok: true, reused: true, noted: false, runId, status }` when the action is already handed. `recordHandoffFinish` then sets `agent_runs` to `{ status: "partial", stop_reason: "no_draft", summary, error }` where `summary` and `error` are the pass-along sentence, and updates the outcome `action_updates` row to that sentence.

## How this is verified

One helper reads the owner-handoff response and the `agent_runs` row together. A partial run whose summary is the pass-along sentence, plus an older cost-ceiling ` finished: ` note, settles the chip and the row label to `Handed to Financial Manager` and does not offer the error toast. `{ ok: true, reused: true, noted: false }` is success. With a bot assignee and no phase yet, the chip stays `Working` and the sent column does not say `Not sent`.
