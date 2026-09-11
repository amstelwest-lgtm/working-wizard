-- Per-client "auto-update on upload" checkboxes (profitability / cash forecast / budget).
-- First upload always fills every deliverable; these prefs govern later uploads.
-- Shape is owned by the app: src/lib/auto-populate.ts (AutoPopulatePrefs).

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS auto_update_prefs JSONB;

COMMENT ON COLUMN public.clients.auto_update_prefs IS
  'Remembered upload checkboxes: which deliverables (profitability, cash_forecast, budget) a new statement upload refreshes automatically. Null = all on.';
