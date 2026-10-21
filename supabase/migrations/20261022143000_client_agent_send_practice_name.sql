-- Practice name and optional client first name on a send. Both nullable.
-- The page uses practice_display_name when it is set. An empty value falls
-- back to firms.name. This file does not rename firms.name.
-- recipient_first_name is a given name for the invite greeting. It is not
-- the business name. Apply on your schedule. This file does not run against
-- a hosted database by itself.

ALTER TABLE public.client_agent_sends
  ADD COLUMN IF NOT EXISTS practice_display_name text;

ALTER TABLE public.client_agent_sends
  DROP CONSTRAINT IF EXISTS client_agent_sends_practice_display_name_len;

ALTER TABLE public.client_agent_sends
  ADD CONSTRAINT client_agent_sends_practice_display_name_len
  CHECK (
    practice_display_name IS NULL
    OR (
      length(btrim(practice_display_name)) > 0
      AND length(practice_display_name) <= 120
    )
  );

COMMENT ON COLUMN public.client_agent_sends.practice_display_name IS
  'Name shown on the client link. Empty falls back to the firm name. Does not replace firms.name.';

ALTER TABLE public.client_agent_sends
  ADD COLUMN IF NOT EXISTS recipient_first_name text;

ALTER TABLE public.client_agent_sends
  DROP CONSTRAINT IF EXISTS client_agent_sends_recipient_first_name_len;

ALTER TABLE public.client_agent_sends
  ADD CONSTRAINT client_agent_sends_recipient_first_name_len
  CHECK (
    recipient_first_name IS NULL
    OR (
      length(btrim(recipient_first_name)) >= 1
      AND length(btrim(recipient_first_name)) <= 60
    )
  );

COMMENT ON COLUMN public.client_agent_sends.recipient_first_name IS
  'Optional given name for the invite greeting. Not the business name.';

-- Existing sends for My practice. The firm row name is left as it is.
UPDATE public.client_agent_sends
SET practice_display_name = 'Theo''s practice'
WHERE firm_id = 'fca0f102-a597-4ec6-8f45-825c57f78797'
  AND practice_display_name IS NULL;
