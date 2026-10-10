-- Older analyst findings were inserted with a null recipient. The route
-- trigger still delivered them to the financial manager, but to_agent stayed
-- empty. 20261011150000 addressed cfaa8b3d and 7c147e88. The remaining
-- analyst finding messages (the ten still null) get the same recipient.
--
-- Idempotent: a second run matches no row once to_agent is set. INSERT-only
-- routing means this update does not enqueue them again.

UPDATE public.agent_messages
SET to_agent = 'financial_manager'
WHERE to_agent IS NULL
  AND type = 'finding'
  AND from_agent = 'analyst';
