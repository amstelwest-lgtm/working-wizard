-- Send an agent. New tables only. Does not alter an existing table, policy,
-- or function. Apply on your schedule. This file does not run against a
-- hosted database by itself.
--
-- Reads: a firm member of the firm that owns the client.
-- Writes: service role only. There is no insert, update, or delete policy.
-- anon has no grant and no policy.
--
-- The token column is a SHA-256 hex hash. The raw token is not stored.
-- expires_at defaults to 14 days after the row is inserted.
-- A file on an item is refused until client_agent_sends.consent_at is set.
-- The guard functions are not SECURITY DEFINER and are not granted to anon
-- or authenticated, so they are not callable without a login.

CREATE TABLE IF NOT EXISTS public.client_agent_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  agent text NOT NULL CHECK (agent = 'tax-specialist'),
  checklist_key text NOT NULL DEFAULT 'za-physio-tax-pack'
    CHECK (checklist_key = 'za-physio-tax-pack'),
  token_hash text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  sent_by uuid NOT NULL REFERENCES auth.users(id),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  revoked_at timestamptz,
  consent_at timestamptz,
  consent_notice_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_agent_sends_token_hash_key UNIQUE (token_hash),
  CONSTRAINT client_agent_sends_consent_pair CHECK (
    (consent_at IS NULL AND consent_notice_version IS NULL)
    OR (consent_at IS NOT NULL AND consent_notice_version IS NOT NULL
        AND length(btrim(consent_notice_version)) > 0)
  ),
  CONSTRAINT client_agent_sends_consent_version_len CHECK (
    consent_notice_version IS NULL OR length(consent_notice_version) <= 80
  )
);

