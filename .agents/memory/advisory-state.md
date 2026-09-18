---
name: Advisory OS spine (P0.1 state machine, P0.2 recommendations, P0.3 Next Step, P0.4 shell, P0.5 direct-client path, P0.6 data requests, P0.7 actions↔recommendations, P1 pack + review + workflow emails)
description: Where the per-client advisory state lives, how it advances, how recommendations/outcomes attach, and how the Next Step is resolved
---

# Advisory state machine

**Where:** `clients.advisory_state` / `advisory_cycle_id` / `next_review_at`, plus
`advisory_cycles` and append-only `advisory_events`. Migration:
`supabase/migrations/20260918120000_advisory_state.sql`.

**States** (what MILŌN is waiting for): onboarding → context_collection →
financial_data_collection → data_validation → diagnosis → forecasting →
recommendations → accountant_review (only if `clients.firm_id` set) →
client_decision → action_execution → outcome_monitoring → next_review → (new cycle).

**How it advances:** DB triggers on `clients`, `client_financial_snapshots`,
`client_brain_questions`, `proposed_next_steps`, `client_review_signoffs`,
`action_items` call `advisory_emit()` → `advisory_apply_event()`. The app never
writes these columns directly. The only app-side write is the RPC
`advisory_record_event` (allowlist: `diagnosis.reviewed`, `cycle.restarted`,
`data.request_*`) via `appendAdvisoryEvent` in `src/lib/advisory-state.functions.ts`.
`cycle.review_due` comes from `advisory_mark_reviews_due()` (pg_cron daily).

**Rules are data.** `ADVISORY_TRANSITION_RULES` in `src/lib/advisory-state.ts` is the
source of truth; the migration seeds the identical rows into
`advisory_transition_rules`, and `pnpm test:advisory-state` fails on any drift
(it prints the VALUES block to paste). To change behaviour: edit the TS rule
groups, run the test, paste the block into a NEW migration that re-seeds the table.

**Safety:** triggers are exception-safe (WARNING, never block the user's write);
`nextAdvisoryState()` never throws on unknown combos (event recorded, state kept).
`getAdvisoryState` falls back to `inferAdvisoryStateFromFacts()` when the
migration isn't applied, so callers always get a state (`source: "derived"`).

**Recommendations (P0.2):** the recommendation object IS `proposed_next_steps`
(extended: problem/evidence/priority/confidence/data*depth/expected_impact*_/
cycle*id/decided*_; status adds `superseded`). `action_items.recommendation_id`
is the FK (legacy `linked_action_item_id` is kept in sync by trigger).
`recommendation_outcomes` holds expected vs actual per metric. Approved → task
goes through RPC `advisory_create_action_from_recommendation` (refuses
unapproved unless `p_approve`). Helpers: `src/lib/recommendations.ts` /
`.functions.ts`; `checkRootCauseClaims()` blocks invoice/customer-level copy on
`data_depth = 'statement'`. Migration: `20260918130000_recommendations_outcomes.sql`.

**Next Step (P0.3):** `resolveNextStep(facts, audience)` in `src/lib/next-step.ts` is
pure and deterministic (clock injected via `facts.now`). Priority: open data request

> overdue actions > blocked actions (only once past data collection) > state-based
> step, specialised per seat (owner vs accountant see different work in
> `accountant_review` / `client_decision`). Routes: owner → `/app` + in-app `tab`
> (`/app` reads no `?tab=` yet; P0.4 shell wires it), accountant →
> `/clients/:id?tab=…` (+`onboard=1` for upload, `filter=overdue|blocked`). Server
> fn `getNextStep` (`next-step.functions.ts`) gathers facts via `loadAdvisorySnapshot`

- count queries that return 0 on un-migrated schema; audience defaults from
  `clients.owner_user_id === userId`. `openDataRequests` is hard-coded 0 until P0.6.
  Test: `pnpm test:next-step` (totality across every state × audience, route validity).

**Next Step shell (P0.4):** `src/components/next-step-card.tsx` fetches `getNextStep` and
renders one CTA + outstanding chips; it never navigates — the host's `onAct(step, target)`
switches tabs / opens dialogs. Mounted above `ClientBriefing` in the accountant studio
and above the tab strip on `/app` (hidden in sample mode). `/app` now accepts `?tab=`
(owner board tab ids) via `validateSearch`. Only app-recorded event: "Mark as reviewed"
→ `diagnosis.reviewed`. Styles: `.milon-next-step*` in `primitives.css` (works under
`.dark` and `.accountant-portal`).

**Direct-client path (P0.5):** DB layer was already owner-safe (`has_client_access` and
`is_action_plan_writer` both include `owner_user_id`); the gate was UI. `proposed_next_steps`
had no surface anywhere — `brain-propose` wrote rows nobody could see, so an owner-only
client could never reach `client_decision`. `src/components/recommendations-panel.tsx`
(shared, `audience` prop) lists open + approved recommendations with Accept/Not now
(owner) or Approve/Reject (accountant), "Add to action plan", and a "Suggest moves"
button → `invokeBrainPropose`. Mounted on `/app` Next Moves tab and the studio Advisory
tab (where `nextStepRoute` already sends `recommend/review/decide`). `brain-propose`
picks its audience server-side from `clients.firm_id` (`systemPromptFor` in logic.ts),
drops proposals that claim invoice/customer-level knowledge (`dropOverclaimingSteps`,
regexes mirror `TRANSACTION_LEVEL_CLAIMS` — test asserts they agree), and stamps
`source: 'ai', data_depth: 'statement'` (retries without on pre-P0.2 DB).
`createActionFromRecommendation` falls back to a TS implementation
(`createActionWithoutRpc`, links via `linked_action_item_id`) when the RPC is absent.
The RPC itself now checks `is_action_plan_writer` (SECURITY DEFINER bypasses RLS, so
invited members must not get a back door). Test: `pnpm test:direct-client-path`.

**Active data requests (P0.6):** `20260918140000_data_requests.sql` adds `data_requests`
(kind / severity / status / source / rule_key; one live row per `(client_id, rule_key)`;
writes limited to `is_action_plan_writer`, no delete policy). Detector is pure
(`detectDataGaps` in `src/lib/data-requests.ts`): four rules — `stale_figures` (>75 days,
critical), `forecast_opening_balance` (forecast live but blank opening balance, critical),
`debtor_days_no_ageing` (>45, important), `creditor_days_no_ageing` (>60, important).
Pre-data states never open requests. `syncDataRequests` (server fn) gathers facts,
applies `suppressRecentlyResolved` (hand-fulfilled/waived within 90 days are not re-asked;
auto-closed ones are) and calls the `data_requests_sync` RPC, which opens missing system
asks and auto-fulfils system asks whose rule stopped firing — human asks are never touched.
Triggers auto-fulfil: snapshot insert → `bank_statement`/`management_accounts`; `clients.cashflow`
openingBalance saved → `bank_balance`. Emits `data.request_opened` / `data.request_fulfilled`
(reserved in P0.1; quiet events). `NextStepCard` calls `syncDataRequests` before `getNextStep`,
which now counts open|sent rows → `openDataRequests` → blocking `data_request` step.
`DataRequestsPanel` (shared) sits under the card on both surfaces; accountant gets "Email the
owner" (`sendDataRequestEmail` → Resend via `sendAccessEmail`, marks rows `sent`, link is
`/app?tab=today`, no tokens) and "Ask for a document". Owner emailing themselves is refused.
Test: `pnpm test:data-requests`; SQL validated on scratch Postgres (/tmp/dr-flow.sql).

