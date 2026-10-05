-- Firm owners and partners get an active client_practice_access row on every
-- client of their firm. Nothing else inserted those rows when a firm created
-- or connected a client, so trg_deliverable_state_caps raised
-- 'No practice assignment on this client.' for the practice owner.
--
-- Staff, managers, reviewers, and bookkeepers still need an explicit
-- assignment. Revoked and declined rows are never rewritten.
-- RLS on client_practice_access stays deny-all. trg_deliverable_state_caps
-- is unchanged: the assignment function below is the belt-and-braces so a
-- missing row cannot block an owner or partner of the client's own firm,
-- while a revoked row still blocks them.

-- ── Who counts as a principal ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_practice_principal(_user_id UUID, _firm_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _user_id IS NOT NULL
    AND _firm_id IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.firms f
        WHERE f.id = _firm_id
          AND f.owner_user_id = _user_id
      )
      OR EXISTS (
        SELECT 1
        FROM public.firm_memberships fm
        WHERE fm.firm_id = _firm_id
          AND fm.user_id = _user_id
          AND (fm.role = 'owner' OR fm.classification = 'partner')
      )
    );
$$;

COMMENT ON FUNCTION public.is_practice_principal(UUID, UUID) IS
  'Firm owner (firms.owner_user_id or firm_memberships.role = owner) or a partner classification. Not staff.';

-- Active assignment, or an owner/partner of the client's firm when nobody has
-- revoked or declined them. A revoked row wins over the principal fallback so
-- removing a person still removes read access immediately.
CREATE OR REPLACE FUNCTION public.has_active_practice_assignment(_user_id UUID, _client_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.client_practice_access a
      WHERE a.user_id = _user_id
        AND a.client_id = _client_id
        AND a.status = 'active'
    )
    OR (
      NOT EXISTS (
        SELECT 1
        FROM public.client_practice_access a
        WHERE a.user_id = _user_id
          AND a.client_id = _client_id
          AND a.status IN ('revoked', 'declined')
      )
      AND EXISTS (
        SELECT 1
        FROM public.clients c
        WHERE c.id = _client_id
          AND c.firm_id IS NOT NULL
          AND public.is_practice_principal(_user_id, c.firm_id)
      )
    );
$$;

-- ── Mirror a practice person onto the Action Plan assignee list ─────────────
-- action_items.owner_id references client_employees. The picker reads that
-- table, so an owner with only a practice-access row never appeared.

