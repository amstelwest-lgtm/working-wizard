-- Holds the visitor message that opened the name-and-email form so the
-- same prospect-talk session can answer it after the lead is saved.
-- Apply before redeploying the prospect-talk edge function.
-- No functions. Service role already owns the table. Nothing here is granted out.

ALTER TABLE public.prospect_talk_sessions
  ADD COLUMN IF NOT EXISTS pending_message text;
