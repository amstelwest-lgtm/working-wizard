-- Brain P1: pending lesson candidates, pattern dedupe, ops-only milon_wide queue.
-- firm_id may be null for milon_wide rows queued for Theo.

ALTER TABLE public.milon_brain_rules
  DROP CONSTRAINT IF EXISTS milon_brain_rules_status_check;

ALTER TABLE public.milon_brain_rules
  ADD CONSTRAINT milon_brain_rules_status_check
    CHECK (status IN ('active', 'merged', 'retired', 'pending'));

ALTER TABLE public.milon_brain_rules
  ALTER COLUMN firm_id DROP NOT NULL;

ALTER TABLE public.milon_brain_rules
  DROP CONSTRAINT IF EXISTS milon_brain_rules_firm_layer_check;

ALTER TABLE public.milon_brain_rules
  ADD CONSTRAINT milon_brain_rules_firm_layer_check
    CHECK (
      (layer = 'private' AND firm_id IS NOT NULL)
      OR layer = 'milon_wide'
    );

ALTER TABLE public.milon_brain_rules
  ADD COLUMN IF NOT EXISTS pattern_key text;

CREATE UNIQUE INDEX IF NOT EXISTS milon_brain_rules_pending_pattern_key_idx
  ON public.milon_brain_rules (pattern_key)
  WHERE layer = 'milon_wide' AND status = 'pending' AND pattern_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.is_milon_ops(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_milon_it_member(_user_id)
    OR EXISTS (
      SELECT 1
      FROM auth.users u
      WHERE u.id = _user_id
        AND u.email_confirmed_at IS NOT NULL
        AND lower(u.email::text) = ANY (
          ARRAY[
            'amstel.west@gmail.com'
          ]::text[]
        )
    );
$$;

REVOKE ALL ON FUNCTION public.is_milon_ops(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_milon_ops(uuid) TO authenticated, service_role;

GRANT UPDATE ON TABLE public.milon_brain_rules TO authenticated;

DROP POLICY IF EXISTS milon_brain_rules_firm_insert ON public.milon_brain_rules;
CREATE POLICY milon_brain_rules_firm_insert ON public.milon_brain_rules FOR INSERT TO authenticated WITH CHECK (layer = 'private' AND status = 'active' AND firm_id IS NOT NULL AND pattern_key IS NULL AND (public.is_firm_member((SELECT auth.uid()), firm_id) OR EXISTS (SELECT 1 FROM public.firms f WHERE f.id = milon_brain_rules.firm_id AND f.owner_user_id = (SELECT auth.uid()))));

DROP POLICY IF EXISTS milon_brain_rules_firm_select ON public.milon_brain_rules;
CREATE POLICY milon_brain_rules_firm_select
  ON public.milon_brain_rules
  FOR SELECT
  TO authenticated
  USING (
    (
      layer = 'private'
      AND firm_id IS NOT NULL
      AND (
        public.is_firm_member((SELECT auth.uid()), firm_id)
        OR EXISTS (
          SELECT 1 FROM public.firms f
          WHERE f.id = milon_brain_rules.firm_id
            AND f.owner_user_id = (SELECT auth.uid())
        )
      )
    )
    OR (
      layer = 'milon_wide'
      AND status = 'pending'
      AND public.is_milon_ops((SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS milon_brain_rules_ops_update ON public.milon_brain_rules;
CREATE POLICY milon_brain_rules_ops_update
  ON public.milon_brain_rules
  FOR UPDATE
  TO authenticated
  USING (
    layer = 'milon_wide'
    AND public.is_milon_ops((SELECT auth.uid()))
  )
  WITH CHECK (
    layer = 'milon_wide'
    AND public.is_milon_ops((SELECT auth.uid()))
  );

COMMENT ON FUNCTION public.is_milon_ops IS
  'Milōn ops approvers (IT roster + owner allowlist). Brain P1 pending queue only.';
