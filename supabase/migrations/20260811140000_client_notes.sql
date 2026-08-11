-- ── Client contextual notes ─────────────────────────────────────────────────
-- Pinned notes shared by everyone with access to a client (owner, members,
-- firm staff). Mentions are stored as JSON; email is sent only to tagged
-- recipients by the app layer (not broadcast).

CREATE TABLE IF NOT EXISTS public.client_notes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  tab            TEXT NOT NULL DEFAULT 'overview',
  x              DOUBLE PRECISION NOT NULL DEFAULT 0,
  y              DOUBLE PRECISION NOT NULL DEFAULT 0,
  body           TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  author_id      UUID NOT NULL REFERENCES auth.users(id),
  author_name    TEXT NOT NULL,
  author_email   TEXT,
  resolved       BOOLEAN NOT NULL DEFAULT false,
  mentions       JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_notes_client_idx
  ON public.client_notes (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS client_notes_client_tab_idx
  ON public.client_notes (client_id, tab);

CREATE TABLE IF NOT EXISTS public.client_note_replies (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id        UUID NOT NULL REFERENCES public.client_notes(id) ON DELETE CASCADE,
  client_id      UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  body           TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  author_id      UUID NOT NULL REFERENCES auth.users(id),
  author_name    TEXT NOT NULL,
  author_email   TEXT,
  mentions       JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_note_replies_note_idx
  ON public.client_note_replies (note_id, created_at ASC);

ALTER TABLE public.client_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_note_replies ENABLE ROW LEVEL SECURITY;

-- Read: anyone with client access
CREATE POLICY "notes read by access"
  ON public.client_notes FOR SELECT TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));

CREATE POLICY "note replies read by access"
  ON public.client_note_replies FOR SELECT TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));

-- Insert: anyone with access, stamping themselves as author
CREATE POLICY "notes insert by access"
  ON public.client_notes FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND public.has_client_access(auth.uid(), client_id)
  );

CREATE POLICY "note replies insert by access"
  ON public.client_note_replies FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND public.has_client_access(auth.uid(), client_id)
  );

-- Update: author may edit; anyone with access may toggle resolved
CREATE POLICY "notes update by access"
  ON public.client_notes FOR UPDATE TO authenticated
  USING (public.has_client_access(auth.uid(), client_id))
  WITH CHECK (public.has_client_access(auth.uid(), client_id));

-- Delete: author only
CREATE POLICY "notes delete by author"
  ON public.client_notes FOR DELETE TO authenticated
  USING (
    author_id = auth.uid()
    AND public.has_client_access(auth.uid(), client_id)
  );

CREATE POLICY "note replies delete by author"
  ON public.client_note_replies FOR DELETE TO authenticated
  USING (
    author_id = auth.uid()
    AND public.has_client_access(auth.uid(), client_id)
  );

-- Keep updated_at fresh
CREATE OR REPLACE FUNCTION public.touch_client_note_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS client_notes_touch_updated_at ON public.client_notes;
CREATE TRIGGER client_notes_touch_updated_at
  BEFORE UPDATE ON public.client_notes
  FOR EACH ROW EXECUTE FUNCTION public.touch_client_note_updated_at();
