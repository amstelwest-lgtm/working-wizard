-- Re-sync evidence.status from severity on active findings.
-- Status is only the severity map: info → healthy, watch → attention, act → critical.
-- 2905a21a and e37ea580 are watch with status critical. 8556e68f is act with status attention.
-- Severity, created_at, and superseded_by stay as they are. Nothing is deleted.

UPDATE public.agent_findings
SET evidence = evidence || jsonb_build_object(
  'status',
  CASE severity
    WHEN 'act' THEN 'critical'
    WHEN 'watch' THEN 'attention'
    ELSE 'healthy'
  END
)
WHERE superseded_by IS NULL
  AND dismissed_reason IS NULL
  AND evidence->>'status' IS DISTINCT FROM (
    CASE severity
      WHEN 'act' THEN 'critical'
      WHEN 'watch' THEN 'attention'
      ELSE 'healthy'
    END
  );
