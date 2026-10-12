-- Source documents → ledger proposal. Database tests, not UI.
-- Safe to re-run: unique prefix, and it deletes its own rows.
-- Requires 20261013170000_source_documents_to_ledger.sql.
-- Does not post to a ledger.

DO $$
DECLARE
  prefix text := 'milon_srcdoc_' || substr(gen_random_uuid()::text, 1, 8);
  v_firm_owner uuid := gen_random_uuid();
  v_staff uuid := gen_random_uuid();
  v_unassigned uuid := gen_random_uuid();
  v_owner uuid := gen_random_uuid();
  v_member uuid := gen_random_uuid();
  v_outsider uuid := gen_random_uuid();
  v_solo uuid := gen_random_uuid();
  v_solo_member uuid := gen_random_uuid();
  v_firm uuid;
  v_firm_client uuid;
  v_solo_client uuid;
  v_doc uuid;
  v_doc_near uuid;
  v_proposal uuid;
  v_unclean uuid;
  v_rows int;
  v_text text;
  v_bool boolean;
  v_hash text;
  v_hash2 text;
  v_canonical text;
  v_canonical2 text;
  v_flags jsonb;
  v_raised text;
  v_result jsonb;
  v_saved_n integer;
  v_sha text := repeat('a', 64);
  v_sha2 text := repeat('b', 64);
  v_sha3 text := repeat('c', 64);
  v_received timestamptz;
  v_until timestamptz;
