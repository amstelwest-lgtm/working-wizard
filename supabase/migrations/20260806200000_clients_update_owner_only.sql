-- Migration: tighten clients UPDATE RLS to owner only
-- ──────────────────────────────────────────────────────────────────────────────
-- Previously "clients update by access" allowed any user with has_client_access()
-- (which includes invited client_member users) to UPDATE any column on the clients
-- row they belong to.  This means an invited member could change business_type,
-- name, financials, and other owner-controlled settings via the Supabase API even
-- if the UI hides those controls.
--
-- The correct boundary is: only the primary owner (owner_user_id = auth.uid())
-- may UPDATE the client record.  Reads remain scoped to has_client_access() so
-- invited members can still load the dashboard data.

DROP POLICY IF EXISTS "clients update by access" ON public.clients;

CREATE POLICY "clients update by owner"
  ON public.clients
  FOR UPDATE
  TO authenticated
  USING (owner_user_id = auth.uid());
