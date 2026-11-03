#!/usr/bin/env bash
# Apply the client-group migration on a fresh database and run the SQL tests.
# Hosted Supabase is not touched. Theo/CoS apply the migration file on a
# branch before production.
# Uses PGHOST, PGPORT, PGUSER, PGPASSWORD, and PGDATABASE when set.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"

psql -v ON_ERROR_STOP=1 -f "$root/scripts/client-groups-migration-prelude.sql"
psql -v ON_ERROR_STOP=1 -f "$root/supabase/migrations/20261103150000_client_groups.sql"
psql -v ON_ERROR_STOP=1 -f "$root/scripts/client-groups-sql-tests.sql"
