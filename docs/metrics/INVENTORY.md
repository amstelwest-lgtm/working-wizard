# MILŌN metrics inventory — Phase 0

**Status:** audit only. No schema, no dashboard, no `analytics` migration until this file and `PROPOSED_TAXONOMY.md` are approved.

**Repo walked:** `amstelwest-lgtm/working-wizard` on `main` at the time of this audit (`035aa25` and descendants). Routes under `src/routes/`, migrations under `supabase/migrations/`, Edge Functions under `supabase/functions/`, server functions under `src/lib/*.functions.ts`.

---

## How to read this

Each row is a **distinct interaction a real person can take today**, not a proposed metric. Event keys in the `id` column are **proposals** for Phase 1 — they are not implemented.

| Field | Meaning |
|---|---|
| `id` | Proposed stable, dot-namespaced event key |
| Actor | Who can do it in this product today |
| Trigger | Exact code path |
| Surface | Where it happens |
| Authoritative source | Server-side (trustworthy) vs client-side (blockable) |
| Costliness | How scarce a resource the actor gives up — the Mom Test signal |
| Currently observable? | Existing log, table, or timestamp that already captures it |

**Costliness scale:** free (nothing scarce) → time (minutes of attention) → reputation (logo / client relationship) → real data (AFS, bank, live ledger) → money.

---

## 1. Brief vs this codebase — contradictions

The Claude brief assumed a vanilla HTML/CSS/JS app with no React, no TanStack, Gemini extraction, tables named `practices` / `entities` / `tasks`, and columns `is_internal` / `is_founding_practice` / `is_demo`. **This repository is not that product.** Per the brief’s own rule: follow the codebase and flag the contradiction. Do not silently adapt.

| Brief assumption | What exists here |
|---|---|
| Vanilla HTML/CSS/JS, no React, no TanStack, no build step | TanStack Start + React. Hybrid: landing page has vanilla quiz JS; Ask AI is a vanilla widget (`src/lib/ask-ai.js`) mounted into React. |
| Gemini for PDF extraction and Ask AI | **Claude** (`extract-financials.functions.ts`, `supabase/functions/extract-financials`, `supabase/functions/ask-ai`). |
| `practices` / `entities` / `public.tasks` | `firms` / `clients` / `action_items`. Assignees are `client_employees`, not app users. |
| `profiles.practice_id`, `profiles.is_staff` | `user_roles` (`firm_admin`, `accountant`, `client_owner`, `client_member`) + `firm_memberships`. No `is_staff` column. |
| `entities.is_demo`, `practices.is_internal`, `is_founding_practice` | **None of these columns exist.** Founder testing, demo clients, and Founding Practice cannot be flagged at write time today. |
| Founder dashboard at `/founder/metrics`, vanilla | Founder console is `/ops` (React), already showing **cumulative** signups and revenue — the exact vanity the brief forbids. |
| Third-party analytics forbidden | No Mixpanel/Amplitude/GA SDK. Existing usage is first-party `lighthouse_product_usage`. |
| Client tracker at `public/js/track.js` | `src/contexts/analytics.tsx` → `ingestProductUsage` server function. Signed-in only. |
| Ask AI disclosure override / rating / copy | Classifier exists (`none` / `summary` / `focused` / `full`). No override, no rating, no copy-to-clipboard telemetry. |
| 10 report types sent to the client | 10 PDF generators exist. “Sent” is an `advisory_deliveries` ledger row (mailto / WhatsApp / copy / pdf_download / email), not a guaranteed SMTP send. |
| Invoice issued / paid / days-to-payment | Manual founder ledger `milon_ops_payments`. No Stripe, no invoices, no dunning. |
| Waitlist signup | Landing “Join waitlist” buttons **do not write a waitlist row**. They scroll to `#register` and keep the user on Spark. |
| Landing quiz answers | Client-only; never persisted. |
| `ask_ai_enabled` as an enforcement gate | Flag in `milon_ops_settings.feature_flags`. Widget mount is not obviously blocked by it at the edge — treat as **UI/ops knob until confirmed**. |

**Vocabulary map (use these in Phase 1, not the brief’s names):**

