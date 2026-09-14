-- Owner ratio questions: unresolved notes tagged to a ratio.
-- Spatial pins stay on tab/x/y; ratio_key is optional.

ALTER TABLE public.client_notes
  ADD COLUMN IF NOT EXISTS ratio_key TEXT;

CREATE INDEX IF NOT EXISTS client_notes_client_ratio_open_idx
  ON public.client_notes (client_id, ratio_key)
  WHERE ratio_key IS NOT NULL AND resolved = false;
