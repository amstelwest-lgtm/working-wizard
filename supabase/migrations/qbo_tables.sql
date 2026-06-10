-- QuickBooks Online Integration Tables
-- Run this in your Supabase SQL Editor: https://app.supabase.com/project/_/sql

-- ── Short-lived OAuth state tokens (CSRF protection, 10-minute TTL) ──────────
CREATE TABLE IF NOT EXISTS qbo_oauth_states (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state      TEXT NOT NULL UNIQUE,
  client_id  UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── One QBO company connection per Milōn client ───────────────────────────────
CREATE TABLE IF NOT EXISTS qbo_connections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  realm_id        TEXT NOT NULL,
  company_name    TEXT,
  access_token    TEXT NOT NULL,
  refresh_token   TEXT NOT NULL,
  token_expiry    TIMESTAMPTZ NOT NULL,
  connected_at    TIMESTAMPTZ DEFAULT NOW(),
  last_synced_at  TIMESTAMPTZ,
  sync_status     TEXT DEFAULT 'idle',  -- 'idle' | 'syncing' | 'error'
  sync_error      TEXT,
  UNIQUE(client_id)
);

-- ── Cached sync data (one row per client per data type) ───────────────────────
CREATE TABLE IF NOT EXISTS qbo_sync_data (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  data_type  TEXT NOT NULL,   -- 'pl' | 'bs' | 'cf' | 'coa' | 'transactions'
  raw_data   JSONB,
  synced_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id, data_type)
);

-- ── Row Level Security ────────────────────────────────────────────────────────
-- All access goes through server functions using the service role key,
-- which bypasses RLS. Enabling RLS with no policies blocks anon/authenticated
-- key access entirely — tokens are never exposed through the public API.

ALTER TABLE qbo_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE qbo_connections  ENABLE ROW LEVEL SECURITY;
ALTER TABLE qbo_sync_data    ENABLE ROW LEVEL SECURITY;

-- ── Optional: auto-clean expired OAuth states ────────────────────────────────
-- (run as a pg_cron job or Supabase Edge Function if desired)
-- DELETE FROM qbo_oauth_states WHERE created_at < NOW() - INTERVAL '10 minutes';