| Brief | This repo |
|---|---|
| practice | `firms` |
| entity | `clients` |
| practice admin | `firm_admin` |
| accountant | `accountant` (also `firm_admin`) |
| SME owner | `client_owner` (product usage persona: `founder`) |
| SME employee (magic-link) | `client_employees` via `/t/:token` — **no auth user** |
| SME employee (signed in) | `client_member` |
| task | `action_items` |
| Tab 5 / Action Plan | Owner: tab `tasks`. Firm: tab `plan`. |

---

## 2. Existing telemetry (what already fires)

### 2.1 `lighthouse_product_usage` — client `track()`, signed-in only

Table: `public.lighthouse_product_usage` (`20260822120000_lighthouse_product_usage.sql`).

Write path: `AnalyticsProvider.track` → batched POST `ingestProductUsage` (`src/lib/product-usage.functions.ts`). RLS: INSERT own row; SELECT denied. Lighthouse reads via service role after `assertPlatformOwner`.

**Events actually called today:**

| Event | Where | Feature key |
|---|---|---|
| `page_viewed` | Auto on every authenticated pathname change | Path catalog (`owner.app`, `firm.dashboard`, …) |
| `tab_viewed` | Owner `/app` and firm `/clients/:id` tab changes | Owner: `today`→health, `waterfall`→profit, `cash`, `budget`, `next`→next_moves, `tasks`→action_plan. Firm: `ratios`, `profit`, `cash`, `budget`, `reports`, `plan`, `advisory` |
| `view_mode_toggled` | Simple / complex | `owner.view_mode` / `firm.view_mode` |
| `financials_uploaded` | After figures land (owner + firm) | `owner.upload_financials` (even when a firm user uploads) |
| `note_created` | Notes context | `owner.notes` / `firm.notes` |
| `playbook_opened` | Firm client workspace | `firm.playbook` |
| `report_downloaded` | Reports studio generate | `firm.report_download` |
| `report_previewed` | Reports studio preview | `firm.report_preview` |

**Catalogued but never `track()`’d:** `profile_updated`, `financials_entered`.

**Skipped paths (no page_viewed):** `/`, `/ops`, `/auth`, `/t/`, `/ack`, `/faq`, `/for-owners`, `/for-accountants`, `/reports/demo`, unsubscribe, API, Lighthouse public URLs.

**What this is:** vanity navigation volume. Not cohorted. No `is_internal` / `is_demo` / `is_bot`. Dual-role users are labelled `firm` when on `/dashboard` and `founder` when on `/app`. Impersonating accountants are labelled `firm`.

**What this is not:** activation, commitment, accountability-loop completion, or anything a board update should quote.

### 2.2 Ask AI — `ask_ai_log` (server)

Edge Function `supabase/functions/ask-ai`. Logs `user_id`, `client_id`, `tier`, token counts, `latency_ms`. **No question text, no answer text** (POPIA-correct). Rate limit 30/hour via `ask_ai_record_request`. Cache hits still recorded.

Not joined to `lighthouse_product_usage`. No abandonment, rating, copy, or session-follow-up.

### 2.3 Commitment timestamps already in product tables (backfillable)

These are the highest-value existing signals. Phase 1 should emit events from triggers / server functions; Phase 0 records that the raw timestamps already exist.

| Signal | Table / column |
|---|---|
| Auth user created | `auth.users.created_at` |
| Role granted | `user_roles.created_at` + `role` |
| Firm created | `firms.created_at` |
| Firm branding | `firms.logo_url`, `brand_updated_at` |
| Client created | `clients.created_at`, `firm_id`, `owner_user_id` |
| Figures saved (JSON blob) | `clients.financials`, `financials_updated_at` |
| Snapshot history | `client_financial_snapshots.created_at` |
| Score computed | `client_score_history` |
| Reports issued counter | `clients.reports_issued_count` (incremented on generate/download — **not** the same as sent) |
| Review sign-off | `client_review_signoffs` + `client_review_signoff_history` |
| Intervention sign-off | `intervention_signoffs` |
| Advisory / report “sent” | `advisory_deliveries.created_at`, `acknowledged_at` |
| Action item created / emailed / completed | `action_items.created_at`, `sent_at`, `completed_at`, `status` |
| Email dispatch | `action_emails.sent_at`, `email_type`, `status` |
| Human task update (POST only) | `action_updates` (`actor_type` = `assignee_link` \| `owner_app` \| `system`); `action_tokens.last_used_at` **only on POST** |
| Owner invite redeemed | `invite_tokens.redeemed_at` |
| Practice staff invited / accepted | `firm_staff_invites.accepted_at` |
| Per-client practice access | `client_practice_access` approval timestamps |
| QBO connected | `qbo_connections` |
| Payment recorded (manual) | `milon_ops_payments.paid_at`, `status` |
| Lighthouse lead funnel | `milon_ops_leads` stage + trial timestamps |
| Lighthouse email delivery | `lighthouse_touches` + Resend webhook |
| Impersonation | `impersonation_audit` |
| Account deletion | `src/lib/account.functions.ts` |

