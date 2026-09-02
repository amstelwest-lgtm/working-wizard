# MILŌN proposed event taxonomy — Phase 0

**Status:** approved (Phase 0). Phase 1 spine is live. Phase 2 derived layer: [`README.md`](./README.md), `src/lib/metrics/definitions.ts`, `20260902200000_analytics_derived_views.sql`, `20260902201000_analytics_commitment_stalls.sql`.

Companion: [`INVENTORY.md`](./INVENTORY.md) (what exists today). This file is the **consolidated event list** we would implement in Phase 1, mapped onto **this repo’s** tables and actors — not the Claude brief’s vanilla/`entities`/`tasks` names.

Where the brief and the codebase disagree, this taxonomy follows the codebase and names the disagreement.

---

## 1. Design rules (locked unless you override them)

1. **Server-authoritative for commitment.** Signup, client created, figures saved, brand logo, report delivery row, task assigned/emailed/completed, payment, invite redeemed — emitted from a Postgres trigger or a server function. Never from `track()`.
2. **Client `track()` is allowlisted** for intent/friction only: views, expansions, abandonment, dead-clicks, human magic-link engagement beacon.
3. **GET on tokenised URLs writes nothing** — including analytics. `/t/:token` already obeys this. `/ack/:token` currently does not; until that is a POST, **do not** emit `report.acknowledged` from the GET path.
4. **No financial amounts in `properties`.** Ratio *codes* and *bands* only. No revenue, balances, ID numbers, employee emails. Magic-link actors identified by salted hash of token, never name/email.
5. **Idempotent keys** so retries don’t inflate. Suggested pattern: `event_key + object_id` for inserts; `event_key + object_id + new_status + truncated_epoch` for updates that can legitimately happen twice.
6. **`is_internal` / `is_demo` / `is_bot` stamped server-side.** Those columns do not exist on `firms`/`clients` yet — Phase 1 must add a founder-editable allowlist (or columns) **before** backfill, or every cohort will include Theo’s testing. Do not invent heuristics (client named “Demo”) without approval.
7. **No cumulative counters** on the founder instrument. `/ops` bookkeeping totals are a different product surface.
8. **Do not add NPS, stars, or thumbs-up.** Ask AI stays without ratings.
9. **Stack:** extend `src/contexts/analytics.tsx` + `ingestProductUsage` (TanStack Start). Do **not** add `public/js/track.js` or a vanilla `/founder/metrics` page unless you explicitly want a parallel UI. Ask AI widget can call the same RPC after allowlisting.

---

## 2. Actor kinds (adapt the brief’s enum)

| Proposed `actor_kind` | Maps to |
|---|---|
| `anonymous` | Landing, unauthenticated |
| `accountant` | `user_roles.role` in (`accountant`, `firm_admin`) acting on a firm client |
| `practice_admin` | `firm_admin` doing firm settings / invites (optional split; can collapse into `accountant` if you prefer fewer kinds) |
| `sme_owner` | `client_owner` on `/app` |
| `sme_member` | `client_member` signed in (brief omitted this; the product has it) |
| `sme_employee` | Magic-link `/t/:token` — **no** `auth.users` id; use `actor_hash` |
| `milon_it` | `milon_it_members` |
| `platform_owner` | `MILON_OWNER_EMAILS` / ops |
| `system` | Cron, Edge, Resend webhook |

**IDs on the event row (Phase 1 schema, names only):** `practice_id` = `firms.id`; `entity_id` = `clients.id`; `object_id` = report delivery / `action_items.id` / snapshot id / etc.

Dual-role: stamp **both** `practice_id` (active firm) and `entity_id` (client in scope). Persona for cohorting is a **query-time** choice (open question 1 in the inventory).

---

## 3. Funnel stages and event keys

Properties listed are the **maximum** we should store. All optional unless noted. Never put PII or rands in them.

### 3.1 Acquisition (mostly client-writable or sales CRM)

| event_key | source | properties | notes |
|---|---|---|---|
| `landing.viewed` | client | `{ path, referrer_host }` | Anonymous RPC or skip until we have a public ingest that cannot be spammed. **Open:** worth it? |
| `pricing.viewed` | client | `{ persona: accountant\|owner }` | Only if `show_pricing`. |
| `pricing.waitlist.clicked` | client | `{ plan: orbit\|constellation }` | Today this does **not** capture email. Measuring it without a waitlist row is a vanity click. **Recommend: do not implement until the button writes a lead.** |
| `landing.quiz.completed` | client | `{ persona }` **no answers** unless you approve storing them | Open question 6. |
| `lighthouse.trial.clicked` | server | `{ is_bot? }` | Already written on `milon_ops_leads`. Re-emit to spine only with bot flag. Prefetch-vulnerable. |
| `lighthouse.trial.signed_up` | server | `{ persona }` | From signup that carried `lh` token. |

