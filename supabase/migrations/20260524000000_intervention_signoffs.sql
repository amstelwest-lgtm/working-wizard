-- ── Intervention Sign-offs & Custom Steps ────────────────────────────────────
-- Three tables supporting accountant sign-offs on playbook steps, custom steps
-- written by accountants for a specific client, and AI consultation sessions.
-- Run in Supabase SQL Editor: https://supabase.com/dashboard/project/cujzeoyvnpfokgwfftyd/sql/new

-- ── Table 1: Sign-offs on standard playbook steps ────────────────────────────

CREATE TABLE IF NOT EXISTS public.intervention_signoffs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  submission_period     DATE NOT NULL,
  ratio_key             TEXT NOT NULL,
  step_number           INTEGER NOT NULL,
  signed_off_by_id      UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  signed_off_by_name    TEXT NOT NULL,
  signed_off_by_title   TEXT,
  firm_name             TEXT,
  accountant_note       TEXT,
  signed_off_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, submission_period, ratio_key, step_number)
);

CREATE INDEX IF NOT EXISTS intervention_signoffs_client_ratio_idx
  ON public.intervention_signoffs (client_id, submission_period, ratio_key);

ALTER TABLE public.intervention_signoffs ENABLE ROW LEVEL SECURITY;

-- Accountants/firm_admins can read/write sign-offs for any client of their firm.
-- Client owners/members can read sign-offs for their own client.
CREATE POLICY "read signoffs for own client"
  ON public.intervention_signoffs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = intervention_signoffs.client_id
        AND (
          c.owner_user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role IN ('accountant', 'firm_admin')
          )
        )
    )
  );

CREATE POLICY "accountants insert signoffs"
  ON public.intervention_signoffs FOR INSERT
  WITH CHECK (
    signed_off_by_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('accountant', 'firm_admin')
    )
  );

CREATE POLICY "accountants update own signoffs"
  ON public.intervention_signoffs FOR UPDATE
  USING (signed_off_by_id = auth.uid())
  WITH CHECK (signed_off_by_id = auth.uid());

CREATE POLICY "accountants delete own signoffs"
  ON public.intervention_signoffs FOR DELETE
  USING (signed_off_by_id = auth.uid());

-- ── Table 2: Custom steps added by accountant ────────────────────────────────

CREATE TABLE IF NOT EXISTS public.intervention_custom_steps (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  submission_period     DATE NOT NULL,
  ratio_key             TEXT,
  step_title            TEXT NOT NULL,
  step_description      TEXT NOT NULL,
  timeframe             TEXT NOT NULL CHECK (timeframe IN (
                          'immediate','week_1_2','month_1','month_1_3','month_3_6','year_1'
                        )),
  effort                TEXT NOT NULL CHECK (effort IN ('low','medium','high')),
  impact                TEXT NOT NULL CHECK (impact IN ('low','medium','high')),
  category              TEXT NOT NULL CHECK (category IN (
                          'revenue','cost','cash','structure','operations','risk','people'
                        )),
  display_order         INTEGER NOT NULL DEFAULT 0,
  is_ai_generated       BOOLEAN NOT NULL DEFAULT false,
  ai_prompt_used        TEXT,
  signed_off            BOOLEAN NOT NULL DEFAULT false,
  signed_off_by_id      UUID REFERENCES auth.users(id),
  signed_off_by_name    TEXT,
  signed_off_by_title   TEXT,
  firm_name             TEXT,
  signed_off_at         TIMESTAMPTZ,
  visible_to_sme        BOOLEAN NOT NULL DEFAULT true,
  created_by            UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS intervention_custom_steps_client_ratio_idx
  ON public.intervention_custom_steps (client_id, submission_period, ratio_key);

ALTER TABLE public.intervention_custom_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read custom steps for own client"
  ON public.intervention_custom_steps FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = intervention_custom_steps.client_id
        AND (
          -- Accountants/firm_admins see everything
          EXISTS (
            SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role IN ('accountant', 'firm_admin')
          )
          -- Client owners only see steps marked visible
          OR (c.owner_user_id = auth.uid() AND intervention_custom_steps.visible_to_sme = true)
        )
    )
  );

CREATE POLICY "accountants insert custom steps"
  ON public.intervention_custom_steps FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('accountant', 'firm_admin')
    )
  );

CREATE POLICY "accountants update own custom steps"
  ON public.intervention_custom_steps FOR UPDATE
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "accountants delete own custom steps"
  ON public.intervention_custom_steps FOR DELETE
  USING (created_by = auth.uid());

-- ── Table 3: AI consultation sessions (Phase 3 — built ahead of time) ────────

CREATE TABLE IF NOT EXISTS public.intervention_ai_sessions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  submission_period     DATE NOT NULL,
  ratio_key             TEXT,
  accountant_prompt     TEXT NOT NULL,
  ai_response           JSONB,
  model_used            TEXT,
  steps_adopted         INTEGER NOT NULL DEFAULT 0,
  created_by            UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.intervention_ai_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "accountants read own ai sessions"
  ON public.intervention_ai_sessions FOR SELECT
  USING (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('accountant', 'firm_admin')
    )
  );

CREATE POLICY "accountants insert ai sessions"
  ON public.intervention_ai_sessions FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('accountant', 'firm_admin')
    )
  );
