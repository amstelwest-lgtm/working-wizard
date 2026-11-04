#!/usr/bin/env bash
# Apply the anon EXECUTE lock on a fresh database and prove the grants.
# Uses PGHOST, PGPORT, PGUSER, PGPASSWORD, and PGDATABASE when set.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
migration="$root/supabase/migrations/20261020160000_revoke_anon_function_execute.sql"
# Skip "function does not exist" notices from the idempotent lock migration.
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"

psql -v ON_ERROR_STOP=1 -f "$root/scripts/function-execute-lock-prelude.sql"
psql -v ON_ERROR_STOP=1 -f "$migration"
psql -v ON_ERROR_STOP=1 -f "$migration"
psql -v ON_ERROR_STOP=1 -f "$root/scripts/function-execute-lock-sql-tests.sql"

echo "function execute lock sql tests ok"