ALTER TABLE public.client_employees
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS client_employees_client_user_idx
  ON public.client_employees (client_id, user_id)
  WHERE user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.ensure_client_practice_employee(
  _client_id UUID,
  _user_id UUID,
  _role TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_name TEXT;
  v_email TEXT;
BEGIN
  IF _client_id IS NULL OR _user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT
    COALESCE(
      NULLIF(btrim(p.full_name), ''),
      NULLIF(split_part(COALESCE(p.email, u.email, ''), '@', 1), ''),
      'Practice member'
    ),
    NULLIF(btrim(COALESCE(p.email, u.email, '')), '')
  INTO v_name, v_email
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE u.id = _user_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT e.id
    INTO v_id
  FROM public.client_employees e
  WHERE e.client_id = _client_id
    AND e.user_id = _user_id
  LIMIT 1;

  IF v_id IS NULL AND v_email IS NOT NULL THEN
    SELECT e.id
      INTO v_id
    FROM public.client_employees e
    WHERE e.client_id = _client_id
      AND e.user_id IS NULL
      AND lower(e.email) = lower(v_email)
    ORDER BY e.created_at
    LIMIT 1;

    IF v_id IS NOT NULL THEN
      UPDATE public.client_employees
      SET user_id = _user_id,
          active = true,
          role = COALESCE(NULLIF(btrim(_role), ''), role)
      WHERE id = v_id
        AND user_id IS NULL;
    END IF;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.client_employees (client_id, user_id, name, email, role, active)
    VALUES (_client_id, _user_id, v_name, v_email, NULLIF(btrim(_role), ''), true)
    ON CONFLICT (client_id, user_id) WHERE user_id IS NOT NULL DO NOTHING
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      SELECT e.id
        INTO v_id
      FROM public.client_employees e
      WHERE e.client_id = _client_id
        AND e.user_id = _user_id
      LIMIT 1;
    END IF;
  END IF;

  RETURN v_id;
END;
$$;

-- ── Grant active access to principals of one firm on one client ─────────────

CREATE OR REPLACE FUNCTION public.grant_practice_principal_access(_client_id UUID, _firm_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requested_by UUID;
  r RECORD;
BEGIN
  IF _client_id IS NULL OR _firm_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.clients c
    WHERE c.id = _client_id
      AND c.firm_id = _firm_id
  ) THEN
    RETURN;
  END IF;

  SELECT f.owner_user_id
    INTO v_requested_by
  FROM public.firms f
  WHERE f.id = _firm_id;

  -- New rows only. An existing row (active, pending, revoked, declined) is
  -- left untouched here so a revoke is never undone by a reconnect.
  INSERT INTO public.client_practice_access (
    client_id,
    user_id,
    firm_id,
    classification,
    status,
    requested_by,
    requested_at,
    accountant_approved_at,
    accountant_approved_by,
    owner_approved_at,
    owner_approved_by
  )
  SELECT
    _client_id,
    p.user_id,
    _firm_id,
    public.practice_class_at_most(
      public.team_practice_classification(p.user_id, _firm_id),
      'partner'
    ),
    'active',
    COALESCE(v_requested_by, p.user_id),
    now(),
    now(),
    COALESCE(v_requested_by, p.user_id),
    now(),
    COALESCE(v_requested_by, p.user_id)
  FROM (
    SELECT f.owner_user_id AS user_id
    FROM public.firms f
    WHERE f.id = _firm_id
      AND f.owner_user_id IS NOT NULL
    UNION
    SELECT fm.user_id
    FROM public.firm_memberships fm
    WHERE fm.firm_id = _firm_id
      AND fm.user_id IS NOT NULL
      AND (fm.role = 'owner' OR fm.classification = 'partner')
  ) p
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.client_practice_access a
    WHERE a.client_id = _client_id
      AND a.user_id = p.user_id
  );

  -- A principal who is stuck in pending can work. Revoked and declined stay.
  UPDATE public.client_practice_access a
  SET
    status = 'active',
    accountant_approved_at = COALESCE(a.accountant_approved_at, now()),
    accountant_approved_by = COALESCE(a.accountant_approved_by, COALESCE(v_requested_by, a.user_id)),
    owner_approved_at = COALESCE(a.owner_approved_at, now()),
    owner_approved_by = COALESCE(a.owner_approved_by, COALESCE(v_requested_by, a.user_id)),
    updated_at = now()
  WHERE a.client_id = _client_id
    AND a.firm_id = _firm_id
    AND a.status = 'pending'
    AND public.is_practice_principal(a.user_id, _firm_id);

  FOR r IN
    SELECT a.user_id, a.classification
    FROM public.client_practice_access a
    WHERE a.client_id = _client_id
      AND a.firm_id = _firm_id
      AND a.status = 'active'
      AND public.is_practice_principal(a.user_id, _firm_id)
  LOOP
    PERFORM public.ensure_client_practice_employee(_client_id, r.user_id, r.classification);
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.grant_practice_principal_access(UUID, UUID) IS
  'Idempotent active access for firm owners and partners. Does not insert a second row, does not revive revoked or declined rows, and does not grant staff.';

