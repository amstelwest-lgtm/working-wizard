-- Owner → accountant invite: mint a firm-link token without touching owner_handoff.
-- Redeem is service-role only (invite_tokens stay deny-all). RLS on clients.firm_id
-- is unchanged — the redeem path writes as service role (auth.uid() IS NULL).

ALTER TABLE public.invite_tokens
  ADD COLUMN IF NOT EXISTS invited_email text;

ALTER TABLE public.invite_tokens DROP CONSTRAINT IF EXISTS invite_tokens_purpose_check;
ALTER TABLE public.invite_tokens
  ADD CONSTRAINT invite_tokens_purpose_check
  CHECK (purpose IN ('owner_handoff', 'staff_member', 'accountant_link'));

CREATE INDEX IF NOT EXISTS invite_tokens_accountant_pending_idx
  ON public.invite_tokens (client_id, created_at DESC)
  WHERE purpose = 'accountant_link' AND redeemed_at IS NULL;

CREATE OR REPLACE FUNCTION public.mint_accountant_invite(p_client_id uuid, p_email text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_owner  uuid;
  v_firm   uuid;
  v_email  text;
  v_token  text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_email := lower(trim(p_email));
  IF v_email IS NULL OR v_email !~ '^[^@]+@[^@]+\.[^@]+$' THEN
    RAISE EXCEPTION 'Enter a valid accountant email';
  END IF;

  SELECT c.owner_user_id, c.firm_id
    INTO v_owner, v_firm
  FROM public.clients c
  WHERE c.id = p_client_id;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Client not found';
  END IF;

  IF v_owner IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Only the business owner can invite an accountant';
  END IF;

  IF v_firm IS NOT NULL THEN
    RAISE EXCEPTION 'This workspace is already linked to a practice';
  END IF;

  v_token := encode(gen_random_bytes(24), 'hex');

  INSERT INTO public.invite_tokens (token, client_id, created_by, purpose, invited_email)
  VALUES (v_token, p_client_id, v_uid, 'accountant_link', v_email);

  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.mint_accountant_invite(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mint_accountant_invite(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.mint_accountant_invite(uuid, text) IS
  'Business owner mints an accountant_link invite. Does not change mint_owner_invite.';

-- Keep owner.invite.* analytics on the firm→owner path only.
CREATE OR REPLACE FUNCTION analytics.trg_invite_tokens()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = analytics, public
AS $$
DECLARE
  v_firm uuid;
BEGIN
  IF NEW.purpose IS DISTINCT FROM 'owner_handoff'
     AND NEW.purpose IS DISTINCT FROM 'staff_member' THEN
    RETURN NEW;
  END IF;

  SELECT c.firm_id INTO v_firm FROM public.clients c WHERE c.id = NEW.client_id;
  IF TG_OP = 'INSERT' THEN
    PERFORM analytics.record(
      'owner.invite.minted', NEW.created_at, analytics.actor_kind_for(NEW.created_by, NULL),
      NEW.created_by, NULL, v_firm, NEW.client_id, NEW.id, 'invite', 'db_trigger',
      NULL, false, 'owner.invite.minted:' || NEW.id, '{}'::jsonb
    );
  ELSIF TG_OP = 'UPDATE' AND OLD.redeemed_at IS NULL AND NEW.redeemed_at IS NOT NULL THEN
    PERFORM analytics.record(
      'owner.invite.redeemed', NEW.redeemed_at,
      analytics.actor_kind_for(NEW.redeemed_by, NULL), NEW.redeemed_by, NULL,
      v_firm, NEW.client_id, NEW.id, 'invite', 'db_trigger',
      NULL, false, 'owner.invite.redeemed:' || NEW.id, '{}'::jsonb
    );
  END IF;
  RETURN NEW;
END;
$$;
