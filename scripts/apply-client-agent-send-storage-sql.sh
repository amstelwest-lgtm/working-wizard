#!/usr/bin/env bash
# Static checks, then the private client-agent-sends bucket on the local
# Postgres used by CI. Does not take a database URL. Uses PGHOST, PGPORT,
# PGUSER, PGPASSWORD, and PGDATABASE when set. Never targets a hosted project.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
mig="$root/supabase/migrations/20261022120000_client_agent_send_storage.sql"

python3 - "$mig" <<'PY'
import re, sys
path = sys.argv[1]
raw = open(path, encoding="utf-8").read()
code = "\n".join(line.split("--", 1)[0] for line in raw.splitlines())
folded = re.sub(r"\s+", " ", code).lower()

def fail(message):
    print(message, file=sys.stderr)
    sys.exit(1)

if "security definer" in folded:
    fail("bucket migration must not create a security definer function")
if re.search(r"\bcreate\s+policy\b", folded):
    fail("bucket migration must not create a storage policy")
if re.search(r"\bgrant\b", folded):
    fail("bucket migration must not grant")
if re.search(r"\brevoke\b", folded):
    fail("bucket migration must not revoke storage privileges")
if re.search(r"\bdrop\s+table\b", folded):
    fail("bucket migration must not drop a table")
if re.search(r"\balter\s+table\b", folded):
    fail("bucket migration must not alter a table")
if re.search(r"\balter\s+role\b", folded):
    fail("bucket migration must not alter a role")
if "public = false" not in folded:
    fail("bucket migration must keep the bucket private")
for needle in (
    "client-agent-sends",
    "20971520",
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/heic",
    "drop policy",
    "storage.objects",
):
    if needle not in folded:
        fail(f"bucket migration is missing {needle}")
print("client-agent-sends bucket: static checks ok")
PY

have_objects="$(psql -tAc "SELECT to_regclass('storage.objects') IS NOT NULL" || true)"
if [ "$have_objects" != "t" ]; then
  psql -v ON_ERROR_STOP=1 -f "$root/scripts/source-documents-migration-prelude.sql"
fi

psql -v ON_ERROR_STOP=1 -f "$root/scripts/client-agent-send-storage-sql-setup.sql"
psql -v ON_ERROR_STOP=1 -f "$mig"
psql -v ON_ERROR_STOP=1 -f "$mig"
psql -v ON_ERROR_STOP=1 -f "$root/scripts/client-agent-send-storage-sql-tests.sql"
echo "client-agent-sends bucket: sql tests ok"