**Not in Phase 1:** quiz step-level, waitlist without persistence.

### 3.2 Signup and practice setup (server)

| event_key | source | properties | notes |
|---|---|---|---|
| `signup.completed` | db / server fn | `{ signup_type: owner\|accountant\|invited_member, auth_provider: password\|google }` | Object = `auth.users.id`. |
| `practice.created` | db | `{}` | `firms` INSERT. |
| `practice.brand.configured` | db | `{ has_logo: bool }` | Fire when `logo_url` goes from null → non-null. Commitment ladder rung. |
| `seat.invited` | server | `{ membership_role, classification }` | `firm_staff_invites` INSERT. No invitee email in properties. |
| `seat.accepted` | server | `{ membership_role }` | `accepted_at` set. |
| `entity.created` | db | `{ via: owner_rpc\|firm_create, has_firm: bool }` | `clients` INSERT. |
| `owner.invite.minted` | server | `{}` | |
| `owner.invite.redeemed` | server | `{}` | |
| `practice.access.granted` | server | `{ classification }` | Both approvals complete, status `active`. |
| `impersonation.started` | server | `{}` | Always `is_internal`-adjacent; exclude from owner engagement. |

### 3.3 Ingestion (server + a little client)

| event_key | source | properties | notes |
|---|---|---|---|
| `upload.started` | client | `{ kind: bank\|pdf\|manual\|qbo }` | Intent. |
| `upload.abandoned` | client | `{ kind, seconds_open }` | Allowlisted client key. |
| `upload.succeeded` | server | `{ kind: bank\|pdf\|manual\|qbo, period_count }` | Fire when `financials` first becomes non-empty **or** snapshot INSERT. **No amounts.** |
| `upload.failed` | server | `{ kind, error_class }` | Need extract fn to persist a row — today it only toasts. |
| `qbo.connected` | server | `{}` | `qbo_connections` INSERT. |
| `extraction.corrected` | client or server | `{ field_count }` **not field names that are financial** | **Blocked** until we can tell AI-fill vs blank form. Do not ship a lying correction rate. |
| `snapshot.created` | db | `{ kind }` | Useful for “number of periods”. |
| `profile.completed` | db | `{ question_count }` | `operating_profile` first persisted. Replaces never-fired `profile_updated` track. |

**Activation-relevant:** first `upload.succeeded` on a non-demo client.

### 3.4 Diagnostic (client intent)

| event_key | source | properties | notes |
|---|---|---|---|
| `view.opened` | client | `{ surface: owner_app\|accountant_portal\|reports, feature_key, tab }` | Replaces raw `page_viewed` / `tab_viewed` in the new spine. Keep writing the old table during dual-run or cut over. |
| `view_mode.toggled` | client | `{ mode: simple\|complex }` | |
| `pillar.drilldown.opened` | client | `{ pillar: fruit\|trunk\|roots\|water }` | **Needs instrumentation** — not a tab today on owner health. |
| `ratio.expanded` | client | `{ ratio_code }` | |
| `playbook.opened` | client | `{ ratio_code? }` | Already tracked; move to spine. |
| `playbook.step.expanded` | client | `{ step_id }` | New. |
| `forecast.saved` | server | `{}` | `last_forecast_at` change. |
| `budget.saved` | server | `{}` | `budget_updated_at` change. |
| `signoff.recorded` | server | `{ scope }` | `client_review_signoffs`. Reputation. |

`score.computed` is derived and noisy (fires as they type). **Do not put it on the founder dashboard.** Optional debug event, not a hypothesis metric.

### 3.5 Reporting (server for send; client for preview)

| event_key | source | properties | notes |
|---|---|---|---|
| `report.previewed` | client | `{ report_key }` | |
| `report.downloaded` | server if we stamp `advisory_deliveries` / increment; else client | `{ report_key }` | Vanity unless cohorted. Still useful as a funnel step **before** send. |
| `report.zip_all` | client / server | `{ count }` | One event, not ten. |
| `report.sent` | db | `{ report_key, channel: mailto\|whatsapp\|copy\|email\|pdf_download, kind }` | `advisory_deliveries` INSERT. **This is the brief’s activation event**, not download. `pdf_download` is weaker than `email`/`mailto`. |
| `report.acknowledged` | server | `{}` | **Do not emit from `/ack` GET.** After POST-ack exists: still `is_bot` if elapsed_ms from send is tiny. |

