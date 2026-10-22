-- password_box holds AES-GCM ciphertext, base64. The IV is a separate column.
-- Zod allows 80 JavaScript characters. Treating each as 4 UTF-8 bytes is 320,
-- plus the 16-byte AES-GCM tag is 336. Base64 length is 4 * ceil(336 / 3) = 448.
-- CoS applies this file. It is not wired into the CI apply script.
-- Invalid link attempts use outcome 'rejected' so a live send can count
-- failures toward 30 without counting a successful open.

ALTER TABLE public.client_agent_send_files
  DROP CONSTRAINT IF EXISTS client_agent_send_files_password_pair;

ALTER TABLE public.client_agent_send_files
  ADD CONSTRAINT client_agent_send_files_password_pair CHECK (
    (password_iv IS NULL AND password_box IS NULL)
    OR (
      password_iv IS NOT NULL
      AND password_box IS NOT NULL
      AND length(password_iv) BETWEEN 8 AND 64
      AND length(password_box) BETWEEN 8 AND 448
    )
  );

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public'
    AND rel.relname = 'client_agent_send_attempts'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%outcome%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.client_agent_send_attempts DROP CONSTRAINT %I',
      constraint_name
    );
  END IF;
END $$;

ALTER TABLE public.client_agent_send_attempts
  ADD CONSTRAINT client_agent_send_attempts_outcome_check
  CHECK (outcome IN ('ok', 'unknown', 'expired', 'revoked', 'limited', 'rejected'));
