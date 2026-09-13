-- Cached "This month's Milōn workflow" line for the accountant client briefing.
-- Shape owned by the app: src/lib/client-briefing.functions.ts (BriefingWorkflow).
-- Regenerated when the briefing inputs (profile, health, snapshot) change.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS briefing_workflow JSONB;

COMMENT ON COLUMN public.clients.briefing_workflow IS
  'Cached monthly Milōn workflow recommendation for the accountant briefing: {text, source, generatedAt, inputsHash}.';
