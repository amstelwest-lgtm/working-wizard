# Diagnose still narrates negative days, WC 162, and GM 104.6%

AQA gate FAIL on prod `4940fee2`, Chill Pepper `79c4c485` (Practice·Theo). The Diagnose narrative still reads, in substance:

> Full year on file show negative creditor and inventory days, which cannot be true…
>
> Creditor Days of not meaningful and Inventory Days of not meaningful, yet Working Capital Days of 162. Gross Margin is stored as 104.6%, above 100%.

The ratio tiles do not say that. Working-capital days are unscored. Gross profit on the header is R1 159 000, about 95.4% of R1 215 000 revenue, not 104.6%.

No narrative code is changed in this note.

## Cached text, not a live sentence

There is no template in `src/` or `supabase/functions` that contains “cannot be true”, “Days of not meaningful”, or “stored as 104.6%”.

The paragraph is pre-generated. The Analyst model writes it, and `supabase/functions/agent-analyst/execute.ts` stores it with `shapeRecordedCopy` (`src/lib/agent-bus.ts`) into `agent_findings.title` and `agent_findings.detail`. `supabase/functions/agent-analyst/run.ts` also inserts a row from `handoffFinding` (`src/lib/owner-handoff.ts`) when a run finishes with a summary and no saved finding. The prompt (`supabase/functions/_shared/agent-prompts/analyst.ts`) tells the model to copy numbers a tool just returned. Page render does not call `computeRatios` to build this paragraph.

What render does is a light rewrite of that cached string:

- `rewriteDraftMonthStamp` (`src/lib/statement-period.ts`) turns `Sep 2026 books` / `Mar 2026 statement` into `Full year on file`. `agreeFullYearGrammar` only repairs “Full year on file look”, so “Full year on file show” keeps the plural verb.
- `quoteUnusableDayCounts` (`src/lib/ratios.ts`) replaces a negative day count in place. `Creditor Days of -248` becomes `Creditor Days of not meaningful`. Inventory is the same. `ratioSentence` (“Creditor Days is not meaningful.”) is not on this path.
- A positive `Working Capital Days of 162` and `Gross Margin is stored as 104.6%` match neither rewrite, so they stay.

`shapeRecordedCopy` can ground a new finding against live ratios, but only through `groundAdvisoryNarrative`. That skips a ratio when the live value is NaN, and “stored as” is not one of its connectors. An old `agent_findings` row is not rewritten in the table. The next open shows the cached sentences, then the display pass above.

## Surfaces

| Surface | What it shows | Live or cached |
| --- | --- | --- |
| Home | Accountant home thread and owner desk. `MilonTeamPane` (`src/components/milon-team/milon-team-pane.tsx`) runs `findingSentence`, then `rewriteDraftMonthStamp` again. The client file mounts that pane (`src/routes/_authenticated/clients.$clientId.tsx`). Owner: `milon-team-desk.tsx`, `owner-draft-card.tsx`, `owner-presence.ts`. | Cached `agent_findings`, then `formatFindingProse`. |
| Analyst | The same pane when the Analyst is selected, and `PracticeAgentThread`, which runs `rewriteDraftMonthStamp` on the finding. | Same cached row. |
| Financial Manager | No separate FM sentence. The Manager shows it on the team desk, or in a hand-off note whose body is the Analyst summary (`handoffFinishNote`). `ownerHomeLines` does not build this paragraph. | Same cached text. |
| PDF | The health scorecard exec summary is a different paragraph: `healthNarrative` in `src/reports/narrative.ts`, computed live from the scored ratios and passed to `ExecSummary`. It does not read `agent_findings`. Ratio rows use `presentScorecardRatio` (dash or “not meaningful” when the day count is not finite). A pack PDF can still print the paragraph if a stored pack section copied the finding; `advisory-pack-panel.tsx` only runs `rewriteDraftMonthStamp` on that body. | Scorecard: live. Pack body: cached, if it was copied in. |
| Emails | No product template (task, invite, welcome, mention) interpolates `agent_findings`. The only send path is a person-sent advisory draft (`advisory-drafter.tsx`): the stored body is passed through `rewriteDraftMonthStamp`, then mailto or WhatsApp. If that draft copied the finding, the email carries the cached paragraph. | Cached draft body. |

## What 162 and 104.6% are

Both are formula readings of the signed statement. They are not a second ledger total and not a units mix-up (days stay days; the margin is a fraction printed as a percent).