### 3.6 Accountability loop (server + one client beacon)

Highest-priority funnel. Object is always `action_items.id`.

| event_key | source | properties | notes |
|---|---|---|---|
| `plan.opened` | client | `{ surface }` | Tab view. |
| `task.created` | db | `{ source: strategic_move\|manual, ratio_code }` | `source_move_key` → `ratio_code`. |
| `task.assigned` | db | `{ has_email: bool }` | `owner_id` set. No employee PII. |
| `task.email.dispatched` | server | `{ email_type: assignment\|nudge\|overdue\|done }` | `action_emails` success. No recipient address. |
| `task.link.rendered` | client POST beacon | `{ ms_on_page }` | **Only after JS; never GET.** Flag `is_bot`. |
| `task.link.engaged` | client POST beacon | `{ reason: pointer\|key\|scroll\|click\|dwell_3s, ms_on_page }` | **Only this counts in the loop funnel.** |
| `task.status_changed` | db | `{ from, to }` | From `action_updates`. |
| `task.completed` | db | `{ hours_since_assigned }` | `completed_at` set. |
| `task.blocked` | db | `{}` | Note text must **not** go in properties (could contain PII). |

**Do not create** `task.link.fetched`.

Until the engagement beacon exists, the honest funnel is:

**assigned → dispatched → status_changed (POST) → completed**

Call the missing step out on the dashboard as “human open: not measured” rather than substituting GET or `last_used_at` from POST (that would collapse engage and save).

### 3.7 Ask AI (server)

| event_key | source | properties | notes |
|---|---|---|---|
| `ask_ai.query.submitted` | Edge (already logs) | `{ tier, latency_ms, cache_hit }` | Mirror `ask_ai_log` into spine or join. **No question text.** |
| `ask_ai.query.abandoned` | client | `{}` | Allowlisted. |

No rating events.

### 3.8 Commercial and churn

| event_key | source | properties | notes |
|---|---|---|---|
| `payment.recorded` | server | `{ status: received\|pending\|refunded, plan_code }` | **No amount in properties** (POPIA/discipline — amount lives on `milon_ops_payments`, queried separately by founder). Open: attach `practice_id`. |
| `account.deleted` | server | `{ had_practice, had_client }` | Emit **before** cascade delete. |

No `invoice.issued` until invoicing exists.

### 3.9 Friction (client)

| event_key | source | properties | notes |
|---|---|---|---|
| `friction.dead_click` | client | `{ label }` | `[data-track-dead]`. |
| `friction.client_error` | server | `{ digest }` | Only if we persist `/api/client-error`; today we don’t. Phase 1 optional. |

---

## 4. Client-writable allowlist (Phase 1 RPC)

Reject anything else from the browser:

```
view.opened
view_mode.toggled
pillar.drilldown.opened
ratio.expanded
playbook.opened
playbook.step.expanded
plan.opened
report.previewed
upload.started
upload.abandoned
ask_ai.query.abandoned
task.link.rendered
task.link.engaged
pricing.viewed
landing.viewed
landing.quiz.completed
friction.dead_click
```

Everything in §3.2, §3.3 success, §3.5 send, §3.6 assign/dispatch/complete, §3.7 submit, §3.8 — **triggers / server only**.

---

## 5. Hypotheses and which events feed them

Carry the brief’s H1–H5. Map onto **this** taxonomy:

| ID | Statement (short) | Primary events | Falsifier reading |
|---|---|---|---|
| H1 Value diagnostic | Score is genuinely used, not a prettier TB | `upload.succeeded` → `view.opened` (health/ratios) → `report.sent` | Uploads with no drilldown and no send |
| H2 Accountability loop | Assign → human engage → complete | `task.assigned` → `task.email.dispatched` → `task.link.engaged` → `task.completed` | High assign, low complete; or reports without assign |
| H3 Ingestion trust | Extraction trusted vs re-key | `upload.succeeded` `{kind}` vs `extraction.corrected` | **Cannot test H3 until correction is observable.** Do not fake it. |
| H4 Channel growth | Practices add entities and seats | `practice.created` → `entity.created` (2nd+) → `seat.accepted` | Plateau at 1 client |
| H5 Price | Unaffiliated pay | `payment.recorded` split by Founding Practice flag | **Cannot test until founding vs unaffiliated and `practice_id` on payments exist.** |

