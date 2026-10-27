-- Per-deliverable input checklists (sources noted, assumption values), shared
-- across browsers and colleagues instead of living in one browser's storage.
-- Chief of Staff applies this file. It is not wired into the CI apply script.
--
-- Shape is owned by the app: { [deliverableId]: { checkedSources, assumptionValues,
-- appliedFingerprint } }. These are notes for the accountant. They do not
-- filter any figure. The app falls back to browser storage until this column
-- exists, so applying it late is safe.
--
-- RLS on clients is unchanged: writers already update the row, and the
-- clients_guard_owner_only_columns trigger only restricts the columns it names.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS deliverable_inputs JSONB;

COMMENT ON COLUMN public.clients.deliverable_inputs IS
  'Input checklist notes per deliverable (sources noted, assumption values). Not read by the forecast engine.';
