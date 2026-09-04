-- Anyone with client access can delete a note (owner, team, firm staff).
-- Author-only delete left existing notes stuck when the current user was not
-- the author (or author_id did not match).

DROP POLICY IF EXISTS "notes delete by author" ON public.client_notes;
CREATE POLICY "notes delete by access"
  ON public.client_notes FOR DELETE TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));
