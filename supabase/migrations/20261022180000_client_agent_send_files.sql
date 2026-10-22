-- Extra files on a client send, plus a chat-turn counter.
-- Password ciphertext is AES-GCM. The plaintext is not stored.
-- Chat rows store no message and no token.
-- CoS applies this file. It is not wired into the CI apply script.
-- Next on the public page is client-side only. This file does not
-- add a completion column and does not send mail.

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
