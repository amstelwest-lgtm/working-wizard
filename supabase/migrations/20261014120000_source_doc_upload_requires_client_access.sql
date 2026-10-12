-- Firm staff may upload only when they also have client access (the practice
-- principal or an active assignment). The business owner still uploads.
-- register_source_document, the insert policies, and extract-source-document
-- all call this function, so they share the rule.

CREATE OR REPLACE FUNCTION public.source_doc_can_upload(p_user_id uuid, p_client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH actor AS (
    SELECT CASE
      WHEN coalesce(auth.role(), '') = 'service_role' THEN p_user_id
      WHEN coalesce(auth.role(), '') = 'authenticated' THEN auth.uid()
      ELSE p_user_id
    END AS user_id
  )
  SELECT EXISTS (
    SELECT 1
    FROM public.clients c
    CROSS JOIN actor
    WHERE c.id = p_client_id
      AND (
        c.owner_user_id = actor.user_id
        OR (
          c.firm_id IS NOT NULL
          AND public.is_firm_member(actor.user_id, c.firm_id)
          AND public.has_client_access(actor.user_id, c.id)
        )
      )
  );
$$;
