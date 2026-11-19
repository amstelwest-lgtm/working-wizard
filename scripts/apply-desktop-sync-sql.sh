#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
mig="$root/supabase/migrations/20261119120000_desktop_sync.sql"
python3 - "$mig" <<'PY'
import re, sys
path = sys.argv[1]
raw = open(path, encoding="utf-8").read()
code = "\n".join(line.split("--", 1)[0] for line in raw.splitlines())
folded = re.sub(r"\s+", " ", code).lower()
if "security definer" in folded:
    sys.exit("migration must not use security definer")
if "desktop_sync_daily_usage" in folded:
    sys.exit("migration must not create desktop_sync_daily_usage")
if "grant select on table public.desktop_sync_devices" in folded:
    sys.exit("migration must not grant select on desktop_sync_devices")
if "desktop_sync_devices_select" in folded:
    sys.exit("migration must not expose devices to authenticated")
print("desktop_sync migration: static checks ok")
PY
have_clients="$(psql -tAc "SELECT to_regclass('public.clients') IS NOT NULL" || true)"
if [ "$have_clients" != "t" ]; then
  psql -v ON_ERROR_STOP=1 -f "$root/scripts/source-documents-migration-prelude.sql"
fi
psql -v ON_ERROR_STOP=1 -f "$mig"
psql -v ON_ERROR_STOP=1 -f "$root/scripts/desktop-sync-sql-tests.sql"
echo "desktop_sync migration: sql tests ok"