### 2.4 Tables that look like telemetry but are not product usage

- `financial_submissions` — schema exists; **nothing in the app writes it** except account-deletion nullify. Dead for metrics.
- `employee_tasks` — leftover; staff-tasks UI was removed.
- `milon_ops_leads` / `lighthouse_touches` — **sales** funnel (outbound to prospects), not product usage. Keep them out of activation cohorts unless a lead becomes a `firms` / `clients` row.
- `/ops?tab=usage` — rollup of `lighthouse_product_usage` (most/least used features, daily counts). Cumulative and un-cohorted.

---

## 3. Magic-link and GET-write hazards

Corporate scanners prefetch GETs. The brief’s §5.4 rule is already a product constraint. Audit result:

| Route | GET writes? | Notes |
|---|---|---|
| `/t/:token` page + Edge `task-link` GET | **No.** Correct. Loads payload only. `?intent=` pre-selects status in the UI and does not save. `last_used_at` / `use_count` update **only on POST**. | Safe to keep. Do **not** add analytics on GET. |
| `/t/:token` POST | Yes — status, progress, milestones, `action_updates`, owner notification email | This is the only trustworthy “assignee engaged” signal today, and it is **save**, not “looked at the page”. |
| `/access/:token` GET `previewAccessToken` | **No.** | Redeem is an explicit POST (`approve` / `decline`). |
| `/ack/:token` | **YES — writes on mount.** `acknowledgeDelivery(token)` in `useEffect` on GET. Scanners will mark deliveries acknowledged. | Must not count GET ack as client engagement. Phase 1 should treat `acknowledged_at` as contaminated until this is a POST. **Do not “just log an analytics row” on this GET either.** |
| `/?lh=<trial_token>` | Landing load POSTs `registerLighthouseTrialVisit`, which sets `milon_ops_leads.trial_clicked_at`. | Scanner risk for **sales** attribution, not product usage. Flag `is_bot` if this is ever treated as a commitment. |

There is **no** `task.link.rendered` / `task.link.engaged` split today. Funnel “link opened” cannot be measured without a POST beacon after a human signal — and that beacon must not run on GET.

Resend webhooks (`/api/resend/webhook`) record `email.clicked` for **Lighthouse sales** mail, not Action Plan assignment mail. Action Plan send status is the app’s own `action_emails.status` at send time — **no bounce/click pipeline** for task emails.

---

## 4. Interaction inventory

Actors used below (this product’s roles, not the brief’s enums):

- `anonymous` — landing, public pages, magic-link before POST
- `client_owner` — SME business owner (`/app`)
- `client_member` — invited signed-in team member
- `firm_admin` / `accountant` — practice
- `assignee_link` — unauthenticated employee on `/t/:token`
- `milon_it` — IT allowlist
- `platform_owner` — `/ops`
- `system` — cron, Edge, webhooks

### 4.1 Acquisition / marketing / onboarding