Working-capital days of 162 is the signed sum. With debtor days 6.6, inventory days −93, and creditor days −248: `6.6 + (−93) − (−248) = 161.6`, which rounds to 162. Live `operatingCycleDays` (`src/lib/ratios.ts`) refuses that. Chill Pepper’s cost of sales is R56 000 on R1 215 000 revenue, under the 5% cover, so creditor days, inventory days, and working-capital days are NaN. The tile is unscored (“not meaningful” / no data). 162 exists only in the cached sentence.

Gross margin of 104.6% is revenue minus a negative cost: `(1 215 000 − (−56 000)) / 1 215 000`. The header and the tiles treat the cost as a cost (`costMagnitude` / `correctedGrossMarginFraction`): gross profit R1 159 000, about 95.4%. The finding kept the uncorrected percent. `groundAdvisoryNarrative` does not rewrite “Gross Margin is stored as 104.6%”.

## Why #962 and #963 missed it

#962 stopped the tiles and `findingMetricContext` from printing a negative day count, and taught `operatingCycleDays` to return NaN when cost of sales is under 5% of revenue. `quoteUnusableDayCounts` only matches `creditor days -248`, not `Creditor Days of -248`, not “negative creditor and inventory days”, and not a later WC or gross-margin clause.

#963 changed `ratioSentence` to “Creditor Days is not meaningful.” The Diagnose paragraph is `formatFindingProse`. It never calls `ratioSentence`.

## Fix that landed

Not a rewrite of the cached sentence.

`computeRatios` / `operatingCycleDays` (`src/lib/ratios.ts`) are the inputs Overview, the tiles, and the Analyst prompt share (`overviewRatios`, `ask-ai/derive-ratios.ts`). A negative or missing day component makes working-capital days NaN. Negative cost of sales, negative payables, or a gross margin above 100% is a data-sign flag. Those ratios are not quoted. Stored financials are not rewritten.

`validateRatioInputs` is that check. `computeRatios`, `dataSignIssue`, and the cached-finding gate all call it. The gate does not look for particular sentences. It reads each ratio name the text cites, takes the number beside that name, and asks the validator. A live tile ratio that is already NaN fails the same way.

`presentCachedFinding` swaps only the sentence that fails. The rest of an email, meeting agenda, exec summary, or hand-off note stays, including after `rewriteDraftMonthStamp`. The replacement is `renderHealthNarrative` plus “Refreshed from current figures.” Home and Analyst pass the same figures and live snapshot into `findingSentence`. The action plan passes them into the Financial Manager hand-off. The client page passes them into the advisory drafter. The `agent_findings` title and detail stay as stored. The desk uses the existing source-check chip with `forceStale`. No new column. The next `record_finding` does not dedupe onto that row; it inserts a new one and sets the existing `superseded_by` on the old row (`agent-analyst/execute.ts`).

## Gate 17 Nov: data-request still quotes negative days beside 95.4%

