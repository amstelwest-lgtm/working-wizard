-- Private firm-scoped rules from human approve/dismiss on agent drafts (P0).
-- Milōn injects a short subset into bot prompts. No cross-firm read.

CREATE TABLE IF NOT EXISTS public.milon_brain_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  task_type text NOT NULL,
  source_event text NOT NULL,
  source_row_id uuid,
  decision text NOT NULL,
  rule_text text NOT NULL,
  approver_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  layer text NOT NULL DEFAULT 'private',
  status text NOT NULL DEFAULT 'active',
  CONSTRAINT milon_brain_rules_decision_check
    CHECK (decision IN ('approved', 'dismissed', 'corrected')),
  CONSTRAINT milon_brain_rules_layer_check
    CHECK (layer IN ('private', 'milon_wide')),
  CONSTRAINT milon_brain_rules_status_check
    CHECK (status IN ('active', 'merged', 'retired'))
);

CREATE INDEX IF NOT EXISTS milon_brain_rules_firm_task_created_idx
  ON public.milon_brain_rules (firm_id, task_type, created_at DESC);

CREATE INDEX IF NOT EXISTS milon_brain_rules_firm_client_task_idx
  ON public.milon_brain_rules (firm_id, client_id, task_type);

COMMENT ON TABLE public.milon_brain_rules IS
  'Private accountant decisions on agent drafts, scoped by firm. Injected into bot prompts in small batches.';

ALTER TABLE public.milon_brain_rules ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.milon_brain_rules FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.milon_brain_rules TO authenticated;
GRANT ALL ON TABLE public.milon_brain_rules TO service_role;

DROP POLICY IF EXISTS milon_brain_rules_firm_select ON public.milon_brain_rules;
CREATE POLICY milon_brain_rules_firm_select
  ON public.milon_brain_rules
  FOR SELECT
  TO authenticated
  USING (
    public.is_firm_member((select auth.uid()), firm_id)
    OR EXISTS (
      SELECT 1 FROM public.firms f
      WHERE f.id = milon_brain_rules.firm_id
        AND f.owner_user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS milon_brain_rules_firm_insert ON public.milon_brain_rules;
CREATE POLICY milon_brain_rules_firm_insert
  ON public.milon_brain_rules
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_firm_member((select auth.uid()), firm_id)
    OR EXISTS (
      SELECT 1 FROM public.firms f
      WHERE f.id = milon_brain_rules.firm_id
        AND f.owner_user_id = (select auth.uid())
    )
  );