| id | Actor | Trigger | Surface | Authoritative source | Costliness | Currently observable? |
|---|---|---|---|---|---|---|
| `landing.viewed` | anonymous | `src/routes/index.tsx` render | Frontend | Client only | free | No. `/` is skipped by usage ingest. |
| `landing.quiz.started` | anonymous | Vanilla quiz engine in `index.tsx` | Frontend click | Client only | time (seconds) | No. Never persisted. |
| `landing.quiz.completed` | anonymous | Quiz finish → pricing persona class | Frontend | Client only | time | No. |
| `pricing.viewed` | anonymous | `#pricing` section / nav | Frontend | Client only | free | No. Flag `show_pricing` can hide it. |
| `pricing.waitlist.clicked` | anonymous | “Join waitlist” on Orbit / Constellation cards | Frontend | Client only | free (no email captured) | No. Scrolls to `#register`; no waitlist table. |
| `signup.started` | anonymous | Submit `#register` | Frontend → `supabase.auth.signUp` or `adminSignUp` | Mixed. Auth user row is server. | time + email | Partial: `auth.users.created_at` after success only. No “started then abandoned”. |
| `signup.completed.owner` | client_owner | `signUp` + `ensure_own_client` (`index.tsx`, `auth.tsx`, `auth.callback.tsx`) | API / RPC | Server | time + email | Yes: `auth.users` + `user_roles` `client_owner` + `clients` row. |
| `signup.completed.accountant` | firm_admin | `adminSignUp` `signupType=accountant` → firm insert + `ensure_practice_firm` | Server fn `src/lib/auth.functions.ts` | Server | time + email + firm name | Yes: `firms.created_at`, `user_roles`. |
| `signup.completed.invited_member` | client_member | `adminSignUp` with `inviteClientId` → `signUpInvitedMember` | Server | Server | time (invited) | Yes: `invite_tokens.redeemed_at`, `client_memberships`. |
| `signup.google` | anonymous → owner | `auth.callback.tsx` | OAuth | Server | time | Partial: same as owner signup; provider not in product_usage. |
| `lighthouse.trial.clicked` | anonymous | `registerLighthouseTrialVisit` on `?lh=` | Server fn POST from landing `useEffect` | Server write, **prefetch-vulnerable** | free | Yes: `milon_ops_leads.trial_clicked_at`. Do not treat as human. |
| `lighthouse.trial.signed_up` | anonymous | Same fn with `signedUp: true` (signup path) | Server | Server | time | Yes: `trial_signed_up_at`, `stage=trial`. |
| `onboarding.profile.completed` | client_owner (firm can also save) | `ProfileFunnel` save → `clients.operating_profile` | Frontend → Supabase UPDATE | Server (row) | time (10 questions) | Partial: JSON present / `operating_profile` non-null. **`profile_updated` is never tracked.** |
| `onboarding.walkthrough.completed` | client_owner | `walkthrough-wizard.tsx` | Frontend | Client | time | Local / first-run helpers (`src/lib/first-run.ts`). Not a durable event. |
| `firm.brand.configured` | firm_admin | `/settings/brand` save (`accountant-profile.tsx`) | Frontend → `firms` UPDATE | Server | reputation (logo on reports) | Yes: `firms.logo_url`, `brand_updated_at`. Strong commitment. |
| `firm.staff.invited` | firm_admin | `inviteFirmStaff` `/settings/team` | Server fn | Server | reputation (colleague) | Yes: `firm_staff_invites.created_at`. |
| `firm.staff.accepted` | accountant | POST redeem `/access/:token` purpose `firm_invite` | Server | Server | time | Yes: `accepted_at`. |
| `client.created.owner` | client_owner | `ensure_own_client` | RPC | Server | time | Yes: `clients.created_at` where `firm_id` is null (own business). |
| `client.created.firm` | accountant / firm_admin | `createFirmClient` dashboard “Add client” | Server fn | Server | time + client relationship | Yes: `clients.created_at` + `firm_id`. **This is the channel’s first real client signal — if the row is not a sandbox.** |
| `practice.access.requested` | accountant | `requestClientAccess` | Server | Server | time | Yes: `client_practice_access` pending. |
| `practice.access.approved` | firm_admin + client_owner | Dual email links `/access/:token` | Server POST | Server | reputation | Yes: approval timestamps. GET preview does not write. |
| `owner.invite.minted` | accountant | `mint_owner_invite` | RPC | Server | reputation | Yes: `invite_tokens.created_at`. |
| `owner.invite.redeemed` | client_owner | Invite signup | Server | Server | time | Yes: `redeemed_at`. |
| `impersonation.started` | accountant | Dashboard open-as-client | Frontend insert `impersonation_audit` | Server | time (internal) | Yes. Must flag as internal-ish for owner-app metrics. |

### 4.2 Data ingestion

