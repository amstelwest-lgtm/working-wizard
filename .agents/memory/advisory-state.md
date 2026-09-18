---
name: Advisory OS spine (P0.1 state machine, P0.2 recommendations, P0.3 Next Step, P0.4 shell)
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

**Gotcha:** `clients.cashflow_bank_draft` has no in-repo migration; the clients
trigger reads it through `to_jsonb(NEW)->'cashflow_bank_draft'` so a missing
column is NULL rather than an error that would roll back sibling emits.
