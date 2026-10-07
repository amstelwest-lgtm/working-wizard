-- ============================================================================
-- Clear a pack sign-off when live figures diverge from the baked snapshot.
--
-- `content` keeps the health, cash, and runway the pack was generated from.
-- The app compares that snapshot to Overview and, when they differ, calls
-- `invalidate`. That reverts approved → in_review (firm) or draft (owner)
-- and writes an audit row. Approve of a stale pack is refused in the server
-- function before this RPC runs; regenerate builds a new version.
--
-- Additive. Replaces advisory_pack_review so the new action is allowlisted.
-- ============================================================================

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'advisory_pack_reviews'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE '%''generated''%'
      AND pg_get_constraintdef(con.oid) LIKE '%''supersede''%'
  LOOP
    EXECUTE format('ALTER TABLE public.advisory_pack_reviews DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.advisory_pack_reviews
  DROP CONSTRAINT IF EXISTS advisory_pack_reviews_action_check;

ALTER TABLE public.advisory_pack_reviews
  ADD CONSTRAINT advisory_pack_reviews_action_check
  CHECK (action IN (
    'generated', 'edit', 'comment', 'approve', 'request_changes', 'reject',
    'deliver', 'supersede', 'read', 'invalidate'
  ));

CREATE OR REPLACE FUNCTION public.advisory_pack_review(
  p_pack_id  uuid,
  p_action   text,
  p_section  text DEFAULT NULL,
  p_after    jsonb DEFAULT NULL,
  p_note     text DEFAULT NULL,
  p_edit_stats jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_pack       record;
  v_kind       text;
  v_is_writer  boolean;
  v_is_firm    boolean;
  v_is_owner   boolean;
  v_before     jsonb;
  v_sections   jsonb;
  v_new        jsonb;
  v_idx        integer;
  v_found      boolean := false;
  v_reverted   text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT p.*, c.firm_id, c.owner_user_id
    INTO v_pack
  FROM public.advisory_packs p
  JOIN public.clients c ON c.id = p.client_id
  WHERE p.id = p_pack_id
  FOR UPDATE OF p;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pack not found';
  END IF;
  IF NOT public.has_client_access(v_uid, v_pack.client_id) THEN
    RAISE EXCEPTION 'You do not have access to this client';
  END IF;

  v_is_writer := public.is_action_plan_writer(v_uid, v_pack.client_id);
  v_is_firm   := v_pack.firm_id IS NOT NULL AND public.is_firm_member(v_uid, v_pack.firm_id);
  v_is_owner  := v_pack.owner_user_id = v_uid;
  v_kind      := public.advisory_actor_kind(v_uid);

  IF p_action NOT IN ('edit', 'comment', 'approve', 'request_changes', 'reject', 'deliver', 'read', 'invalidate') THEN
    RAISE EXCEPTION 'Unknown pack action %', p_action;
  END IF;

  IF p_action = 'comment' THEN
    INSERT INTO public.advisory_pack_reviews (pack_id, client_id, action, actor_id, actor_kind, section, note)
    VALUES (p_pack_id, v_pack.client_id, 'comment', v_uid, v_kind, p_section, p_note);
    RETURN jsonb_build_object('status', v_pack.status);
  END IF;

  IF p_action = 'read' THEN
    INSERT INTO public.advisory_pack_reviews (pack_id, client_id, action, actor_id, actor_kind)
    VALUES (p_pack_id, v_pack.client_id, 'read', v_uid, v_kind);
    -- The owner opening an approved pack is delivery.
    IF v_is_owner AND v_pack.status = 'approved' AND v_pack.delivered_at IS NULL THEN
      UPDATE public.advisory_packs
         SET delivered_at = now(), delivered_to = coalesce(p_note, 'owner (in-app)')
       WHERE id = p_pack_id;
    END IF;
    RETURN jsonb_build_object('status', v_pack.status);
  END IF;

  -- Stale sign-off. The server function only calls this after the baked
  -- snapshot disagrees with Overview. Idempotent when the pack is not approved.
  IF p_action = 'invalidate' THEN
    IF v_pack.status <> 'approved' THEN
      RETURN jsonb_build_object('status', v_pack.status);
    END IF;
    v_reverted := CASE WHEN v_pack.requires_review THEN 'in_review' ELSE 'draft' END;
    UPDATE public.advisory_packs
       SET status = v_reverted,
           reviewed_by = NULL,
           reviewed_by_kind = NULL,
           reviewed_at = NULL,
           review_note = NULL
     WHERE id = p_pack_id;
    INSERT INTO public.advisory_pack_reviews (pack_id, client_id, action, actor_id, actor_kind, before, after, note)
    VALUES (p_pack_id, v_pack.client_id, 'invalidate', v_uid, v_kind,
            jsonb_build_object('status', 'approved'),
            jsonb_build_object('status', v_reverted),
            'Figures have changed since this pack was generated, regenerate');
    RETURN jsonb_build_object('status', v_reverted);
  END IF;

  IF v_pack.status IN ('superseded', 'rejected') THEN
    RAISE EXCEPTION 'Pack v% is %; generate a new version instead', v_pack.version, v_pack.status;
  END IF;

  IF p_action = 'edit' THEN
    IF NOT v_is_writer THEN
      RAISE EXCEPTION 'Only the owner or the firm can edit the pack';
    END IF;
    IF v_pack.status = 'approved' THEN
      RAISE EXCEPTION 'An approved pack is final; generate a new version to change it';
    END IF;
    IF p_section IS NULL OR p_after IS NULL OR jsonb_typeof(p_after) <> 'object' THEN
      RAISE EXCEPTION 'edit needs p_section and an object p_after';
    END IF;
    v_sections := coalesce(v_pack.content->'sections', '[]'::jsonb);
    v_new := '[]'::jsonb;
    FOR v_idx IN 0 .. jsonb_array_length(v_sections) - 1 LOOP
      IF v_sections->v_idx->>'key' = p_section THEN
        v_before := v_sections->v_idx;
        -- key is immutable; body / bullets / title are what gets edited
        v_new := v_new || (v_sections->v_idx || p_after || jsonb_build_object('key', p_section));
        v_found := true;
      ELSE
        v_new := v_new || (v_sections->v_idx);
      END IF;
    END LOOP;
    IF NOT v_found THEN
      RAISE EXCEPTION 'Section % not found in pack', p_section;
    END IF;
    UPDATE public.advisory_packs
       SET content = jsonb_set(content, '{sections}', v_new),
           edit_stats = coalesce(p_edit_stats, edit_stats)
     WHERE id = p_pack_id;
    INSERT INTO public.advisory_pack_reviews (pack_id, client_id, action, actor_id, actor_kind, section, before, after, note)
    VALUES (p_pack_id, v_pack.client_id, 'edit', v_uid, v_kind, p_section, v_before, p_after, p_note);
    RETURN jsonb_build_object('status', v_pack.status);
  END IF;

  IF p_action IN ('approve', 'reject') THEN
    IF v_pack.requires_review AND NOT v_is_firm THEN
      RAISE EXCEPTION 'This pack needs the accountant''s sign-off';
    END IF;
    IF NOT v_pack.requires_review AND NOT v_is_writer THEN
      RAISE EXCEPTION 'Only the owner can accept this pack';
    END IF;
    IF v_pack.status = 'approved' THEN
      RAISE EXCEPTION 'Pack v% is already approved', v_pack.version;
    END IF;
    UPDATE public.advisory_packs
       SET status = CASE WHEN p_action = 'approve' THEN 'approved' ELSE 'rejected' END,
           reviewed_by = v_uid,
           reviewed_by_kind = CASE WHEN v_is_firm THEN 'accountant' ELSE 'owner' END,
           reviewed_at = now(),
           review_note = p_note,
           edit_stats = coalesce(p_edit_stats, edit_stats)
     WHERE id = p_pack_id;
    INSERT INTO public.advisory_pack_reviews (pack_id, client_id, action, actor_id, actor_kind, before, after, note)
    VALUES (p_pack_id, v_pack.client_id, p_action, v_uid, v_kind,
            jsonb_build_object('status', v_pack.status),
            jsonb_build_object('status', CASE WHEN p_action = 'approve' THEN 'approved' ELSE 'rejected' END,
                               'edit_stats', coalesce(p_edit_stats, v_pack.edit_stats)),
            p_note);
    RETURN jsonb_build_object('status', CASE WHEN p_action = 'approve' THEN 'approved' ELSE 'rejected' END);
  END IF;

  IF p_action = 'request_changes' THEN
    IF NOT v_is_firm THEN
      RAISE EXCEPTION 'Only the firm can request changes';
    END IF;
    UPDATE public.advisory_packs
       SET status = 'changes_requested', reviewed_by = v_uid, reviewed_by_kind = 'accountant',
           reviewed_at = now(), review_note = p_note
     WHERE id = p_pack_id;
    INSERT INTO public.advisory_pack_reviews (pack_id, client_id, action, actor_id, actor_kind, section, before, after, note)
    VALUES (p_pack_id, v_pack.client_id, 'request_changes', v_uid, v_kind, p_section,
            jsonb_build_object('status', v_pack.status), jsonb_build_object('status', 'changes_requested'), p_note);
    RETURN jsonb_build_object('status', 'changes_requested');
  END IF;

  IF p_action = 'deliver' THEN
    IF NOT v_is_writer THEN
      RAISE EXCEPTION 'Only the owner or the firm can deliver the pack';
    END IF;
    IF v_pack.status <> 'approved' THEN
      RAISE EXCEPTION 'Only an approved pack can be delivered';
    END IF;
    UPDATE public.advisory_packs
       SET delivered_at = coalesce(delivered_at, now()), delivered_to = coalesce(p_note, delivered_to, 'owner')
     WHERE id = p_pack_id;
    INSERT INTO public.advisory_pack_reviews (pack_id, client_id, action, actor_id, actor_kind, after, note)
    VALUES (p_pack_id, v_pack.client_id, 'deliver', v_uid, v_kind, jsonb_build_object('delivered_to', p_note), p_note);
    RETURN jsonb_build_object('status', v_pack.status, 'delivered', true);
  END IF;

  RETURN jsonb_build_object('status', v_pack.status);
END;
$$;

REVOKE ALL ON FUNCTION public.advisory_pack_review(uuid, text, text, jsonb, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.advisory_pack_review(uuid, text, text, jsonb, text, jsonb) TO authenticated, service_role;