**Actions ↔ recommendations (P0.7):** `action_items_v` was `select ai.*` and froze its
columns before P0.2 added `recommendation_id`, so the plan UI could not see the FK.
`20260918150000_action_items_recommendation_view.sql` DROP+CREATEs the view with
`recommendation_id` + joined `recommendation_title/status/metric/amount` (security_invoker).
`action-plan.tsx`: `Item` carries those fields, `toActionItemWrite` strips the joined ones
(PostgREST rejects them on writes), rows show "From recommendation · title" (wins over the
strategic-move badge), the drawer shows expected impact, and "Add from recommendations (N)"
is the primary header button whenever approved/edited recommendations lack an action
(`FromRecommendationsPanel`, preselects all, goes through `createActionFromRecommendation`).
Chase/nudge email and `task-link` GET (read-only) untouched. Test:
`pnpm test:recommendation-actions`. Gotcha: any future `ALTER TABLE action_items ADD COLUMN`
needs the view recreated again.

**Advisory pack (P1.1/P1.2):** `20260918160000_advisory_packs.sql` — `advisory_packs`
(`ai_draft` frozen at generation, `content` edited, `edit_stats`, `requires_review` = firm
attached, reviewer + sign-off, delivery) and append-only `advisory_pack_reviews`. **No direct
write policies**: `advisory_pack_create` (versions, supersedes the open pack, owner-or-firm)
and `advisory_pack_review` (edit / comment / approve / request_changes / reject / deliver /
read). Only the firm seat can approve/request changes when `requires_review`; owner-only
packs are `draft` and the owner accepts them; approved packs are final (regenerate instead).
Owner `read` of an approved pack = delivery. Events `pack.*`; rule `pack.approved`:
accountant_review → client_decision (rules re-seeded there; drift test finds the latest
`^\d+_advisory` file). Builder `buildAdvisoryPack` in `src/lib/advisory-pack.ts` is
**deterministic, rules-first, no LLM** (health, ≥5% ratio moves, forecast low week, recs,
gaps, HITL disclosure, locked); the honesty test runs `checkRootCauseClaims` over every
section — it caught my own copy once. `computeEditStats` = char edit-distance / draft chars;
`HIGH_EDIT_RATE` 0.35 is the "draft not ready" signal shown to the accountant. Next Step:
`generate_pack` (accountant, no pack) → `review_pack` (in_review/changes_requested) →
owner `read_pack` before deciding. `AdvisoryPackPanel` above the recommendations on both
surfaces; studio/board selects now include `firm_id`. Test: `pnpm test:advisory-pack`.

**Workflow emails (P1.3):** `20260918170000_workflow_emails.sql` — `workflow_email_log`
(immutable; partial unique index on `(client, kind, ref_key, recipient_email) WHERE sent`
is the idempotency guard) + `workflow_recipients(client)` SECURITY DEFINER RPC (owner +
firm members with emails; profiles RLS does not cross that boundary). Pure planner
`planWorkflowEmails` in `src/lib/workflow-emails.ts`: `forecast_break` (closings < 0, both
seats, keyed by `last_forecast_at`), `pack_ready_for_review` (accountant), `pack_signed_off`
(owner, until read), `pack_changes_requested` (owner, keyed by pack+reviewed_at),
`cycle_restarted` (owner, ≤14 days, keyed by event id). Pre-data states send nothing.
`runWorkflow` server fn runs **as the user** (never service role), fire-and-forget from
`NextStepCard` after the step resolves; links are plain `/app?tab=` or `/clients/:id?tab=`
(no tokens). Action overdue/nudge mail stays in the action machine. Test:
`pnpm test:workflow-emails`.

**Gotcha:** `clients.cashflow_bank_draft` has no in-repo migration; the clients
trigger reads it through `to_jsonb(NEW)->'cashflow_bank_draft'` so a missing
column is NULL rather than an error that would roll back sibling emits.
