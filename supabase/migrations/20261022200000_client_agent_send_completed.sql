-- Finish timestamps for a client document link.
-- Chief of Staff applies this. CI does not.
-- completed_at cannot be stored without consent, and a later update cannot
-- clear it. reviewed_at is the firm's mark. The guard is not security
-- definer and is not granted to anon or authenticated.
-- The documents bucket also accepts the image types a client may upload,
-- or those files cannot be copied into the archive.

ALTER TABLE public.client_agent_sends
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

ALTER TABLE public.client_agent_sends
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

COMMENT ON COLUMN public.client_agent_sends.completed_at IS
  'When the client finished the list. Null until then. Never cleared.';

COMMENT ON COLUMN public.client_agent_sends.reviewed_at IS
  'When a firm member marked the received documents reviewed.';

CREATE INDEX IF NOT EXISTS client_agent_sends_unreviewed_idx
  ON public.client_agent_sends (client_id)
  WHERE completed_at IS NOT NULL AND reviewed_at IS NULL;

CREATE OR REPLACE FUNCTION public.client_agent_send_guard_firm()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.clients c
    WHERE c.id = NEW.client_id
      AND c.firm_id = NEW.firm_id
  ) THEN
    RAISE EXCEPTION 'firm_client_mismatch' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.consent_at IS NOT NULL
     AND NEW.consent_at IS NULL
     AND EXISTS (
       SELECT 1
       FROM public.client_agent_send_items i
       WHERE i.send_id = NEW.id
         AND (
           i.mime IS NOT NULL
           OR i.size_bytes IS NOT NULL
           OR i.storage_path IS NOT NULL
         )
     ) THEN
    RAISE EXCEPTION 'consent_required' USING ERRCODE = '23514';
  END IF;

  IF NEW.completed_at IS NOT NULL AND NEW.consent_at IS NULL THEN
    RAISE EXCEPTION 'consent_required' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.completed_at IS NOT NULL
     AND NEW.completed_at IS NULL THEN
    RAISE EXCEPTION 'completed_at_required' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS client_agent_send_guard_firm ON public.client_agent_sends;
CREATE TRIGGER client_agent_send_guard_firm
  BEFORE INSERT OR UPDATE ON public.client_agent_sends
  FOR EACH ROW
  EXECUTE FUNCTION public.client_agent_send_guard_firm();

REVOKE ALL ON FUNCTION public.client_agent_send_guard_firm() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_agent_send_guard_firm() TO service_role;

UPDATE storage.buckets
SET allowed_mime_types = (
  SELECT COALESCE(array_agg(DISTINCT mime), ARRAY[]::text[])
  FROM unnest(
    COALESCE(allowed_mime_types, ARRAY[]::text[])
    || ARRAY['image/jpeg', 'image/png', 'image/heic']::text[]
  ) AS mime
)
WHERE id = 'client-documents';
