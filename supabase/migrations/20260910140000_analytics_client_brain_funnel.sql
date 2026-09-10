-- ============================================================================
-- Client Brain + accountant path — minimal funnel instrumentation
-- Run AFTER 20260907140000_client_brain.sql and analytics spine triggers.
--
-- Funnel (4 points):
--   1) accept        → owner.invite.redeemed / seat.accepted (existing triggers)
--   2) brain quality → brain.proposed (this migration)
--   3) propose yes   → brain.step.approved (this migration)
--   4) sign-off      → report.sent on advisory_deliveries INSERT (existing trigger)
-- ============================================================================

CREATE OR REPLACE FUNCTION analytics.trg_proposed_next_steps()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = analytics, public
AS $$
DECLARE
  v_firm uuid;
  v_actor uuid;
  v_assumption_count int;
BEGIN
  SELECT c.firm_id INTO v_firm FROM public.clients c WHERE c.id = NEW.client_id;

  IF TG_OP = 'INSERT' THEN
    v_actor := coalesce(NEW.created_by, auth.uid());
    v_assumption_count := coalesce(jsonb_array_length(NEW.assumptions), 0);
    PERFORM analytics.record(
      'brain.proposed', NEW.created_at, analytics.actor_kind_for(v_actor, NULL),
      v_actor, NULL, v_firm, NEW.client_id, NEW.id, 'brain_next_step', 'db_trigger',
      NULL, false, 'brain.proposed:' || NEW.id,
      jsonb_build_object(
        'has_rationale', coalesce(length(trim(coalesce(NEW.rationale, ''))), 0) > 0,
        'assumption_count', v_assumption_count
      )
    );
  ELSIF TG_OP = 'UPDATE'
    AND OLD.status = 'proposed'
    AND NEW.status IN ('approved', 'edited') THEN
    v_actor := coalesce(NEW.signed_off_by_id, auth.uid());
    PERFORM analytics.record(
      'brain.step.approved', coalesce(NEW.signed_off_at, NEW.updated_at, now()),
      analytics.actor_kind_for(v_actor, NULL), v_actor, NULL,
      v_firm, NEW.client_id, NEW.id, 'brain_next_step', 'db_trigger',
      NULL, false,
      'brain.step.approved:' || NEW.id || ':' || NEW.status,
      jsonb_build_object('outcome', NEW.status)
    );
  END IF;

  RETURN NEW;
END;
$$;

DO $$ BEGIN
  IF to_regclass('public.proposed_next_steps') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_analytics_proposed_next_steps ON public.proposed_next_steps;
    CREATE TRIGGER trg_analytics_proposed_next_steps
      AFTER INSERT OR UPDATE ON public.proposed_next_steps
      FOR EACH ROW EXECUTE FUNCTION analytics.trg_proposed_next_steps();
  END IF;
END $$;