-- AFTER, not BEFORE: the client row must exist before the access FK insert.
-- clients_firm_connect stays the BEFORE stamp of firm_connected_at.
CREATE OR REPLACE FUNCTION public.trg_clients_grant_principal_access()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.firm_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.firm_id IS DISTINCT FROM NEW.firm_id) THEN
    PERFORM public.grant_practice_principal_access(NEW.id, NEW.firm_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clients_grant_principal_access ON public.clients;
CREATE TRIGGER clients_grant_principal_access
  AFTER INSERT OR UPDATE OF firm_id ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_clients_grant_principal_access();

CREATE OR REPLACE FUNCTION public.trg_firm_membership_grant_principal_access()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
BEGIN
  IF NOT public.is_practice_principal(NEW.user_id, NEW.firm_id) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND public.is_practice_principal(OLD.user_id, OLD.firm_id)
     AND OLD.firm_id IS NOT DISTINCT FROM NEW.firm_id
     AND OLD.role IS NOT DISTINCT FROM NEW.role
     AND OLD.classification IS NOT DISTINCT FROM NEW.classification THEN
    RETURN NEW;
  END IF;

  FOR r IN
    SELECT c.id
    FROM public.clients c
    WHERE c.firm_id = NEW.firm_id
  LOOP
    PERFORM public.grant_practice_principal_access(r.id, NEW.firm_id);
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS firm_membership_grant_principal_access ON public.firm_memberships;
CREATE TRIGGER firm_membership_grant_principal_access
  AFTER INSERT OR UPDATE OF role, classification, firm_id ON public.firm_memberships
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_firm_membership_grant_principal_access();

-- Action Plan team list. Caller must already have client access (owners and
-- partners do, including via the principal fallback above). Returns firm
-- members with active access, plus principals who have not been revoked, and
-- the client_employees id the owner picker can store on action_items.owner_id.
CREATE OR REPLACE FUNCTION public.list_client_practice_team(_client_id UUID)
RETURNS TABLE (
  id UUID,
  name TEXT,
  email TEXT,
  role TEXT,
  user_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_firm UUID;
  r RECORD;
  v_emp UUID;
BEGIN
  IF auth.uid() IS NULL OR _client_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT public.has_client_access(auth.uid(), _client_id) THEN
    RETURN;
  END IF;

  SELECT c.firm_id
    INTO v_firm
  FROM public.clients c
  WHERE c.id = _client_id;

  IF v_firm IS NULL THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT DISTINCT ON (s.user_id) s.user_id, s.classification
    FROM (
      SELECT a.user_id, a.classification, 0 AS ord
      FROM public.client_practice_access a
      WHERE a.client_id = _client_id
        AND a.firm_id = v_firm
        AND a.status = 'active'
        AND (
          EXISTS (
            SELECT 1
            FROM public.firm_memberships fm
            WHERE fm.firm_id = v_firm
              AND fm.user_id = a.user_id
          )
          OR EXISTS (
            SELECT 1
            FROM public.firms f
            WHERE f.id = v_firm
              AND f.owner_user_id = a.user_id
          )
        )
      UNION ALL
      SELECT
        p.user_id,
        public.practice_class_at_most(
          public.team_practice_classification(p.user_id, v_firm),
          'partner'
        ),
        1 AS ord
      FROM (
        SELECT f.owner_user_id AS user_id
        FROM public.firms f
        WHERE f.id = v_firm
          AND f.owner_user_id IS NOT NULL
        UNION
        SELECT fm.user_id
        FROM public.firm_memberships fm
        WHERE fm.firm_id = v_firm
          AND fm.user_id IS NOT NULL
          AND (fm.role = 'owner' OR fm.classification = 'partner')
      ) p
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.client_practice_access a
        WHERE a.client_id = _client_id
          AND a.user_id = p.user_id
          AND a.status IN ('revoked', 'declined')
      )
    ) s
    ORDER BY s.user_id, s.ord
  LOOP
    v_emp := public.ensure_client_practice_employee(_client_id, r.user_id, r.classification);
    IF v_emp IS NULL THEN
      CONTINUE;
    END IF;
    RETURN QUERY
      SELECT e.id, e.name, e.email, e.role, e.user_id
      FROM public.client_employees e
      WHERE e.id = v_emp;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.is_practice_principal(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_client_practice_employee(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grant_practice_principal_access(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_client_practice_team(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_practice_principal(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_client_practice_team(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.grant_practice_principal_access(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.ensure_client_practice_employee(UUID, UUID, TEXT) TO service_role;

-- ── Backfill existing firm clients ───────────────────────────────────────────
-- Idempotent. Counted on jxclnsbsqpixxqlbcapl on 2026-10-05, before this runs:
--   15 clients with firm_id, 4 already have an active row for firms.owner_user_id,
--   0 revoked / pending / declined, no partner membership besides those owners.
--   Missing pairs = 11, so this insert adds 11 client_practice_access rows.
--   Recount with:
--     SELECT count(*) FROM clients c
--     JOIN firms f ON f.id = c.firm_id
--     WHERE c.firm_id IS NOT NULL
--       AND f.owner_user_id IS NOT NULL
--       AND NOT EXISTS (
--         SELECT 1 FROM client_practice_access a
--         WHERE a.client_id = c.id AND a.user_id = f.owner_user_id
--       );
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.id, c.firm_id
    FROM public.clients c
    WHERE c.firm_id IS NOT NULL
  LOOP
    PERFORM public.grant_practice_principal_access(r.id, r.firm_id);
  END LOOP;
END;
$$;
