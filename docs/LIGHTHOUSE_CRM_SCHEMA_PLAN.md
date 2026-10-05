# LH-A1 — Lighthouse CRM schema audit

Plan only. This document does not change the database, the send path, or the agent.
Live Lighthouse data stays on the tables it already uses.

Audit date: 2026-10-05. Source of truth is the SQL in `supabase/migrations/` plus the
writers in `src/lib/lighthouse.functions.ts`, `src/lib/lighthouse-delivery.server.ts`,
`src/lib/lighthouse-optout.server.ts`, and `src/lib/owner-ops.functions.ts`.

## Decision

Ship no migration in this change.

A safe additive migration would be empty `lighthouse_firms` / `lighthouse_contacts` /
`lighthouse_activities` / `lighthouse_campaigns` / `lighthouse_cadence_steps` tables with
deny-all RLS. That is low-risk to apply and high-risk to leave unused: the app would keep
writing `milon_ops_leads`, and two CRM shapes would drift before Night-1. The stage CHECK
on `milon_ops_leads` cannot be swapped in place. Existing rows and the running console
(`LIGHTHOUSE_STAGES` in `src/lib/lighthouse.functions.ts`) still use the old vocabulary.
Replacing that CHECK, or backfilling firms from free-text `company`, is a data migration
with a dedupe rule Theo has to accept first.

