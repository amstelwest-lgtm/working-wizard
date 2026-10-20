# Migrations

## Data API grants (from 30 Oct 2026)

Postgres tables created in schema `public` no longer receive Data API (PostgREST) grants on their own. That includes new migrations, preview branches, and `supabase db reset`, because those replay every historical migration under the new rule. Tables that already exist in production keep the grants they have.

In the same migration that creates a public relation, grant the Data API roles explicitly. Row level security still decides which rows a role can touch; a missing grant means the Data API cannot see the relation at all.

```sql
CREATE TABLE public.example (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.example TO authenticated, service_role;
```

- `authenticated` and `service_role` both get `SELECT`, `INSERT`, `UPDATE`, and `DELETE`. `GRANT ALL` is accepted by the check because it includes those four. Do this even when RLS is what actually limits writes.
- Grant `anon` only when that relation is genuinely reachable without a session. Check current production grants before adding it (see the anon list in `20261020143201_data_api_grants_catchup.sql`). RLS still applies.
- A sequence used by the table (`CREATE SEQUENCE`, `serial`, or `GENERATED ... AS IDENTITY`) needs `GRANT USAGE, SELECT ON SEQUENCE public.<name> TO authenticated, service_role` in that same file. The default identity sequence name is `<table>_<column>_seq`.
- A view created in `public` needs the same `SELECT`, `INSERT`, `UPDATE`, `DELETE` grants to `authenticated` and `service_role`.
- Write the `GRANT` as static SQL in that file. A grant that exists only inside a comment or a string does not count.

`scripts/migration-grants-check.mts` enforces this for every timestamped migration newer than `20261020130500`. Older files are allowlisted; `20261020143201_data_api_grants_catchup.sql` restores the privileges production had on 20 Oct 2026 when history is replayed. Do not backdate a new migration's timestamp to skip the check. Non-timestamped SQL in this directory (`full_schema.sql`, `qbo_tables.sql`) is not applied by the Supabase CLI.

Run the check with `pnpm test:migration-grants`. CI runs it in the unit-test job, and `pnpm test:ci` runs it again with the other source tests.