| id | Actor | Trigger | Surface | Authoritative source | Costliness | Currently observable? |
|---|---|---|---|---|---|---|
| `upload.bank.started` | owner / accountant | `BankStatementDrafter` file pick | Frontend | Client | time | No (abandonment invisible). |
| `upload.bank.drafted` | owner / accountant | Bank → figures / cash draft server fns (`bankStatements.server.ts`, cash-from-banks) | Server fn | Server | **real bank data** | Partial: resulting `clients.financials` / `cashflow` / `cashflow_bank_draft`. No per-file success log. |
| `upload.pdf.started` | owner / accountant | PDF picker in `/app` or client workspace | Frontend | Client | time | No. |
| `upload.pdf.succeeded` | owner / accountant | `extractPDFsWithAI` / Edge `extract-financials` | Server / Edge | Server | real AFS | Partial: figures written. **No extraction-run table** (success/fail/partial). `financial_submissions` is unused. |
| `upload.pdf.failed` | owner / accountant | Extract error toast | Frontend / server error | Mixed | time (friction) | No durable row. |
| `upload.manual.saved` | owner / accountant | Manual figure entry / `accountant-ratios.tsx` insert snapshot | Frontend → `client_financial_snapshots` INSERT | Server | time (re-keying) | Yes: snapshot row. **Cannot tell “corrected AI” vs “typed from scratch”** without a `source` property. |
| `upload.qbo.connected` | accountant / owner | `QboConnectCard` + `/api/qbo/callback` | OAuth | Server | live ledger access (high) | Yes: `qbo_connections`. |
| `upload.qbo.imported` | accountant | Pull into figures (`source: "qbo"` in client workspace) | Frontend → snapshot | Server | real data | Partial: snapshot exists; source not always stored on the snapshot. |
| `figures.saved` | owner / accountant | Autosave `clients.financials` (`app.tsx`) | Frontend UPDATE | Server | real data | Yes: `financials_updated_at`. Client also fires `financials_uploaded` (spoofable). |
| `snapshot.created` | owner / accountant | Insert `client_financial_snapshots` | Supabase | Server | real data | Yes. Period count = row count per client. |
| `upload.abandoned` | owner / accountant | Leave mid-drafter | Frontend | Client only | friction | **No.** Candidate client-writable event. |
| `extraction.corrected` | owner / accountant | Edit a field after AI fill | Frontend | Client (intent) + later snapshot (server) | **very high signal** (distrust of pipeline) | **No.** Cannot distinguish correction from first manual entry. |

### 4.3 Diagnostic core (health, pillars, playbooks, cash, budget)

Owner tabs: `today` (health), `waterfall` (profit), `cash`, `budget`, `next` (next moves), `tasks` (action plan). Notes live in a panel, not a tab id. Firm tabs: `ratios`, `profit`, `cash`, `budget`, `reports`, `plan`, `advisory`. Notes panel ids differ (owner vs firm).

| id | Actor | Trigger | Surface | Authoritative source | Costliness | Currently observable? |
|---|---|---|---|---|---|---|
| `view.opened` | signed-in | `page_viewed` / `tab_viewed` | Frontend | Client | free | Yes, usage table. Vanity unless cohorted. |
| `score.computed` | system / user | Health score calc; persist `recordScoreIfNewDay` in `clients.$clientId.tsx` | Frontend → `client_score_history` upsert | Server (row) | free (derived) | Yes: history row. Not “user valued the score”. |
| `pillar.drilldown.opened` | owner / accountant | Click Fruit / Trunk / Roots / Water (or equivalent) | Frontend | Client | time | **No** distinct event. May be bundled into tab_viewed if the pillar is a tab; owner health is one tab. |
| `ratio.expanded` | owner / accountant | Expand a ratio row | Frontend | Client | time | **No.** |
| `ratio.definition.read` | owner / accountant | Definition copy / Ask AI definitional | Frontend | Client | time | **No** (Ask AI `tier=none` is a weak proxy). |
| `playbook.opened` | accountant | `track("playbook_opened")` | Frontend | Client | time | Yes, usage. |
| `playbook.step.expanded` | accountant | Expand step | Frontend | Client | time | **No.** |
| `forecast.edited` | owner / accountant | Cash forecast save; `clients.cashflow`, `last_forecast_at` | Frontend UPDATE | Server | time | Partial: `last_forecast_at`. |
| `budget.edited` | owner / accountant | Budget panel save | Frontend | Server | time | Partial: `budget_updated_at`. |
| `benchmark.viewed` | accountant | Reports studio `benchmark` preview, or in-app compare | Frontend | Client | time | Partial: `report_previewed` with `reportKey`. |
| `next_moves.viewed` | owner | Tab `next` | Frontend | Client | time | Yes: `tab_viewed`. |
| `view_mode.toggled` | owner / accountant | Simple / complex | Frontend | Client | free | Yes. |
| `signoff.recorded` | accountant | `ReviewSignoffButton` | Server fn | Server | reputation (name on the file) | Yes: `client_review_signoffs` scopes (financials, cash_forecast, profitability, action_plan, advisory, …). |

