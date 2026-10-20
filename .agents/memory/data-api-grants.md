---
name: Public Data API grants
description: New public tables, views, and sequences must grant Data API roles in the same migration. History is restored by the 2026-10-20 catch-up.
---

# Public Data API grants

From 30 Oct 2026, a table created in schema `public` does not get PostgREST grants automatically. `supabase db reset` and preview branches replay every migration, so the gap applies to old files as well as new ones.

When adding a migration under `supabase/migrations/`:

- In that same file, `GRANT SELECT, INSERT, UPDATE, DELETE` on every new public table and view `TO authenticated, service_role`.
- `GRANT USAGE, SELECT` on sequences those tables use, including `serial` and identity sequences.
- Grant `anon` only when production already does for that kind of relation, or the table is deliberately public. RLS still applies. The anon list as of 20 Oct 2026 is the header of `supabase/migrations/20261020143201_data_api_grants_catchup.sql`.
- Do not backdate the migration timestamp. Files at or before `20261020130500` are allowlisted because the catch-up migration replays production's ACLs.

The check is `pnpm test:migration-grants` (`scripts/migration-grants-check.mts`). The convention is written out in `supabase/migrations/README.md`.

The catch-up is idempotent and was derived read-only from project `jxclnsbsqpixxqlbcapl`. Do not apply it by hand on production; it ships with the other migrations. It does not widen `anon` past that snapshot.