The next schema PR should be the Phase 1 script in [Migration approach](#migration-approach),
applied only when the admin UI in [CRM admin UI, first surface](#crm-admin-ui-first-surface)
is ready to read the new tables. Until then the live writer stays `milon_ops_leads`.

## What exists today

Lighthouse CRM is a founder console (`/ops` → Lighthouse — sales). RLS on every table
below is deny-all for `authenticated` and `anon`. Server functions use the service role
after `MILON_OWNER_EMAILS` and the ops passphrase. Nothing here is readable by a signed-in
accountant or client.

### `public.milon_ops_leads` — one row is a person and a company

Created in `20260819190000_milon_owner_ops.sql`, extended by
`20260820100000_milon_lighthouse.sql`, `20260820140000_lighthouse_optout_and_assets.sql`,
and `20260822210000_lighthouse_engagement.sql`.

| Column | Notes |
| --- | --- |
| `id` | uuid PK |
| `name`, `email`, `company` | All nullable. `email` is not unique. |
| `status` | Legacy text, default `'new'`. The CHECK `('new','contacted','qualified','won','lost','nurture')` was dropped. `addOpsLead` still writes `status: "new"`. The Lighthouse console ignores the column and uses `stage`. |
| `source`, `notes` | Free text. Console inserts `source = 'lighthouse'` or `'lighthouse_import'`. Ops insert uses `'manual'`. |
| `created_at`, `updated_at` | |
| `persona` | `'owner'` \| `'accountant'`. This is who we sell to, not the CRM owner of the record. |
| `stage` | CHECK: `sourced`, `researched`, `contacted`, `replied`, `meeting`, `trial`, `activated`, `won`, `lost`, `nurture`. Default `sourced`. |
| `signal`, `role_title`, `phone`, `city` | `phone` is never read by the console. |
| `sequence_key`, `sequence_step` | Default sequence `owner_v1`, step `0`. |
| `next_touch_on` | `date`, not a timestamp. Indexed where `do_not_contact = false`. |
| `last_touch_at`, `replied_at`, `meeting_at` | |
| `trial_token`, `trial_clicked_at`, `trial_signed_up_at` | Token is unique when present. |
| `do_not_contact` | Boolean. Send and draft refuse the lead when true. |
| `lost_reason` | Set to `hard bounce`, `spam complaint`, `delivery failed`, or `unsubscribed`. The console type `LighthouseLead` does not surface it. |
| `optout_token`, `optout_at`, `optout_source` | Token unique when present. Sources seen in code: `one_click`, `link`, `manual`, plus webhook reasons `bounce`, `complaint`, `unsubscribe`, `failed`. |
| `last_clicked_at`, `last_clicked_url`, `last_inbound_at` | |

Stage default on a row created by `addOpsLead` is `sourced` (column default) while `status`
stays `new`. Those two fields already disagree.

### `public.lighthouse_touches` — planned and sent outbound steps

`20260820100000_milon_lighthouse.sql`, plus `provider_message_id` in
`20260822100000_lighthouse_send_guards.sql`, plus `delivered_at` / `clicked_at` /
`last_clicked_url` in `20260822210000_lighthouse_engagement.sql`.

| Column | Notes |
| --- | --- |
| `lead_id` | FK → `milon_ops_leads(id)` ON DELETE CASCADE |
| `step_no` | integer 1–8 |
| `channel` | `email` \| `linkedin` \| `call` \| `whatsapp`. Default `email`. Console send path is email. |
| `angle`, `subject`, `body` | Draft content lives here. |
| `status` | `draft` \| `approved` \| `sent` \| `replied` \| `skipped` \| `failed` |
| `scheduled_for` | date |
| `sent_at`, `delivered_at`, `clicked_at`, `last_clicked_url`, `error` | |
| `provider_message_id` | Unique when present. Bounce and reply webhooks look up by this id. |
| `created_at`, `created_by` | `created_by` is `auth.users(id)`, nullable. No `agent` \| `human` \| `webhook` kind. |

### `public.lighthouse_inbound` — inbound email only

`20260822210000_lighthouse_engagement.sql`. Columns: `lead_id` (nullable FK, ON DELETE
CASCADE), `provider_email_id` (unique when present), `from_email`, `subject`, `body`,
`received_at`, `created_at`. No activity type, no `created_by`.

### `public.lighthouse_sequences` — playbooks, stored as one JSON array

`20260820100000_milon_lighthouse.sql`. Columns: `key` PK, `name`, `persona`
(`owner` \| `accountant`), `steps` jsonb, `active` boolean, `updated_at`.

Seeded keys still in migrations:

| Key | Shape |
| --- | --- |
| `owner_v1` | 5 steps, days 0/3/7/12/18, with `asset_fallback` |
| `accountant_v1` | 5 steps, days 0/4/9/17/28 (v3 rewrite) |
| `accountant_oneshot_v1` | 1 step, day 0 |

Each step object is `{step, day, angle, goal, max_words, cta, asset, asset_fallback}`.
The email body is not in the database. Accountant golden copy lives in
`src/lib/lighthouse-accountant-golden.ts`. Owner copy is drafted by Claude at click time.

### `public.lighthouse_assets` — collateral slots

`key`, `kind` (`video` \| `faq` \| `demo` \| `one_pager` \| `case_study` \| `link`),
`title`, `purpose`, `used_in_step`, `persona`, `url`, `status`
(`placeholder` \| `in_progress` \| `ready`), `used_in`, `updated_at`.

### `public.milon_ops_settings` key `lighthouse`

JSON knobs, not a campaign row: `sender_name`, `sender_title`, `trial_days`,
`daily_send_cap` (default 25), `booking_url`, `send_window`
(`Tue-Thu 07:00-09:00 SAST`), `auto_send` (seeded `false`), `reply_to`
(locked toward `team@trymilon.com` by `20260912170000_lighthouse_reply_to_trymilon.sql`
and `resolveLighthouseReplyTo`), `sender_address` (read by the console, not in the
original seed).

### Nearby tables that are not the CRM

| Table | Why it stays out of this model |
| --- | --- |
| `public.firms` | Product practice tenant: `owner_user_id`, memberships, `market` jsonb `{country: ZA\|US, regionCode}`, `is_internal`, `is_founding_practice`. Member RLS. A prospect must never be inserted here. |
| `public.clients` | Product workspace. `firm_id` points at `public.firms`. |
| `public.suppressed_emails` | Platform-wide send block (`email` unique, `reason`, `metadata`). Written by the Lighthouse bounce/complaint/unsubscribe path and by transactional mail. Service-role only, no policies. |
| `public.lighthouse_product_usage` | In-product feature analytics. Insert-own RLS for `authenticated`. |
| `public.milon_bot_runs`, `milon_bot_tool_calls` | In-product Milonbot objective trace, keyed by `client_id`. |
| `public.milon_ops_payments` | Manual revenue ledger. Optional `firm_id` → product `public.firms`. |

## Hypothesis check

`lighthouse_touches`, `lighthouse_inbound`, and `lighthouse_sequences` overlap the target
Activity and Campaign/CadenceStep shapes. They are not those tables.

- A touch is one sequence step with a draft lifecycle (`draft` → `approved` → `sent`).
  It can record `call` as a channel, and it stores `provider_message_id`. It does not
  record notes, meetings, signups, opt-outs, warmup, or inbound mail.
- Inbound replies are a second table (`lighthouse_inbound`), matched on
  `provider_email_id`, not on a shared activity type.
- Opt-out, bounce, and trial signup are columns and timestamps on the lead
  (`optout_at`, `do_not_contact`, `trial_signed_up_at`), not activity rows.
- A sequence is a persona playbook (`steps` jsonb plus `active`). It has no geo, no
  per-campaign cap, and no signing rule. The only daily cap is the global settings knob.
- Assets are collateral the drafter may link. They are not cadence templates.

So the overlap is real and partial. The migration should copy from these tables and
keep them as the send pipeline until a later cutover. It should not rename them in place.

## Gap list

Legend: **have** means a column already stores this fact. **partial** means a nearby
field that must not be aliased blindly. **missing** means no column.

### Firm

Target: `name`, `country` `US|SA|OTHER`, `website`, `size_band`, `stack`
`xero|qbo|other|unknown`, `icp_score`, `source`, `owner`, `stage`, `next_action_at`,
`next_action`, `notes`, `suppress_reason`, `campaign_tags` (warmup vs campaign).

| Target | Current | Gap |
| --- | --- | --- |
| Firm row | `milon_ops_leads.company` text | **partial** — a label on the person row. No firm id. Blank company is common. |
| `name` | `company` | **partial** |
| `country` US\|SA\|OTHER | `city` text. Product `firms.market.country` is `ZA`\|`US` on a different table. | **missing**. Do not copy `ZA` into CRM `SA`, and do not infer country from `city`. |
| `website` | — | **missing** |
| `size_band` | — | **missing** |
| `stack` | — | **missing** |
| `icp_score` | — | **missing**. `signal` is a sentence the drafter quotes, not a score. |
| `source` | `source` text | **have**, free text, not an enum |
| `owner` | — | **missing**. `persona` is the buyer type. `lighthouse_touches.created_by` is the auth user who drafted a touch. |
| `stage` | `stage` CHECK, ten values | **partial** — see stage map |
| `next_action_at` | `next_touch_on` date | **partial** — date only, and it means “next sequence send”, not an arbitrary next action |
| `next_action` | — | **missing** |
| `notes` | `notes` | **have** |
| `suppress_reason` | `lost_reason`, `optout_source`, `do_not_contact` | **partial** — bounce and unsubscribe both set `stage = 'lost'` (or leave a late-stage lead in place — see opt-out). There is no suppress reason that stays distinct from a commercial loss. |
| `campaign_tags` | `sequence_key` (single playbook) | **missing**. No warmup-vs-campaign tag. |

### Contact

Target: `firm_id`, `name`, `email`, `role`, `bounce_status`, `suppress`.

| Target | Current | Gap |
| --- | --- | --- |
| Contact row under a firm | The lead row itself | **partial** — one person, no `firm_id`, no second contact |
| `name` | `name` | **have** |
| `email` | `email` | **have**, not unique, not normalized by a constraint (console lowercases on some writes) |
| `role` | `role_title` | **have** |
| `bounce_status` | Touch `status = 'failed'` plus `lost_reason = 'hard bounce'` plus `suppressed_emails.reason` | **partial** — no per-contact bounce enum. Soft vs hard is not stored. `delivery failed` is lumped with bounce on the platform suppression list (`reason` rewritten to `bounce` when the event is `failed`). |
| `suppress` | `do_not_contact` | **partial** — also mirrored into `suppressed_emails` for the address, which blocks transactional mail too |

Also on the lead, with no target column yet: `phone`, `trial_token`, `optout_token`.
Keep them on the legacy row. See [Leave these alone](#leave-these-alone).

### Activity

Target: `type` `email_out` \| `email_in` \| `call` \| `note` \| `meeting` \| `signup` \|
`opt_out` \| `warmup`, `provider_message_id`, `created_by` `agent` \| `human` \| `webhook`.

| Target | Current | Gap |
| --- | --- | --- |
| One activity stream | `lighthouse_touches` + `lighthouse_inbound` + timestamps on the lead | **partial** |
| `email_out` | Touch with `channel = 'email'` and a send lifecycle | **partial** — drafts exist before send. An activity row should be the send (or an explicit manual log), not every draft revision. |
| `email_in` | `lighthouse_inbound` | **partial** |
| `call` | Touch `channel = 'call'` is allowed and unused by the send path | **missing** as a logged activity |
| `note` | `notes` is one blob on the lead | **missing** as an activity |
| `meeting` | `meeting_at` timestamp; stage `meeting` means an email thread in the current product copy | **partial** — a timestamp, not an activity, and the stage word does not mean a booked meeting |
| `signup` | `trial_signed_up_at` | **partial** |
| `opt_out` | `optout_at` / `optout_source` | **partial** |
| `warmup` | — | **missing** |
| `provider_message_id` | `lighthouse_touches.provider_message_id`; inbound uses `provider_email_id` | **have** on the two tables separately |
| `created_by` agent\|human\|webhook | `created_by uuid` on touches only | **missing** as a kind. Webhook updates do not set it. Inbound rows have no actor. |

### Campaign

Target: `geo`, `daily_send_cap`, `status`.

| Target | Current | Gap |
| --- | --- | --- |
| Campaign row | `lighthouse_sequences` plus settings JSON | **partial** |
| `geo` | — | **missing**. Persona is `owner` \| `accountant`, not US/SA. |
| `daily_send_cap` | `milon_ops_settings.lighthouse.daily_send_cap` | **partial** — one global cap, enforced in `sendLighthouseTouch` on SAST calendar day across every sequence |
| `status` | `lighthouse_sequences.active` boolean | **partial** — on/off playbook, not a campaign status |

### CadenceStep

Target: templates the agent chooses; `signing_rule` `theo_us` \| `team_only`.

| Target | Current | Gap |
| --- | --- | --- |
| One row per step | Object inside `lighthouse_sequences.steps` | **partial** |
| Template the agent chooses | `goal`, `angle`, `max_words`, `cta`, `asset` | **partial** — instructions and asset keys. Subject/body templates are code (golden) or generated at draft time. |
| `signing_rule` | Settings `sender_name` = `Theo van der Westhuizen`. Accountant v3 comment says voice “The Milōn Team”. Reply-To resolves to `team@trymilon.com`. | **missing**. No per-step rule. |

### Stages

Target path:

`new → researched → warmed → outreached → replied → meeting → pilot → customer`

Exits: `nurture` \| `closed_lost` \| `suppressed`

Current CHECK and console board:

`sourced → researched → contacted → replied → meeting → trial → activated → won`

Plus exits `lost` \| `nurture`. The board shows `lost` and `nurture` as chips beside the
main path. Labels in the UI already diverge from the stored values (`contacted` is shown
as “In sequence”, `meeting` as “In conversation”, `trial` as “Free trial”, `won` as
“Paying”).

| Current `stage` | Target | Rule for a later backfill |
| --- | --- | --- |
| `sourced` | `new` | Direct map. |
| `researched` | `researched` | Same word. |
| — | `warmed` | No current value. Leave null / skip. Do not invent `warmed` from “step 2 was sent”. |
| `contacted` | `outreached` | Direct map. Send path advances `sourced` and `researched` to `contacted` on first send. |
| `replied` | `replied` | Same word. |
| `meeting` | `meeting` | Same word. Current code treats this stage as an email conversation (`20260822160000_lighthouse_email_first.sql`). Keep that meaning until the product decides a meeting is a booked call. |
| `trial` | `pilot` | Map the value. Trial tokens and `trial_signed_up_at` stay as the signup mechanism. |
| `activated`, `won` | `customer` | Map both forward. Copy the old value onto `legacy_stage` so “using the product” and “paying” are not collapsed in history. |
| `nurture` | `nurture` | Same word. |
| `lost` and `do_not_contact = true` with `optout_source` in `bounce`, `complaint`, `unsubscribe`, `failed`, `one_click`, `link`, `manual` | `suppressed` | These rows were forced to `lost` by the webhook or the opt-out helper. |
| `lost` and not in the suppress set above | `closed_lost` | Commercial loss. |
| `do_not_contact = true` while `stage` stayed late (`replied`, `meeting`, `trial`, `activated`, `won`) | `suppressed` | `applyLighthouseOptOut` only flips early stages (`sourced`, `researched`, `contacted`, `nurture`) to `lost`. A late-stage opt-out keeps its stage and sets the flag. The target exit is `suppressed`. |

There is no `warmed` stage and no warmup activity today. `auto_send` is false. Night-1
stays gated: this plan does not add a warmup campaign or a scheduler.

## Migration approach

Additive, dual-read, then backfill. No `DROP TABLE`, no `TRUNCATE`, no in-place rename of
`milon_ops_leads` / `lighthouse_touches` / `lighthouse_inbound` / `lighthouse_sequences` /
`lighthouse_assets`, no rewrite of their CHECK constraints, no change to ON DELETE CASCADE
on the legacy foreign keys.

Suggested later filename (do not add it until Phase 1 is approved):
`supabase/migrations/20261006120000_lighthouse_crm_shape.sql`.

### Phase 1 — empty shape, no copy

Create the five tables below with `CREATE TABLE IF NOT EXISTS`. Enable RLS. Add the same
deny-all policy the other Lighthouse tables use (`FOR ALL TO authenticated, anon USING
(false) WITH CHECK (false)`). Grant nothing to `authenticated` or `anon`.

Columns are nullable except ids, timestamps, and the CHECKs that define the vocabulary.
Existing leads are not inserted. The console keeps reading `milon_ops_leads`.

`lighthouse_firms`

- `id uuid` PK
- `legacy_lead_id uuid` UNIQUE NULL — points at the lead this firm was copied from. No FK
  until Phase 2, so a lead delete cannot cascade into the new table by accident. Phase 2
  adds `REFERENCES milon_ops_leads(id) ON DELETE SET NULL`.
- `name text`
- `country text` CHECK (`US`, `SA`, `OTHER`)
- `website text`
- `size_band text`
- `stack text` CHECK (`xero`, `qbo`, `other`, `unknown`)
- `icp_score numeric`
- `source text`
- `owner_label text` — display name of the human who owns the record. Not an `auth.users` FK
  until more than one operator exists.
- `stage text` CHECK (`new`, `researched`, `warmed`, `outreached`, `replied`, `meeting`,
  `pilot`, `customer`, `nurture`, `closed_lost`, `suppressed`)
- `legacy_stage text` — the pre-map value (`activated` vs `won`, and so on)
- `next_action_at timestamptz`
- `next_action text`
- `notes text`
- `suppress_reason text`
- `campaign_tags text[]` — allowed values enforced in app code as `warmup` and `campaign`
  for now. A CHECK on each element can wait until the tag list is stable.
- `created_at`, `updated_at`

`lighthouse_contacts`

- `id uuid` PK
- `firm_id uuid` NULL REFERENCES `lighthouse_firms(id)` ON DELETE RESTRICT
- `legacy_lead_id uuid` UNIQUE NULL
- `name text`, `email text`, `role text`
- `bounce_status text` CHECK (`none`, `soft`, `hard`) default `none`
- `suppress boolean` default false
- `created_at`, `updated_at`

No unique constraint on `email` in Phase 1. Live leads can repeat an address.

`lighthouse_activities`

- `id uuid` PK
- `firm_id uuid` NULL REFERENCES `lighthouse_firms(id)` ON DELETE RESTRICT
- `contact_id uuid` NULL REFERENCES `lighthouse_contacts(id)` ON DELETE RESTRICT
- `legacy_touch_id uuid` UNIQUE NULL
- `legacy_inbound_id uuid` UNIQUE NULL
- `type text` CHECK (`email_out`, `email_in`, `call`, `note`, `meeting`, `signup`,
  `opt_out`, `warmup`)
- `provider_message_id text` — index, not UNIQUE, while `lighthouse_touches` still owns
  the unique webhook key
- `created_by_kind text` CHECK (`agent`, `human`, `webhook`)
- `created_by_user_id uuid` NULL REFERENCES `auth.users(id)` ON DELETE SET NULL
- `occurred_at timestamptz`
- `subject text`, `body text` — copied for history; the send pipeline still edits the touch
- `created_at`

`lighthouse_campaigns`

- `id uuid` PK
- `legacy_sequence_key text` UNIQUE NULL
- `name text`
- `geo text` CHECK (`US`, `SA`, `OTHER`) NULL
- `daily_send_cap integer` NULL CHECK (`daily_send_cap >= 0`)
- `status text` CHECK (`draft`, `active`, `paused`, `ended`)
- `from_address text` CHECK (`from_address = 'team@trymilon.com'`)
- `created_at`, `updated_at`

`from_address` is fixed to `team@trymilon.com` so a campaign row cannot store a cold From
on `milonfinance.com` or `milon.co.za`. The column stays NULL until a campaign is actually
armed. Phase 1 does not read or write `RESEND_FROM_EMAIL`.

`lighthouse_cadence_steps`

- `id uuid` PK
- `campaign_id uuid` REFERENCES `lighthouse_campaigns(id)` ON DELETE RESTRICT
- `legacy_sequence_key text` NULL
- `step_no integer`
- `day_offset integer`
- `template_subject text` NULL
- `template_body text` NULL
- `signing_rule text` CHECK (`theo_us`, `team_only`)
- `asset_key text` NULL — copied from the step’s `asset`, still resolved against
  `lighthouse_assets`
- UNIQUE (`campaign_id`, `step_no`)

Leave `template_subject` and `template_body` NULL in the backfill. Golden copy stays in
TypeScript until someone deliberately publishes a template into the step row.

### Phase 2 — backfill, still dual-write off

One transaction, idempotent, keyed by `legacy_lead_id` / `legacy_touch_id` /
`legacy_inbound_id` / `legacy_sequence_key`. Re-running inserts nothing new.

1. One `lighthouse_firms` row per lead. `name` = `NULLIF(btrim(company), '')`. If company
   is blank, `name` stays NULL and the contact still hangs off the firm (the firm is the
   container, not a guessed company). Do not merge two leads that share a company string
   in this phase — `company` is free text and collisions are unreviewed.
2. One `lighthouse_contacts` row per lead. `email` lowercased. `role` = `role_title`.
   `suppress` = `do_not_contact`. `bounce_status` = `hard` when `lost_reason` is
   `hard bounce` or `optout_source` is `bounce`; otherwise `none`. Soft bounces are not
   in the data.
3. Map `stage` with the table above. Set `suppress_reason` from `lost_reason` when the
   new stage is `suppressed`, otherwise leave it NULL (`lost_reason` on a commercial loss
   can be copied into firm notes as a prefixed line `Lost reason: …` only when `notes`
   does not already contain it).
4. `next_action_at` = `next_touch_on` at `00:00` SAST (`Africa/Johannesburg`), stored as
   `timestamptz`. `next_action` stays NULL.
5. `source` copied as-is. `owner_label` stays NULL. `campaign_tags` stays `'{}'`. Do not
   tag `owner_v1` / `accountant_v1` / `accountant_oneshot_v1` as `campaign` until Theo
   classifies them. They are cold sequences, and warmup does not exist yet.
6. Activities, inserted only when the legacy id is not already present:
   - Each touch with `status = 'sent'` and `channel = 'email'` → `email_out`,
     `provider_message_id` copied, `created_by_kind = 'human'`, `occurred_at = sent_at`.
   - Each touch with `status = 'sent'` and `channel = 'call'` → `call`. LinkedIn and
     WhatsApp touches, if any ever exist, stay on the legacy table (no target type).
   - Each `lighthouse_inbound` row → `email_in`, `provider_message_id` =
     `provider_email_id`, `created_by_kind = 'webhook'`, `occurred_at = received_at`.
   - When `optout_at` is not null → one `opt_out`, `created_by_kind = 'webhook'` if
     `optout_source` is a Resend reason, else `human`.
   - When `trial_signed_up_at` is not null → one `signup`, `created_by_kind = 'webhook'`.
   - Draft, approved, skipped, and failed touches are not activities. They remain the
     send queue.
7. One campaign per sequence key. `status` = `active` when `active` is true, else
   `paused`. `geo` NULL. `daily_send_cap` NULL (the global cap remains in settings).
   `from_address` NULL. `signing_rule` on every exploded step = `team_only`. Do not
   assign `theo_us` without an explicit US campaign.
8. Counters and tokens (`trial_token`, `optout_token`, click timestamps) stay on
   `milon_ops_leads`. The new tables do not duplicate them in Phase 2.

After Phase 2 the console still writes the legacy tables. A read-only “CRM preview” can
select the new tables. Cutover (Phase 3) is a later PR: dual-write both shapes, then switch
the board, then stop writing legacy stage. Only after the send path reads cadence steps
may `lighthouse_sequences.steps` become a cache.

### Rename map (logical — no `ALTER TABLE … RENAME`)

| Legacy | New |
| --- | --- |
| `milon_ops_leads` | stays; splits conceptually into `lighthouse_firms` + `lighthouse_contacts` |
| `milon_ops_leads.company` | `lighthouse_firms.name` |
| `milon_ops_leads.name` | `lighthouse_contacts.name` |
| `milon_ops_leads.email` | `lighthouse_contacts.email` |
| `milon_ops_leads.role_title` | `lighthouse_contacts.role` |
| `milon_ops_leads.do_not_contact` | `lighthouse_contacts.suppress` |
| `milon_ops_leads.stage` | `lighthouse_firms.stage` via the map; raw value also in `legacy_stage` |
| `milon_ops_leads.next_touch_on` | `lighthouse_firms.next_action_at` |
| `milon_ops_leads.notes` | `lighthouse_firms.notes` |
| `milon_ops_leads.source` | `lighthouse_firms.source` |
| `milon_ops_leads.lost_reason` + opt-out fields | `lighthouse_firms.suppress_reason` when the mapped stage is `suppressed` |
| `milon_ops_leads.sequence_key` | `lighthouse_campaigns.legacy_sequence_key` (not `campaign_tags`) |
| `lighthouse_touches` sent email | `lighthouse_activities` type `email_out` |
| `lighthouse_inbound` | `lighthouse_activities` type `email_in` |
| `lighthouse_touches.provider_message_id` | `lighthouse_activities.provider_message_id` |
| `lighthouse_inbound.provider_email_id` | `lighthouse_activities.provider_message_id` |
| `lighthouse_sequences` | `lighthouse_campaigns` |
| `lighthouse_sequences.steps[]` | `lighthouse_cadence_steps` |
| `milon_ops_settings.lighthouse.daily_send_cap` | stays global; optional later copy onto a campaign cap |
| `public.firms` | unchanged product tenant. Never the CRM firm. |

### RLS

Keep the current pattern for every new CRM table:

- `ENABLE ROW LEVEL SECURITY`
- Single policy: deny `ALL` to `authenticated` and `anon`
- No `GRANT` to those roles
- Access only through service-role server functions that already call
  `assertOpsConsoleAccess` / `assertPlatformOwner`

`owner_label` is a string, not a policy predicate. Do not add
`USING (auth.uid() = owner)` — the console is not a multi-tenant CRM yet, and a mistaken
policy would either hide every row or open prospect data to product users.

Leave these policies as they are:

- `public.firms` / `firm_memberships` — member and owner checks (`is_firm_member`)
- `lighthouse_product_usage` — insert-own, deny select/update/delete for `authenticated`
- `suppressed_emails` — RLS on, zero policies, service role only
- `milon_bot_runs` — `has_client_access` select for the product bot, unrelated to sales

Webhook handlers (`src/lib/lighthouse-delivery.server.ts`) stay on the service role.
They must keep updating `lighthouse_touches` and `milon_ops_leads` until Phase 3.
A new activity insert in the webhook is Phase 3 dual-write, not Phase 1.

### Writers a later migration has to keep working

| Path | What it writes |
| --- | --- |
| `upsertLighthouseLead` / `importLighthouseLeads` | leads, `stage` default `sourced`, `source` `lighthouse` / `lighthouse_import` |
| `addOpsLead` | leads with legacy `status = 'new'` (stage then defaults to `sourced`) |
| `sendLighthouseTouch` | touch status, `provider_message_id`, lead stage → `contacted` |
| `applyLighthouseDeliveryEvent` | bounce/complaint/unsubscribe → `do_not_contact`, `stage = 'lost'`, `lost_reason`, `suppressed_emails` |
| `applyLighthouseOptOut` | `do_not_contact`; `stage = 'lost'` only from early stages |
| Inbound + click handlers in `lighthouse-delivery.server.ts` | `lighthouse_inbound`, click columns, stage advance toward `replied` |
| Trial visit / signup | `trial_clicked_at`, `trial_signed_up_at`, stage `trial` |
| Sequence migrations | in-place `UPDATE` of `lighthouse_sequences.steps` for `accountant_v1` and the one-shot |

Any Phase 1 script that changes a CHECK these writers use will break `/ops` and the
Resend webhook. That is why Phase 1 only creates new tables.

## CRM admin UI, first surface

The console already has Pipeline, Playbook, Assets, and Settings
(`src/components/lighthouse-panel.tsx`). The first CRM surface is a thin layer on that
pipeline, still human-operated, still behind the owner gate, still click-to-send.

Build this only after Phase 2, and only these screens:

1. **Firm list.** One row per firm: name (or the contact’s email when name is null),
   country, stack, stage, owner label, next action date, suppress flag. Filter chips for
   the target stages including the three exits. Default sort: `next_action_at` then
   `updated_at`.
2. **Firm drawer.** Edit the missing firm facts that cannot be inferred: country, website,
   size band, stack, ICP score, owner label, next action text, notes. Show the single
   backfilled contact (name, email, role, bounce status, suppress) on the same drawer.
   A second contact can wait.
3. **Stage control** that writes the new stage CHECK, with `suppressed` separate from
   `closed_lost`. Show `suppress_reason` and `lost_reason` (legacy) on the drawer. Today
   a bounce looks like “Lost” and the reason is invisible in the UI.
4. **Activity list** on the drawer: sent email, inbound, opt-out, signup, plus one new
   write — a manual `note` (`created_by_kind = human`). Do not rebuild the drafter here.
   Draft / Load golden / Send now stay on the existing touch UI until Phase 3.

Defer playbook editing, asset management, and the global daily cap. They already work.

## Leave these alone

- **The Claude sales agent** (Milonbot-class Lighthouse). No new tools, no
  `milon_bot_runs` rows for prospects, no auto-pick of cadence templates.
- **Night-1 / unattended send.** `auto_send` stays false. Do not add a cron that walks
  `next_touch_on`. Do not lift `LIGHTHOUSE_DRY_RUN` or `LIGHTHOUSE_SEND_ALLOWLIST`.
- **Cold From domain.** Reply-To is already forced to `team@trymilon.com` in code and in
  `20260912170000_lighthouse_reply_to_trymilon.sql`. From is still
  `process.env.RESEND_FROM_EMAIL`, with a code fallback of `noreply@milon.co.za`
  (`sendLighthouseTouch`). Day-0 docs still allow a verified `milonfinance.com` From
  until `trymilon.com` is verified in Resend. Fixing that is an env and send-path change,
  separate from this schema. The future `lighthouse_campaigns.from_address` CHECK only
  accepts `team@trymilon.com`. Do not store `hello@milonfinance.com`,
  `team@milonfinance.com`, or `noreply@milon.co.za` as a cold From.
- **`public.firms` and `public.clients`.** Product tenants. Market country stays `ZA`|`US`.
  Linking a CRM firm to a product firm, if it ever happens, is a nullable
  `product_firm_id` added after a human match — not a backfill on name.
- **`lighthouse_product_usage` and the analytics spine.** Sales events stay out of
  activation cohorts (`docs/metrics/INVENTORY.md`).
- **`suppressed_emails`.** Keep writing it from the bounce and opt-out path so
  transactional mail stays blocked. CRM `contact.suppress` does not replace it.
- **`lighthouse_assets`, golden TypeScript templates, and sequence JSON.** The drafter
  still needs them. Phase 2 copies asset keys onto cadence steps and leaves template
  bodies empty.
- **Legacy `milon_ops_leads.status`.** Stop writing it in some later cleanup. Do not
  backfill it, do not drop it, do not use it as the new stage.
- **`phone`, trial tokens, opt-out tokens, click counters, `signal`, `persona`.** Still
  used (or reserved) by the live funnel. `persona` is not `owner_label`.
- **In-place stage rename** (`sourced` → `new`, `contacted` → `outreached`, `trial` →
  `pilot`, `lost` → `closed_lost` / `suppressed`) on `milon_ops_leads`. The CHECK, the
  Zod enum, the board, the send advancer, and the webhook all share those strings.
- **Unique email, company dedupe, and merging two leads into one firm.**
- **Dropping or cascading deletes** of touches, inbound, or leads.
- **Per-campaign daily caps and geo** until a real second campaign exists. The global
  cap of 25/day SAST remains the send guard.
- **`signing_rule = theo_us`.** Default every existing step to `team_only`.
- **Warmup sequences and `campaign_tags`.** No warmup mail is modeled. Tagging current
  sequences as `campaign` is a product call, not a migration default.
- **`icp_score` formula.** The column can exist empty. Do not compute one from `signal`.

## Suggested order after this PR

1. Theo confirms the stage map, especially `activated`+`won` → `customer` with
   `legacy_stage` preserved, and bounce/`lost` → `suppressed`.
2. Phase 1 empty tables (deny-all RLS only).
3. Phase 2 idempotent backfill, then a read-only firm list against a copy of production
   or a restored snapshot — row counts: firms = contacts = leads, sent touches = `email_out`
   activities, inbound rows = `email_in` activities.
4. The four UI pieces above, still writing legacy tables for send/opt-out/webhook.
5. Phase 3 dual-write and cutover, still with `auto_send` false and From locked to
   `team@trymilon.com`.
6. Agent work only after the firm drawer and activity list are the system of record.