CREATE INDEX IF NOT EXISTS client_agent_sends_client_idx
  ON public.client_agent_sends (client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS client_agent_sends_firm_idx
  ON public.client_agent_sends (firm_id, client_id);

CREATE INDEX IF NOT EXISTS client_agent_sends_open_idx
  ON public.client_agent_sends (client_id, agent)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE public.client_agent_sends IS
  'Firm-sent agent link. token_hash is SHA-256 hex. The raw token is never stored. expires_at defaults to 14 days.';

COMMENT ON COLUMN public.client_agent_sends.consent_at IS
  'When the client agreed to the POPIA notice. Empty until they do. An item cannot record a file before this is set.';

CREATE TABLE IF NOT EXISTS public.client_agent_send_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  send_id uuid NOT NULL REFERENCES public.client_agent_sends(id) ON DELETE CASCADE,
  item_key text NOT NULL CHECK (item_key IN (
    'irp5',
    'medical_aid_certificate',
    'ra_contribution_certificate',
    'it3b',
    'practice_income_expenses'
  )),
  totals_only boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'received')),
  quality text CHECK (quality IS NULL OR quality IN ('usable', 'incomplete', 'poor')),
  explanation text,
  mime text CHECK (mime IS NULL OR mime IN (
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/heic'
  )),
  size_bytes bigint CHECK (
    size_bytes IS NULL OR (size_bytes > 0 AND size_bytes <= 20971520)
  ),
  storage_path text CHECK (
    storage_path IS NULL
    OR (
      length(storage_path) BETWEEN 1 AND 240
      AND storage_path ~ '^[A-Za-z0-9._/-]+$'
      AND storage_path !~ '\.\.'
    )
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_agent_send_items_send_key UNIQUE (send_id, item_key),
  CONSTRAINT client_agent_send_items_medical_totals CHECK (
    (item_key = 'medical_aid_certificate' AND totals_only)
    OR (item_key <> 'medical_aid_certificate' AND totals_only = false)
  ),
  CONSTRAINT client_agent_send_items_quality_status CHECK (
    quality IS NULL OR status = 'received'
  ),
  CONSTRAINT client_agent_send_items_explanation CHECK (
    quality IS NULL
    OR quality = 'usable'
    OR (explanation IS NOT NULL AND length(btrim(explanation)) > 0)
  ),
  CONSTRAINT client_agent_send_items_explanation_len CHECK (
    explanation IS NULL OR length(explanation) <= 2000
  ),
  CONSTRAINT client_agent_send_items_file_shape CHECK (
    (mime IS NULL AND size_bytes IS NULL)
    OR (mime IS NOT NULL AND size_bytes IS NOT NULL)
  ),
  CONSTRAINT client_agent_send_items_path_needs_file CHECK (
    storage_path IS NULL OR (mime IS NOT NULL AND size_bytes IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS client_agent_send_items_send_idx
  ON public.client_agent_send_items (send_id);

COMMENT ON COLUMN public.client_agent_send_items.totals_only IS
  'Medical aid tax certificate stores totals only. The check forces that item on and every other item off.';

COMMENT ON COLUMN public.client_agent_send_items.size_bytes IS
  'File size in bytes. Cap is 20 MiB. PDF, JPEG, PNG, and HEIC only.';

-- Presented tokens for the later public route. The route is not in this
-- migration. Unknown tokens are stored as a hash with send_id null.
-- Service role only. Firm members do not read IP hashes.
CREATE TABLE IF NOT EXISTS public.client_agent_send_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  send_id uuid REFERENCES public.client_agent_sends(id) ON DELETE CASCADE,
  token_hash text CHECK (token_hash IS NULL OR token_hash ~ '^[0-9a-f]{64}$'),
  ip_hash text NOT NULL CHECK (ip_hash ~ '^[0-9a-f]{64}$'),
  outcome text NOT NULL CHECK (outcome IN ('ok', 'unknown', 'expired', 'revoked', 'limited')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_agent_send_attempts_ip_idx
  ON public.client_agent_send_attempts (ip_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS client_agent_send_attempts_send_idx
  ON public.client_agent_send_attempts (send_id, created_at DESC)
  WHERE send_id IS NOT NULL;

COMMENT ON TABLE public.client_agent_send_attempts IS
  'Rate-limit log for the public link. Hashes only. No raw token and no IP address.';

-- Firm on the send must be the firm on the client. Not security definer.
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

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.client_agent_send_item_guard_consent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.mime IS NULL AND NEW.size_bytes IS NULL AND NEW.storage_path IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.client_agent_sends s
    WHERE s.id = NEW.send_id
      AND s.consent_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'consent_required' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS client_agent_send_guard_firm ON public.client_agent_sends;
CREATE TRIGGER client_agent_send_guard_firm
  BEFORE INSERT OR UPDATE ON public.client_agent_sends
  FOR EACH ROW
  EXECUTE FUNCTION public.client_agent_send_guard_firm();

DROP TRIGGER IF EXISTS client_agent_send_item_guard_consent ON public.client_agent_send_items;
CREATE TRIGGER client_agent_send_item_guard_consent
  BEFORE INSERT OR UPDATE ON public.client_agent_send_items
  FOR EACH ROW
  EXECUTE FUNCTION public.client_agent_send_item_guard_consent();

REVOKE ALL ON FUNCTION public.client_agent_send_guard_firm() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.client_agent_send_item_guard_consent() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_agent_send_guard_firm() TO service_role;
GRANT EXECUTE ON FUNCTION public.client_agent_send_item_guard_consent() TO service_role;

ALTER TABLE public.client_agent_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_agent_send_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_agent_send_attempts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.client_agent_sends FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.client_agent_send_items FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.client_agent_send_attempts FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.client_agent_sends TO service_role;
GRANT ALL ON TABLE public.client_agent_send_items TO service_role;
GRANT ALL ON TABLE public.client_agent_send_attempts TO service_role;

GRANT SELECT ON TABLE public.client_agent_sends TO authenticated;
GRANT SELECT ON TABLE public.client_agent_send_items TO authenticated;

DROP POLICY IF EXISTS client_agent_sends_firm_read ON public.client_agent_sends;
CREATE POLICY client_agent_sends_firm_read
  ON public.client_agent_sends
  FOR SELECT
  TO authenticated
  USING (
    public.is_firm_member((select auth.uid()), firm_id)
    AND EXISTS (
      SELECT 1
      FROM public.clients c
      WHERE c.id = client_id
        AND c.firm_id = firm_id
    )
  );

DROP POLICY IF EXISTS client_agent_send_items_firm_read ON public.client_agent_send_items;
CREATE POLICY client_agent_send_items_firm_read
  ON public.client_agent_send_items
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.client_agent_sends s
      WHERE s.id = send_id
        AND public.is_firm_member((select auth.uid()), s.firm_id)
        AND EXISTS (
          SELECT 1
          FROM public.clients c
          WHERE c.id = s.client_id
            AND c.firm_id = s.firm_id
        )
    )
  );

-- No policy on client_agent_send_attempts. Service role bypasses RLS.
-- No insert, update, or delete policy on any of these tables.
