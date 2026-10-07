-- Sage Business Cloud Accounting (South Africa / Sage One).
-- Basic auth + API key. No authorization-code state table and no token columns.
-- password_enc is AES-GCM ciphertext written by the server. RLS deny-all,
-- service role only, matching qbo_connections and xero_connections.

-- ── One Sage company login per Milōn client ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sage_connections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  username        TEXT NOT NULL,
  password_enc    TEXT NOT NULL,
  company_id      TEXT NOT NULL,
  company_name    TEXT,
  connected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_synced_at  TIMESTAMPTZ,
  sync_status     TEXT NOT NULL DEFAULT 'idle'
                    CHECK (sync_status IN ('idle', 'syncing', 'error')),
  sync_error      TEXT,
  UNIQUE (client_id)
);

CREATE INDEX IF NOT EXISTS sage_connections_company_idx
  ON public.sage_connections (company_id);

-- ── Cached sync payloads (Eng1). Connect does not write report figures. ────
CREATE TABLE IF NOT EXISTS public.sage_sync_data (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  data_type  TEXT NOT NULL,
  raw_data   JSONB,
  synced_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, data_type)
);

ALTER TABLE public.sage_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sage_sync_data    ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.sage_connections IS
  'One Sage SA company login per client. password_enc is server-only (RLS deny-all). No bearer tokens.';
COMMENT ON TABLE public.sage_sync_data IS
  'Cached Sage report payloads for Eng1. Service-role only. Connect does not write figures here.';
COMMENT ON COLUMN public.sage_connections.password_enc IS
  'enc:v1 AES-256-GCM. Key is SAGE_SA_PASSWORD_KEY, or SAGE_SA_API_KEY when that is unset. Never returned to the browser.';
