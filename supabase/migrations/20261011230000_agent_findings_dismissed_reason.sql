-- Findings can be dismissed without pretending another finding replaced them.
-- dismissed_reason null means the row is still active. Nothing is deleted.
--
-- 9e99e9e8 and 10464c39 are Sep-versus-Oct labelling artefacts. The previous
-- cleanup pointed them at weakest-pillar keeper 8556e68f, which is a different
-- observation. Clear that pointer and dismiss them. A second run finds
-- dismissed_reason already set. 982d09f0 is genuine and is not touched.

ALTER TABLE public.agent_findings
  ADD COLUMN IF NOT EXISTS dismissed_reason text;

UPDATE public.agent_findings AS finding
SET superseded_by = NULL,
    dismissed_reason = 'period label artefact'
WHERE finding.dismissed_reason IS NULL
  AND (
    finding.id::text LIKE '9e99e9e8-%'
    OR finding.id::text LIKE '10464c39-%'
  )
  AND (
    finding.superseded_by IS NULL
    OR EXISTS (
      SELECT 1
      FROM public.agent_findings AS keeper
      WHERE keeper.id = finding.superseded_by
        AND keeper.id::text LIKE '8556e68f-%'
    )
  );
