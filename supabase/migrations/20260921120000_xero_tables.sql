-- Xero Integration Tables
-- Additive only. Parallel to qbo_* — do not reuse QuickBooks tables.
-- Tokens are stored as TEXT the same way QBO does: RLS enabled with no
-- policies so anon/authenticated cannot read them. Server functions use the
-- service role and must run their own client-scope checks. Supabase encrypts
-- the disk at rest; there is no separate vault column for QBO or Xero.

-- ── Short-lived OAuth state tokens (CSRF + return path, 10-minute TTL) ──────
CREATE TABLE IF NOT EXISTS public.xero_oauth_states (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state       TEXT NOT NULL UNIQUE,
  client_id   UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  return_path TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS xero_oauth_states_created_idx
  ON public.xero_oauth_states (created_at);

-- ── One Xero organisation (tenant) connection per Milōn client ──────────────
CREATE TABLE IF NOT EXISTS public.xero_connections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  tenant_id       TEXT NOT NULL,
  connection_id   TEXT,
  tenant_name     TEXT,
  access_token    TEXT NOT NULL,
  refresh_token   TEXT NOT NULL,
  token_expiry    TIMESTAMPTZ NOT NULL,
  connected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_synced_at  TIMESTAMPTZ,
  sync_status     TEXT NOT NULL DEFAULT 'idle'
                    CHECK (sync_status IN ('idle', 'syncing', 'error')),
  sync_error      TEXT,
  data_depth      TEXT NOT NULL DEFAULT 'statement'
                    CHECK (data_depth IN ('statement', 'transaction')),
  UNIQUE (client_id)
);

CREATE INDEX IF NOT EXISTS xero_connections_tenant_idx
  ON public.xero_connections (tenant_id);

-- ── Cached sync data (one row per client per data type) ─────────────────────
CREATE TABLE IF NOT EXISTS public.xero_sync_data (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  data_type  TEXT NOT NULL,   -- 'pl' | 'bs' | 'bank' | 'invoices'
  raw_data   JSONB,
  synced_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, data_type)
);

-- ── Row Level Security ──────────────────────────────────────────────────────
-- Same pattern as qbo_*: enable RLS with no policies. Service-role handlers
-- bypass RLS and must call assertClientScope + a user-scoped clients SELECT.

ALTER TABLE public.xero_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.xero_connections  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.xero_sync_data    ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.xero_oauth_states IS
  'CSRF state for Xero OAuth. Service-role only. Expire after 10 minutes.';
COMMENT ON TABLE public.xero_connections IS
  'One Xero tenant per client. Tokens are service-role only (RLS deny-all), matching qbo_connections.';
COMMENT ON TABLE public.xero_sync_data IS
  'Cached Xero report payloads. Service-role only.';
COMMENT ON COLUMN public.xero_connections.data_depth IS
  'Phase 1 is statement-level (P&L / BS / bank). Transaction/invoice pull is Phase 2.';
