-- ============================================================================
-- ensure_own_client RPC
--
-- The "clients insert own" RLS policy (WITH CHECK owner_user_id = auth.uid())
-- fails to evaluate correctly via PostgREST for INSERT operations, even though
-- SELECT and UPDATE policies that call auth.uid() work fine.  This is a known
-- PostgREST/Supabase quirk with WITH CHECK expressions in some project
-- configurations.
--
-- The fix: a SECURITY DEFINER function that runs as postgres (bypassing RLS)
-- but still gates on auth.uid() being non-null, and only ever creates/returns
-- the calling user's own client.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ensure_own_client(p_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_client_id uuid;
  v_lock_key  bigint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Per-user advisory lock (transaction-scoped) prevents concurrent self-signup
  -- races. The lock is only held for the duration of this transaction.
  v_lock_key := ('x' || left(md5('ensure_own_client:' || v_uid::text), 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- Return existing self-signup client if any (firm_id IS NULL = owner-registered,
  -- not an accountant-managed firm client).
  SELECT id INTO v_client_id
  FROM public.clients
  WHERE owner_user_id = v_uid AND firm_id IS NULL
  LIMIT 1;

  IF v_client_id IS NOT NULL THEN
    RETURN v_client_id;
  END IF;

  -- Create the client — SECURITY DEFINER bypasses the broken INSERT RLS policy
  INSERT INTO public.clients (name, owner_user_id)
  VALUES (p_name, v_uid)
  RETURNING id INTO v_client_id;

  RETURN v_client_id;
END;
$$;

-- Explicitly revoke PUBLIC execute (PostgreSQL grants PUBLIC by default on new functions)
REVOKE EXECUTE ON FUNCTION public.ensure_own_client(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_own_client(text) TO authenticated;

-- Restore the INSERT policy to its original (simple) form
DROP POLICY IF EXISTS "clients insert own" ON public.clients;
CREATE POLICY "clients insert own"
  ON public.clients FOR INSERT TO authenticated
  WITH CHECK (owner_user_id = auth.uid());