**Proposed activation metric (H1, needs your yes/no):**

> Of `firms` that signed up in week W (excluding internal/demo), how many have `report.sent` on a real client within 14 days?

Alternative if send is rare in pilot: first `upload.succeeded` + `view.opened` health. That is a **weaker** activation; label it as such.

**Proposed loop metric (H2):**

> Of `task.assigned` in week W with an email dispatched, % `task.completed` within 14 days. Show the hole where `task.link.engaged` is missing.

---

## 6. Commitment ladder (computable from existing tables, after flags)

Rungs from the brief, with **this** repo’s evidence:

| Rung | Evidence |
|---|---|
| signed_up | `signup.completed` |
| demo_entity_only | `entity.created` where `is_demo` (column TBD) |
| real_client_uploaded | `upload.succeeded` on non-demo client |
| branding_configured | `practice.brand.configured` |
| report_sent_to_client | `report.sent` with channel ≠ `pdf_download` preferred |
| task_assigned | `task.assigned` + preferably `task.email.dispatched` |
| second_entity_added | second non-demo `entity.created` for the firm |
| colleague_invited | `seat.invited` / `seat.accepted` |
| invoice_paid | `payment.recorded` status `received` tied to firm |
| referred_another_practice | **no event today** (`referral_code` unused) |

Score weekly per `firms.id`. Owner-only SMEs (no firm) need a parallel ladder on `clients.id` — **open:** in or out of the practice-channel instrument?

---

## 7. Stall rules (Phase 2 — listed so taxonomy covers the events they need)

| Stall | Needs |
|---|---|
| `signup_no_entity` | `signup.completed` vs `entity.created` |
| `upload_no_report` | `upload.succeeded` vs `report.downloaded` / `report.sent` |
| `report_no_send` | `report.downloaded` vs `report.sent` |
| `send_no_assign` | `report.sent` vs `task.assigned` |
| `assign_no_completion` | `task.assigned` vs `task.completed` |
| `high_correction_rate` | **blocked on H3 instrumentation** |
| `month2_dormant` | any server commitment event in month 2 |

Mom Test questions stay exactly as in the brief (past-tense, behavioural). Not implemented in Phase 0.

---

## 8. Existing `lighthouse_product_usage` — dual-run

Phase 1 should **not** drop the current table on day one. Options (pick at approval):

- **A.** Keep ingesting the old event names; additionally write allowlisted keys to `analytics.events`.
- **B.** Map old names → new keys in `ingestProductUsage` and stop the old table after a cutoff.

Recommendation: **A** for one pilot month so `/ops?tab=usage` does not go dark.

Do not treat old `financials_uploaded` as `upload.succeeded` (client-side, wrong feature_key for firm uploads).

---

## 9. Explicitly out of taxonomy until you say otherwise

- Landing waitlist without a row
- Quiz answers payload
- `/ack` acknowledgement as engagement
- Magic-link GET fetch
- Score recompute spam
- Lighthouse sales touches mixed into product activation (keep CRM events in `milon_ops_leads` / `lighthouse_touches`; optional later `lead.*` keys in the spine **filtered out of H1–H4**)
- Extraction correction rate
- Invoice lifecycle
- Referrals
- Ask AI ratings
- Founder vanilla dashboard (Phase 3)

---

## 10. Approval checklist

Please confirm or correct:

1. Actor set in §2 (especially `sme_member` and collapsing `practice_admin`).
2. Activation = `report.sent` within 14d of firm signup, excluding internal/demo — or a weaker pilot definition.
3. How to mark **demo** clients and **Founding Practice** / **internal** users before any backfill.
4. Dual-role and impersonation cohorting.
5. Whether to implement `task.link.engaged` beacon in Phase 1 or wait (funnel stays honest with a hole).
6. Whether `/ack` is fixed to POST as part of Phase 1 or excluded from metrics.
7. Client allowlist in §4.
8. Dual-run option A vs B for `lighthouse_product_usage`.
9. Payments: add `firm_id` before using money as a ladder rung.
10. H3: delay until correction instrumentation, rather than shipping a fake rate.

After approval: Phase 1 is `analytics` schema (deny-all RLS, service role / founder allowlist), triggers on the commitment tables above, extend existing analytics ingest — **not** a new vanilla stack, **not** Gemini, **not** `public.tasks`.
