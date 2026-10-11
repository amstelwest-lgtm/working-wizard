-- A person can approve or dismiss an agent draft.
-- Approve stores who did it and the live row id, so a second approve returns that row.
-- Dismiss uses status and the existing dismissed_reason column.
-- Nothing is deleted. Existing rows stay status null.

ALTER TABLE public.agent_findings
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_table text,
  ADD COLUMN IF NOT EXISTS approved_row_id uuid;

ALTER TABLE public.agent_findings DROP CONSTRAINT IF EXISTS agent_findings_status_check;
ALTER TABLE public.agent_findings
  ADD CONSTRAINT agent_findings_status_check
  CHECK (status IS NULL OR status IN ('approved', 'dismissed'));

ALTER TABLE public.agent_findings DROP CONSTRAINT IF EXISTS agent_findings_approved_row_check;
ALTER TABLE public.agent_findings
  ADD CONSTRAINT agent_findings_approved_row_check
  CHECK (
    status IS DISTINCT FROM 'approved'
    OR (
      approved_by IS NOT NULL
      AND approved_at IS NOT NULL
      AND approved_row_id IS NOT NULL
      AND approved_table IN (
        'data_requests',
        'action_items',
        'proposed_next_steps',
        'deliverable_drafts',
        'accountant_requests'
      )
    )
  );

COMMENT ON COLUMN public.agent_findings.status IS
  'Null while a draft is waiting. approved after the live row is created. dismissed with dismissed_reason.';
COMMENT ON COLUMN public.agent_findings.approved_by IS
  'The user who approved the draft.';
COMMENT ON COLUMN public.agent_findings.approved_at IS
  'When the draft was approved.';
COMMENT ON COLUMN public.agent_findings.approved_table IS
  'Live table written on approve: data_requests, action_items, proposed_next_steps, deliverable_drafts, or accountant_requests.';
COMMENT ON COLUMN public.agent_findings.approved_row_id IS
  'Id of that live row. A second approve returns this id and does not insert again.';