Health score, ratios, and playbooks are **computed in the client** from `clients.financials`. There is no `report.generated` server job — generation is a browser PDF blob.

### 4.4 Reporting

Ten report keys: `scorecard`, `intervention`, `forecast`, `cycle`, `waterfall`, `leverage`, `assets`, `labor`, `movement`, `benchmark`. Plus `zip_all`.

| id | Actor | Trigger | Surface | Authoritative source | Costliness | Currently observable? |
|---|---|---|---|---|---|---|
| `report.previewed` | accountant (studio); owner can open Reports tab on firm client page | `reports.index.tsx` `onPreview` | Frontend | Client `track` + optional delivery log | time | Yes: usage + often `advisory_deliveries` if `logReportDelivery` runs. |
| `report.downloaded` | accountant | `onGenerate` PDF download | Frontend | Client track + `reports_issued_count++` + `logReportDelivery` | time | Yes, but **counter increments on generate**, which the brief calls vanity unless cohorted and tied to send. |
| `report.zip_all` | accountant | Generate all | Frontend | Same | time | Yes: `reportKey=zip_all`. Inflates counts (1 click → N PDFs). |
| `report.sent` | accountant | Share mailto / WhatsApp / copy / email; `recordDelivery` | Frontend → `advisory_deliveries` INSERT | Server row = **intent to send**, not inbox delivery | **reputation** (client relationship) | Yes: `advisory_deliveries`. Channel in `channel`. |
| `report.ack.contaminated` | anonymous / scanner | `/ack/:token` GET mount | Frontend GET → `acknowledgeDelivery` | Server write on GET | free | Yes: `acknowledged_at` — **untrustworthy**. |
| `advisory.drafted` | accountant | Advisory tab | Frontend | Mixed | time | Partial: delivery kind `advisory_draft` if they share. |
| `report.whitelabel.applied` | system | PDF uses `firms.logo_url` at generate time | Client PDF code | Derived | (branding already counted) | Indirect: brand configured + report downloaded. No “this PDF had a logo” flag. |

Owner `/app` does not use Reports Studio the same way; some PDFs can be triggered from cash / waterfall components (`reportKey: forecast` / `waterfall`).

### 4.5 Accountability loop (highest priority)

This is the claimed moat. Assignees never log in.

