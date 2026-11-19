-- Implementation Manager cloud OAuth (Google Drive / OneDrive).
-- Tables only — not applied to production until ops runs this migration.
-- Token storage (CoS option b): access_token_enc / refresh_token_enc hold
-- AES-GCM ciphertext from the app (IM_CLOUD_TOKEN_KEY). RLS enabled with no
-- policies (service role only).
-- im_source_inbound_aliases intentionally omitted — webhook keeps admin scan.

-- ── Short-lived OAuth state (CSRF + return path, ~10-minute TTL) ───────────
CREATE TABLE IF NOT EXISTS public.im_cloud_oauth_states (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state       TEXT NOT NULL UNIQUE,
  client_id   UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  provider    TEXT NOT NULL CHECK (provider IN ('google', 'microsoft')),
  return_path TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS im_cloud_oauth_states_created_idx
  ON public.im_cloud_oauth_states (created_at);

CREATE INDEX IF NOT EXISTS im_cloud_oauth_states_client_idx
  ON public.im_cloud_oauth_states (client_id);

-- ── One connection per client per cloud provider ────────────────────────────
CREATE TABLE IF NOT EXISTS public.im_cloud_connections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL CHECK (provider IN ('google', 'microsoft')),
  folder_ids      TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  drive_id        TEXT,
  access_token_enc  TEXT,
  refresh_token_enc TEXT,
  token_expiry    TIMESTAMPTZ NOT NULL,
  connected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_polled_at  TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, provider),
  CONSTRAINT im_cloud_connections_tokens_revoked_ck CHECK (
    revoked_at IS NOT NULL
    OR (access_token_enc IS NOT NULL AND refresh_token_enc IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS im_cloud_connections_client_idx
  ON public.im_cloud_connections (client_id);

CREATE INDEX IF NOT EXISTS im_cloud_connections_poll_idx
  ON public.im_cloud_connections (last_polled_at)
  WHERE revoked_at IS NULL;

-- ── Row Level Security (deny anon/authenticated; service role only) ─────────
ALTER TABLE public.im_cloud_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.im_cloud_connections ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.im_cloud_oauth_states IS
  'CSRF state for IM cloud OAuth. Service-role only. Expire after ~10 minutes.';
COMMENT ON TABLE public.im_cloud_connections IS
  'Per-client Google Drive or OneDrive connection. Token columns are service-role only (RLS deny-all).';
COMMENT ON COLUMN public.im_cloud_connections.access_token_enc IS
  'AES-GCM ciphertext encrypted by the app with env IM_CLOUD_TOKEN_KEY; never plaintext.';
COMMENT ON COLUMN public.im_cloud_connections.refresh_token_enc IS
  'AES-GCM ciphertext encrypted by the app with env IM_CLOUD_TOKEN_KEY; never plaintext.';
COMMENT ON COLUMN public.im_cloud_connections.folder_ids IS
  'Picked folder root ids; ingest rejects files outside these roots.';
COMMENT ON COLUMN public.im_cloud_connections.drive_id IS
  'Microsoft Graph drive id when provider is microsoft.';
COMMENT ON COLUMN public.im_cloud_connections.revoked_at IS
  'When set, poll and refresh must stop; disconnect sets this and NULLs access_token_enc and refresh_token_enc.';
