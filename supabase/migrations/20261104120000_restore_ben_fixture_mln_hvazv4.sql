-- Restore QA fixture MLN-HVAZV4 (AQA J2 US 1020E) onto Ben Accountants.
-- CoS applies on merge. Idempotent when the client is already on Ben.
--
-- Context: Remove only sets clients.active = false (firm_id unchanged). Owners may
-- clear firm_id to leave a firm; link_client_firm then attaches elsewhere. There is
-- no in-app transfer between two firms while firm_id is set, so this fixture landed
-- on AQA Throwaway 1020E after disconnect/re-link. Ben is at Starter cap (5 active);
-- archived clients do not count (see countFirmClientsForCreate), so we soft-archive
-- MLN-T8UEXM before moving MLN-HVAZV4 back.
--
-- Verify after apply:
--   SELECT client_code, firm_id, active FROM clients
--   WHERE client_code IN ('MLN-HVAZV4', 'MLN-T8UEXM');
-- Ben login → /clients lists AQA J2 US 1020E (MLN-HVAZV4); T8UEXM hidden (archived).
--
-- Rollback (manual, service role):
--   UPDATE public.clients SET active = true
--     WHERE id = '3cc31b6a-10a6-4202-bec7-ebb32a4e1f7a';
--   UPDATE public.clients SET
--     firm_id = '1a857761-e116-4cb8-9b8e-5777bb4f125a',
--     firm_link_accepted_by = 'ed48b936-2287-4b4c-9e0a-cba9bc7c23f4',
--     active = true
--     WHERE id = '353f1dbf-a7ba-4092-878d-792223ba3536';
--   UPDATE public.client_groups SET firm_id = '1a857761-e116-4cb8-9b8e-5777bb4f125a'
--     WHERE id = 'd0a1132e-b187-48b5-b3b4-9c991c70782e';

DO $$
DECLARE
  v_ben_firm uuid := 'e8f7a440-a541-422c-8e4f-82ba33dd0604';
  v_ben_owner uuid := 'd55084b0-43fe-417b-970b-37f22cee84f3';
  v_throwaway_firm uuid := '1a857761-e116-4cb8-9b8e-5777bb4f125a';
  v_restore_client uuid := '353f1dbf-a7ba-4092-878d-792223ba3536';
  v_swap_client uuid := '3cc31b6a-10a6-4202-bec7-ebb32a4e1f7a';
  v_restore_group uuid := 'd0a1132e-b187-48b5-b3b4-9c991c70782e';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.firms WHERE id = v_ben_firm AND name = 'Ben Accountants'
  ) THEN
    RAISE EXCEPTION 'restore_ben_hvazv4: Ben Accountants firm missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.clients c
    WHERE c.id = v_restore_client
      AND c.client_code = 'MLN-HVAZV4'
      AND c.firm_id = v_ben_firm
      AND c.active IS DISTINCT FROM false
  ) THEN
    RAISE NOTICE 'restore_ben_hvazv4: MLN-HVAZV4 already active on Ben; no-op';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.clients c
    WHERE c.id = v_restore_client
      AND c.client_code = 'MLN-HVAZV4'
      AND c.firm_id = v_throwaway_firm
  ) THEN
    RAISE EXCEPTION 'restore_ben_hvazv4: MLN-HVAZV4 not on AQA Throwaway 1020E';
  END IF;

  UPDATE public.clients
  SET active = false
  WHERE id = v_swap_client
    AND firm_id = v_ben_firm
    AND client_code = 'MLN-T8UEXM';

  UPDATE public.clients
  SET
    firm_id = v_ben_firm,
    firm_link_accepted_by = v_ben_owner,
    active = true
  WHERE id = v_restore_client
    AND client_code = 'MLN-HVAZV4';

  UPDATE public.client_groups
  SET firm_id = v_ben_firm
  WHERE id = v_restore_group;
END;
$$;
