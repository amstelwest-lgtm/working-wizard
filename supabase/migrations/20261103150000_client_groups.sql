-- Multi-company groups (parent plan P0).
--
-- Apply on a Supabase branch first. Theo/CoS run this file there, check the
-- branch, then apply it on production. CI does not apply it to hosted
-- Supabase. Rollback is the commented block at the bottom of this file.
--
-- clients stays the company table. client_id stays the data key on ledgers,
-- agents, and documents. A company has one group_id, so it cannot sit in two
-- groups. Every existing client is backfilled as a group of one. Group chrome
-- stays hidden while a group has one company.
--
-- Included companies: 3, excluding Individual. A placeholder counts only after
-- books are connected or data is uploaded. This file does not change Stripe.
--
-- Edge functions that take a client id stay per company (agents included).
-- None of them load "the" client for a login with owner_user_id … limit 1.
-- Signup still creates the first self-serve company only; further companies
-- are added inside the group.

-- ── Group tables ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.client_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid REFERENCES public.firms(id) ON DELETE SET NULL,
  name text NOT NULL,
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.client_groups IS
  'Billing and navigation group. One owner login. Not a consolidation entity.';

CREATE TABLE IF NOT EXISTS public.client_group_members (
  group_id uuid NOT NULL REFERENCES public.client_groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

COMMENT ON TABLE public.client_group_members IS
  'Owner login for the group. Per-company seats stay on client_memberships (P1).';

CREATE INDEX IF NOT EXISTS client_group_members_user_idx
  ON public.client_group_members (user_id);

-- Grants we inserted because of a group. Revoked when the company leaves.
CREATE TABLE IF NOT EXISTS public.client_group_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.client_groups(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, user_id, group_id)
);

CREATE INDEX IF NOT EXISTS client_group_grants_client_idx
  ON public.client_group_grants (client_id);

CREATE TABLE IF NOT EXISTS public.client_group_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid REFERENCES public.client_groups(id) ON DELETE SET NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_group_audit_group_idx
  ON public.client_group_audit (group_id, created_at DESC);

COMMENT ON TABLE public.client_group_audit IS
  'Membership and company moves. Who gained or lost access is in detail.';