| id | Actor | Trigger | Surface | Authoritative source | Costliness | Currently observable? |
|---|---|---|---|---|---|---|
| `plan.opened` | owner / accountant | Tab `tasks` / `plan` | Frontend | Client | time | Yes: `tab_viewed`. |
| `plan.created` | owner (writes restricted) | Insert `action_plans` | Frontend → table | Server | time | Yes: `action_plans.created_at`. Firm users should not write (owner-only writes migration). |
| `task.created` | owner | Insert `action_items` (`action-plan.tsx`) | Frontend | Server | time | Yes: `created_at`. `source` = `strategic_move` \| `manual`; `source_move_key` links a ratio. |
| `task.assigned` | owner | Set `owner_id` → `client_employees` | Frontend UPDATE | Server | time | Yes: `owner_id` not null. Not the same as emailed. |
| `employee.added` | owner | Insert `client_employees` | Frontend | Server | time | Yes. |
| `task.email.dispatched` | owner / system | `action-plan.tsx` send / `nudge-action-items` Edge | Frontend / Edge / Resend | Server: `action_emails` + `action_items.sent_at` | reputation (emailing a staff member) | Yes. Types: `assignment`, `nudge`, `overdue`, `done`, `owner_update`. **No Resend delivery/bounce for these.** |
| `task.link.fetched` | scanner or human | GET `task-link` | Edge GET | **Must not write, must not count** | n/a | Intentionally unobservable. Keep it that way. |
| `task.link.rendered` | human or headless JS | Page JS ran | Proposed POST beacon | Client | free | **No. Do not implement on GET.** |
| `task.link.engaged` | human | Proposed: pointer/key/scroll/dwell ≥3s then POST | Client beacon | Client, bot-flagged | time | **No.** Closest proxy today: POST save. |
| `task.status_changed` | assignee_link or owner | POST `task-link` or owner UI | Edge / frontend | Server: `action_updates` | time | Yes. |
| `task.completed` | assignee or owner | status `done` | Same | Server: `completed_at` | time (work) | Yes. |
| `task.blocked` | assignee | status `blocked` + note | POST | Server | time | Yes. |
| `task.overdue` | system | Derived `action_item_health` from due date | DB view / function | Derived, not an event | n/a | Computable; no event row. |
| `task.nudge.sent` | owner / cron | nudge / overdue email | Same as dispatch | Server | time | Yes: `email_type`. |
| `task.owner_notified` | system | POST save → owner email | Edge | Server `action_emails` `owner_update` | free | Yes. |

**Gap vs the brief:** there is no recommendation object separate from Next Moves → `source_move_key`. “Recommendation converted to task” ≈ `action_items.source = 'strategic_move'`.

### 4.6 Ask AI

| id | Actor | Trigger | Surface | Authoritative source | Costliness | Currently observable? |
|---|---|---|---|---|---|---|
| `ask_ai.query.submitted` | owner / accountant | Widget POST Edge `ask-ai` | Edge | Server `ask_ai_log` | time | Yes: tier + tokens + latency. Not in product_usage. |
| `ask_ai.tier.classified` | system | `classifier.ts` | Edge | Server (`tier` column) | n/a | Yes. |
| `ask_ai.tier.overridden` | user | — | — | — | — | **Does not exist.** |
| `ask_ai.answer.rated` | user | — | — | — | — | **Does not exist** (and the brief forbids thumbs-up widgets). |
| `ask_ai.answer.copied` | user | — | Frontend | Client | time | **No.** |
| `ask_ai.query.abandoned` | user | Typed, never sent | Frontend | Client | friction | **No.** |
| `ask_ai.followup` | user | Second query same session | Edge | Inferable if we add `session_id` | time | **No** session id on `ask_ai_log`. |

### 4.7 Notes, IT queries, settings, support friction

| id | Actor | Trigger | Surface | Authoritative source | Costliness | Currently observable? |
|---|---|---|---|---|---|---|
| `note.created` | owner / accountant | `notes.tsx` | Server fn + `track` | Server `client_notes` | time | Yes. |
| `note.mention.emailed` | system | `dispatchNoteMentionEmails` | Server | Server | time | Partial (send attempt). |
| `note.tagged_milon_it` | accountant | Tag note | Server | Server | time (escalation) | Yes: `tagged_milon_it_at`. |
| `settings.opened` | signed-in | `/settings` | Frontend | Client | free | Yes: `page_viewed`. |
| `account.deleted` | signed-in | Settings delete | Server fn | Server | high (churn) | Yes if we log it; deletion removes user — capture **before** delete. |
| `friction.client_error` | anyone | `/api/client-error` POST | Server log | Dev console only | friction | Not durable; not founder-facing. |
| `friction.dead_click` | anyone | Proposed `[data-track-dead]` | Frontend | Client | friction | **No.** |
| `email.unsubscribed` | anonymous | `/unsubscribe`, `/lh/unsubscribe` | Server | Server | time | Lighthouse opt-out on leads; product suppression `suppressed_emails`. |

### 4.8 Retention, expansion, commercial, Lighthouse sales

