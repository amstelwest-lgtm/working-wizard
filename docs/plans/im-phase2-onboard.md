# IM Phase 2 — Onboard into Milōn

Plan only. No code in this change. Phase 2 starts after the firm confirms its workflow map. Confirm already writes the map: `supabase/functions/setup-partner/index.ts` (`action === "confirm"`) calls `buildPracticeImplementationPlan` and inserts `milon_brain_rules`. The interview that produces the map is `src/components/practice-setup-panel.tsx`.

## 1. Takeover flow

For each confirmed step, Implementation Manager proposes how Milōn takes the step over, at the highest automation the product already allows. The proposal is a draft. A named person approves it. Nothing is posted to Xero, QuickBooks, or Sage, and nothing is submitted to SARS, without that approval being stored against the person who clicked it.

What exists today:

- Buckets are `covered`, `client_setup`, `product_gap`, and `bespoke` (`src/lib/setup-partner-plan.ts`). `covered` is plan only. `client_setup` becomes a private brain rule (`firm_id` set, `client_id` null). `bespoke` is a retired log row and is not queued (`bespokeLogRow`).
- Ledger posting already refuses to run on its own. `supabase/functions/extract-source-document/index.ts` says the model only proposes and the function never approves and never posts. `supabase/functions/owner-handoff/index.ts` records an assignment and never posts to a ledger. `src/lib/source-documents-ui.ts` says nothing posts to the ledger without the approval step.
- SARS forms are worksheets. `src/lib/tax-specialist/forms/irp6.ts` and `itr14.ts` say the sheet is not a SARS return and the accountant captures it on eFiling.

Phase 2 draft, per step:

1. Read the confirmed step from `milon_brain_rules` (`task_type` `onboarding_workflow`, `source_event` from `SETUP_PARTNER_SOURCE_EVENT` in `src/lib/setup-partner.ts`).
2. Propose the takeover in plain language: which agent owns it (`milonCoverage` on the map), which stored figures it may reuse, and that the output is a draft.
3. Where the step is a form Milōn already lays out (IRP6, ITR14, ITR12 under `src/lib/tax-specialist/forms/`), fill the sheet from figures already on the client. The sheet stays a draft. The copy that says the accountant files on eFiling stays.
4. Store the proposal as a draft the accountant can approve or dismiss. Approval writes `approver_id` on the brain rule, the same column `productGapInsertRow` and `clientSetupBrainRows` already set from `user.id` at confirm time.
5. Only after that logged approval may a later action post. Phase 2 does not add a post. The existing extract and hand-off functions stay non-posting.

`bespoke` steps are not automated. They stay the retired log (`PRACTICE_BESPOKE_TASK` / `PRACTICE_BESPOKE_SOURCE`).

## 2. Routines and a cost budget

Where a confirmed step is already owned by Financial Manager, Advisor, Analyst, or Tax, Implementation Manager may propose a recurring run. The proposal is shown to the accountant. One click approves it. Until that click, nothing is scheduled.

Defaults for a proposal:

- Model: the cheapest tier the repo can price. That is `claude-sonnet-5-5` at $2 input and $10 output per million tokens (`CLAUDE_MODEL_RATES_USD_PER_MTOK` in `src/lib/agent-analyst.ts`). There is no Haiku rate in that table. Financial Manager stays on Opus 5.5 ($4 / $20) via `edgeModelForAgent` in `supabase/functions/_shared/claude-model.ts`. A routine must not silently upgrade to Opus.
- Cadence: weekly or monthly. The repo does not have a generic weekly cron for these agents. Due work today is `enqueue_agent_event` (10-minute debounce, 30-day idle skip) and `promote_due_agent_events` in `supabase/migrations/20261010160000_agent_foundation.sql`. `supabase/functions/agent-dispatch/index.ts` drains queues only when `agent_settings` flags are on, and its cron is inserted inactive. A Phase 2 routine should enqueue through that path, not a new scheduler.
- Cap: a per-firm run cap, counted from `agent_runs` (`firm_id` is already written in `begin` of a run in that migration). Show the cap next to the approve button.

Cost model. `analystRunCostUsd` is the formula: input, 5-minute cache write, cache read, and output, divided by 1,000,000. The repo has no USD/ZAR rate, so the figure below is USD. A short Sonnet 5.5 routine at 8,000 input tokens and 1,000 output tokens is `(8000 × 2 + 1000 × 10) / 1_000_000 = $0.026` per run. Weekly is about $0.10 a month. Monthly is $0.026. A firm cap of 40 such runs is about $1.04 a month before cache. Opus 5.5 at the same token shape is `(8000 × 4 + 1000 × 20) / 1_000_000 = $0.052`, so an FM routine costs twice that and should be called out on the approve row. Cache reads are $0.10 per million on Sonnet 5.5 and $0.20 on Opus 5.5; they lower a repeat run, they do not raise the cap.

The cap is enforced by refusing to enqueue once the firm’s `agent_runs` in the calendar month reach the approved number. `agent-dispatch` already no-ops when flags are off. The cap is a second check in front of `enqueue_agent_event`, not a new billing product.

## 3. Build-out channel

