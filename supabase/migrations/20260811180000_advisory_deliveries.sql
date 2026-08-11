-- Gap 9: advisory / report delivery ledger
-- ────────────────────────────────────────────────────────────────────────────
-- mailto / WhatsApp / copy / PDF download leave no audit trail today.
-- This table records intent-to-send (and PDF downloads) with stamped figures
-- so a firm can answer "what did we advise in March?"
-- Acknowledgement columns support a later magic-link confirm flow.

create table if not exists public.advisory_deliveries (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null references public.clients(id) on delete cascade,
  firm_id            uuid references public.firms(id) on delete set null,
  channel            text not null
                       check (channel in ('mailto', 'whatsapp', 'copy', 'pdf_download', 'email')),
  kind               text not null
                       check (kind in (
                         'advisory_draft', 'health_summary', 'report_pdf',
                         'meeting_agenda', 'exec_summary'
                       )),
  subject            text,
  body               text,
  recipient_email    text,
  recipient_name     text,
  report_key         text,
  snapshot_id        uuid references public.client_financial_snapshots(id) on delete set null,
  figures_hash       text,
  period_label       text,
  created_by         uuid not null references auth.users(id),
  created_at         timestamptz not null default now(),
  acknowledged_at    timestamptz,
  acknowledged_by    uuid references auth.users(id),
  ack_token          text unique
);

create index if not exists advisory_deliveries_client_idx
  on public.advisory_deliveries (client_id, created_at desc);

alter table public.advisory_deliveries enable row level security;

-- Prefer is_client_writer when Gap 3 is applied; fall back to has_client_access.
drop policy if exists "advisory deliveries read" on public.advisory_deliveries;
create policy "advisory deliveries read"
  on public.advisory_deliveries for select to authenticated
  using (public.has_client_access(auth.uid(), client_id));

drop policy if exists "advisory deliveries insert" on public.advisory_deliveries;
create policy "advisory deliveries insert"
  on public.advisory_deliveries for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.has_client_access(auth.uid(), client_id)
  );

drop policy if exists "advisory deliveries update ack" on public.advisory_deliveries;
create policy "advisory deliveries update ack"
  on public.advisory_deliveries for update to authenticated
  using (public.has_client_access(auth.uid(), client_id))
  with check (public.has_client_access(auth.uid(), client_id));
