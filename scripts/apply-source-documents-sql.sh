#!/usr/bin/env bash
# Apply the source-document migration on a fresh database and run its SQL test.
# Catches a function body that names a table created later in the same file.
# Uses PGHOST, PGPORT, PGUSER, PGPASSWORD, and PGDATABASE when set.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"

psql -v ON_ERROR_STOP=1 -f "$root/scripts/source-documents-migration-prelude.sql"
psql -v ON_ERROR_STOP=1 -f "$root/supabase/migrations/20261013170000_source_documents_to_ledger.sql"
psql -v ON_ERROR_STOP=1 -f "$root/scripts/source-documents-ledger-sql-tests.sql"
