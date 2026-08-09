-- Persist preliminary bank→cash drafts on the client row (Phases 1–3).
-- Full normalised import/txn tables come in the accountant workspace phase.
-- Draft JSON shape is owned by the app (CashFromBanksDraftResult + edits).

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS cashflow_bank_draft JSONB;

COMMENT ON COLUMN public.clients.cashflow_bank_draft IS
  'Preliminary cash forecast draft built from bank statements (extract + editable lines). Published forecasts live in clients.cashflow.';
