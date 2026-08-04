-- Ask AI support tables and helper function
-- Does NOT drop or alter any existing table.

-- ── Cache for definitional answers (shared across all tenants) ───────────────
CREATE TABLE IF NOT EXISTS public.ask_ai_cache (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_hash   text NOT NULL UNIQUE,
  answer          text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  hit_count       integer NOT NULL DEFAULT 0
);

-- ── Audit log (no question or answer text) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ask_ai_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL,
  client_id       uuid NOT NULL,
  tier            text NOT NULL,
  input_tokens    integer NOT NULL DEFAULT 0,
  output_tokens   integer NOT NULL DEFAULT 0,
  latency_ms      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ask_ai_log_user_idx   ON public.ask_ai_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ask_ai_log_client_idx ON public.ask_ai_log (client_id, created_at DESC);

-- ── Atomic record + rate-limit enforcement ────────────────────────────────────
-- Acquires a per-user advisory lock so concurrent requests cannot both observe
-- the same count and both insert (Read Committed race). The lock is released
-- automatically when the function's transaction commits or rolls back.
-- Returns TRUE when the request was recorded (within limit), FALSE when exceeded.
--
-- Security: SECURITY DEFINER with explicit privilege revokes.
-- Only the Supabase service-role (used by the edge function) may call this.
-- PUBLIC / anon / authenticated cannot invoke it directly.
CREATE OR REPLACE FUNCTION public.ask_ai_record_request(
  p_user_id       uuid,
  p_client_id     uuid,
  p_tier          text,
  p_input_tokens  integer DEFAULT 0,
  p_output_tokens integer DEFAULT 0,
  p_latency_ms    integer DEFAULT 0,
  p_limit         integer DEFAULT 30
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  -- Serialize concurrent calls for this user with a transaction-scoped advisory lock.
  -- hashtext() maps the UUID to a 32-bit integer suitable for pg_advisory_xact_lock.
  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text));

  SELECT COUNT(*) INTO v_count
  FROM   public.ask_ai_log
  WHERE  user_id    = p_user_id
    AND  created_at > now() - interval '1 hour';

  IF v_count >= p_limit THEN
    RETURN false;
  END IF;

  INSERT INTO public.ask_ai_log
    (user_id, client_id, tier, input_tokens, output_tokens, latency_ms)
  VALUES
    (p_user_id, p_client_id, p_tier, p_input_tokens, p_output_tokens, p_latency_ms);

  RETURN true;
END;
$$;

-- Revoke execute from everyone, then grant only to service_role.
-- The edge function uses a service-role Supabase client; no other caller is intended.
REVOKE EXECUTE ON FUNCTION public.ask_ai_record_request(uuid, uuid, text, integer, integer, integer, integer)
  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ask_ai_record_request(uuid, uuid, text, integer, integer, integer, integer)
  FROM anon;
REVOKE EXECUTE ON FUNCTION public.ask_ai_record_request(uuid, uuid, text, integer, integer, integer, integer)
  FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.ask_ai_record_request(uuid, uuid, text, integer, integer, integer, integer)
  TO service_role;

-- ── Read-only rate-limit helper (for monitoring / dashboards if needed) ───────
-- Grants to authenticated so it can be used for UI display, but it only reads
-- the caller's own rows (no SECURITY DEFINER — RLS applies).
CREATE OR REPLACE FUNCTION public.ask_ai_check_rate_limit(
  p_user_id uuid,
  p_limit   integer DEFAULT 30
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COUNT(*) < p_limit
  FROM   public.ask_ai_log
  WHERE  user_id    = p_user_id
    AND  created_at > now() - interval '1 hour';
$$;

GRANT EXECUTE ON FUNCTION public.ask_ai_check_rate_limit(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ask_ai_check_rate_limit(uuid, integer) TO service_role;

-- The edge function calls has_client_access via the service-role client (authenticated/anon
-- EXECUTE was revoked by the RLS-hardening migration). Ensure service_role can call it.
GRANT EXECUTE ON FUNCTION public.has_client_access(uuid, uuid) TO service_role;

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE public.ask_ai_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ask_ai_log   ENABLE ROW LEVEL SECURITY;

-- Cache: no authenticated-user policies — all reads and writes go through the
-- service-role client inside the edge function only.
-- This prevents any authenticated user from reading cached hashes or answers.

-- Log: users can read their own rows for transparency. Writes are service-role only.
CREATE POLICY "log_select_own" ON public.ask_ai_log
  FOR SELECT TO authenticated USING (user_id = auth.uid());
