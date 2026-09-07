-- ── Client Brain (system of record) ──────────────────────────────────────────
-- Additive only. Summary lives on clients (jsonb) — no client_brain_summaries
-- table. Four client-scoped tables reuse has_client_access (firm / owner /
-- member), matching client_notes + review_signoffs read access.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS brain_summary jsonb,
  ADD COLUMN IF NOT EXISTS brain_summary_updated_at timestamptz;

COMMENT ON COLUMN public.clients.brain_summary IS
  'Client-brain blob: {headline, body, bullets, gap_report, competitors, business_map}. Written by a later propose step — not this migration.';
COMMENT ON COLUMN public.clients.brain_summary_updated_at IS
  'Last time clients.brain_summary was saved.';

-- ── client_artifacts ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.client_artifacts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN (
                  'financial_snapshot', 'budget', 'upload', 'advisory', 'note', 'other'
                )),
  ref_table     text,
  ref_id        uuid,
  storage_path  text,
  period_label  text,
  meta          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_artifacts_client_idx
  ON public.client_artifacts (client_id, created_at DESC);

-- ── context_facts ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.context_facts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  fact_text      text NOT NULL,
  category       text,
  source         text CHECK (source IS NULL OR source IN (
                   'ask_ai', 'note', 'profile', 'manual', 'extract', 'other'
                 )),
  source_ref     text,
  confidence     numeric,
  superseded_by  uuid REFERENCES public.context_facts(id) ON DELETE SET NULL,
  created_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS context_facts_client_idx
  ON public.context_facts (client_id, created_at DESC);

-- ── proposed_next_steps ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.proposed_next_steps (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  title                 text NOT NULL,
  rationale             text,
  assumptions           jsonb NOT NULL DEFAULT '[]'::jsonb,
  status                text NOT NULL DEFAULT 'proposed'
                          CHECK (status IN ('proposed', 'approved', 'edited', 'rejected')),
  edit_diff             jsonb,
  linked_action_item_id uuid REFERENCES public.action_items(id) ON DELETE SET NULL,
  signed_off_by_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  signed_off_by_name    text,
  signed_off_by_title   text,
  firm_name             text,
  signed_off_at         timestamptz,
  note                  text,
  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS proposed_next_steps_client_idx
  ON public.proposed_next_steps (client_id, status, created_at DESC);

-- ── deliverable_drafts ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.deliverable_drafts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  kind                  text,
  body                  text,
  assumption_checklist  jsonb NOT NULL DEFAULT '[]'::jsonb,
  status                text NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft', 'ready', 'sent', 'discarded')),
  advisory_delivery_id  uuid REFERENCES public.advisory_deliveries(id) ON DELETE SET NULL,
  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deliverable_drafts_client_idx
  ON public.deliverable_drafts (client_id, created_at DESC);

-- ── updated_at ───────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.touch_row_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS proposed_next_steps_touch_updated_at ON public.proposed_next_steps;
CREATE TRIGGER proposed_next_steps_touch_updated_at
  BEFORE UPDATE ON public.proposed_next_steps
  FOR EACH ROW EXECUTE FUNCTION public.touch_row_updated_at();

DROP TRIGGER IF EXISTS deliverable_drafts_touch_updated_at ON public.deliverable_drafts;
CREATE TRIGGER deliverable_drafts_touch_updated_at
  BEFORE UPDATE ON public.deliverable_drafts
  FOR EACH ROW EXECUTE FUNCTION public.touch_row_updated_at();

-- ── RLS — same client-scoped access as client_notes / review_signoffs ────────

ALTER TABLE public.client_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.context_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proposed_next_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deliverable_drafts ENABLE ROW LEVEL SECURITY;

-- client_artifacts
DROP POLICY IF EXISTS "artifacts read by access" ON public.client_artifacts;
CREATE POLICY "artifacts read by access"
  ON public.client_artifacts FOR SELECT TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));

DROP POLICY IF EXISTS "artifacts insert by access" ON public.client_artifacts;
CREATE POLICY "artifacts insert by access"
  ON public.client_artifacts FOR INSERT TO authenticated
  WITH CHECK (
    (created_by IS NULL OR created_by = auth.uid())
    AND public.has_client_access(auth.uid(), client_id)
  );

DROP POLICY IF EXISTS "artifacts update by access" ON public.client_artifacts;
CREATE POLICY "artifacts update by access"
  ON public.client_artifacts FOR UPDATE TO authenticated
  USING (public.has_client_access(auth.uid(), client_id))
  WITH CHECK (public.has_client_access(auth.uid(), client_id));

DROP POLICY IF EXISTS "artifacts delete by access" ON public.client_artifacts;
CREATE POLICY "artifacts delete by access"
  ON public.client_artifacts FOR DELETE TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));

-- context_facts
DROP POLICY IF EXISTS "facts read by access" ON public.context_facts;
CREATE POLICY "facts read by access"
  ON public.context_facts FOR SELECT TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));

DROP POLICY IF EXISTS "facts insert by access" ON public.context_facts;
CREATE POLICY "facts insert by access"
  ON public.context_facts FOR INSERT TO authenticated
  WITH CHECK (
    (created_by IS NULL OR created_by = auth.uid())
    AND public.has_client_access(auth.uid(), client_id)
  );

