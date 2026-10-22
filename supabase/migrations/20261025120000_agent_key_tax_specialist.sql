-- Add tax_specialist to the agent enum.
-- Chief of Staff applies this. CI does not.
-- The new value is not used in this file. Postgres cannot use an enum
-- value that was added in the same transaction.

ALTER TYPE public.agent_key ADD VALUE IF NOT EXISTS 'tax_specialist';