When a step has no Milōn coverage and the gap is universal, Implementation Manager writes a structured proposal into the gap pipeline that already exists. It does not open a chat with an outside agent.

What exists:

- Classification lives in `buildPracticeImplementationPlan` (`src/lib/setup-partner-plan.ts`). Universal gaps become `product_gap` with a capability, fit note, and effort S/M/L. One-offs match `BESPOKE_RE` and stay `bespoke`.
- Confirm writes each `product_gap` with `upsertProductGap` (`supabase/functions/setup-partner/index.ts`). The row is `productGapInsertRow`: `layer` `milon_wide`, `status` `pending`, `task_type` `feature_idea`, `source_event` `setup_partner_product_gap`, `pattern_key` the dedupe key. A repeat sighting merges; it does not insert a second idea.
- The weekday 17:00 SAST product-gap digest is named in `supabase/functions/setup-partner/firm-interview-prompt.ts`. The read that matches a one-day window is `PRODUCT_GAPS_SINCE_YESTERDAY_SQL` and `productGapsSinceYesterday` in `src/lib/setup-partner-plan.ts`. There is no function in `supabase/functions` whose name is `implementation-gap-digest`. Ops already lists pending `feature_idea` rows and can Approve or Reject them in `src/components/milon-brain-review-ops.tsx`. Go / Park / Plan is not a status in that panel today (the actions are Approve and Reject). Phase 2 should feed the same rows and the same digest read, and add Go / Park / Plan as labels on that existing queue rather than a second pipeline.
- Bespoke stays bespoke: `bespokeLogRow` is `status` `retired` and `isPracticeGapQueued` returns false for it.

Phase 2 does not add an IM-to-external-agent channel.

## Data reuse

No new table for P1.

| Need | Existing store | Path |
| --- | --- | --- |
| Confirmed workflow | `milon_brain_rules` | `clientSetupBrainRows` in `src/lib/setup-partner-plan.ts` |
| Universal gap | same table, `feature_idea`, `milon_wide`, `pending` | `productGapInsertRow` |
| Bespoke log | same table, `practice_bespoke`, `retired` | `bespokeLogRow` |
| In-progress interview | same table, `practice_setup_interview` | `src/lib/firm-interview-draft.ts` |
| Draft the accountant approves | `agent_findings` plus the brain rule’s `approver_id` | `src/lib/milon-brain-rules.ts` |
| Run cost and the monthly cap | `agent_runs` | `analystRunCostUsd`; `firm_id` on the run |
| Schedule | `enqueue_agent_event` / `promote_due_agent_events` | `supabase/migrations/20261010160000_agent_foundation.sql` |
| On/off | `agent_settings` | `supabase/functions/agent-dispatch/index.ts` |

`rule_text` is clipped at 500 characters for normal rules (`MILON_BRAIN_RULE_TEXT_MAX`). The interview draft is the exception and is not clipped. A takeover proposal must stay inside 500 characters or it will be cut.

A new table would only be unavoidable if a routine needed columns the brain rule and `agent_runs` cannot hold (a cron expression plus a hard token budget plus a ledger of approvals). They can: cadence and cap as a short `rule_text`, spend from `agent_runs`, approval as `approver_id`. Do not add a table in P1.

## Approval points

1. Firm confirms the workflow map (`confirm` in `setup-partner`). That is the start of Phase 2, not a step inside it.
2. Accountant approves each takeover draft. Store `approver_id`. No ledger post and no SARS submit on this click.
3. Accountant approves each routine, including the model tier, the weekly or monthly cadence, and the firm cap, on one button.
4. Ops Approve / Reject on a `feature_idea` stays the build-out decision (`milon-brain-review-ops.tsx`). Go / Park / Plan, when added, is this same click with three labels.

## P1 and P2

P1, after confirm:

- List confirmed steps and a one-paragraph takeover proposal.
- Approve / dismiss, writing `approver_id`.
- Propose routines with the Sonnet 5.5 cost line and a cap. Approving stores the routine. It does not enqueue yet.
- Universal gaps go through `upsertProductGap`. Bespoke is not queued.

P2:

- Enqueue approved routines through `enqueue_agent_event`, with the monthly cap checked first.
- Fill the existing tax worksheets from client figures. Still no eFiling submit.
- Label the ops queue Go / Park / Plan and send the weekday digest from `productGapsSinceYesterday`. The 17:00 SAST schedule is specified in the interview prompt and is not a function in the repo yet.

## PR count

Five PRs, each client-side or one edge function that already exists (`setup-partner`). No migration.

1. Takeover proposals read from the confirmed brain rules and render on the practice setup page.
2. Approve / dismiss those proposals, with `approver_id`.
3. Routine proposal: model, weekly/monthly, cap, and the `$0.026` style cost line.
4. Cap check in front of `enqueue_agent_event`, still behind `agent_settings`.
5. Go / Park / Plan labels on the existing brain-review queue, and the digest read that is already `productGapsSinceYesterday`.

Form-fill of IRP6 / ITR14 can fold into PR 1 if the proposal only links the existing sheet. A separate PR is warranted only if the fill logic is new.