BEGIN
  SELECT final_unlock_after_clean_drafts INTO v_saved_n
  FROM public.ledger_posting_config
  WHERE singleton;

  INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, instance_id)
  VALUES
    (v_firm_owner, 'authenticated', 'authenticated', prefix || '_firm@example.test', crypt('x', gen_salt('bf')), now(), now(), now(), '00000000-0000-0000-0000-000000000000'),
    (v_staff, 'authenticated', 'authenticated', prefix || '_staff@example.test', crypt('x', gen_salt('bf')), now(), now(), now(), '00000000-0000-0000-0000-000000000000'),
    (v_unassigned, 'authenticated', 'authenticated', prefix || '_unassigned@example.test', crypt('x', gen_salt('bf')), now(), now(), now(), '00000000-0000-0000-0000-000000000000'),
    (v_owner, 'authenticated', 'authenticated', prefix || '_owner@example.test', crypt('x', gen_salt('bf')), now(), now(), now(), '00000000-0000-0000-0000-000000000000'),
    (v_member, 'authenticated', 'authenticated', prefix || '_member@example.test', crypt('x', gen_salt('bf')), now(), now(), now(), '00000000-0000-0000-0000-000000000000'),
    (v_outsider, 'authenticated', 'authenticated', prefix || '_out@example.test', crypt('x', gen_salt('bf')), now(), now(), now(), '00000000-0000-0000-0000-000000000000'),
    (v_solo, 'authenticated', 'authenticated', prefix || '_solo@example.test', crypt('x', gen_salt('bf')), now(), now(), now(), '00000000-0000-0000-0000-000000000000'),
    (v_solo_member, 'authenticated', 'authenticated', prefix || '_solom@example.test', crypt('x', gen_salt('bf')), now(), now(), now(), '00000000-0000-0000-0000-000000000000');

  INSERT INTO public.profiles (id, email, full_name)
  VALUES
    (v_firm_owner, prefix || '_firm@example.test', prefix || ' Firm'),
    (v_staff, prefix || '_staff@example.test', prefix || ' Staff'),
    (v_unassigned, prefix || '_unassigned@example.test', prefix || ' Unassigned'),
    (v_owner, prefix || '_owner@example.test', prefix || ' Owner'),
    (v_member, prefix || '_member@example.test', prefix || ' Member'),
    (v_solo, prefix || '_solo@example.test', prefix || ' Solo'),
    (v_solo_member, prefix || '_solom@example.test', prefix || ' Solo member')
  ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, email = EXCLUDED.email;

  INSERT INTO public.firms (name, owner_user_id)
  VALUES (prefix || ' firm', v_firm_owner)
  RETURNING id INTO v_firm;

  INSERT INTO public.firm_memberships (firm_id, user_id, role, classification)
  VALUES
    (v_firm, v_firm_owner, 'owner', 'staff'),
    (v_firm, v_staff, 'member', 'staff'),
    (v_firm, v_unassigned, 'member', 'staff');

  -- No JWT here. clients_guard_owner_only_columns rejects firm_id when auth.uid() is set.
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);

  INSERT INTO public.clients (name, owner_user_id, firm_id)
  VALUES (prefix || ' client', v_owner, v_firm)
  RETURNING id INTO v_firm_client;

  INSERT INTO public.clients (name, owner_user_id, firm_id)
  VALUES (prefix || ' solo', v_solo, NULL)
  RETURNING id INTO v_solo_client;

  INSERT INTO public.client_memberships (client_id, user_id, role)
  VALUES
    (v_firm_client, v_member, 'member'),
    (v_solo_client, v_solo_member, 'member');

  INSERT INTO public.client_practice_access (client_id, user_id, firm_id, classification, status)
  VALUES (v_firm_client, v_staff, v_firm, 'staff', 'active');

  IF public.normalise_supplier_key('Acme (Pty) Ltd') <> 'acme' THEN
    RAISE EXCEPTION 'supplier key should drop the legal suffix';
  END IF;
  IF public.ledger_post_approver_role(v_firm_client) <> 'accountant' THEN
    RAISE EXCEPTION 'a client with a firm is approved by the accountant';
  END IF;
  IF public.ledger_post_approver_role(v_solo_client) <> 'owner' THEN
    RAISE EXCEPTION 'a client with no firm is approved by the owner';
  END IF;
  IF public.ledger_post_caller_may_decide(v_owner, v_firm_client) THEN
    RAISE EXCEPTION 'the business owner must not approve while a firm is attached';
  END IF;
  IF NOT public.ledger_post_caller_may_decide(v_staff, v_firm_client) THEN
    RAISE EXCEPTION 'a firm member with practice access should approve';
  END IF;
  IF public.ledger_post_caller_may_decide(v_unassigned, v_firm_client) THEN
    RAISE EXCEPTION 'a firm member without client access must not approve';
  END IF;
  IF NOT public.ledger_post_caller_may_decide(v_solo, v_solo_client) THEN
    RAISE EXCEPTION 'the owner should approve when there is no firm';
  END IF;
  IF public.ledger_post_caller_may_decide(v_solo_member, v_solo_client) THEN
    RAISE EXCEPTION 'a member who is not the owner must not approve';
  END IF;
  IF public.ledger_note_is_sign_off('Please sign off') IS NOT TRUE THEN
    RAISE EXCEPTION 'sign-off wording should be refused';
  END IF;
  IF public.ledger_note_is_sign_off('Approve and send') THEN
    RAISE EXCEPTION 'an approval note should be allowed';
  END IF;

  IF NOT public.source_doc_can_read(v_member, v_firm_client) THEN
    RAISE EXCEPTION 'a client member should read documents';
  END IF;
  IF public.source_doc_can_read(v_outsider, v_firm_client) THEN
    RAISE EXCEPTION 'an outsider must not read documents';
  END IF;
  IF NOT public.source_doc_can_upload(v_owner, v_firm_client) THEN
    RAISE EXCEPTION 'the owner should upload';
  END IF;
  IF NOT public.source_doc_can_upload(v_staff, v_firm_client) THEN
    RAISE EXCEPTION 'a firm member with practice access should upload';
  END IF;
  IF public.source_doc_can_upload(v_unassigned, v_firm_client) THEN
    RAISE EXCEPTION 'a firm member without client access must not upload';
  END IF;
  IF public.source_doc_can_upload(v_member, v_firm_client) THEN
    RAISE EXCEPTION 'a client member who is not the owner must not upload';
  END IF;
  IF public.source_doc_can_upload(v_staff, v_solo_client) THEN
    RAISE EXCEPTION 'another firm must not upload to a client with no firm';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_outsider::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_outsider::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  IF public.source_doc_can_read(v_member, v_firm_client) THEN
    RAISE EXCEPTION 'an authenticated caller must not probe another user''s read access';
  END IF;
  IF public.source_doc_can_upload(v_owner, v_firm_client) THEN
    RAISE EXCEPTION 'an authenticated caller must not probe another user''s upload access';
  END IF;
  v_raised := NULL;
  BEGIN
    PERFORM public.ledger_post_approver_role(v_firm_client);
  EXCEPTION WHEN OTHERS THEN
    v_raised := SQLERRM;
  END;
  IF v_raised IS NULL OR v_raised NOT ILIKE '%permission denied%' THEN
    RAISE EXCEPTION 'authenticated must not probe the approver role, got %', v_raised;
  END IF;
  IF has_function_privilege('authenticated', 'public.ledger_post_caller_may_decide(uuid, uuid)', 'EXECUTE') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'authenticated must not hold execute on ledger_post_caller_may_decide';
  END IF;
  IF has_function_privilege('authenticated', 'public.supplier_final_unlocked(uuid, text)', 'EXECUTE') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'authenticated must not hold execute on supplier_final_unlocked';
  END IF;
  v_raised := NULL;
  BEGIN
    PERFORM public.ledger_post_caller_may_decide(v_staff, v_firm_client);
    v_raised := 'no error';
  EXCEPTION WHEN insufficient_privilege THEN
    v_raised := SQLSTATE;
  END;
  IF v_raised IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION 'authenticated call to ledger_post_caller_may_decide should be 42501, got %', v_raised;
  END IF;
  v_raised := NULL;
  BEGIN
    PERFORM public.supplier_final_unlocked(v_firm_client, 'acme');
    v_raised := 'no error';
  EXCEPTION WHEN insufficient_privilege THEN
    v_raised := SQLSTATE;
  END;
  IF v_raised IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION 'authenticated call to supplier_final_unlocked should be 42501, got %', v_raised;
  END IF;
  RESET ROLE;
  -- request.jwt.claim.role overrides request.jwt.claims. Clear it after use.
  PERFORM set_config('request.jwt.claim.role', '', true);

  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  IF NOT public.source_doc_can_read(v_member, v_firm_client) THEN
    RAISE EXCEPTION 'service role should check the user id it was given';
  END IF;
  IF public.source_doc_can_read(v_outsider, v_firm_client) THEN
    RAISE EXCEPTION 'service role should still reject an outsider';
  END IF;
  IF NOT public.source_doc_can_upload(v_owner, v_firm_client) THEN
    RAISE EXCEPTION 'service role should honour the upload user id';
  END IF;
  IF public.source_doc_can_upload(v_unassigned, v_firm_client) THEN
    RAISE EXCEPTION 'service role should still refuse a firm member without client access';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claims', '', true);

  INSERT INTO public.source_documents (
    client_id, uploaded_by, channel, storage_path, sha256, mime, size_bytes, status, received_at
  )
  VALUES (
    v_firm_client, v_owner, 'upload', v_firm_client::text || '/invoice.pdf', v_sha,
    'application/pdf', 1200, 'received', timestamptz '2026-10-11 00:00:00+00'
  )
  RETURNING id, retention_until::text INTO v_doc, v_text;

  IF v_text::timestamptz <> timestamptz '2026-10-11 00:00:00+00' + interval '5 years' THEN
    RAISE EXCEPTION 'retention should be 5 years from upload, got %', v_text;
  END IF;

  UPDATE public.source_documents
    SET received_at = timestamptz '1999-01-01 00:00:00+00',
        uploaded_by = v_staff,
        client_id = v_solo_client,
        sha256 = repeat('f', 64),
        storage_path = v_solo_client::text || '/changed.pdf',
        status = 'extracted'
    WHERE id = v_doc;
  IF NOT EXISTS (
    SELECT 1
    FROM public.source_documents
    WHERE id = v_doc
      AND received_at = timestamptz '2026-10-11 00:00:00+00'
      AND uploaded_by = v_owner
      AND client_id = v_firm_client
      AND sha256 = v_sha
      AND storage_path = v_firm_client::text || '/invoice.pdf'
      AND status = 'extracted'
  ) THEN
    RAISE EXCEPTION 'received_at, uploaded_by, client_id, sha256 and storage_path should stay immutable';
  END IF;
  UPDATE public.source_documents SET status = 'received' WHERE id = v_doc;

  PERFORM set_config('request.jwt.claim.sub', v_member::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_member::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_rows FROM public.source_documents WHERE id = v_doc;
  RESET ROLE;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'a client member should see their document, saw %', v_rows;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_outsider::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_outsider::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_rows FROM public.source_documents WHERE id = v_doc;
  RESET ROLE;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'an outsider must not see the document, saw %', v_rows;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_member::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_member::text, 'role', 'authenticated')::text, true);
  v_raised := NULL;
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.source_documents (
      client_id, uploaded_by, channel, storage_path, sha256, mime, size_bytes
    )
    VALUES (
      v_firm_client, v_member, 'upload', v_firm_client::text || '/member.pdf', v_sha2,
      'application/pdf', 1000
    );
  EXCEPTION WHEN OTHERS THEN
    v_raised := SQLERRM;
  END;
  RESET ROLE;
  IF v_raised IS NULL OR v_raised NOT ILIKE '%row-level security%' THEN
    RAISE EXCEPTION 'member upload should be blocked, got %', v_raised;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_unassigned::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_unassigned::text, 'role', 'authenticated')::text, true);
  v_raised := NULL;
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.source_documents (
      client_id, uploaded_by, channel, storage_path, sha256, mime, size_bytes
    )
    VALUES (
      v_firm_client, v_unassigned, 'upload', v_firm_client::text || '/unassigned.pdf', repeat('3', 64),
      'application/pdf', 1000
    );
  EXCEPTION WHEN OTHERS THEN
    v_raised := SQLERRM;
  END;
  RESET ROLE;
  IF v_raised IS NULL OR v_raised NOT ILIKE '%row-level security%' THEN
    RAISE EXCEPTION 'a firm member without client access must not upload, got %', v_raised;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  -- The business owner can upload, but prod has_client_access does not include
  -- owner_user_id, so INSERT ... RETURNING is hidden by the select policy.
  INSERT INTO public.source_documents (
    client_id, uploaded_by, channel, storage_path, sha256, mime, size_bytes, status, received_at
  )
  VALUES (
    v_firm_client, v_owner, 'upload', v_firm_client::text || '/backdated.pdf', repeat('1', 64),
    'application/pdf', 1100, 'received', timestamptz '2000-01-01 00:00:00+00'
  );
  INSERT INTO public.source_documents (
    client_id, uploaded_by, channel, storage_path, sha256, mime, size_bytes, status, received_at
  )
  VALUES (
    v_firm_client, v_owner, 'upload', v_firm_client::text || '/status.pdf', repeat('2', 64),
    'application/pdf', 1100, 'extracted', now()
  );
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.role', '', true);
  SELECT received_at, retention_until INTO v_received, v_until
  FROM public.source_documents
  WHERE storage_path = v_firm_client::text || '/backdated.pdf';
  IF v_received < now() - interval '5 minutes'
     OR v_until <> v_received + interval '5 years'
     OR v_until < timestamptz '2024-01-01 00:00:00+00' THEN
    RAISE EXCEPTION 'a backdated received_at should be stored as now, retention % from %', v_until, v_received;
  END IF;
  SELECT status, received_at INTO v_text, v_received
  FROM public.source_documents
  WHERE storage_path = v_firm_client::text || '/status.pdf';
  IF v_text <> 'received' THEN
    RAISE EXCEPTION 'a direct status insert should be stored as received, got %', v_text;
  END IF;
  IF v_received < now() - interval '5 minutes' THEN
    RAISE EXCEPTION 'a direct insert should not keep a caller-supplied received_at, got %', v_received;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  v_result := public.register_source_document(
    v_firm_client, v_firm_client::text || '/camera.jpg', v_sha3, 'image/jpeg', 800, 'camera'
  );
  IF v_result ->> 'ok' <> 'true' OR v_result ->> 'duplicate' <> 'false' THEN
    RAISE EXCEPTION 'owner register failed: %', v_result;
  END IF;
  v_result := public.register_source_document(
    v_firm_client, v_firm_client::text || '/again.jpg', v_sha3, 'image/jpeg', 800, 'camera'
  );
  IF v_result ->> 'duplicate' <> 'true' THEN
    RAISE EXCEPTION 'the same file hash should be a duplicate, got %', v_result;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_member::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_member::text, 'role', 'authenticated')::text, true);
  v_result := public.register_source_document(
    v_firm_client, v_firm_client::text || '/nope.pdf', repeat('d', 64), 'application/pdf', 100, 'upload'
  );
  IF v_result ->> 'error' <> 'upload_forbidden' THEN
    RAISE EXCEPTION 'member register should be forbidden, got %', v_result;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_unassigned::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_unassigned::text, 'role', 'authenticated')::text, true);
  v_result := public.register_source_document(
    v_firm_client, v_firm_client::text || '/unassigned.pdf', repeat('7', 64), 'application/pdf', 100, 'upload'
  );
  IF v_result ->> 'error' <> 'upload_forbidden' THEN
    RAISE EXCEPTION 'a firm member without client access must not register, got %', v_result;
  END IF;

  v_flags := jsonb_build_object(
    'low_confidence', false,
    'arithmetic_mismatch', false,
    'duplicate_file', false,
    'duplicate_document', false,
    'bank_details_changed', false,
    'new_supplier', true
  );
  v_canonical := '{"draft_holding":"ledger_draft","guards":{"arithmetic_mismatch":false,"bank_details_changed":false,"duplicate_document":false,"duplicate_file":false,"low_confidence":false,"new_supplier":true},"ledger":"xero","mode":"draft"}';
  v_hash := public.ledger_payload_sha256(v_canonical);
  INSERT INTO public.ledger_post_proposals (
    client_id, document_id, target_ledger, doc_type, mode, draft_holding,
    canonical_payload, payload, payload_sha256, flags, status,
    supplier_key, supplier_display_name, document_number, amount, issued_on, file_sha256, clean
  )
  VALUES (
    v_firm_client, v_doc, 'xero', 'bill', 'draft', 'ledger_draft',
    v_canonical, v_canonical::jsonb, v_hash, v_flags, 'proposed',
    'acme', 'Acme', 'INV100', 115.00, date '2026-10-11', v_sha, true
  )
  RETURNING id INTO v_proposal;

  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  v_result := public.decide_ledger_post_proposal(v_proposal, 'approve', NULL);
  IF v_result ->> 'error' <> 'approver_forbidden' THEN
    RAISE EXCEPTION 'owner approval on a firm client should be forbidden, got %', v_result;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_unassigned::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_unassigned::text, 'role', 'authenticated')::text, true);
  v_result := public.decide_ledger_post_proposal(v_proposal, 'approve', NULL);
  IF v_result ->> 'error' <> 'approver_forbidden' THEN
    RAISE EXCEPTION 'a firm member without client access must not approve, got %', v_result;
  END IF;

  v_result := public.decide_ledger_post_proposal(v_proposal, 'approve', 'Please sign off');
  IF v_result ->> 'error' <> 'signed_off_refused' THEN
    RAISE EXCEPTION 'sign-off wording should be refused, got %', v_result;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_staff::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_staff::text, 'role', 'authenticated')::text, true);
  v_result := public.decide_ledger_post_proposal(v_proposal, 'approve', 'Send it');
  IF v_result ->> 'ok' <> 'true' OR v_result ->> 'status' <> 'approved' THEN
    RAISE EXCEPTION 'a firm member with practice access should approve, got %', v_result;
  END IF;
  IF v_result ->> 'approved_by' <> v_staff::text
     OR v_result ->> 'approval_payload_sha256' <> v_hash
     OR v_result ->> 'approver_role' <> 'accountant' THEN
    RAISE EXCEPTION 'approval should name the human and the payload hash, got %', v_result;
  END IF;

  v_result := public.decide_ledger_post_proposal(v_proposal, 'approve', NULL);
  IF v_result ->> 'already' <> 'true' OR v_result ->> 'approval_payload_sha256' <> v_hash THEN
    RAISE EXCEPTION 'a second approve should return the same hash, got %', v_result;
  END IF;

  SELECT clean_approved_drafts INTO v_rows
  FROM public.supplier_trust
  WHERE client_id = v_firm_client AND supplier_key = 'acme';
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'one clean approval should count once, got %', v_rows;
  END IF;
  IF public.supplier_final_unlocked(v_firm_client, 'acme') THEN
    RAISE EXCEPTION 'one clean draft must not unlock final when N is 3';
  END IF;

  v_canonical2 := '{"draft_holding":"ledger_draft","guards":{"arithmetic_mismatch":false,"bank_details_changed":false,"duplicate_document":false,"duplicate_file":false,"low_confidence":false,"new_supplier":true},"ledger":"xero","mode":"draft","total":"116.00"}';
  v_hash2 := public.ledger_payload_sha256(v_canonical2);
  UPDATE public.ledger_post_proposals
    SET canonical_payload = v_canonical2,
        payload = v_canonical2::jsonb,
        payload_sha256 = v_hash2
    WHERE id = v_proposal;
  SELECT status, approval_payload_sha256, version
    INTO v_text, v_hash, v_rows
  FROM public.ledger_post_proposals
  WHERE id = v_proposal;
  IF v_text <> 'proposed' OR v_hash IS NOT NULL OR v_rows <> 2 THEN
    RAISE EXCEPTION 'a payload edit should clear the approval, status=% hash=% version=%', v_text, v_hash, v_rows;
  END IF;

  SELECT clean_approved_drafts INTO v_rows
  FROM public.supplier_trust
  WHERE client_id = v_firm_client AND supplier_key = 'acme';
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'invalidating the approval should reverse the clean count, got %', v_rows;
  END IF;

  v_result := public.decide_ledger_post_proposal(v_proposal, 'approve', NULL);
  IF v_result ->> 'approval_payload_sha256' <> v_hash2 THEN
    RAISE EXCEPTION 'the new approval should hash the edited payload, got %', v_result;
  END IF;

  v_raised := NULL;
  BEGIN
    UPDATE public.ledger_post_proposals
      SET status = 'posted',
          approval_payload_sha256 = repeat('ab', 32)
      WHERE id = v_proposal;
  EXCEPTION WHEN OTHERS THEN
    v_raised := SQLERRM;
  END;
  IF v_raised IS NULL OR v_raised NOT ILIKE '%payload_hash_mismatch%' THEN
    RAISE EXCEPTION 'a posted row with a different hash should be refused, got %', v_raised;
  END IF;

  UPDATE public.ledger_post_proposals
    SET status = 'posted'
    WHERE id = v_proposal;
  SELECT status INTO v_text FROM public.ledger_post_proposals WHERE id = v_proposal;
  IF v_text <> 'posted' THEN
    RAISE EXCEPTION 'posting should succeed when the approval hash matches';
  END IF;

  v_raised := NULL;
  BEGIN
    UPDATE public.ledger_post_proposals
      SET canonical_payload = v_canonical,
          payload = v_canonical::jsonb,
          payload_sha256 = public.ledger_payload_sha256(v_canonical)
      WHERE id = v_proposal;
  EXCEPTION WHEN OTHERS THEN
    v_raised := SQLERRM;
  END;
  IF v_raised IS NULL OR v_raised NOT ILIKE '%posted_payload_locked%' THEN
    RAISE EXCEPTION 'a posted payload should stay locked, got %', v_raised;
  END IF;

  v_flags := jsonb_build_object(
    'low_confidence', false,
    'arithmetic_mismatch', true,
    'duplicate_file', false,
    'duplicate_document', false,
    'bank_details_changed', false,
    'new_supplier', false
  );
  v_canonical := '{"draft_holding":"held_in_milon","guards":{"arithmetic_mismatch":true,"bank_details_changed":false,"duplicate_document":false,"duplicate_file":false,"low_confidence":false,"new_supplier":false},"ledger":"qbo","mode":"draft"}';
  INSERT INTO public.source_documents (
    client_id, uploaded_by, storage_path, sha256, mime, size_bytes, received_at
  )
  VALUES (
    v_firm_client, v_owner, v_firm_client::text || '/near.pdf', repeat('e', 64),
    'application/pdf', 900, timestamptz '2026-10-11 00:00:00+00'
  )
  RETURNING id INTO v_doc_near;

  INSERT INTO public.ledger_post_proposals (
    client_id, document_id, target_ledger, doc_type, mode, draft_holding,
    canonical_payload, payload, payload_sha256, flags, status,
    supplier_key, document_number, amount, issued_on, file_sha256, clean
  )
  VALUES (
    v_firm_client, v_doc_near, 'qbo', 'bill', 'draft', 'held_in_milon',
    v_canonical, v_canonical::jsonb, public.ledger_payload_sha256(v_canonical), v_flags, 'proposed',
    'acme', 'INV100', 115.00, date '2026-10-09', repeat('e', 64), true
  )
  RETURNING id, clean INTO v_unclean, v_bool;
  IF v_bool THEN
    RAISE EXCEPTION 'an arithmetic mismatch must not stay clean';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_staff::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_staff::text, 'role', 'authenticated')::text, true);
  v_result := public.decide_ledger_post_proposal(v_unclean, 'approve', NULL);
  IF v_result ->> 'status' <> 'approved' THEN
    RAISE EXCEPTION 'a flagged draft can still be approved, got %', v_result;
  END IF;
  SELECT clean_approved_drafts INTO v_rows
  FROM public.supplier_trust
  WHERE client_id = v_firm_client AND supplier_key = 'acme';
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'an unclean approval must not advance the counter, got %', v_rows;
  END IF;

  SELECT count(*) INTO v_rows
  FROM public.find_source_document_duplicates(
    v_firm_client, repeat('e', 64), 'Acme (Pty) Ltd', 'INV-100', 115.00, date '2026-10-11', v_doc
  )
  WHERE kind = 'semantic';
  IF v_rows < 1 THEN
    RAISE EXCEPTION 'same supplier, number, amount, and a date within 3 days should match';
  END IF;

  SELECT count(*) INTO v_rows
  FROM public.find_source_document_duplicates(
    v_firm_client, v_sha, 'Acme', 'INV100', 115.00, date '2026-10-11', NULL
  )
  WHERE kind = 'file';
  IF v_rows < 1 THEN
    RAISE EXCEPTION 'the same file hash should match';
  END IF;

  SELECT count(*) INTO v_rows
  FROM public.find_source_document_duplicates(
    v_firm_client, repeat('f', 64), 'Acme', 'INV100', 115.00, date '2026-10-05', NULL
  )
  WHERE kind = 'semantic';
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'four days apart should not be a semantic duplicate, got %', v_rows;
  END IF;

  v_raised := NULL;
  BEGIN
    INSERT INTO public.document_extractions (
      document_id, client_id, model, prompt_version, doc_type, fields, line_items, totals_check,
      arithmetic_ok, vat_claimable, tax_treatment
    )
    VALUES (
      v_doc, v_firm_client, 'claude-sonnet-5-5', 'source-doc-v1', 'bill',
      '{}'::jsonb, '[]'::jsonb, '{}'::jsonb, true, true, 'claimable'
    );
  EXCEPTION WHEN OTHERS THEN
    v_raised := SQLERRM;
  END;
  IF v_raised IS NULL THEN
    RAISE EXCEPTION 'claimable VAT without a supplier VAT number should be refused';
  END IF;

  INSERT INTO public.document_extractions (
    document_id, client_id, model, prompt_version, doc_type, supplier_vat_number,
    fields, line_items, totals_check, arithmetic_ok, vat_claimable, tax_treatment
  )
  VALUES (
    v_doc, v_firm_client, 'claude-sonnet-5-5', 'source-doc-v1', 'bill', NULL,
    '{"total":{"value":115,"confidence":0.99}}'::jsonb, '[]'::jsonb, '{"ok":true}'::jsonb,
    true, false, 'non_claimable'
  );
  INSERT INTO public.document_extractions (
    document_id, client_id, model, prompt_version, doc_type, supplier_vat_number,
    fields, line_items, totals_check, arithmetic_ok, vat_claimable, tax_treatment
  )
  VALUES (
    v_doc_near, v_firm_client, 'claude-sonnet-5-5', 'source-doc-v1', 'bill', '4123456789',
    '{}'::jsonb, '[]'::jsonb, '{}'::jsonb, true, true, 'claimable'
  );

  UPDATE public.ledger_posting_config
    SET final_unlock_after_clean_drafts = 1
    WHERE singleton;
  IF NOT public.supplier_final_unlocked(v_firm_client, 'acme') THEN
    RAISE EXCEPTION 'final should unlock when the clean count reaches N';
  END IF;
  UPDATE public.ledger_posting_config
    SET final_unlock_after_clean_drafts = v_saved_n
    WHERE singleton;
  IF v_saved_n > 1 AND public.supplier_final_unlocked(v_firm_client, 'acme') THEN
    RAISE EXCEPTION 'restoring N should lock final again';
  END IF;

  v_raised := NULL;
  BEGIN
    UPDATE public.supplier_trust
      SET bank_fingerprint = repeat('ab', 32)
      WHERE client_id = v_firm_client AND supplier_key = 'acme';
  EXCEPTION WHEN OTHERS THEN
    v_raised := SQLERRM;
  END;
  IF v_raised IS NULL OR v_raised NOT ILIKE '%supplier_bank_details_locked%' THEN
    RAISE EXCEPTION 'bank details on file should stay locked, got %', v_raised;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_solo::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_solo::text, 'role', 'authenticated')::text, true);
  v_result := public.register_source_document(
    v_solo_client, v_solo_client::text || '/solo.pdf', repeat('9', 64), 'application/pdf', 500, 'upload'
  );
  IF v_result ->> 'ok' <> 'true' THEN
    RAISE EXCEPTION 'solo owner should upload, got %', v_result;
  END IF;

  v_flags := jsonb_build_object(
    'low_confidence', false,
    'arithmetic_mismatch', false,
    'duplicate_file', false,
    'duplicate_document', false,
    'bank_details_changed', false,
    'new_supplier', false
  );
  v_canonical := '{"draft_holding":"held_in_milon","guards":{"arithmetic_mismatch":false,"bank_details_changed":false,"duplicate_document":false,"duplicate_file":false,"low_confidence":false,"new_supplier":false},"ledger":"sage","mode":"draft"}';
  INSERT INTO public.ledger_post_proposals (
    client_id, document_id, target_ledger, doc_type, mode, draft_holding,
    canonical_payload, payload, payload_sha256, flags,
    supplier_key, document_number, amount, issued_on, file_sha256
  )
  SELECT
    v_solo_client, d.id, 'sage', 'bill', 'draft', 'held_in_milon',
    v_canonical, v_canonical::jsonb, public.ledger_payload_sha256(v_canonical), v_flags,
    'beta', 'B-1', 10.00, date '2026-10-11', d.sha256
  FROM public.source_documents d
  WHERE d.id = (v_result ->> 'document_id')::uuid
  RETURNING id INTO v_proposal;

  v_result := public.decide_ledger_post_proposal(v_proposal, 'approve', NULL);
  IF v_result ->> 'status' <> 'approved' OR v_result ->> 'approver_role' <> 'owner' THEN
    RAISE EXCEPTION 'the owner should approve when there is no firm, got %', v_result;
  END IF;
  IF v_result ->> 'status' = 'signed_off' THEN
    RAISE EXCEPTION 'approval must not be stored as a sign-off';
  END IF;

  UPDATE public.ledger_posting_config
    SET final_unlock_after_clean_drafts = v_saved_n
    WHERE singleton;

  -- storage.protect_delete refuses a delete on storage.objects, so this test leaves that table alone. It does not insert objects.
  DELETE FROM public.ledger_post_proposals WHERE client_id IN (v_firm_client, v_solo_client);
  DELETE FROM public.document_extractions WHERE client_id IN (v_firm_client, v_solo_client);
  DELETE FROM public.supplier_trust WHERE client_id IN (v_firm_client, v_solo_client);
  DELETE FROM public.source_documents WHERE client_id IN (v_firm_client, v_solo_client);
  DELETE FROM public.client_practice_access WHERE client_id IN (v_firm_client, v_solo_client);
  DELETE FROM public.client_employees WHERE client_id IN (v_firm_client, v_solo_client);
  DELETE FROM public.audit_log WHERE client_id IN (v_firm_client, v_solo_client);
  DELETE FROM public.client_memberships WHERE client_id IN (v_firm_client, v_solo_client);
  DELETE FROM public.clients WHERE id IN (v_firm_client, v_solo_client);
  ALTER TABLE public.firm_memberships DISABLE TRIGGER firm_memberships_partner_guard_del;
  DELETE FROM public.firm_memberships WHERE firm_id = v_firm;
  ALTER TABLE public.firm_memberships ENABLE TRIGGER firm_memberships_partner_guard_del;
  DELETE FROM public.firms WHERE id = v_firm;
  DELETE FROM public.profiles WHERE id IN (v_firm_owner, v_staff, v_unassigned, v_owner, v_member, v_outsider, v_solo, v_solo_member);
  DELETE FROM auth.users WHERE id IN (v_firm_owner, v_staff, v_unassigned, v_owner, v_member, v_outsider, v_solo, v_solo_member);

  RAISE NOTICE 'source-documents-ledger-sql-tests: ok';
END;
$$;