CREATE TABLE IF NOT EXISTS public.ownership_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.client_groups(id) ON DELETE CASCADE,
  holder_client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  held_client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  ownership_pct numeric(6,2) CHECK (ownership_pct IS NULL OR (ownership_pct >= 0 AND ownership_pct <= 100)),
  effective_from date,
  effective_to date,
  classification text NOT NULL DEFAULT 'subsidiary'
    CHECK (classification IN ('subsidiary', 'associate', 'joint_venture', 'other')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (holder_client_id <> held_client_id),
  CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS ownership_edges_group_idx
  ON public.ownership_edges (group_id);

CREATE INDEX IF NOT EXISTS ownership_edges_held_idx
  ON public.ownership_edges (held_client_id);

COMMENT ON TABLE public.ownership_edges IS
  'Holder to held company for a later reporting group. No consolidation math.';

-- ── Company columns (clients is the company table) ──────────────────────────

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES public.client_groups(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS entity_type text NOT NULL DEFAULT 'company',
  ADD COLUMN IF NOT EXISTS year_end_month smallint,
  ADD COLUMN IF NOT EXISTS currency text,
  ADD COLUMN IF NOT EXISTS registration_number text,
  ADD COLUMN IF NOT EXISTS tax_number text,
  ADD COLUMN IF NOT EXISTS vat_number text,
  ADD COLUMN IF NOT EXISTS person_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS placeholder boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS books_connected_at timestamptz,
  ADD COLUMN IF NOT EXISTS data_uploaded_at timestamptz;

ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_entity_type_check;
ALTER TABLE public.clients
  ADD CONSTRAINT clients_entity_type_check
  CHECK (entity_type IN ('company', 'cc', 'trust', 'sole_prop', 'individual', 'partnership'));

ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_year_end_month_check;
ALTER TABLE public.clients
  ADD CONSTRAINT clients_year_end_month_check
  CHECK (year_end_month IS NULL OR year_end_month BETWEEN 1 AND 12);

COMMENT ON COLUMN public.clients.group_id IS
  'The one group this company belongs to. Null only before the backfill trigger runs.';
COMMENT ON COLUMN public.clients.entity_type IS
  'company, cc, trust, sole_prop, individual, or partnership. Individual is the owner ITR12 seat.';
COMMENT ON COLUMN public.clients.person_user_id IS
  'The person an Individual entity belongs to. Firm access stays on the existing client path.';
COMMENT ON COLUMN public.clients.placeholder IS
  'True until books are connected or data is uploaded. Does not count toward the included 3.';

CREATE INDEX IF NOT EXISTS clients_group_id_idx
  ON public.clients (group_id);

-- ── Backfill: every current client is a group of one ────────────────────────

DO $$
DECLARE
  r record;
  gid uuid;
BEGIN
  FOR r IN
    SELECT id, name, firm_id, owner_user_id
    FROM public.clients
    WHERE group_id IS NULL
  LOOP
    INSERT INTO public.client_groups (firm_id, name, owner_user_id)
    VALUES (
      r.firm_id,
      COALESCE(NULLIF(btrim(r.name), ''), 'Company'),
      CASE WHEN r.firm_id IS NULL THEN r.owner_user_id ELSE NULL END
    )
    RETURNING id INTO gid;

    UPDATE public.clients SET group_id = gid WHERE id = r.id;

    IF r.firm_id IS NULL AND r.owner_user_id IS NOT NULL THEN
      INSERT INTO public.client_group_members (group_id, user_id, role)
      VALUES (gid, r.owner_user_id, 'owner')
      ON CONFLICT (group_id, user_id) DO NOTHING;
    END IF;
  END LOOP;

  INSERT INTO public.client_group_members (group_id, user_id, role)
  SELECT c.group_id, m.user_id, 'owner'
  FROM public.client_memberships m
  JOIN public.clients c ON c.id = m.client_id
  WHERE m.role = 'client_owner'
    AND c.group_id IS NOT NULL
  ON CONFLICT (group_id, user_id) DO NOTHING;
END $$;

-- New companies without a group become a group of one.
CREATE OR REPLACE FUNCTION public.trg_clients_ensure_group()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  gid uuid;
BEGIN
  IF NEW.group_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.client_groups (firm_id, name, owner_user_id)
  VALUES (
    NEW.firm_id,
    COALESCE(NULLIF(btrim(NEW.name), ''), 'Company'),
    CASE WHEN NEW.firm_id IS NULL THEN NEW.owner_user_id ELSE NULL END
  )
  RETURNING id INTO gid;

  NEW.group_id := gid;

  IF NEW.firm_id IS NULL AND NEW.owner_user_id IS NOT NULL THEN
    INSERT INTO public.client_group_members (group_id, user_id, role)
    VALUES (gid, NEW.owner_user_id, 'owner')
    ON CONFLICT (group_id, user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clients_ensure_group ON public.clients;
CREATE TRIGGER clients_ensure_group
  BEFORE INSERT ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_clients_ensure_group();

ALTER TABLE public.clients
  ALTER COLUMN group_id SET NOT NULL;

-- An invited client_owner joins the company's group (one login, all companies).
CREATE OR REPLACE FUNCTION public.trg_client_owner_joins_group()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM 'client_owner' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.client_group_members (group_id, user_id, role)
  SELECT c.group_id, NEW.user_id, 'owner'
  FROM public.clients c
  WHERE c.id = NEW.client_id
    AND c.group_id IS NOT NULL
  ON CONFLICT (group_id, user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS client_owner_joins_group ON public.client_memberships;
CREATE TRIGGER client_owner_joins_group
  AFTER INSERT OR UPDATE OF role, client_id, user_id ON public.client_memberships
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_client_owner_joins_group();

-- Stubs so this file still creates on a database that has not replayed the
-- whole history. Hosted Supabase already has the real functions; do not replace
-- them.
DO $stub$
BEGIN
  IF to_regprocedure('public.is_milon_it_member(uuid)') IS NULL THEN
    EXECUTE $fn$
      CREATE FUNCTION public.is_milon_it_member(_user_id uuid)
      RETURNS boolean
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = public
      AS $body$ SELECT false $body$
    $fn$;
  END IF;
  IF to_regprocedure('public.has_active_practice_assignment(uuid, uuid)') IS NULL THEN
    EXECUTE $fn$
      CREATE FUNCTION public.has_active_practice_assignment(_user_id uuid, _client_id uuid)
      RETURNS boolean
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = public
      AS $body$ SELECT false $body$
    $fn$;
  END IF;
  IF to_regprocedure('public.is_client_writer(uuid, uuid)') IS NULL THEN
    EXECUTE $fn$
      CREATE FUNCTION public.is_client_writer(_user_id uuid, _client_id uuid)
      RETURNS boolean
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = public
      AS $body$
        SELECT EXISTS (
          SELECT 1 FROM public.clients c
          WHERE c.id = _client_id AND c.owner_user_id = _user_id
        )
      $body$
    $fn$;
  END IF;
  IF to_regprocedure('public.is_firm_member(uuid, uuid)') IS NULL THEN
    EXECUTE $fn$
      CREATE FUNCTION public.is_firm_member(_user_id uuid, _firm_id uuid)
      RETURNS boolean
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = public
      AS $body$
        SELECT EXISTS (
          SELECT 1 FROM public.firm_memberships
          WHERE user_id = _user_id AND firm_id = _firm_id
        ) OR EXISTS (
          SELECT 1 FROM public.firms
          WHERE id = _firm_id AND owner_user_id = _user_id
        )
      $body$
    $fn$;
  END IF;
END
$stub$;

-- ── Access ───────────────────────────────────────────────────────────────────
-- Direct rules stay the team-amendment body (assignment, owner_user_id,
-- membership, Milōn IT). Group owners additionally see every non-individual
-- company in the group. An Individual is visible only through the direct path
-- (the firm file) or to that person.

CREATE OR REPLACE FUNCTION public.has_direct_client_access(_user_id uuid, _client_id uuid)
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
      FROM public.clients c
      WHERE c.id = _client_id
        AND (
          c.owner_user_id = _user_id
          OR EXISTS (
            SELECT 1
            FROM public.client_memberships m
            WHERE m.client_id = c.id
              AND m.user_id = _user_id
          )
          OR public.has_active_practice_assignment(_user_id, c.id)
        )
    );
$$;

CREATE OR REPLACE FUNCTION public.can_access_company(_user_id uuid, _company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_direct_client_access(_user_id, _company_id)
    OR EXISTS (
      SELECT 1
      FROM public.clients company
      JOIN public.client_group_members member
        ON member.group_id = company.group_id
       AND member.user_id = _user_id
       AND member.role = 'owner'
      WHERE company.id = _company_id
        AND (
          company.entity_type IS DISTINCT FROM 'individual'
          OR company.person_user_id = _user_id
          OR EXISTS (
            SELECT 1
            FROM public.client_memberships m
            WHERE m.client_id = company.id
              AND m.user_id = _user_id
          )
        )
    );
$$;

CREATE OR REPLACE FUNCTION public.can_access_company(_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_access_company(auth.uid(), _company_id);
$$;

CREATE OR REPLACE FUNCTION public.has_client_access(_user_id uuid, _client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_access_company(_user_id, _client_id);
$$;

COMMENT ON FUNCTION public.can_access_company(uuid, uuid) IS
  'Company access: direct client access, or group owner, with Individual limited to the firm path and that person.';
COMMENT ON FUNCTION public.can_access_company(uuid) IS
  'can_access_company(company_id) for the signed-in user.';

GRANT EXECUTE ON FUNCTION public.has_direct_client_access(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_company(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_company(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_client_access(uuid, uuid) TO authenticated, anon, service_role;
REVOKE ALL ON FUNCTION public.has_direct_client_access(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.can_access_company(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.can_access_company(uuid) FROM anon;

-- Included-company count. Individual never counts. Placeholder counts once
-- connected or once data has been uploaded. No Stripe write.
CREATE OR REPLACE FUNCTION public.company_counts_toward_group_slot(
  p_entity_type text,
  p_placeholder boolean,
  p_books_connected_at timestamptz,
  p_data_uploaded_at timestamptz
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_entity_type IS DISTINCT FROM 'individual'
    AND (
      COALESCE(p_placeholder, false) = false
      OR p_books_connected_at IS NOT NULL
      OR p_data_uploaded_at IS NOT NULL
    );
$$;

CREATE OR REPLACE FUNCTION public.group_billable_company_count(_group_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::integer
  FROM public.clients c
  WHERE c.group_id = _group_id
    AND public.company_counts_toward_group_slot(
      c.entity_type,
      c.placeholder,
      c.books_connected_at,
      c.data_uploaded_at
    );
$$;

GRANT EXECUTE ON FUNCTION public.company_counts_toward_group_slot(text, boolean, timestamptz, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.group_billable_company_count(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_manage_group(_user_id uuid, _group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.client_groups g
    WHERE g.id = _group_id
      AND (
        (g.firm_id IS NOT NULL AND public.is_firm_member(_user_id, g.firm_id))
        OR g.owner_user_id = _user_id
        OR EXISTS (
          SELECT 1
          FROM public.client_group_members m
          WHERE m.group_id = g.id
            AND m.user_id = _user_id
            AND m.role = 'owner'
        )
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.can_manage_group(uuid, uuid) TO authenticated, service_role;

-- Columns the owner-only trigger already uses on production. Present here so the
-- replaced function body is valid on a branch database that has not replayed
-- every earlier file.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS firm_link_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS firm_link_accepted_by uuid,
  ADD COLUMN IF NOT EXISTS firm_connected_at timestamptz,
  ADD COLUMN IF NOT EXISTS brain_summary jsonb,
  ADD COLUMN IF NOT EXISTS brain_summary_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

-- Lets group RPCs change company columns the owner-only trigger would block.
CREATE OR REPLACE FUNCTION public.clients_guard_owner_only_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Firm-link stamping stays first so a group insert still records acceptance.
  IF coalesce(current_setting('milon.firm_link', true), '') = 'accept' THEN
    IF NEW.firm_id IS NULL THEN
      NEW.firm_link_accepted_at := NULL;
      NEW.firm_link_accepted_by := NULL;
    ELSIF NEW.firm_link_accepted_at IS NULL THEN
      NEW.firm_link_accepted_at := now();
      IF NEW.firm_link_accepted_by IS NULL THEN
        NEW.firm_link_accepted_by := auth.uid();
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF coalesce(current_setting('milon.group_write', true), '') = 'accept' THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL THEN
    IF NEW.firm_id IS NULL THEN
      NEW.firm_link_accepted_at := NULL;
      NEW.firm_link_accepted_by := NULL;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.firm_id IS NOT NULL
       OR NEW.firm_link_accepted_at IS NOT NULL
       OR NEW.firm_link_accepted_by IS NOT NULL THEN
      RAISE EXCEPTION 'clients.firm_id cannot be set by the owner';
    END IF;
    RETURN NEW;
  END IF;

  IF auth.uid() = OLD.owner_user_id THEN
    IF NEW.firm_id IS NULL AND OLD.firm_id IS NOT NULL THEN
      NEW.firm_link_accepted_at := NULL;
      NEW.firm_link_accepted_by := NULL;
      NEW.firm_connected_at := NULL;
      RETURN NEW;
    END IF;
    IF NEW.firm_id IS DISTINCT FROM OLD.firm_id
       OR NEW.firm_link_accepted_at IS DISTINCT FROM OLD.firm_link_accepted_at
       OR NEW.firm_link_accepted_by IS DISTINCT FROM OLD.firm_link_accepted_by THEN
      RAISE EXCEPTION 'clients.firm_id cannot be set by the owner';
    END IF;
  END IF;

  IF public.has_client_access(auth.uid(), OLD.id)
     AND NOT public.is_client_writer(auth.uid(), OLD.id) THEN
    IF (to_jsonb(NEW) - 'brain_summary' - 'brain_summary_updated_at')
       IS DISTINCT FROM
       (to_jsonb(OLD) - 'brain_summary' - 'brain_summary_updated_at') THEN
      RAISE EXCEPTION 'clients update for non-writers is limited to brain_summary';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'clients.id is immutable';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'clients.created_at is owner-only';
  END IF;
  IF NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id THEN
    RAISE EXCEPTION 'clients.owner_user_id is owner-only';
  END IF;
  IF NEW.firm_id IS DISTINCT FROM OLD.firm_id THEN
    RAISE EXCEPTION 'clients.firm_id is owner-only';
  END IF;
  IF NEW.firm_link_accepted_at IS DISTINCT FROM OLD.firm_link_accepted_at
     OR NEW.firm_link_accepted_by IS DISTINCT FROM OLD.firm_link_accepted_by THEN
    RAISE EXCEPTION 'clients.firm_link_accepted_at is server-only';
  END IF;
  IF NEW.last_login_at IS DISTINCT FROM OLD.last_login_at THEN
    RAISE EXCEPTION 'clients.last_login_at is owner-only';
  END IF;

  RETURN NEW;
END;
$$;

-- ── Move / add / split ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.preview_company_group_change(
  p_company_id uuid,
  p_group_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_company public.clients%ROWTYPE;
  v_dest public.client_groups%ROWTYPE;
  v_gains jsonb;
  v_losses jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.can_manage_group(v_uid, p_group_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.clients c
       WHERE c.id = p_company_id
         AND public.can_manage_group(v_uid, c.group_id)
     ) THEN
    RAISE EXCEPTION 'Not allowed to change this group';
  END IF;

  SELECT * INTO v_company FROM public.clients WHERE id = p_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company not found';
  END IF;
  SELECT * INTO v_dest FROM public.client_groups WHERE id = p_group_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Group not found';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'userId', m.user_id,
    'reason', 'group owner'
  )), '[]'::jsonb)
  INTO v_gains
  FROM public.client_group_members m
  WHERE m.group_id = p_group_id
    AND m.role = 'owner'
    AND NOT EXISTS (
      SELECT 1 FROM public.client_group_members oldm
      WHERE oldm.group_id = v_company.group_id
        AND oldm.user_id = m.user_id
    )
    AND (
      v_company.entity_type IS DISTINCT FROM 'individual'
      OR v_company.person_user_id = m.user_id
    );

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'userId', m.user_id,
    'reason', 'left previous group'
  )), '[]'::jsonb)
  INTO v_losses
  FROM public.client_group_members m
  WHERE m.group_id = v_company.group_id
    AND m.role = 'owner'
    AND m.user_id IS DISTINCT FROM v_company.person_user_id
    AND NOT EXISTS (
      SELECT 1 FROM public.client_group_members keep
      WHERE keep.group_id = p_group_id
        AND keep.user_id = m.user_id
    );

  RETURN jsonb_build_object(
    'companyId', v_company.id,
    'companyName', v_company.name,
    'entityType', v_company.entity_type,
    'fromGroupId', v_company.group_id,
    'toGroupId', p_group_id,
    'gains', v_gains,
    'losses', v_losses,
    'firmKeepsAccess', v_company.firm_id IS NOT NULL OR v_company.owner_user_id IS NOT NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_company_group_change(
  p_company_id uuid,
  p_group_id uuid,
  p_confirm boolean,
  p_action text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_company public.clients%ROWTYPE;
  v_dest public.client_groups%ROWTYPE;
  v_preview jsonb;
  v_old_group uuid;
  v_loss record;
  v_gain record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_confirm IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Confirm who gains access before changing the group';
  END IF;
  IF p_action NOT IN ('move', 'split', 'add') THEN
    RAISE EXCEPTION 'Unknown group action';
  END IF;

  SELECT * INTO v_company FROM public.clients WHERE id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company not found';
  END IF;
  IF NOT public.can_manage_group(v_uid, v_company.group_id)
     AND NOT public.can_manage_group(v_uid, p_group_id) THEN
    RAISE EXCEPTION 'Not allowed to change this group';
  END IF;

  SELECT * INTO v_dest FROM public.client_groups WHERE id = p_group_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Group not found';
  END IF;
  IF v_dest.firm_id IS DISTINCT FROM v_company.firm_id THEN
    RAISE EXCEPTION 'A company cannot join a group in another firm';
  END IF;

  v_old_group := v_company.group_id;
  v_preview := public.preview_company_group_change(p_company_id, p_group_id);

  IF v_old_group IS NOT DISTINCT FROM p_group_id THEN
    RETURN v_preview || jsonb_build_object('changed', false);
  END IF;

  PERFORM set_config('milon.group_write', 'accept', true);
  UPDATE public.clients SET group_id = p_group_id WHERE id = p_company_id;

  FOR v_loss IN
    SELECT m.user_id
    FROM public.client_group_members m
    WHERE m.group_id = v_old_group
      AND m.user_id IS DISTINCT FROM v_company.person_user_id
      AND NOT EXISTS (
        SELECT 1 FROM public.client_group_members keep
        WHERE keep.group_id = p_group_id
          AND keep.user_id = m.user_id
      )
  LOOP
    DELETE FROM public.client_memberships
    WHERE client_id = p_company_id
      AND user_id = v_loss.user_id;
    DELETE FROM public.client_group_grants
    WHERE client_id = p_company_id
      AND group_id = v_old_group
      AND user_id = v_loss.user_id;
    INSERT INTO public.client_group_audit (group_id, client_id, actor_user_id, action, detail)
    VALUES (
      v_old_group,
      p_company_id,
      v_uid,
      'access_revoked',
      jsonb_build_object('userId', v_loss.user_id, 'reason', 'left previous group')
    );
  END LOOP;

  FOR v_gain IN
    SELECT m.user_id
    FROM public.client_group_members m
    WHERE m.group_id = p_group_id
      AND m.role = 'owner'
      AND (
        v_company.entity_type IS DISTINCT FROM 'individual'
        OR v_company.person_user_id = m.user_id
      )
  LOOP
    INSERT INTO public.client_memberships (client_id, user_id, role)
    SELECT p_company_id, v_gain.user_id, 'client_owner'
    WHERE NOT EXISTS (
      SELECT 1 FROM public.client_memberships existing
      WHERE existing.client_id = p_company_id
        AND existing.user_id = v_gain.user_id
    );
    INSERT INTO public.client_group_grants (group_id, client_id, user_id)
    VALUES (p_group_id, p_company_id, v_gain.user_id)
    ON CONFLICT (client_id, user_id, group_id) DO NOTHING;
    INSERT INTO public.client_group_audit (group_id, client_id, actor_user_id, action, detail)
    VALUES (
      p_group_id,
      p_company_id,
      v_uid,
      'access_granted',
      jsonb_build_object('userId', v_gain.user_id, 'reason', 'group owner')
    );
  END LOOP;

  INSERT INTO public.client_group_audit (group_id, client_id, actor_user_id, action, detail)
  VALUES (
    p_group_id,
    p_company_id,
    v_uid,
    CASE p_action
      WHEN 'split' THEN 'company_split'
      WHEN 'add' THEN 'company_added'
      ELSE 'company_moved'
    END,
    v_preview || jsonb_build_object('confirmed', true)
  );

  IF v_old_group IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.clients c WHERE c.group_id = v_old_group
  ) THEN
    DELETE FROM public.client_groups WHERE id = v_old_group;
  END IF;

  RETURN v_preview || jsonb_build_object('changed', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.move_company_to_group(
  p_company_id uuid,
  p_group_id uuid,
  p_confirm boolean
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.apply_company_group_change(p_company_id, p_group_id, p_confirm, 'move');
$$;

CREATE OR REPLACE FUNCTION public.split_company_from_group(
  p_company_id uuid,
  p_confirm boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_company public.clients%ROWTYPE;
  v_new uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_confirm IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Confirm who gains access before changing the group';
  END IF;

  SELECT * INTO v_company FROM public.clients WHERE id = p_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company not found';
  END IF;
  IF NOT public.can_manage_group(v_uid, v_company.group_id) THEN
    RAISE EXCEPTION 'Not allowed to change this group';
  END IF;

  INSERT INTO public.client_groups (firm_id, name, owner_user_id)
  VALUES (v_company.firm_id, v_company.name, NULL)
  RETURNING id INTO v_new;

  RETURN public.apply_company_group_change(p_company_id, v_new, true, 'split');
END;
$$;

CREATE OR REPLACE FUNCTION public.add_company_to_group(
  p_group_id uuid,
  p_name text,
  p_entity_type text,
  p_person_user_id uuid,
  p_confirm boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_group public.client_groups%ROWTYPE;
  v_id uuid;
  v_type text := COALESCE(NULLIF(btrim(p_entity_type), ''), 'company');
  v_code text := NULL;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_confirm IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Confirm who gains access before changing the group';
  END IF;
  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN
    RAISE EXCEPTION 'Company name is required';
  END IF;
  IF v_type NOT IN ('company', 'cc', 'trust', 'sole_prop', 'individual', 'partnership') THEN
    RAISE EXCEPTION 'Unknown entity type';
  END IF;
  IF v_type = 'individual' AND p_person_user_id IS NULL THEN
    RAISE EXCEPTION 'An Individual entity needs the person it belongs to';
  END IF;

  SELECT * INTO v_group FROM public.client_groups WHERE id = p_group_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Group not found';
  END IF;
  IF NOT public.can_manage_group(v_uid, p_group_id) THEN
    RAISE EXCEPTION 'Not allowed to change this group';
  END IF;

  IF to_regprocedure('public.generate_client_code()') IS NOT NULL THEN
    v_code := public.generate_client_code();
  END IF;

  PERFORM set_config('milon.firm_link', 'accept', true);
  PERFORM set_config('milon.group_write', 'accept', true);

  -- Omit group_id so the ensure-group trigger opens a group of one. The move
  -- below then grants the destination owners and drops the empty group.
  INSERT INTO public.clients (
    name,
    owner_user_id,
    firm_id,
    entity_type,
    person_user_id,
    placeholder
  )
  VALUES (
    btrim(p_name),
    v_uid,
    v_group.firm_id,
    v_type,
    CASE WHEN v_type = 'individual' THEN p_person_user_id ELSE NULL END,
    true
  )
  RETURNING id INTO v_id;

  IF v_code IS NOT NULL THEN
    BEGIN
      UPDATE public.clients SET client_code = v_code WHERE id = v_id;
    EXCEPTION
      WHEN undefined_column THEN
        NULL;
    END;
  END IF;

  -- The Individual's person is the owner login for this group.
  IF v_type = 'individual' AND p_person_user_id IS NOT NULL THEN
    INSERT INTO public.client_group_members (group_id, user_id, role)
    VALUES (p_group_id, p_person_user_id, 'owner')
    ON CONFLICT (group_id, user_id) DO NOTHING;
  END IF;

  RETURN public.apply_company_group_change(v_id, p_group_id, true, 'add')
    || jsonb_build_object('companyId', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_company_entity(
  p_company_id uuid,
  p_entity_type text,
  p_year_end_month smallint,
  p_currency text,
  p_registration_number text,
  p_tax_number text,
  p_vat_number text,
  p_person_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_type text := NULLIF(btrim(p_entity_type), '');
  v_company public.clients%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  SELECT * INTO v_company FROM public.clients WHERE id = p_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company not found';
  END IF;
  IF NOT public.can_manage_group(v_uid, v_company.group_id)
     AND NOT public.has_direct_client_access(v_uid, p_company_id) THEN
    RAISE EXCEPTION 'Not allowed to edit this company';
  END IF;
  IF v_type IS NOT NULL
     AND v_type NOT IN ('company', 'cc', 'trust', 'sole_prop', 'individual', 'partnership') THEN
    RAISE EXCEPTION 'Unknown entity type';
  END IF;
  IF p_year_end_month IS NOT NULL AND (p_year_end_month < 1 OR p_year_end_month > 12) THEN
    RAISE EXCEPTION 'Year-end month must be 1–12';
  END IF;
  IF coalesce(v_type, v_company.entity_type) = 'individual'
     AND p_person_user_id IS NULL
     AND v_company.person_user_id IS NULL THEN
    RAISE EXCEPTION 'An Individual entity needs the person it belongs to';
  END IF;

  PERFORM set_config('milon.group_write', 'accept', true);
  UPDATE public.clients
  SET
    entity_type = COALESCE(v_type, entity_type),
    year_end_month = p_year_end_month,
    currency = NULLIF(btrim(p_currency), ''),
    registration_number = NULLIF(btrim(p_registration_number), ''),
    tax_number = NULLIF(btrim(p_tax_number), ''),
    vat_number = NULLIF(btrim(p_vat_number), ''),
    person_user_id = CASE
      WHEN COALESCE(v_type, entity_type) = 'individual' THEN COALESCE(p_person_user_id, person_user_id)
      ELSE NULL
    END
  WHERE id = p_company_id;

  BEGIN
    UPDATE public.clients
    SET financial_year_start_month = CASE
      WHEN p_year_end_month IS NULL THEN financial_year_start_month
      ELSE (p_year_end_month % 12) + 1
    END
    WHERE id = p_company_id;
  EXCEPTION
    WHEN undefined_column THEN
      NULL;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_ownership_edge(
  p_group_id uuid,
  p_holder_client_id uuid,
  p_held_client_id uuid,
  p_ownership_pct numeric,
  p_effective_from date,
  p_effective_to date,
  p_classification text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_class text := COALESCE(NULLIF(btrim(p_classification), ''), 'subsidiary');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.can_manage_group(v_uid, p_group_id) THEN
    RAISE EXCEPTION 'Not allowed to edit this group';
  END IF;
  IF p_holder_client_id = p_held_client_id THEN
    RAISE EXCEPTION 'A company cannot hold itself';
  END IF;
  IF v_class NOT IN ('subsidiary', 'associate', 'joint_venture', 'other') THEN
    RAISE EXCEPTION 'Unknown ownership classification';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = p_holder_client_id AND c.group_id = p_group_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = p_held_client_id AND c.group_id = p_group_id
  ) THEN
    RAISE EXCEPTION 'Both companies must be in this group';
  END IF;

  INSERT INTO public.ownership_edges (
    group_id,
    holder_client_id,
    held_client_id,
    ownership_pct,
    effective_from,
    effective_to,
    classification,
    created_by
  )
  VALUES (
    p_group_id,
    p_holder_client_id,
    p_held_client_id,
    p_ownership_pct,
    p_effective_from,
    p_effective_to,
    v_class,
    v_uid
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_ownership_edge(p_edge_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_group uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  SELECT group_id INTO v_group FROM public.ownership_edges WHERE id = p_edge_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF NOT public.can_manage_group(v_uid, v_group) THEN
    RAISE EXCEPTION 'Not allowed to edit this group';
  END IF;
  DELETE FROM public.ownership_edges WHERE id = p_edge_id;
END;
$$;

REVOKE ALL ON FUNCTION public.preview_company_group_change(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_company_group_change(uuid, uuid, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.move_company_to_group(uuid, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.split_company_from_group(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_company_to_group(uuid, text, text, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_company_entity(uuid, text, smallint, text, text, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_ownership_edge(uuid, uuid, uuid, numeric, date, date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_ownership_edge(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.preview_company_group_change(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.move_company_to_group(uuid, uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.split_company_from_group(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.add_company_to_group(uuid, text, text, uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_company_entity(uuid, text, smallint, text, text, text, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_ownership_edge(uuid, uuid, uuid, numeric, date, date, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_ownership_edge(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.preview_company_group_change(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.move_company_to_group(uuid, uuid, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.split_company_from_group(uuid, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.add_company_to_group(uuid, text, text, uuid, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.update_company_entity(uuid, text, smallint, text, text, text, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.upsert_ownership_edge(uuid, uuid, uuid, numeric, date, date, text) FROM anon;
REVOKE ALL ON FUNCTION public.delete_ownership_edge(uuid) FROM anon;

-- apply_company_group_change stays internal. move/add/split are the callers.
REVOKE ALL ON FUNCTION public.apply_company_group_change(uuid, uuid, boolean, text) FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.client_groups TO authenticated, service_role;
GRANT SELECT ON public.client_group_members TO authenticated, service_role;
GRANT SELECT ON public.client_group_audit TO authenticated, service_role;
GRANT SELECT ON public.ownership_edges TO authenticated, service_role;
GRANT ALL ON public.client_group_grants TO service_role;

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.client_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_group_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_group_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ownership_edges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS client_groups_read ON public.client_groups;
CREATE POLICY client_groups_read ON public.client_groups
  FOR SELECT TO authenticated
  USING (
    public.can_manage_group((SELECT auth.uid()), id)
    OR EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.group_id = client_groups.id
        AND public.can_access_company((SELECT auth.uid()), c.id)
    )
  );

DROP POLICY IF EXISTS client_group_members_read ON public.client_group_members;
CREATE POLICY client_group_members_read ON public.client_group_members
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR public.can_manage_group((SELECT auth.uid()), group_id)
  );

DROP POLICY IF EXISTS client_group_audit_read ON public.client_group_audit;
CREATE POLICY client_group_audit_read ON public.client_group_audit
  FOR SELECT TO authenticated
  USING (
    actor_user_id = (SELECT auth.uid())
    OR (group_id IS NOT NULL AND public.can_manage_group((SELECT auth.uid()), group_id))
    OR (client_id IS NOT NULL AND public.can_access_company((SELECT auth.uid()), client_id))
  );

DROP POLICY IF EXISTS ownership_edges_read ON public.ownership_edges;
CREATE POLICY ownership_edges_read ON public.ownership_edges
  FOR SELECT TO authenticated
  USING (
    public.can_access_company((SELECT auth.uid()), holder_client_id)
    OR public.can_access_company((SELECT auth.uid()), held_client_id)
    OR public.can_manage_group((SELECT auth.uid()), group_id)
  );

-- Writes go through the SECURITY DEFINER functions above.

-- ── ROLLBACK ─────────────────────────────────────────────────────────────────
-- Do not run this with the migration. On a branch, to reverse P0:
--
-- DROP TRIGGER IF EXISTS client_owner_joins_group ON public.client_memberships;
-- DROP TRIGGER IF EXISTS clients_ensure_group ON public.clients;
-- DROP FUNCTION IF EXISTS public.delete_ownership_edge(uuid);
-- DROP FUNCTION IF EXISTS public.upsert_ownership_edge(uuid, uuid, uuid, numeric, date, date, text);
-- DROP FUNCTION IF EXISTS public.update_company_entity(uuid, text, smallint, text, text, text, text, uuid);
-- DROP FUNCTION IF EXISTS public.add_company_to_group(uuid, text, text, uuid, boolean);
-- DROP FUNCTION IF EXISTS public.split_company_from_group(uuid, boolean);
-- DROP FUNCTION IF EXISTS public.move_company_to_group(uuid, uuid, boolean);
-- DROP FUNCTION IF EXISTS public.apply_company_group_change(uuid, uuid, boolean, text);
-- DROP FUNCTION IF EXISTS public.preview_company_group_change(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.can_manage_group(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.group_billable_company_count(uuid);
-- DROP FUNCTION IF EXISTS public.company_counts_toward_group_slot(text, boolean, timestamptz, timestamptz);
-- DROP FUNCTION IF EXISTS public.can_access_company(uuid);
-- DROP FUNCTION IF EXISTS public.can_access_company(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.has_direct_client_access(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.trg_client_owner_joins_group();
-- DROP FUNCTION IF EXISTS public.trg_clients_ensure_group();
-- -- Restore has_client_access to the 20260913120000 team-amendment body
-- -- (is_milon_it_member OR owner_user_id OR client_memberships OR
-- -- has_active_practice_assignment) before dropping columns.
-- ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_entity_type_check;
-- ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_year_end_month_check;
-- ALTER TABLE public.clients
--   DROP COLUMN IF EXISTS group_id,
--   DROP COLUMN IF EXISTS entity_type,
--   DROP COLUMN IF EXISTS year_end_month,
--   DROP COLUMN IF EXISTS currency,
--   DROP COLUMN IF EXISTS registration_number,
--   DROP COLUMN IF EXISTS tax_number,
--   DROP COLUMN IF EXISTS vat_number,
--   DROP COLUMN IF EXISTS person_user_id,
--   DROP COLUMN IF EXISTS placeholder,
--   DROP COLUMN IF EXISTS books_connected_at,
--   DROP COLUMN IF EXISTS data_uploaded_at;
-- DROP TABLE IF EXISTS public.ownership_edges;
-- DROP TABLE IF EXISTS public.client_group_audit;
-- DROP TABLE IF EXISTS public.client_group_grants;
-- DROP TABLE IF EXISTS public.client_group_members;
-- DROP TABLE IF EXISTS public.client_groups;
-- Restore public.clients_guard_owner_only_columns() from
-- 20261013150000_owner_firm_link_guard.sql (no milon.group_write branch).
