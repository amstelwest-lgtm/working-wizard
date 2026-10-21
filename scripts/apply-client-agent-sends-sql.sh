#!/usr/bin/env bash
# Static checks, then the send-an-agent migration on the local Postgres
# used by CI. Does not take a database URL. Uses PGHOST, PGPORT, PGUSER,
# PGPASSWORD, and PGDATABASE when set. Never targets a hosted project.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
mig="$root/supabase/migrations/20261021210000_client_agent_sends.sql"

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
    fail("migration must not create a security definer function")
if re.search(r"grant\b[^;]*\bto\s+(anon|public)\b", folded):
    fail("migration must not grant to anon or public")
if re.search(r"\bdrop\s+table\b", folded):
    fail("migration must not drop a table")
if "is_firm_member" in folded and "create or replace function public.is_firm_member" in folded:
    fail("migration must not replace is_firm_member")

for match in re.finditer(r"alter\s+table\s+(only\s+)?([a-z0-9_.]+)", folded):
    name = match.group(2).split(".")[-1]
    if name not in {
        "client_agent_sends",
        "client_agent_send_items",
        "client_agent_send_attempts",
    }:
        fail(f"migration alters an existing table: {name}")

for needle in (
    "create table if not exists public.client_agent_sends",
    "create table if not exists public.client_agent_send_items",
    "create table if not exists public.client_agent_send_attempts",
    "token_hash",
    "revoked_at",
    "interval '14 days'",
    "consent_at",
    "consent_notice_version",
    "totals_only",
    "medical_aid_certificate",
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/heic",
    "20971520",
    "consent_required",
    "revoke all on table public.client_agent_sends from public, anon, authenticated",
    "grant select on table public.client_agent_sends to authenticated",
    "grant all on table public.client_agent_sends to service_role",
):
    if needle not in folded and needle not in code.lower():
        fail(f"migration is missing {needle}")

if re.search(r"\btoken\b", folded) and re.search(r"\btoken\s+text\b", folded):
    fail("migration must not store a raw token column")
print("client_agent_sends migration: static checks ok")
PY

have_clients="$(psql -tAc "SELECT to_regclass('public.clients') IS NOT NULL" || true)"
if [ "$have_clients" != "t" ]; then
  psql -v ON_ERROR_STOP=1 -f "$root/scripts/source-documents-migration-prelude.sql"
fi

psql -v ON_ERROR_STOP=1 -f "$mig"
psql -v ON_ERROR_STOP=1 -f "$root/scripts/client-agent-sends-sql-tests.sql"
echo "client_agent_sends migration: sql tests ok"
