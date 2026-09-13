-- Team & Access amendment: classification capabilities, partner-only sign-off,
-- effective (min) level, firm-connection approval, audit log, deliverable states.
-- Practice writes still go through SECURITY DEFINER RPCs (tables stay deny-all).

-- ── Rank & capabilities ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.practice_class_rank(c TEXT)
RETURNS INT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE c
    WHEN 'partner' THEN 5
    WHEN 'manager' THEN 4
    WHEN 'reviewer' THEN 3
    WHEN 'staff' THEN 2
    WHEN 'bookkeeper' THEN 2
    WHEN 'read_only' THEN 1
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION public.practice_class_at_most(ceiling TEXT, wanted TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN public.practice_class_rank(wanted) <= public.practice_class_rank(ceiling)
      THEN wanted
    ELSE ceiling
  END;
$$;

-- Team-card classification (ceiling). Firm owner defaults to partner.
CREATE OR REPLACE FUNCTION public.team_practice_classification(_user_id UUID, _firm_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.firms f
      WHERE f.id = _firm_id AND f.owner_user_id = _user_id
    ) THEN COALESCE(
      NULLIF(
        (SELECT fm.classification FROM public.firm_memberships fm
          WHERE fm.firm_id = _firm_id AND fm.user_id = _user_id),
        'staff'
      ),
      'partner'
    )
    ELSE COALESCE(
      (SELECT fm.classification FROM public.firm_memberships fm
        WHERE fm.firm_id = _firm_id AND fm.user_id = _user_id),
      'staff'
    )
  END;
$$;

-- Effective permission = the lower of team ceiling and per-client class.
CREATE OR REPLACE FUNCTION public.effective_practice_classification(_user_id UUID, _client_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.practice_class_at_most(
    public.team_practice_classification(_user_id, c.firm_id),
    COALESCE(a.classification, public.team_practice_classification(_user_id, c.firm_id))
  )
  FROM public.clients c
  LEFT JOIN public.client_practice_access a
    ON a.client_id = c.id AND a.user_id = _user_id AND a.status = 'active'
  WHERE c.id = _client_id
    AND c.firm_id IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.practice_can(_class TEXT, _cap TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE _cap
    WHEN 'view' THEN _class IS NOT NULL AND _class <> ''
    WHEN 'edit' THEN _class IN ('partner', 'manager', 'staff', 'bookkeeper')
    WHEN 'submit' THEN _class IN ('partner', 'manager', 'staff', 'bookkeeper')
    WHEN 'review' THEN _class IN ('partner', 'manager', 'reviewer')
    WHEN 'sign_off' THEN _class = 'partner'
    ELSE FALSE
  END;
$$;

CREATE OR REPLACE FUNCTION public.can_sign_off_deliverable(_user_id UUID, _client_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.practice_can(
    public.effective_practice_classification(_user_id, _client_id),
    'sign_off'
  )
  AND public.has_active_practice_assignment(_user_id, _client_id);
$$;

GRANT EXECUTE ON FUNCTION public.practice_class_rank(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.practice_class_at_most(TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.team_practice_classification(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.effective_practice_classification(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.practice_can(TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_sign_off_deliverable(UUID, UUID) TO authenticated, service_role;

-- ── Read / write helpers ─────────────────────────────────────────────────────
-- Firm admin no longer sees every client file. Access is assignment-only.
-- Revoking an individual therefore immediately removes read access.

CREATE OR REPLACE FUNCTION public.has_client_access(_user_id UUID, _client_id UUID)
RETURNS BOOLEAN
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
            SELECT 1 FROM public.client_memberships m
            WHERE m.client_id = c.id AND m.user_id = _user_id
          )
          OR public.has_active_practice_assignment(_user_id, c.id)
        )
    );
$$;

CREATE OR REPLACE FUNCTION public.is_client_writer(_user_id UUID, _client_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = _client_id
      AND (
        c.owner_user_id = _user_id
        OR (
          public.has_active_practice_assignment(_user_id, c.id)
          AND public.practice_can(
            public.effective_practice_classification(_user_id, c.id),
            'edit'
          )
        )
      )
  );
$$;

-- ── Partner guards on firm_memberships ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.firm_has_partner(_firm_id UUID, _except_user UUID DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.firms f
    WHERE f.id = _firm_id
      AND f.owner_user_id IS NOT NULL
      AND (_except_user IS NULL OR f.owner_user_id IS DISTINCT FROM _except_user)
  )
  OR EXISTS (
    SELECT 1 FROM public.firm_memberships fm
    WHERE fm.firm_id = _firm_id
      AND fm.classification = 'partner'
      AND (_except_user IS NULL OR fm.user_id IS DISTINCT FROM _except_user)
  );
$$;

CREATE OR REPLACE FUNCTION public.actor_is_partner(_user_id UUID, _firm_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.team_practice_classification(_user_id, _firm_id) = 'partner';
$$;

CREATE OR REPLACE FUNCTION public.trg_firm_memberships_partner_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor UUID := auth.uid();
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.classification = 'partner'
       AND NOT public.firm_has_partner(OLD.firm_id, OLD.user_id) THEN
      RAISE EXCEPTION 'A practice must keep at least one partner.';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.classification = 'partner'
     AND (TG_OP = 'INSERT' OR OLD.classification IS DISTINCT FROM 'partner') THEN
    IF actor IS NOT NULL AND NOT public.actor_is_partner(actor, NEW.firm_id) THEN
      RAISE EXCEPTION 'Only a partner can assign partner status.';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.classification = 'partner'
     AND NEW.classification IS DISTINCT FROM 'partner'
     AND NOT public.firm_has_partner(NEW.firm_id, NEW.user_id) THEN
    RAISE EXCEPTION 'A practice must keep at least one partner.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS firm_memberships_partner_guard ON public.firm_memberships;
CREATE TRIGGER firm_memberships_partner_guard
  BEFORE INSERT OR UPDATE OF classification ON public.firm_memberships
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_firm_memberships_partner_guard();

DROP TRIGGER IF EXISTS firm_memberships_partner_guard_del ON public.firm_memberships;
CREATE TRIGGER firm_memberships_partner_guard_del
  BEFORE DELETE ON public.firm_memberships
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_firm_memberships_partner_guard();

-- Per-client class cannot exceed team ceiling.
CREATE OR REPLACE FUNCTION public.trg_practice_access_ceiling()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ceiling TEXT;
BEGIN
  IF NEW.firm_id IS NULL THEN
    RETURN NEW;
  END IF;
  ceiling := public.team_practice_classification(NEW.user_id, NEW.firm_id);
  IF public.practice_class_rank(NEW.classification) > public.practice_class_rank(ceiling) THEN
    RAISE EXCEPTION 'Per-client class cannot exceed the person''s professional level (%).', ceiling;
  END IF;
  NEW.classification := public.practice_class_at_most(ceiling, NEW.classification);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS practice_access_ceiling ON public.client_practice_access;
CREATE TRIGGER practice_access_ceiling
  BEFORE INSERT OR UPDATE OF classification ON public.client_practice_access
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_practice_access_ceiling();

-- ── Sign-off: Partner only, at the database ──────────────────────────────────

DROP POLICY IF EXISTS "practice users insert review signoffs" ON public.client_review_signoffs;
DROP POLICY IF EXISTS "accountants insert review signoffs" ON public.client_review_signoffs;
DROP POLICY IF EXISTS "practice users update review signoffs" ON public.client_review_signoffs;
DROP POLICY IF EXISTS "accountants update review signoffs" ON public.client_review_signoffs;

CREATE POLICY "partners insert review signoffs"
  ON public.client_review_signoffs FOR INSERT
  TO authenticated
  WITH CHECK (
    public.can_sign_off_deliverable(auth.uid(), client_id)
    AND signed_off_by_id = auth.uid()
  );

CREATE POLICY "partners update review signoffs"
  ON public.client_review_signoffs FOR UPDATE
  TO authenticated
  USING (public.can_sign_off_deliverable(auth.uid(), client_id))
  WITH CHECK (
    public.can_sign_off_deliverable(auth.uid(), client_id)
    AND signed_off_by_id = auth.uid()
  );

-- ── Deliverable status (Draft → Ready for review → Signed off) ───────────────

CREATE TABLE IF NOT EXISTS public.client_deliverable_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'ready_for_review', 'signed_off')),
  submitted_by UUID,
  submitted_at TIMESTAMPTZ,
  change_comment TEXT,
  content_snapshot JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, scope)
);

CREATE INDEX IF NOT EXISTS client_deliverable_states_client_idx
  ON public.client_deliverable_states (client_id);

ALTER TABLE public.client_deliverable_states ENABLE ROW LEVEL SECURITY;

-- Business-side users only see signed-off rows. Practice assignees see all.
DROP POLICY IF EXISTS "deliverable states select" ON public.client_deliverable_states;
CREATE POLICY "deliverable states select"
  ON public.client_deliverable_states FOR SELECT
  TO authenticated
  USING (
    public.is_milon_it_member(auth.uid())
    OR public.has_active_practice_assignment(auth.uid(), client_id)
    OR (
      status = 'signed_off'
      AND EXISTS (
        SELECT 1 FROM public.clients c
        WHERE c.id = client_id
          AND (
            c.owner_user_id = auth.uid()
            OR EXISTS (
              SELECT 1 FROM public.client_memberships m
              WHERE m.client_id = c.id AND m.user_id = auth.uid()
            )
          )
      )
    )
  );

DROP POLICY IF EXISTS "deliverable states write" ON public.client_deliverable_states;
CREATE POLICY "deliverable states write"
  ON public.client_deliverable_states FOR ALL
  TO authenticated
  USING (public.has_active_practice_assignment(auth.uid(), client_id))
  WITH CHECK (public.has_active_practice_assignment(auth.uid(), client_id));

-- ── Audit log (append-only) ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id UUID,
  action TEXT NOT NULL,
  firm_id UUID,
  client_id UUID,
  subject_user_id UUID,
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS audit_log_firm_idx ON public.audit_log (firm_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_client_idx ON public.audit_log (client_id, created_at DESC);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_log select managers" ON public.audit_log;
CREATE POLICY "audit_log select managers"
  ON public.audit_log FOR SELECT
  TO authenticated
  USING (
    public.is_milon_it_member(auth.uid())
    OR (firm_id IS NOT NULL AND public.is_firm_manager(auth.uid(), firm_id))
    OR (client_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = client_id AND c.owner_user_id = auth.uid()
    ))
  );

DROP POLICY IF EXISTS "audit_log no update" ON public.audit_log;
CREATE POLICY "audit_log no update"
  ON public.audit_log FOR UPDATE
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS "audit_log no delete" ON public.audit_log;
CREATE POLICY "audit_log no delete"
  ON public.audit_log FOR DELETE
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS "audit_log insert definer" ON public.audit_log;
CREATE POLICY "audit_log insert service"
  ON public.audit_log FOR INSERT
  TO authenticated
  WITH CHECK (actor_id = auth.uid());

CREATE OR REPLACE FUNCTION public.write_audit_log(
  _action TEXT,
  _firm_id UUID DEFAULT NULL,
  _client_id UUID DEFAULT NULL,
  _subject_user_id UUID DEFAULT NULL,
  _details JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rid UUID;
BEGIN
  INSERT INTO public.audit_log (actor_id, action, firm_id, client_id, subject_user_id, details)
  VALUES (auth.uid(), _action, _firm_id, _client_id, _subject_user_id, COALESCE(_details, '{}'::jsonb))
  RETURNING id INTO rid;
  RETURN rid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.write_audit_log(TEXT, UUID, UUID, UUID, JSONB) TO authenticated, service_role;

-- ── Firm connection stamp (owner approved the firm once) ─────────────────────

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS firm_connected_at TIMESTAMPTZ;

UPDATE public.clients
  SET firm_connected_at = COALESCE(firm_connected_at, created_at, now())
  WHERE firm_id IS NOT NULL AND firm_connected_at IS NULL;

ALTER TABLE public.client_deliverable_states
  ADD COLUMN IF NOT EXISTS signed_off_by UUID,
  ADD COLUMN IF NOT EXISTS signed_off_at TIMESTAMPTZ;

COMMENT ON TABLE public.client_practice_access IS
  'Named practice staff on a client file. Max 12 pending+active. Owner approves the firm once; the firm then assigns people.';

COMMENT ON COLUMN public.firm_memberships.classification IS
  'Professional level (ceiling): partner, manager, staff, bookkeeper, reviewer, read_only.';

-- Stamp the firm↔business connection; clear it on disconnect.
CREATE OR REPLACE FUNCTION public.trg_clients_firm_connect()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.firm_id IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.firm_id IS NULL) THEN
    NEW.firm_connected_at := COALESCE(NEW.firm_connected_at, now());
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.firm_id IS NULL AND OLD.firm_id IS NOT NULL THEN
    NEW.firm_connected_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clients_firm_connect ON public.clients;
CREATE TRIGGER clients_firm_connect
  BEFORE INSERT OR UPDATE OF firm_id ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_clients_firm_connect();

CREATE OR REPLACE FUNCTION public.trg_clients_firm_connect_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.firm_id IS NOT NULL THEN
    INSERT INTO public.audit_log (actor_id, action, firm_id, client_id, details)
    VALUES (auth.uid(), 'firm_connected', NEW.firm_id, NEW.id, '{}'::jsonb);
  ELSIF TG_OP = 'UPDATE' AND NEW.firm_id IS NOT NULL AND OLD.firm_id IS NULL THEN
    INSERT INTO public.audit_log (actor_id, action, firm_id, client_id, details)
    VALUES (auth.uid(), 'firm_connected', NEW.firm_id, NEW.id, '{}'::jsonb);
  ELSIF TG_OP = 'UPDATE' AND NEW.firm_id IS NULL AND OLD.firm_id IS NOT NULL THEN
    INSERT INTO public.audit_log (actor_id, action, firm_id, client_id, details)
    VALUES (auth.uid(), 'firm_disconnected', OLD.firm_id, NEW.id, '{}'::jsonb);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clients_firm_connect_audit ON public.clients;
CREATE TRIGGER clients_firm_connect_audit
  AFTER INSERT OR UPDATE OF firm_id ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_clients_firm_connect_audit();

-- Deliverable transitions. No skip from draft to signed_off.
CREATE OR REPLACE FUNCTION public.trg_deliverable_state_caps()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor UUID := auth.uid();
  eff TEXT;
BEGIN
  IF actor IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT public.has_active_practice_assignment(actor, NEW.client_id) THEN
    RAISE EXCEPTION 'No practice assignment on this client.';
  END IF;
  eff := public.effective_practice_classification(actor, NEW.client_id);

  IF NEW.status = 'signed_off' THEN
    IF NOT public.practice_can(eff, 'sign_off') THEN
      RAISE EXCEPTION 'Only a partner can sign off.';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'draft' THEN
      RAISE EXCEPTION 'Submit for review before sign-off.';
    END IF;
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'Submit for review before sign-off.';
    END IF;
    NEW.signed_off_by := COALESCE(NEW.signed_off_by, actor);
    NEW.signed_off_at := COALESCE(NEW.signed_off_at, now());
  ELSIF NEW.status = 'ready_for_review' THEN
    IF NOT public.practice_can(eff, 'submit') THEN
      RAISE EXCEPTION 'This professional level cannot submit for review.';
    END IF;
    NEW.signed_off_by := NULL;
    NEW.signed_off_at := NULL;
  ELSIF NEW.status = 'draft' THEN
    IF TG_OP = 'UPDATE' AND OLD.status = 'ready_for_review' THEN
      IF NOT public.practice_can(eff, 'review') THEN
        RAISE EXCEPTION 'This professional level cannot request changes.';
      END IF;
    ELSIF TG_OP = 'UPDATE' AND OLD.status = 'signed_off' THEN
      IF NOT public.practice_can(eff, 'edit') AND NOT public.practice_can(eff, 'review') THEN
        RAISE EXCEPTION 'This professional level cannot open a new draft.';
      END IF;
    END IF;
    NEW.signed_off_by := NULL;
    NEW.signed_off_at := NULL;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS deliverable_state_caps ON public.client_deliverable_states;
CREATE TRIGGER deliverable_state_caps
  BEFORE INSERT OR UPDATE OF status ON public.client_deliverable_states
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_deliverable_state_caps();

-- write_audit_log: service-role callers can pass the acting user.
DROP FUNCTION IF EXISTS public.write_audit_log(TEXT, UUID, UUID, UUID, JSONB);
CREATE OR REPLACE FUNCTION public.write_audit_log(
  _action TEXT,
  _firm_id UUID DEFAULT NULL,
  _client_id UUID DEFAULT NULL,
  _subject_user_id UUID DEFAULT NULL,
  _details JSONB DEFAULT '{}'::jsonb,
  _actor_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rid UUID;
BEGIN
  INSERT INTO public.audit_log (actor_id, action, firm_id, client_id, subject_user_id, details)
  VALUES (
    COALESCE(_actor_id, auth.uid()),
    _action,
    _firm_id,
    _client_id,
    _subject_user_id,
    COALESCE(_details, '{}'::jsonb)
  )
  RETURNING id INTO rid;
  RETURN rid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.write_audit_log(TEXT, UUID, UUID, UUID, JSONB, UUID)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.firm_has_partner(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.actor_is_partner(UUID, UUID) TO authenticated, service_role;