| id | Actor | Trigger | Surface | Authoritative source | Costliness | Currently observable? |
|---|---|---|---|---|---|---|
| `session.returned` | signed-in | `page_viewed` on a later day | Client usage | Weak (adblock) | time | Partial: usage `user_id` + `occurred_at`. No server session table. |
| `client.second_added` | accountant | Second `createFirmClient` | Server | Server | expansion | Yes: count `clients` per `firm_id`. |
| `seat.added` | firm_admin | Staff invite accepted | Server | Server | expansion | Yes: `firm_memberships` / invites. |
| `payment.recorded` | platform_owner | Manual `/ops` add payment | Server | Server | **money** | Yes: `milon_ops_payments`. Not tied to `firm_id`. |
| `invoice.issued` | — | — | — | — | money | **Does not exist.** |
| `price.objection` | — | — | — | — | — | **Does not exist.** |
| `referral.recorded` | — | `firms.referral_code` column exists | Unused in product? | — | reputation | Column only; no redemption event found. |
| `lead.stage.changed` | platform_owner / system | Lighthouse CRM | `/ops` sales | Server | sales time | Yes: `milon_ops_leads.stage`. Separate from product activation. |
| `lighthouse.email.sent` | platform_owner | Send guards + `lighthouse_touches` | Server | Server | sales | Yes. Delivery/bounce via Resend webhook. |

`/ops?tab=usage` and `getOwnerOpsDashboard` currently show **total users, total firms, total clients, all-time revenue** — forbidden as founder-instrument headlines. Keep them out of the validated-learning dashboard even if the ops console still shows them for bookkeeping.

---

## 5. Surfaces the brief asked for that do not exist (or exist only as UI)

- Feature-request / Mom Test signal log (`analytics.customer_signals`) — not built.
- Experiment registry — not built.
- Stall / founder action queue — not built.
- Commitment ladder score — not built; rungs can be **derived** from tables in §2.3 once internal/demo flags exist.
- Client-facing analytics — not built (and must not be).
- NPS / ratings — not built (do not add).
- Extraction correction rate — not measurable until `source` + before/after field diffs exist.
- Email delivered/bounced for Action Plan — not wired to Resend webhooks.
- Human link engagement without a save — not measurable without a POST beacon.
- Founding Practice vs unaffiliated split — no column.

---

## 6. Open questions (do not guess)

A wrong event definition is worse than a missing one.

1. **Dual-role users** (practice + own SME): does activation cohort by `firms.id`, by `clients.id` they own, or both? Impersonation sessions — exclude from owner-app engagement?
2. **Sandbox / first-pilot clients:** dashboard copy tells accountants to “add a sandbox client”. How do we mark demo vs real without an `is_demo` column? Name heuristic is not acceptable.
3. **Founding Practice list:** who is in it, and will it be an allowlist of `firms.id` / emails rather than a boolean on `firms`?
4. **Internal traffic:** `MILON_OWNER_EMAILS`, `milon_it_members`, and Theo’s own firm — stamp `is_internal` from which source of truth?
5. **Waitlist buttons** that don’t capture email: intentional (Spark-only) or a hole to close before measuring demand?
6. **Quiz answers:** capture as marketing qualification, or leave ephemeral?
7. **Activation definition:** candidate (needs approval) — practice signup → first **non-demo** client with figures → report **sent** (`advisory_deliveries`) **or** downloaded? Brief says “sent a real report to a real client within 14 days”. Download ≠ sent.
8. **QBO vs PDF vs bank vs manual:** store `source` on snapshots going forward?
9. **`ask_ai_enabled`:** edge-enforce or UI-only?
10. **Report zip_all:** one event or N? Recommendation: one `report.zip_all` plus child keys, never N downloads for activation.
11. **`/ack` GET write:** fix to POST-before-count, or permanently exclude `acknowledged_at` from learning metrics?
12. **Action Plan firm vs owner:** firm users view the plan; owners assign. Is assignment-by-accountant a future event or out of scope?
13. **Notes tab ids** differ owner vs firm — if we add `view.opened` properties, use feature keys not raw tab ids.
14. **`financial_submissions`:** revive as extraction audit log, or ignore forever?
15. **Payments without `firm_id`:** how to attach `invoice.paid` to a practice for the commitment ladder?

---

## 7. What Phase 0 is not

This document does not approve a schema. It does not add `analytics.events`, triggers, `/founder/metrics`, or `src/metrics/definitions.js`. Those are Phases 1–3 after taxonomy approval.

Existing `/ops` usage and signup totals stay as they are until a later phase explicitly replaces them. Do not “fix” them in the same change as this inventory.
