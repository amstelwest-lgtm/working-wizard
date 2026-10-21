#!/usr/bin/env bash
# Show that wrapping auth.uid() on the clients policies does not change which
# rows an owner, an accountant member, and an outsider can see. Scratch schema
# only. Refuses to run when public.clients already has rows, and never applies
# the migration to public.clients.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
mig="$root/supabase/migrations/20261021180000_clients_rls_initplan.sql"

if grep -Eiq 'grant[[:space:]]|security definer|create[[:space:]]+(or replace[[:space:]]+)?function' "$mig"; then
  echo "migration must not grant privileges or create a function" >&2
  exit 1
fi

# Comments may name the function. The statements themselves may not call it bare.
bare="$(sed -E 's/--.*$//' "$mig" | grep -n 'auth\.uid()' | grep -v '(select auth.uid())' || true)"
if [ -n "$bare" ]; then
  echo "clients policies must wrap auth.uid() as (select auth.uid()):" >&2
  echo "$bare" >&2
  exit 1
fi

grep -q 'CREATE INDEX IF NOT EXISTS clients_owner_user_id_idx' "$mig"
grep -q 'ON public.clients (owner_user_id);' "$mig"

psql -v ON_ERROR_STOP=1 -f "$root/scripts/clients-rls-initplan-check.sql"
