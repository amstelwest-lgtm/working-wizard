-- A missing document can be saved with no note.
-- The client-visible file name is stored on the file row.
-- CoS applies this file. It is not wired into the CI apply scripts.
-- Applied migrations are not edited.

ALTER TABLE public.client_agent_send_items
  DROP CONSTRAINT IF EXISTS client_agent_send_items_explanation;

ALTER TABLE public.client_agent_send_items
  ADD CONSTRAINT client_agent_send_items_explanation CHECK (
    quality IS NULL
    OR quality = 'usable'
    OR (
      explanation IS NOT NULL
      AND length(btrim(explanation)) > 0
    )
    OR (
      quality IN ('incomplete', 'poor')
      AND storage_path IS NULL
      AND mime IS NULL
      AND size_bytes IS NULL
    )
  );

COMMENT ON CONSTRAINT client_agent_send_items_explanation ON public.client_agent_send_items IS
  'A file that is incomplete or poor still needs a note. A missing document does not.';

ALTER TABLE public.client_agent_send_files
  ADD COLUMN IF NOT EXISTS display_name text;

ALTER TABLE public.client_agent_send_files
  DROP CONSTRAINT IF EXISTS client_agent_send_files_display_name_len;

ALTER TABLE public.client_agent_send_files
  ADD CONSTRAINT client_agent_send_files_display_name_len CHECK (
    display_name IS NULL
    OR (
      length(btrim(display_name)) > 0
      AND length(display_name) <= 120
      AND display_name !~ '[[:cntrl:]]'
      AND strpos(display_name, '/') = 0
      AND strpos(display_name, chr(92)) = 0
    )
  );

COMMENT ON COLUMN public.client_agent_send_files.display_name IS
  'File name the client sees. No path and no control characters. Null until confirm stores it.';