DROP POLICY IF EXISTS "facts update by access" ON public.context_facts;
CREATE POLICY "facts update by access"
  ON public.context_facts FOR UPDATE TO authenticated
  USING (public.has_client_access(auth.uid(), client_id))
  WITH CHECK (public.has_client_access(auth.uid(), client_id));

DROP POLICY IF EXISTS "facts delete by access" ON public.context_facts;
CREATE POLICY "facts delete by access"
  ON public.context_facts FOR DELETE TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));

-- proposed_next_steps (approve / edit / reject are UPDATEs)
DROP POLICY IF EXISTS "next steps read by access" ON public.proposed_next_steps;
CREATE POLICY "next steps read by access"
  ON public.proposed_next_steps FOR SELECT TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));

DROP POLICY IF EXISTS "next steps insert by access" ON public.proposed_next_steps;
CREATE POLICY "next steps insert by access"
  ON public.proposed_next_steps FOR INSERT TO authenticated
  WITH CHECK (
    (created_by IS NULL OR created_by = auth.uid())
    AND public.has_client_access(auth.uid(), client_id)
  );

DROP POLICY IF EXISTS "next steps update by access" ON public.proposed_next_steps;
CREATE POLICY "next steps update by access"
  ON public.proposed_next_steps FOR UPDATE TO authenticated
  USING (public.has_client_access(auth.uid(), client_id))
  WITH CHECK (public.has_client_access(auth.uid(), client_id));

DROP POLICY IF EXISTS "next steps delete by access" ON public.proposed_next_steps;
CREATE POLICY "next steps delete by access"
  ON public.proposed_next_steps FOR DELETE TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));

-- deliverable_drafts
DROP POLICY IF EXISTS "drafts read by access" ON public.deliverable_drafts;
CREATE POLICY "drafts read by access"
  ON public.deliverable_drafts FOR SELECT TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));

DROP POLICY IF EXISTS "drafts insert by access" ON public.deliverable_drafts;
CREATE POLICY "drafts insert by access"
  ON public.deliverable_drafts FOR INSERT TO authenticated
  WITH CHECK (
    (created_by IS NULL OR created_by = auth.uid())
    AND public.has_client_access(auth.uid(), client_id)
  );

DROP POLICY IF EXISTS "drafts update by access" ON public.deliverable_drafts;
CREATE POLICY "drafts update by access"
  ON public.deliverable_drafts FOR UPDATE TO authenticated
  USING (public.has_client_access(auth.uid(), client_id))
  WITH CHECK (public.has_client_access(auth.uid(), client_id));

DROP POLICY IF EXISTS "drafts delete by access" ON public.deliverable_drafts;
CREATE POLICY "drafts delete by access"
  ON public.deliverable_drafts FOR DELETE TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));

-- ── client_brain_questions (shared owner + accountant queue) ──────────────────
-- Schema only. No Claude prompt loop in this migration.

CREATE TABLE IF NOT EXISTS public.client_brain_questions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  question_key  text NOT NULL,
  prompt_text   text,
  status        text NOT NULL DEFAULT 'unanswered'
                  CHECK (status IN ('unanswered', 'answered', 'skipped')),
  audience      text NOT NULL DEFAULT 'both'
                  CHECK (audience IN ('owner', 'accountant', 'both')),
  answer_text   text,
  answer_json   jsonb,
  last_asked_at timestamptz,
  answered_at   timestamptz,
  answered_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, question_key)
);

CREATE INDEX IF NOT EXISTS client_brain_questions_client_idx
  ON public.client_brain_questions (client_id, status, created_at DESC);

DROP TRIGGER IF EXISTS client_brain_questions_touch_updated_at ON public.client_brain_questions;
CREATE TRIGGER client_brain_questions_touch_updated_at
  BEFORE UPDATE ON public.client_brain_questions
  FOR EACH ROW EXECUTE FUNCTION public.touch_row_updated_at();

ALTER TABLE public.client_brain_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "brain questions read by access" ON public.client_brain_questions;
CREATE POLICY "brain questions read by access"
  ON public.client_brain_questions FOR SELECT TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));

DROP POLICY IF EXISTS "brain questions insert by access" ON public.client_brain_questions;
CREATE POLICY "brain questions insert by access"
  ON public.client_brain_questions FOR INSERT TO authenticated
  WITH CHECK (public.has_client_access(auth.uid(), client_id));

DROP POLICY IF EXISTS "brain questions update by access" ON public.client_brain_questions;
CREATE POLICY "brain questions update by access"
  ON public.client_brain_questions FOR UPDATE TO authenticated
  USING (public.has_client_access(auth.uid(), client_id))
  WITH CHECK (public.has_client_access(auth.uid(), client_id));

DROP POLICY IF EXISTS "brain questions delete by access" ON public.client_brain_questions;
CREATE POLICY "brain questions delete by access"
  ON public.client_brain_questions FOR DELETE TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));

COMMENT ON TABLE public.client_brain_questions IS
  'Shared outstanding-question queue for owner and accountant. Claude prompt loop is a later PR.';
