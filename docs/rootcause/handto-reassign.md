# Hand to reassign

## 29 Oct 2026 — first reload settles on Hand to

ZA 1020F owner Next moves, client AQA J2 ZA 1020F (`24844299-1aec-449c-ab45-66ca1b97c3ef`). A new move, not a reassign. “Automate repeat tasks to free people for higher-value work” (`source_move_key` `gpToLabor`). Handed to Analyst at 10:16 SAST. The row showed `Handing to Analyst…`, then `Handed to Milōn Analyst · by Zanele Owner`. The first hard reload settled on plain `Hand to` and stayed there. The second reload showed `Handed to Milōn Analyst`. It was not a `Checking…` flash. US 1020E did not do this over two reloads.

Read-only queries on the Milon real project (`jxclnsbsqpixxqlbcapl`). No writes, no deletes. `pg_stat_replication` still has one subscriber, `realtime_replication_connection`, async, replay lag about 1ms. There is no read replica in front of the reload.

### What is on file

One action. No blank twin.

| | |
|---|---|
| `action_items.id` | `0079314c-5bfb-49ac-adf2-3aae4a4a4c3d` |
| `plan_id` | `40d86075-265c-474d-8d7f-a3ff3be6c902` |
| `source` / `source_move_key` | `strategic_move` / `gpToLabor` |
| `owner_id` | null |
| `created_at` | 2026-10-29 08:16:15.448484+00 |
| `updated_at` | 2026-10-29 08:16:19.586990+00 |

`action_updates` on that id, oldest first:

| `created_at` | actor | note |
|---|---|---|
| 2026-10-29 08:16:19.954751+00 | Zanele Owner (`owner_app`) | Handed to Milōn Analyst. |
| 2026-10-29 08:16:28.936536+00 | Milōn Analyst (`system`) | Analyst finished: Recorded one finding… |

The Analyst run (`90b4cbdc-c0e5-4d52-a6c2-65bbf2d0aae1`) was queued at 08:16:19.090559+00, started at 08:16:20.554+00, and finished at 08:16:28.700+00. The item exists 4.5 seconds before the hand-off note. The run exists 0.86 seconds before the note. The note exists before the runner starts. That is the current edge order: insert `agent_runs`, then `writeAssignment`, then `agent_invoke`.

A read in that 4.5 seconds finds a real row with `owner_id` null and no `Handed to ` note. `latestStoredAssignment` returns null. The button is `Hand to`. A read after 08:16:19.955+00 finds Analyst. That is reload 1, then reload 2. Nothing else was written between them that would change the match. There is one `gpToLabor` row.

### Why the screen already said Handed to

Owner Next moves is `ActionPlanPanel` with `ownerView` (`src/routes/app.tsx`). The click is `MoveHandTo` on a suggested move (`src/components/action-plan.tsx`). `handToAgent` sets the suggestion button to `Handing to ${agentShortName(agent)}…` and only then `await ensure()` (`src/components/hand-to-menu.tsx`).

`ensureStrategicMoveItem` (`src/lib/ensure-plan-item.ts`) inserts `action_items` and returns. That insert is the 08:16:15.448 row. It does not write a note. `owner_id` stays null. `action_items_v` (`supabase/migrations/20260918150000_action_items_recommendation_view.sql`) takes `owner_name` from `client_employees` on `owner_id`, so the view name is null too.

`commitActionHandoff` (`src/lib/owner-handoff-client.ts`) then builds the note in memory, `rememberOptimistic`, and `dispatchActionPlanRefresh` **before** `await requestOwnerHandoff`. `signedInActorLabel()` fills `note.actorLabel` on that same object, still before the fetch. The plan listener (`src/components/action-plan.tsx`) stores the note with `withPendingNote` and calls `refresh()`. `applyOptimisticPlan` sets that item’s `owner_name` to `Milōn Analyst` and keeps the optimistic note until a stored copy arrives.