AQA gate FAIL on prod `0c37f532` (#964 and #966 live), Chill Pepper Boutique Hotel `79c4c485` (Practice·Theo). Health/Diagnose still shows a data-request narrative with `creditor days −248` and `inventory days −93` beside `gross margin is 95.4%`. The ratio tiles do not. This is the second fail on negative days in Diagnose, so no narrative code is changed here.

95.4% is the header margin: revenue R1 215 000 minus the cost treated as a cost (R56 000), not the signed-cost reading of 104.6%. Creditor days −248 and inventory days −93 are the signed day counts. Live `operatingCycleDays` returns NaN for both. The sentence keeps the signed days and the corrected margin in one line.

### Every surface that renders the data-request copy

The card label “Data request” is `agent_findings.kind = data_request_draft`. There is still no template that contains these numbers. The Analyst writes them, and `shapeRecordedCopy` stores them.

| Surface | Render path | Gate |
| --- | --- | --- |
| Accountant Health/Diagnose desk | `MilonTeamPane` (`src/components/milon-team/milon-team-pane.tsx`) mounts `MilonTeamDesk`. A draft row is `OwnerDraftCard` (`src/components/owner-draft-card.tsx`). The client file mounts that pane (`src/routes/_authenticated/clients.$clientId.tsx`). | The card does not call `findingSentence`. |
| Owner Health/Diagnose desk | The same `MilonTeamDesk` and `OwnerDraftCard`, with `decisionSeat="owner"`. | Same skip. |
| Accountant home draft line | `presentHomeDraftTitle` / `presentHomeDraftBody` in `clients.$clientId.tsx`, from `src/lib/owner-needs.ts`. | `presentLiveDraft` only. |
| Owner home draft line | `ownerDraftPresentations` in `src/components/owner-door/owner-door.tsx`, drawn by `owner-home.tsx`. | Same `presentLiveDraft`. |
| Drafts list | `AgentDraftShelf` (`src/components/agent-draft-shelf.tsx`) is another `OwnerDraftCard`. | Same skip. |
| Write | `supabase/functions/agent-analyst/execute.ts` calls `shapeRecordedCopy` (`src/lib/agent-bus.ts`). The Financial Manager prompt can ask for `data_request_draft`; the row is still stored by that Analyst execute path. | `polishAgentCopy` only. |

`OwnerDraftCard` builds the lead with `findingCardCopy` (`src/lib/milon-team-activity.ts`) and the second line with `findingMetricContext`. For `data_request_draft` it sets `fromSnapshot` to empty, so `findingSentence` — and therefore `presentCachedFinding` — never runs. `HealthNarrativeLine` prints that lead as given.

The desk hero is different. `MilonTeamPane` does call `findingSentence` on the newest finding for the selected agent. That one path is covered. The card under it, and the home draft line, are not.

### Why the #964 gate does not cover it

`validateRatioInputs`, `cachedFindingRejected`, and `presentCachedFinding` only run inside `findingSentence`. The data-request card and the home draft line do not call it.

What they call instead leaves the signed days in place:

- `groundAdvisoryNarrative` (`src/lib/advisory-narrative.ts`) rewrites a day or margin quote only when the live ratio is finite. Chill Pepper’s creditor and inventory days are NaN, so those citations are skipped. Gross margin, when the live value is the finite corrected 0.954, is rewritten to `95.4%`. Inventory days is not in `LABEL_SPECS` at all, so that label is never rewritten even when the live number is finite.
- `presentLiveDraft` (`src/lib/draft-figures.ts`) is that grounder plus the health-score reconcile. It does not call `quoteUnusableDayCounts` or `presentCachedFinding`.
- `formatFindingProse`, used for the card lead, does call `quoteUnusableDayCounts`. That regex only matches an ASCII hyphen before the digits (`creditor days -248`). A unicode minus (`creditor days −248`, U+2212) does not match. `citedNumber` in the gate has the same ASCII-only minus, so a unicode minus is read as a positive 248. A positive 248 is not unquotable on its own. `numberRatioRecord` keeps NaN, and `ratioValue` then treats NaN as “no live figure”, which is the skip above. An absent figure is not unquotable.
- `findingMetricContext` does not quote the minus. `correctQuotedFigure` turns a negative component day into `Math.abs`. The second line can still read `creditor days are 248, inventory days 93, gross margin 95.4%`. That is the magnitude of an unusable day count sitting beside the corrected margin. The gate never sees this line.

So #964 can refresh a finding sentence and still leave the data-request lead, the home draft line, and the metric context quoting days the tiles refuse.

### Proposed single fix

One shared guard on every narrative or data-request surface that cites days or a margin: `findingCardCopy`, `findingMetricContext`, `formatFindingProse`, `presentLiveDraft`, and `polishAgentCopy` / `shapeRecordedCopy`. When `validateRatioInputs` says that ratio is unquotable, drop the citation or say the data is insufficient. Do not turn a negative day count into its absolute value. Do not leave a corrected margin in the same sentence as an unsuppressed day count.

No stored financials change. No new column. The `agent_findings` row stays as written.

### Verification

A test that builds Chill Pepper-shaped inputs — revenue 1 215 000, cost of sales −56 000, and the receivables, inventory, and payables that produce creditor days −248 and inventory days −93 — and walks them through `findingCardCopy`, `findingMetricContext`, `formatFindingProse`, `presentLiveDraft`, and `polishAgentCopy`. Each result must not contain `−248`, `-248`, `−93`, or `-93`.

### Action plan, same pass, no code

The number on an action row is the stored `action_items.seq` (`src/components/action-plan.tsx`), not a recount of the rows on screen. `keptOpenPlanRows` drops a repeated title before paint, and a deleted row is not renumbered until someone drags the list. Either one leaves a hole, so the visible numbers can run 1, 2, 3, 5.

“Done by Financial Manager · 27 Oct” is `handoffProgressCaption` (`src/lib/action-handoff.ts`): a succeeded run that saved a finding. `deriveActionHealth` (`src/lib/action-item-health.ts`) does not read that caption. An open row whose due date is past is Overdue, and `progress_pct` stays 0 until someone moves it. The bot finishing a draft does not mark the action done and does not fill the bar.

Owner load groups open rows by `owner_id` (`OwnerLoad` in `action-plan.tsx`). A bot assignment stores the agent name on `owner_name` and sets `owner_id` to null (`latestStoredAssignment` of kind `bot`, and the assign click). Null `owner_id` is the Unassigned bucket. Three actions handed to agents with no employee id count as Unassigned 3.

## Gate d121bab4: the stored ask still shows the signed days

AQA on prod `d121bab4` (Chill Pepper `79c4c485`, Practice·Theo, hard reload). The data-request card still reads, with an ASCII hyphen:

> gross margin is 95.4%, creditor days are -248 days and inventory days are -93 days

No “Not enough data” wording is on the page. The gross-margin tile is “—”. 95.4% appears only in that sentence. No code in this note.

### What writes the sentence

There is no template with this wording. The Analyst model writes it. `record_finding` in `supabase/functions/agent-analyst/execute.ts` stores it through `shapeRecordedCopy` (`src/lib/agent-bus.ts`) on `agent_findings.title` / `detail`. Approving the draft copies those strings onto `data_requests` with no guard: `liveRecordForDraft` (`src/lib/agent-draft-decision.ts`) sets `title: input.title` and `reason: input.detail`.

The repo has no “agent-analyst v50” marker. The sentence is the model’s wording from a row saved before `guardQuotedRatios` ran on that write. The write-path call only affects a later `record_finding`, and only after that function is deployed. It does not rewrite a row already in `data_requests`.

### Why the guard misses this card

On `d121bab4`, `guardQuotedRatios` does match this literal sentence. With no live ratios, and with Creditor Days and Inventory Days set to NaN, it becomes “gross margin is 95.4%, creditor days are not enough data and inventory days are not enough data”. `findingCardCopy` does the same. The matcher allows “are” between the label and the number. The hyphen here is ASCII `-`, which the guard already accepts.

The card that still shows the original sentence does not call that function.

- `DataRequestsPanel` (`src/components/data-requests-panel.tsx`) prints `{r.title}` as stored.
- The reason goes through `displayedDataRequestReason` (`src/lib/data-requests.ts`), which only rewrites “45-day benchmark”. It does not call `guardQuotedRatios`.
- `OwnerDraftCard` does call the guard, via `findingCardCopy`. A still-open draft would not keep “-248”. The visible ask is the saved `data_requests` row.

The gross-margin tile is the live ratio. Negative cost of sales makes `validateRatioInputs` refuse it, so the tile is “—”. 95.4% is the header margin the model copied into the stored sentence. The guard, when it runs, leaves that percent and replaces the day counts.

### Why test:diagnose-days-guard passed

The test builds a finding and calls `findingCardCopy`, `findingMetricContext`, `formatFindingProse`, `presentLiveDraft`, and `polishAgentCopy`. Those paths do call the guard, so a Chill Pepper-shaped title is cleaned. It never builds a `data_requests` row, never calls `displayedDataRequestReason`, and never renders `DataRequestsPanel`. The prod string is that stored title/reason. The fixture never went through the component that prints it.

### Proposed fix, and the test

One display-time call to `guardQuotedRatios` on the data-request title and reason, in `displayedDataRequestReason` and the title in `DataRequestsPanel`. Same function. No new column. Existing rows are re-read when the card renders. No SQL.

The test passes the literal prod string `gross margin is 95.4%, creditor days are -248 days and inventory days are -93 days` through that display helper and asserts the result has no `-248` and no `-93`.

### D. Suggested — confirm still says Overdue

`actionRowDisplayState` (`src/lib/action-handoff.ts`) clears Overdue and fills the progress bar on the action row only, and only on screen. `planAutomation` (`src/lib/action-plan-automation.ts`) still sets `overdue` from the stored status and due date. `ActionPlanAutomation` (`src/components/action-plan-automation.tsx`) prints “· Overdue” from that flag, including on rows the plan row shows as done because the bot finished. `countActionPlan` / `formatActionPlanCounts` (`src/lib/action-plan-counts.ts`) count the same stored due dates, so the summary can say “3 open, including 3 overdue” when only one row is still overdue after the display rule.

Proposed fix: pass the same display rule into `planAutomation` and `countActionPlan`. A finished bot run is not overdue and is not an open overdue in the summary. Do not write the plan. Test with two bot-finished rows and one still-overdue row, and assert the Suggested block and the summary name only the one.

### E. All owners stays on All owners

The owner dropdown (`action-plan.tsx`) is `value={ownerFilter ?? ""}` and its options are `employees[].id` plus “All owners”. A bucket click sets `ownerFilter` to the row key. An agent key (`agent:Financial Manager`) is not one of those options, so the control stays on “All owners” while the list is already filtered. A person id that is not in `employees` does the same.

Proposed fix: the select value must be one of its options. Add the active bucket (the agent name, or the employee whose id was picked) as an option when it is selected. Test: pick an agent bucket and assert the select value is that agent, not `""`.

## B. Past interviews still does not render (second fail)

AQA on prod `d2c5a7d5`, firm Theo (`fca0f102-a597-4ec6-8f45-825c57f78797`), page `/practice/setup`. The action JSON fix and J4 pass. Past interviews still does not render.

### The real interview row

One active firm-wide row, `milon_brain_rules.id` `e168adc5-556f-4fd0-b390-2a2266d453c7`, `status` `active`, `task_type` `practice_setup_interview`, `source_event` `setup_partner_interview`, `client_id` null. Created 2026-11-13. The transcript is `rule_text`, 259 characters, JSON with three keys: `messages`, `question`, `modelTurns`.

`modelTurns` is 1. `messages` has one element. Its role is `assistant`. There are zero `user` messages. `question` is 91 characters and is equal to that only message. There is no answered turn.

`fetchFirmInterviewDraft` (`src/lib/setup-partner-client.ts`) reads that `rule_text` and `interviewDraftFromRuleText` (`src/lib/firm-interview-draft.ts`) parses it. The confirmed plan is the other active rows (`source_event` `setup_partner_confirm`), so the page is in phase `done` with this draft still open.

### Why “transcript has answers” is false

`PastInterviews` (`src/components/interview-exchange.tsx`) returns null when `interviewPairs` is empty. `interviewPairs` drops the live question when it is the last message and the model is not thinking. On this row that drop removes the only message. Nothing with a `user` role remains, so the log is not mounted. #968 did not change that filter. It only kept an archive across a redo and stopped labeling this draft as a redo. The condition is false because the stored transcript has no answer, not because the component failed to read a longer history.

### Why test:practice-setup-route passed

The route test’s saved-interview fixture (`scripts/practice-setup-route-test.mts`) is built with `interviewDraftWithQuestion` from an assistant question plus a user answer, then a second question. That row has a `user` message, so `interviewPairs` keeps a pair and `[data-past-interviews]` renders. The prod row is `{ messages: [{ role: "assistant", content: <question> }], question: <same>, modelTurns: 1 }`. The fixture never used that shape, so it could not fail.

### Accepted behaviour

Past responses sit below, hidden, if any. With zero answers the page renders no Past interviews section and does not repeat the live question. `PastInterviews` already returns null when `interviewPairs` is empty, so this row needs no render change. The test loads `PracticeSetupInterview` with a saved plan and this draft shape, and asserts `[data-past-interviews]` is absent and the question text appears once. A second fixture with an answered pair asserts the section is collapsed and shows a count. Redo stays on the Saved / idle screen only.

### Redo, on this same screen

AQA sees no Redo button. The controls are Next, “That’s enough, map it”, Review proposals, and Back to practice.

Redo is this condition in `PracticeSetupInterview` (`src/components/practice-setup-panel.tsx`): `phase === "done" && !showInterview`. Back to practice is `phase === "done"`, so it shows while a plan is saved. Next and “That’s enough, map it” render only while `showInterview` is true. Review proposals sits on the next-steps card, which also shows because the phase is `done`.

On this firm `showInterview` is true: the draft question is already in `messages` and no user message follows it, so `draftContinuesInterview` is true. Redo is therefore omitted on purpose. It is not missing from an idle page.

Recommend keeping Redo only in the Saved / idle state, when no question is on screen. An interview that is already open does not need a second control to start one. AQA cannot click Redo from the current screen. To reach it, answer the open question, choose “That’s enough, map it”, and confirm the map so the interview panel closes. Status becomes Saved, and Redo interview sits with Back to practice. A fixture with a saved plan and a draft whose question already has a user reply (so `draftContinuesInterview` is false and `redoOpen` is false) lands on that idle screen directly.
