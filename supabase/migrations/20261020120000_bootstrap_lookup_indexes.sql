-- Cold practice and owner bootstrap filter firms, memberships, and clients
-- by the signed-in user. user_roles already has UNIQUE (user_id, role).
-- firm_memberships is UNIQUE (firm_id, user_id), which does not serve
-- WHERE user_id = ?. These lookups are not the 10–20s variance (one client
-- is a handful of rows) but they are on every cold load.
--
-- CREATE INDEX IF NOT EXISTS so a re-run is a no-op. CONCURRENTLY is omitted:
-- Supabase applies this file inside a transaction, and CONCURRENTLY cannot
-- run there. Apply by hand when ready. Do not run it against production
-- from the app.

CREATE INDEX IF NOT EXISTS firms_owner_user_id_idx
  ON public.firms (owner_user_id);

CREATE INDEX IF NOT EXISTS firm_memberships_user_id_idx
  ON public.firm_memberships (user_id);

CREATE INDEX IF NOT EXISTS clients_owner_user_id_idx
  ON public.clients (owner_user_id);

CREATE INDEX IF NOT EXISTS clients_firm_id_idx
  ON public.clients (firm_id);
