# Hand to reassign: first reload shows the old agent

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