Once `refresh()` sees the row `ensure` just inserted, the plan row’s button is `handoffTriggerLabel("Milōn Analyst")`, which is `Handed to Milōn Analyst`. The line under it is `AssignmentNotes` → `formatAssignmentNote` (`src/lib/action-handoff.ts`): `Handed to Milōn Analyst · by Zanele Owner`. That string is not `handoffTriggerLabel`. The suggestion button can still say `Handing to Analyst…`, because `MoveHandTo` does not call `setAssignee(agentDisplayName(agent))` until `result.noted === true`, and `noted` is the edge response after `writeAssignment` and `agent_invoke`.

The suggestion also leaves the list as soon as the new row is in `items`. `importedKeys` drops a move whose `source_move_key` is already on the plan. The control that remains is the plan row, and that row is already painted from the optimistic note.

A hard reload drops `optimisticHandoffs`, `liveHandoff`, and `moveAssignmentCache`. They are module or component state. The new document reads `action_items_v` and `action_updates`. In the gap, the note is not there. `notesReady` becomes true (`handoffPending={!notesReady}`). `displayedAssignee(null, [])` is null. `pending` is false. `handoffTriggerLabel(null)` is `Hand to`. `MoveHandTo` does the same if it is still mounted: the load effect calls `setReady(true)` and then returns without `setAssignee` when `assigneeName` is null (`src/components/hand-to-menu.tsx`). `Checking…` is only while `ready` / `notesReady` is false. A finished read of a blank row is a settled Hand to.

### Why it stays until the next reload

The reloaded page has no memory of the click, so nothing is “awaiting a run”. `useAgentActivity(clientId)` on the plan (`src/hooks/use-agent-activity.ts`) arms its poll only when the runs it just fetched are queued or running, or when a caller passed an open hand-off. The plan does not pass one. `MoveHandTo` polls every 5 seconds only when `face.phase === "working"`, which needs the run.

The run does not exist until 08:16:19.090, which is most of the way through the gap, and 0.86 seconds before the note. A reload whose read lands before that run gets no open run, does not arm the poll, and does not call `refresh()` again. The button stays `Hand to`. The second reload is after the note, so the same read returns Analyst.

A read in the short slice that sees the run and not the note would arm the poll and could heal on its own within about 5 seconds. Today’s report stayed on Hand to until another reload, which is the earlier slice: the item is in, the run is not, the note is not. Either way the settled label is Hand to, because a bot assignee is the note, not `owner_id`.

### Why #704, #706, #709, and the earlier note missed it

#704 (`5dbe27a1`, commit `efeffb3f`) stops a newer blank duplicate from hiding an older noted row. This client has one `gpToLabor` row. `assignmentForMove` prefers a noted row only when one of the matches has `assigneeName`. A single row with no note is the match, and the name is null. The #704 test passed two notes that were already in the array.

#706 (`8c8f482b`, commit `4ac73f40`) moves `writeAssignment` to before `agent_invoke`, and keeps the `MoveHandTo` label on `Handing to` until `noted === true`. The comment in `supabase/functions/owner-handoff/index.ts` says a reload during the runner already sees the note. Prod clocks match that order. The gap today is before `writeAssignment`: after `ensureStrategicMoveItem` has committed the blank row, while `commitActionHandoff` has already dispatched the byline. #706 never stopped that dispatch, and it never mounted a fresh page against a matching row whose note was still absent. Its reload fixture still had the previous agent’s note, so the gap read as the old name. That is US 1020E. A new row has no previous name, so the same gap is `Hand to`. Two reloads after the note is in both show Analyst, which is why 1020E did not reproduce this shape.

#709 (`d91bbd90`, commit `10d1fcf8`) is the Checking guard, plus the 60-second reuse in the edge function. `setReady(true)` and `setNotesReady(true)` run when the read resolves, including when the resolved row has no assignee. Checking is the in-flight state. Today’s failure is the resolved state. The #709 reload test held the read open and asserted `Checking…`. It did not resolve the read with the new action and a null assignee, which is the settled Hand to.

