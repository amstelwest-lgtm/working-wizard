-- Send-an-agent missions. Extends the existing send tables.
-- Does not rewrite physio rows. checklist_key stays as it is.
-- Legacy agent value tax-specialist remains allowed.
-- CoS applies this file. It is not wired into the CI apply script.
-- Service role writes. The new message table has no anon grant and no
-- signed-in read policy. The accountant feed is a server function.

ALTER TABLE public.client_agent_sends
  DROP CONSTRAINT IF EXISTS client_agent_sends_agent_check;

ALTER TABLE public.client_agent_sends
  ADD CONSTRAINT client_agent_sends_agent_check
  CHECK (agent IN (
    'tax-specialist',
    'financial_manager',
    'analyst',
    'advisor',
    'tax_specialist'
  ));

ALTER TABLE public.client_agent_sends
  ADD COLUMN IF NOT EXISTS mission_key text;

ALTER TABLE public.client_agent_sends
  DROP CONSTRAINT IF EXISTS client_agent_sends_mission_key_check;

ALTER TABLE public.client_agent_sends
  ADD CONSTRAINT client_agent_sends_mission_key_check
  CHECK (
    mission_key IS NULL
    OR mission_key IN (
      'collect_documents',
      'deadline_reminder',
      'informal_consult',
      'confirm_balances',
      'vat_pack',
      'signoff_reminder'
    )
  );

ALTER TABLE public.client_agent_sends
  ADD COLUMN IF NOT EXISTS firm_note text;

ALTER TABLE public.client_agent_sends
  DROP CONSTRAINT IF EXISTS client_agent_sends_firm_note_len;

ALTER TABLE public.client_agent_sends
  ADD CONSTRAINT client_agent_sends_firm_note_len
  CHECK (
    firm_note IS NULL
    OR (length(btrim(firm_note)) > 0 AND length(firm_note) <= 500)
  );

ALTER TABLE public.client_agent_sends
  ADD COLUMN IF NOT EXISTS mission_prompt text;

ALTER TABLE public.client_agent_sends
  ADD COLUMN IF NOT EXISTS opened_at timestamptz;

ALTER TABLE public.client_agent_sends
  ADD COLUMN IF NOT EXISTS replied_at timestamptz;

ALTER TABLE public.client_agent_sends
  ADD COLUMN IF NOT EXISTS docs_received_at timestamptz;

ALTER TABLE public.client_agent_sends
  ADD COLUMN IF NOT EXISTS report_mailed_at timestamptz;

ALTER TABLE public.client_agent_sends
  ADD COLUMN IF NOT EXISTS report_summary text;

ALTER TABLE public.client_agent_sends
  DROP CONSTRAINT IF EXISTS client_agent_sends_report_summary_len;

ALTER TABLE public.client_agent_sends
  ADD CONSTRAINT client_agent_sends_report_summary_len
  CHECK (report_summary IS NULL OR length(report_summary) <= 4000);

COMMENT ON COLUMN public.client_agent_sends.mission_key IS
  'One of the six missions. Null on a legacy physio send.';

COMMENT ON COLUMN public.client_agent_sends.firm_note IS
  'Optional note for the agent. The client never sees this text. Not copied into the email.';

COMMENT ON COLUMN public.client_agent_sends.mission_prompt IS
  'Prompt filled at Send and stored so a later report matches the prompt that ran.';

COMMENT ON COLUMN public.client_agent_sends.opened_at IS
  'First successful public open. Not set from a throttled retry.';

COMMENT ON COLUMN public.client_agent_sends.replied_at IS
  'First stored client message.';

COMMENT ON COLUMN public.client_agent_sends.docs_received_at IS
  'First archive copy into Client library.';

COMMENT ON COLUMN public.client_agent_sends.report_mailed_at IS
  'Set once the report email has gone to sent_by. A resend is a new row.';

COMMENT ON COLUMN public.client_agent_sends.report_summary IS
  'What the client answered, what is still open, and the file names.';

ALTER TABLE public.client_agent_send_files
  ADD COLUMN IF NOT EXISTS upload_label text;

ALTER TABLE public.client_agent_send_files
  DROP CONSTRAINT IF EXISTS client_agent_send_files_upload_label_len;

ALTER TABLE public.client_agent_send_files
  ADD CONSTRAINT client_agent_send_files_upload_label_len
  CHECK (
    upload_label IS NULL
    OR (length(btrim(upload_label)) > 0 AND length(upload_label) <= 200)
  );

COMMENT ON COLUMN public.client_agent_send_files.upload_label IS
  'Name the client typed for this file. Null on a legacy checklist upload.';

CREATE TABLE IF NOT EXISTS public.client_agent_send_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  send_id uuid NOT NULL REFERENCES public.client_agent_sends(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('client', 'agent')),
  body text NOT NULL CHECK (length(btrim(body)) > 0 AND length(body) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_agent_send_messages_send_idx
  ON public.client_agent_send_messages (send_id, created_at);

COMMENT ON TABLE public.client_agent_send_messages IS
  'Chat text for one send. Service role only. The accountant feed checks sent_by in a server function.';

ALTER TABLE public.client_agent_send_messages ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.client_agent_send_messages FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.client_agent_send_messages TO service_role;

-- No policy. Signed-in reads go through the server function, which checks sent_by.
