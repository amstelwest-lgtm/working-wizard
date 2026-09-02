# MILŌN validated-learning metrics

Phase 0 inventory: [`INVENTORY.md`](./INVENTORY.md), [`PROPOSED_TAXONOMY.md`](./PROPOSED_TAXONOMY.md) (approved).

Phase 1 (this folder + migration) is the **event spine**. It is not a dashboard. Cumulative `/ops` signup/revenue totals stay as bookkeeping and are not this instrument.

## Apply

Paste `supabase/migrations/20260902120000_analytics_events_spine.sql` in the Supabase SQL editor.

Then mark rows by hand (do not guess from names):

```sql
-- Sandbox clients
-- update public.clients set is_demo = true where id in (...);

-- Founding Practice firms (segment out of headline PMF)
-- update public.firms set is_founding_practice = true where id in (...);

-- Extra internal test firms (founder-owned firms are auto-flagged)
-- update public.firms set is_internal = true where id in (...);
```

Add founder emails to `analytics.founder_emails` if needed. Firms owned by those emails are set `is_internal` when the migration runs.

## What writes

| Path | Events |
|---|---|
| Postgres triggers | Commitment: signup, practice, entity, upload.succeeded, brand, tasks, emails, report.sent / downloaded / zip_all, QBO, sign-off, invites, payments, Ask AI submit, impersonation |
| `public.analytics_track` (authenticated) | Intent only — allowlist in `src/lib/analytics-events.ts` |
| `POST /api/task-engaged` | `task.link.rendered` / `task.link.engaged` (hashed actor, `is_bot` from UA + dispatch latency) |
| Dual-run | Existing `lighthouse_product_usage` still fills; mapped keys also go to `analytics.events` |

GET `/t/:token` and GET `/ack/:token` write **no** analytics and **no** product rows. Ack confirm is a button. Task engagement is a POST beacon after a human signal (or 3s visible dwell).

**Activation (H1):** `report.sent` (not `report.downloaded` / `pdf_download`) within 14 days of `practice.created`, excluding `is_internal` / `is_demo` / `is_bot`.

**Loop (H2):** `task.assigned` → `task.email.dispatched` → `task.link.engaged` (not GET) → `task.completed`. Until the migration is applied, engaged will be empty.

H3 (extraction corrections) is **not** instrumented — we cannot tell AI-fill vs blank form yet.

## Rollback

[`ROLLBACK.sql`](./ROLLBACK.sql) drops the analytics schema and new columns. Product tables are otherwise unchanged.

## What this is not

No founder dashboard, cohort views, stall queue, or digest yet (Phase 2–3). Do not add NPS or customer-facing analytics.