The sections below this one cover the two earlier failures: reload 1 shows the old agent (the note is not in yet, the previous note is), and a clickable Hand to while the read is still open (`useState(null)` before #709). Neither is a finished read of a brand-new blank row. The “first reload” test below seeds `Handed to Milōn Financial Manager.` first, so step 5 cannot be today’s button.

### A test that is this reload

Not `assignmentForMove` with the Analyst note already present. Not a remount that still holds the optimistic map. Not a read that is still pending (`Checking…`). Not a fixture that already has another agent’s note.

1. Do not seed a hand-off note. Render the owner plan row and `MoveHandTo` for a move that has no `action_items` row.
2. Choose Analyst. Let `ensureStrategicMoveItem` insert the row. Hold `requestOwnerHandoff` so `writeAssignment` has not inserted the note and no `agent_runs` row exists yet.
3. Assert the plan row already says `Handed to Milōn Analyst` and the note line says `Handed to Milōn Analyst · by <actor>`, while the suggestion button can still say `Handing to Analyst…`. Do not resolve the fetch.
4. Throw the document away: unmount, and load a new module so `moveAssignmentCache` and `optimisticHandoffs` are empty.
5. Mount again. The loader returns that action, `owner_id` null, no assignment note, no run.
6. Assert the read has finished: no `Checking…`, `[data-hand-to-trigger]` is present, and its accessible name is `Hand to`. That is reload 1, and it must still be `Hand to` with no later poll in the test.
7. Resolve the fetch with `Handed to Milōn Analyst.` by the same actor, `created_at` after the item.
8. Mount a third time. Assert `Handed to Milōn Analyst`. That is reload 2.

Step 6 is today’s bug. Step 8 is the second reload.

### Parked polish — raw login on an older byline

Not this failure. Do not fix it in the same change.

The 21 Oct note on “Audit and renegotiate your top 5 supplier contracts” (`eecc8d6d-9d5c-42ea-bb00-be2c730fbb68`) is `Handed to Milōn Financial Manager.` with `actor_label` `amstel.west+qa1020f` and `actor_type` `owner_app`. `formatAssignmentNote` prints `by` plus that label, because the author is not a bot and the type is not `system`. Later notes on this client are `Thandi Tester` and `Zanele Owner`.

`handoffAuthorName` (`src/lib/owner-handoff.ts`) uses `profiles.full_name`, then the auth display name, then the email local-part. Commit `0c8299fd` stopped storing the email handle when a name exists. It does not rewrite a note already stored, and the email local-part is still the fallback when no name is on file. CoS has this as polish.

### Hand to Tax Specialist is a sample preview

Not this failure. Do not change it.

On a ZA owner, `HandToMenu` renders `TaxSpecialistSlot` with `variant="handoff"` (`src/components/hand-to-menu.tsx`). That slot is `ZaTaxSpecialistSample` (`src/components/tax-specialist/za-tax-specialist-sample.tsx`), loaded only when `taxSampleEnabled` is true (`src/lib/tax-specialist/enabled.ts`, country `ZA`). The menu button is `data-tax-handoff` and its label is `Hand to Tax Specialist`. The click calls `openFromManager`, which opens the sample sheet (`data-tax-sample-sheet`, kicker `SAMPLE · ZA · SARS`). The banner says nothing was filed. It does not call `onAssignAgent` or `commitActionHandoff`. There is no Tax Specialist `agent_runs` row and no hand-off note for one. It is a sample preview, not a live hand-off.

## Earlier — first reload shows the old agent

AQA failed this a second time on US 1020E, client `353f1dbf-a7ba-4092-878d-792223ba3536`, `/clients/353f1dbf-a7ba-4092-878d-792223ba3536?tab=moves`. Next moves row 2 is “Set a quarterly revenue target and track weekly progress” (`source_move_key` `revenueGrowth`). Reassign from Financial Manager to Analyst. The toast says “Handed to Analyst” and the row updates immediately. Reload 1 shows “Handed to Milōn Financial Manager”. Reloads 2 and 3 show Analyst. It no longer falls back to “Hand to”.

Read-only queries against the Milon real project (`jxclnsbsqpixxqlbcapl`). No writes, no deletes.

## What the first reload reads

A hard reload is a new document. The accountant client route has no loader (`src/routes/_authenticated/clients.$clientId.tsx`, `createFileRoute` only sets `validateSearch` and `component`). The assignee is not in the HTML.

`getRouter` builds `new QueryClient()` with no persister (`src/router.tsx`). Move assignments are not a TanStack query. They sit in module maps in `src/lib/owner-handoff-client.ts` (`moveAssignmentCache` and the epoch). A new document drops those maps.

There is no service worker in the repo. The data request is the browser’s Supabase client against the project API, which is the primary. `pg_stat_replication` has one subscriber, `realtime_replication_connection`, `sync_state` async, `replay_lag` about 1ms. That is the realtime slot, not a read replica in front of PostgREST.

The mount effect in `MoveHandTo` (`src/components/hand-to-menu.tsx`) calls `loadClientMoveAssignments`. That selects `action_items` for the client, then `action_updates` ordered by `created_at` descending, then `latestStoredAssignment` (`src/lib/open-plan-home.ts`). A note counts only when it starts with `Handed to ` or `Assigned to `. A finish sentence does not. The newest such note is the button label.

So the first reload is a fresh primary read of `action_updates`. It shows whatever note is already committed. It is not SSR loader data, not a persisted query cache, not a service worker or CDN copy of the assignee, not a replica, and not a timestamp tie.

## This client’s rows

One action, not two.

| | |
|---|---|
| `action_items.id` | `327b822c-cf07-4b70-9327-ac94b40842bc` |
| `plan_id` | `f42d6aa9-b3a6-4d02-8caf-61b1889ae8e6` |
| `source_move_key` / `driver_key` | `revenueGrowth` |
| `created_at` | 2026-10-20 23:22:52.437761+00 |
| `updated_at` | 2026-10-21 00:32:22.052099+00 |
| `owner_id` | null |

`action_updates` on that id, oldest first:

| `created_at` | note |
|---|---|
| 2026-10-20 23:22:55.633936+00 | Handed to Milōn Financial Manager. |
| 2026-10-20 23:23:02.191777+00 | Financial Manager finished: Drafts are recorded… |
| 2026-10-21 00:32:22.465706+00 | Handed to Milōn Analyst. |
| 2026-10-21 00:32:30.259667+00 | Analyst finished: Recorded one finding… |

The two assignment notes are 1 hour 9 minutes apart. `latestStoredAssignment` sorts by `created_at` (`stamp` is `Date.parse`). Nothing ties. A read before 00:32:22.465706+00 must return Financial Manager. A read after that must return Analyst. That is reload 1, then reloads 2 and 3.

`agent_runs` on the same action:

| agent | status | `queued_at` | `finished_at` |
|---|---|---|---|
| financial_manager | succeeded | 2026-10-20 23:22:54.772738+00 | 2026-10-20 23:23:01.638+00 |
| analyst | succeeded | 2026-10-21 00:32:20.954982+00 | 2026-10-21 00:32:30.079+00 |

The Analyst run row exists 1.5 seconds before the Analyst hand-off note.

## The write is not finished when the UI says done

`MoveHandTo` sets the assignee to `agentDisplayName(agent)` and fires `toast.success(\`Handed to ${agentShortName(agent)}\`)` before `await ensure()` and before `await commitActionHandoff` (`src/components/hand-to-menu.tsx`). The toast and the row update are optimistic. They do not wait for the database.

`commitActionHandoff` does `await requestOwnerHandoff` before it sets `committed: true`. That await is after the toast. The edge function (`supabase/functions/owner-handoff/index.ts`) inserts `agent_runs`, calls `agent_invoke`, and only then `writeAssignment`, which updates `action_items` and inserts the `action_updates` note. The response `noted: true` is after that insert. The prod clocks match that order: run queued at 00:32:20.955, note at 00:32:22.466.

A reload in that gap reads the still-committed Financial Manager note. The later reloads read the Analyst note. No retry and no cache is involved. The first read is correct about the database. The screen had already claimed Analyst.

## Why #704 missed it

#704 (`5dbe27a1`, commit `efeffb3f`) fixed a different failure. The previous retest showed plain “Hand to”, which is what you get when the matched action has no assignment note. The code could insert a second `action_items` row for the same move before the note existed, and the reload took that newer blank row. #704 reuses the oldest `client_id` + `source_move_key` row, prefers a row that has a note, and drops the in-memory move cache only after `committed: true`.

This retest has a single `revenueGrowth` row. There is no blank duplicate to prefer. The old Financial Manager note is the latest committed note until `writeAssignment` inserts the new one. #704 never moved the toast or the label to after that insert.

#704’s test called `assignmentForMove` with the Analyst note already in the array, and checked that the same page refetches after `detail.committed`. A hard reload does not use that listener or that cache. It mounts a new `MoveHandTo` and reads `action_updates`. The test never held the insert open and then loaded a new page, so it could not fail the way reload 1 failed.

`78a45cf1` (2026-10-21 02:00:25 +0200, “Merge branch main into cursor/firm-sub-by-owner-7f64”) does not contain `5dbe27a1` (02:00:52 +0200). `git merge-base --is-ancestor 5dbe27a1 78a45cf1` is false. `data-move-phase` is not in `hand-to-menu.tsx` at `78a45cf1`. Current `main` (`cacab2d5`) does contain #704. Vercel’s deployment list for sha `5dbe27a1` came back empty from this session, so this note does not claim which bundle the browser actually executed. The database order above does not depend on that.

## A test that is the first reload

Not `assignmentForMove` with both notes already present, and not the `committed` listener on the same mounted component.

1. Seed one `action_items` row and one note, “Handed to Milōn Financial Manager.”
2. Render `MoveHandTo` and choose Analyst.
3. Assert the toast and the button already say Analyst while `requestOwnerHandoff` (the note insert) is still pending. Do not resolve it.
4. Throw away the document: unmount, and use a new module instance so `moveAssignmentCache` is empty. Mount `MoveHandTo` again. The loader returns only the Financial Manager note.
5. Assert the button’s accessible name is “Handed to Milōn Financial Manager”. That is reload 1.
6. Resolve the insert with “Handed to Milōn Analyst.” at a later `created_at`.
7. Mount a third time. Assert Analyst.

Step 5 is the bug. Step 7 is reloads 2 and 3.

## Item 2: Working / Draft ready is the Action plan row

AQA sees the phase on the Action plan tab. Next moves, where they hand the row off, still shows only the agent name.

Those are different components and different reads.

The Action plan tab (`tab=plan`) is `ActionPlanPanel`. Each plan task is an `ItemRow`. `useAgentActivity(clientId)` loads `agent_runs` and `agent_findings` by `client_id` (newest 20). `describeActionHandoff` turns that into `phaseLabel`. The chip is `data-handoff-phase` (`src/components/action-plan.tsx`). The labels are “Working” and “Draft ready”. That chip was already on the plan task before #704. Accountant view does not render the suggested-move `MoveHandTo` list (`ownerView` is false), so the plan tab is the imported action, not the ranked move.

The Next moves tab (`tab=moves`) is `StrategicMovesPanel`. Row 2’s control is `MoveHandTo`. The button text is only `handoffTriggerLabel(assignee)`: “Hand to” or “Handed to <name>”. It does not become “Working…” or “Draft ready”. #704 added a sibling span (`data-move-phase`) beside that button. That span is not in `78a45cf1`. On a build that has it, it renders only when `loadMoveActivity` attached `runStatus` or `draftId`. The button the eye lands on stays the agent name either way.

Prod drafts for this action, both `status` null, neither superseded:

| id | run | kind | title |
|---|---|---|---|
| `afcbc474-e7a7-4ed8-b91d-8d2388a79424` | Financial Manager run | `action_point_draft` | Hand-off: Set a quarterly revenue target and track weekly progress |
| `61257356-2c0c-4c9a-b96e-8dcf6d2ac48a` | Analyst run | `handoff` | Recorded one finding: Profit is the weakest pillar… |

The plan chip can see those because `useAgentActivity` loads the client’s runs and `findingForAction` matches every run for the action. The move span, on the #704 code, only asks `findingForAction` about the newest run. The plan chip and the move button are not the same row.

## Loading paints a clickable Hand to

AQA on the #706 build (`8c8f482b`): reassign passes. `Handing to …` shows, reloads stay on the new agent, and the Action plan phase matches Next moves. The new failure is the empty state while that read is still open. On a cold load of US 1020E, all five Next moves rows showed a plain clickable `Hand to` for about 7 seconds. After a reassign, the first or second reload showed `Hand to` and only then settled on `Handed to Milōn Analyst` or `Handed to Milōn Advisor`. That button starts a hand-off. A click in the gap is a second one.

### Cause

`MoveHandTo` (`src/components/hand-to-menu.tsx`) starts with `useState<string | null>(null)`. The button is `HandToMenu`, and `handoffTriggerLabel(null)` is the string `Hand to` (`src/lib/action-handoff.ts`). The trigger is a `<button>` with no `disabled`. Nothing in that render means “we have not read the assignment yet.” `null` means the same thing as “this move has no note.”

The mount effect calls `loadClientMoveAssignments` and only then `setAssignee`. Until that promise resolves, every row is a live Hand to. A hard reload drops `moveAssignmentCache`, so the first and second reload do it again. Five rows share one in-flight promise (`moveAssignmentLoads`), so they all flip together. They do not each wait on their own copy. They all wait on the same chain.

The Action plan row does the same thing on a shorter chain. `ActionPlanPanel` calls `setLoading(false)` and paints `ItemRow` before the `action_updates` read (`src/components/action-plan.tsx`). A bot hand-off has `owner_id` null, so `displayedAssignee` is null until those notes arrive, and `HandToMenu` again draws `Hand to`. The phase chip uses `phaseLabel ?? h.label`. While `useAgentActivity` is still `loading` and the notes are empty, `phaseLabel` is null and the chip shows the ordinary health label (`Not started`), not a loading state.

### Why it takes about 7 seconds

No single statement is a 7 second scan. The assignee is behind four serial PostgREST calls in `loadClientMoveAssignments` (`src/lib/owner-handoff-client.ts`):

1. `action_items` filtered by `client_id`, limit 80. The ids are required for the next two reads.
2. `action_updates` with `action_item_id IN (...)` ordered by `created_at` descending. This is the note `latestStoredAssignment` turns into the button. The index is `action_updates (action_item_id, created_at desc)` (`supabase/migrations/20260804120000_action_plan.sql`).
3. `agent_runs` with `action_item_id IN (...)` ordered by `queued_at` descending. This starts only after step 2, even though it only needs the ids from step 1. Indexes: `agent_runs_action_item_idx` and `agent_runs_client_idx`.
4. `agent_findings` with `run_id IN (...)` ordered by `created_at` descending. This starts only after step 3. Index: `agent_findings_client_idx`.

The button cannot leave `Hand to` until step 4 returns. The label does not use the finding. US 1020E has a handful of actions and runs, so this is not a sequential scan of a large table. It is four round trips, one after another, on a cold page that is already sharing the Supabase connection with the rest of the client load. `SHELL_GATE_TIMEOUT_MS` is 8 seconds (`src/lib/shell-gate.ts`). That cap is for a stuck auth lock, and the observed gap sits next to it. This note does not have a trace that the lock actually hit the cap. The named wait is the serial chain above, and the last two calls are `agent_runs` then `agent_findings`.

Those two are not slow queries to rewrite. They are indexed, and the row count for this client is small. An index or an RLS change would not remove the serial wait. The cheap fix is to stop waiting for them before the button is allowed to say Hand to, and to issue the independent reads together: `action_items` with `agent_runs` by `client_id` (that index already exists), then `action_updates` and `agent_findings` together.

### Why #706 did not catch it

#706 held the hand-off *request* and asserted the label after a remount. The assignment *read* in that test returned the Financial Manager note immediately. The assertion ran after `loadClientMoveAssignments` had already resolved, so `assignee` was no longer null. The test never rendered `MoveHandTo` while that read was still pending, and it never asserted that `data-hand-to-trigger` was absent. `useState(null)` plus `handoffTriggerLabel` was the path AQA hit, and the test did not walk it.

### How this is verified

Hold the assignment read. Mount `MoveHandTo`. Assert there is no `[data-hand-to-trigger]` and the row says `Checking…`. Unmount, load a fresh module so `moveAssignmentCache` is empty, and mount again while the read is still held. Assert the same. Resolve the read. Assert the Hand to button exists and shows the stored assignee. The Action plan row uses the same `HandToMenu` `pending` prop, so it cannot render the trigger until its notes have arrived, and the phase chip shows `Checking…` until the notes and `useAgentActivity` have both settled. A second hand-off is also refused in `owner-handoff`: an open run, or any run started within 60 seconds, is returned instead of calling `agent_invoke`.
