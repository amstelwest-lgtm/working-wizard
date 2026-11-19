#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
mig="$root/supabase/migrations/20261119120000_desktop_sync.sql"
psql -v ON_ERROR_STOP=1 -f "$mig"
psql -v ON_ERROR_STOP=1 -f "$root/scripts/desktop-sync-sql-tests.sql"
echo "desktop_sync migration: sql tests ok"