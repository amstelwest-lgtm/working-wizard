-- A tax document review is approved on the finding itself.
-- No live row is inserted, and nothing is queued for the client.
-- Not applied here.

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
        'accountant_requests',
        'agent_findings'
      )
    )
  );

COMMENT ON COLUMN public.agent_findings.approved_table IS
  'Live table written on approve, or agent_findings when the decision stays on the finding and nothing is sent on.';
