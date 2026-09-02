# MILŌN validated-learning metrics

Phase 0 inventory: [`INVENTORY.md`](./INVENTORY.md), [`PROPOSED_TAXONOMY.md`](./PROPOSED_TAXONOMY.md) (approved).

Phase 1 is the **event spine**. Phase 2 is the **derived layer**. Phase 3 is the **founder instrument**: `/founder/metrics`, Monday digest, experiment registry, 24-month purge RPC. Cumulative `/ops` signup/revenue totals stay as bookkeeping and are not this instrument.

Phases: [`PHASES.md`](./PHASES.md). Questions: [`QUESTIONS.md`](./QUESTIONS.md).

Definitions live in one place: [`src/lib/metrics/definitions.ts`](../../src/lib/metrics/definitions.ts).

## Apply

Phase 1 (already applied if the spine check returned rows):

1. `supabase/migrations/20260902120000_analytics_events_spine.sql`
2. `supabase/migrations/20260902121000_analytics_events_triggers.sql`

Phase 2 + 3 — paste **in order** in the Supabase SQL editor (do not re-run Phase 1):

3. `supabase/migrations/20260902200000_analytics_derived_views.sql`
4. `supabase/migrations/20260902201000_analytics_commitment_stalls.sql`
5. `supabase/migrations/20260902300000_analytics_experiments_digest.sql`

Then, once, to snapshot the ladder and fill this week's call list:

```sql
select public.analytics_refresh_derived();
```

Sanity:

```sql
select cohort_week, is_founding_practice, practices, activation_14d_pct
from analytics.v_practice_activation
order by 1 desc;

select stall_type, severity, practice_name, suggested_question
from analytics.founder_action_queue
where status = 'open'
order by severity, created_at;
```

Mark rows by hand (do not guess from names):

```sql
-- Sandbox clients
-- update public.clients set is_demo = true where id in (...);

-- Founding Practice firms (segment out of headline PMF)
-- update public.firms set is_founding_practice = true where id in (...);

-- Extra internal test firms (founder-owned firms are auto-flagged)
-- update public.firms set is_internal = true where id in (...);
```

## What each metric falsifies

| Metric | Hypothesis | Bad reading means |
|---|---|---|
| Practice activation (14d) — `report.sent` within 14d of firm signup | H1 | Onboarding or core value is broken. Do not add features. Call stalled practices. |
| Task completion (assigned → done, 14d) | H2 | The claimed moat is not real. Do not price or position around the loop yet. |
| Report → assignment within 7d | H2 | Accountants want the diagnostic, not the workflow — a worse competitive position. |
| Median entities per practice by signup month | H4 | The accountant channel does not compound. Consider a channel pivot. |
| Month-2 active practices | H1 | Novelty, not utility. Strongest single falsifier of the value hypothesis. |
| Extraction correction rate | H3 | **Not computed.** We cannot tell AI-fill vs a blank form. |

Founding Practice rows are a **separate split**, never blended into the unaffiliated headline. Internal / demo / bot events are excluded from every view.

Owner-only SMEs (no `firms` row) are **out of this practice-channel instrument**. Dual-role accounts are cohorted as practices when `practice_id` is stamped.

## Loop interpretation

- High assignment + low completion → the loop is theatre.
- High engagement + low completion → task UX or content is wrong.
- Low dispatch → engagement → deliverability, not product. Check bounces first.
- Low assignment despite high `report.sent` → diagnostics-not-workflow. Flag in red when the dashboard exists.

Human open is **`task.link.engaged` only**. GET `/t/:token` is not engagement.

## Commitment ladder

Weekly snapshot on `analytics.practice_commitment_weekly`. Live picture: `analytics.v_practice_commitment_current`. Highest rung wins (not a sum). `referred_another_practice` is unmeasurable until referrals exist.

## Stall queue

`analytics.founder_action_queue` is a call list, not a chart. Questions are past-tense and behavioural. `high_correction_rate` is not generated (H3 blocked).

## Signal log

`analytics.customer_signals` requires a `situation` longer than 20 characters (what they actually do today). Compliment-only rows are flagged and must be excluded from any later aggregation.

## What writes (Phase 1, unchanged)

| Path | Events |
|---|---|
| Postgres triggers | Commitment: signup, practice, entity, upload.succeeded, brand, tasks, emails, report.sent / downloaded / zip_all, QBO, sign-off, invites, payments, Ask AI submit, impersonation |
| `public.analytics_track` (authenticated) | Intent only — allowlist in `src/lib/analytics-events.ts` |
| `POST /api/task-engaged` | `task.link.rendered` / `task.link.engaged` |
| Dual-run | `lighthouse_product_usage` still fills; mapped keys also go to `analytics.events` |

GET `/t/:token` and GET `/ack/:token` write **no** analytics and **no** product rows.

## Privacy (POPIA)

Raw `analytics.events` store event keys, ids, and non-financial properties. No amounts, no employee emails, no ID numbers. Magic-link actors are a hash of the token. Retention of raw events is 24 months (`analytics_purge_old_events`). Aggregates stay. Public privacy-policy copy is not changed until Theo approves question 10.

## Rollback

[`ROLLBACK.sql`](./ROLLBACK.sql) drops the analytics schema and new columns. Product tables are otherwise unchanged.

## Founder instrument (Phase 3)

- `/founder/metrics` — platform owner only (`assertPlatformOwner`, not IT). Linked from `/ops` for owners.
- Order on the page: one question / one number → call list → loop + interpretation → cohort tables → H1–H5 → signals → experiments.
- Weekly digest: `GET /api/metrics-digest` without a secret writes nothing and returns no numbers. `GET`/`POST` with `CRON_SECRET` or `MILON_DIGEST_SECRET` sends. Vercel cron: Monday 06:00 UTC. Founder **Send digest** button also works.
- Experiments require a written prediction before a result. Pivot needs a `pivot_type`.
- Retention: `select public.analytics_purge_old_events(24);` deletes raw events only. Snapshots stay. Do not schedule until you have read the count.

## What this is not

Do not add NPS, customer-facing analytics, or cumulative signup/report counters on this instrument. Do not put these numbers on `/ops?tab=usage`.
