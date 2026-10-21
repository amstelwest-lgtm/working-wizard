-- Practice name shown on the client link. Nullable.
-- The page uses this text when it is set. An empty value falls back to
-- firms.name. This file does not rename firms.name.
-- Apply on your schedule. This file does not run against a hosted database
-- by itself.

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

-- Existing sends for My practice. The firm row name is left as it is.
UPDATE public.client_agent_sends
SET practice_display_name = 'Theo''s practice'
WHERE firm_id = 'fca0f102-a597-4ec6-8f45-825c57f78797'
  AND practice_display_name IS NULL;
