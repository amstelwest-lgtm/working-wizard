-- Soft-archive. False hides a client from active practice lists.
-- Rows, memberships, books, and related data stay.
-- CoS applies this file on merge. It is not wired into the CI apply script.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.clients.active IS
  'False means soft-archived: hidden from active practice lists. Data is kept.';

CREATE INDEX IF NOT EXISTS clients_firm_id_active_idx
  ON public.clients (firm_id)
  WHERE active;
