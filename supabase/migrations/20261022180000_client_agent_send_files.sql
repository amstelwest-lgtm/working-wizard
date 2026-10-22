-- Extra files on a client send, plus a chat-turn counter.
-- Password ciphertext is AES-GCM. The plaintext is not stored.
-- Chat rows store no message and no token. The table stays unused
-- while the document chat is off.
-- Next sets client_agent_sends.completed_at. Nothing is emailed.
-- CoS applies this file. It is not wired into the CI apply script.

CREATE TABLE IF NOT EXISTS public.client_agent_send_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  send_id uuid NOT NULL REFERENCES public.client_agent_sends(id) ON DELETE CASCADE,
  item_key text NOT NULL CHECK (item_key IN (
    'irp5',
    'medical_aid_certificate',
    'ra_contribution_certificate',
    'it3b',
    'practice_income_expenses',
    'bank_statements',
    'travel_logbook',
    'other'
  )),
  storage_path text NOT NULL CHECK (
    length(storage_path) BETWEEN 1 AND 240
    AND storage_path ~ '^[A-Za-z0-9._/-]+$'
    AND storage_path !~ '\.\.'
  ),
  mime text NOT NULL CHECK (mime IN (
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/heic'
  )),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 20971520),
  password_iv text,
  password_box text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_agent_send_files_password_pair CHECK (
    (password_iv IS NULL AND password_box IS NULL)
    OR (
      password_iv IS NOT NULL
      AND password_box IS NOT NULL
      AND length(password_iv) BETWEEN 8 AND 64
      AND length(password_box) BETWEEN 8 AND 400
    )
  )
);

CREATE INDEX IF NOT EXISTS client_agent_send_files_item_idx
  ON public.client_agent_send_files (send_id, item_key, created_at DESC);

COMMENT ON TABLE public.client_agent_send_files IS
  'One uploaded file. password_box is AES-GCM ciphertext. Service role only.';

CREATE TABLE IF NOT EXISTS public.client_agent_send_chat_turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  send_id uuid NOT NULL REFERENCES public.client_agent_sends(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_agent_send_chat_turns_send_idx
  ON public.client_agent_send_chat_turns (send_id, created_at DESC);

COMMENT ON TABLE public.client_agent_send_chat_turns IS
  'Rate-limit marks for document questions. No message and no token.';

ALTER TABLE public.client_agent_send_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_agent_send_chat_turns ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.client_agent_send_files FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.client_agent_send_chat_turns FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.client_agent_send_files TO service_role;
GRANT ALL ON TABLE public.client_agent_send_chat_turns TO service_role;

-- No policies. Service role bypasses RLS. No login-free function.

ALTER TABLE public.client_agent_sends
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

COMMENT ON COLUMN public.client_agent_sends.completed_at IS
  'Set when the client presses Next. Null until then. Not cleared. No mail.';

-- Same trigger as 20261021210000. Not security definer.
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

REVOKE ALL ON FUNCTION public.client_agent_send_guard_firm() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_agent_send_guard_firm() TO service_role;
