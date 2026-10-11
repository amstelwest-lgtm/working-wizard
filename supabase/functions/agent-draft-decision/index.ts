/**
 * Approve or dismiss one agent draft.
 *
 * POST { finding_id, decision: "approve" | "dismiss", edits?: { title?, detail? } }
 * Caller JWT. verify_jwt is true. The caller is a firm member or accountant on
 * the client, or the owner for an owner-side draft.
 *
 * 200 { ok, finding_id, decision, already, status, record_table?, record_id?,
 *       approved_by?, approved_at?, dismissed_reason? }
 * A second approve returns the same record_id. Nothing is emailed. Nothing is signed off.
 * accountant_handoff_draft inserts accountant_requests (status open). It does not
 * call the marketplace accept or recipient RPCs. A client with no firm, or an
 * open request already on that firm, is refused and the draft stays unlinked.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  DISMISSED_BY_USER,
  DRAFT_DECISION_KINDS,
  actionPlanInsert,
  applyDraftEdits,
  draftDecisionAccess,
  isDraftFinding,
  liveRecordForDraft,
  recordMarksSignedOff,
  repeatDecision,
  settledDraftEvidence,
  type DraftDecision,
  type RepeatDecision,
} from "../../../src/lib/agent-draft-decision.ts";

const DECISION_KINDS = new Set<string>(DRAFT_DECISION_KINDS);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

type FindingRow = {
  id: string;
  client_id: string;
  kind: string;
  severity: string;
  title: string;
  detail: string | null;
  evidence: unknown;
  superseded_by: string | null;
  status: string | null;
  dismissed_reason: string | null;
  approved_by: string | null;
  approved_at: string | null;
  approved_table: string | null;
  approved_row_id: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ ok: false, error: "unauthorised" }, 401);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !anonKey || !serviceKey) return json({ ok: false, error: "not_configured" }, 500);

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const admin = createClient(url, serviceKey);
  const {
    data: { user },
    error: authErr,
  } = await userClient.auth.getUser();
  if (authErr || !user) return json({ ok: false, error: "unauthorised" }, 401);

  let body: { finding_id?: unknown; decision?: unknown; edits?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }
  const findingId = typeof body.finding_id === "string" ? body.finding_id : "";
  const decision = body.decision === "approve" || body.decision === "dismiss" ? body.decision : "";
  if (!isUuid(findingId)) return json({ ok: false, error: "finding_id_required" }, 400);
  if (!decision) return json({ ok: false, error: "decision_invalid" }, 400);
  const edits = editFields(body.edits);
  if (edits === "invalid") return json({ ok: false, error: "edits_invalid" }, 400);

  const { data: finding, error: findingError } = await admin
    .from("agent_findings")
    .select(
      "id, client_id, kind, severity, title, detail, evidence, superseded_by, status, dismissed_reason, approved_by, approved_at, approved_table, approved_row_id",
    )
    .eq("id", findingId)
    .maybeSingle();
  if (findingError) return json({ ok: false, error: "finding_lookup_failed" }, 500);
  if (!finding) return json({ ok: false, error: "finding_not_found" }, 404);
  const row = finding as FindingRow;

  const { data: client, error: clientError } = await admin
    .from("clients")
    .select("owner_user_id, firm_id")
    .eq("id", row.client_id)
    .maybeSingle();
  if (clientError) return json({ ok: false, error: "access_check_failed" }, 500);
  if (!client) return json({ ok: false, error: "client_not_found" }, 404);
  const firmId = (client.firm_id as string | null) ?? null;
  const ownerUserId = (client.owner_user_id as string | null) ?? null;
  const firmMember = await callerIsFirmMember(admin, user.id, row.client_id, firmId);
  if (!firmMember && ownerUserId !== user.id) return json({ ok: false, error: "forbidden" }, 403);
  if (!DECISION_KINDS.has(row.kind)) return json({ ok: false, error: "not_a_draft" }, 400);

  const access = draftDecisionAccess({
    kind: row.kind,
    userId: user.id,
    ownerUserId,
    firmMember,
  });
  const prior = repeatDecision(decision, {
    status: row.status,
    dismissedReason: row.dismissed_reason,
    approvedTable: row.approved_table,
    approvedRowId: row.approved_row_id,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
  });
  if (prior.action !== "apply") {
    if (!access.ok) return json({ ok: false, error: "forbidden" }, 403);
    if (prior.action === "conflict") return json({ ok: false, error: prior.error }, 409);
    return decidedJson(row.id, decision, prior);
  }
  if (!access.ok) return json({ ok: false, error: access.error }, 403);
  if (row.superseded_by) return json({ ok: false, error: "superseded" }, 409);
  if (!isDraftFinding({ kind: row.kind, evidence: row.evidence })) {
    return json({ ok: false, error: "not_a_draft" }, 400);
  }

  const text = applyDraftEdits({
    title: row.title,
    detail: row.detail,
    edits: edits ?? undefined,
  });
  if (!text.ok) return json({ ok: false, error: text.error }, 400);

  if (decision === "dismiss") {
    const { data: dismissed, error: dismissError } = await admin
      .from("agent_findings")
      .update({
        status: "dismissed",
        dismissed_reason: DISMISSED_BY_USER,
        evidence: settledDraftEvidence(row.evidence),
      })
      .eq("id", row.id)
      .is("status", null)
      .select("id")
      .maybeSingle();
    if (dismissError) return json({ ok: false, error: "decision_not_saved" }, 500);
    if (!dismissed) return await reread(admin, row.id, decision);
    return json({
      ok: true,
      finding_id: row.id,
      decision: "dismiss",
      already: false,
      status: "dismissed",
      dismissed_reason: DISMISSED_BY_USER,
    });
  }

  let planId: string | undefined;
  let seq: number | undefined;
  if (row.kind === "action_point_draft") {
    const plan = await ensureActionPlan(admin, row.client_id);
    if ("error" in plan) return json({ ok: false, error: plan.error }, 500);
    planId = plan.planId;
    seq = plan.seq;
  }

  const live = liveRecordForDraft({
    kind: row.kind,
    title: text.title,
    detail: text.detail,
    severity: row.severity,
    clientId: row.client_id,
    userId: user.id,
    seat: access.seat,
    firmId,
    findingId: row.id,
    planId,
    seq,
  });
  if (!live.ok) {
    const status = live.error === "client_has_no_firm" ? 409 : live.error === "signed_off_refused" ? 400 : 500;
    return json({ ok: false, error: live.error }, status);
  }
  if (recordMarksSignedOff(live.record.row)) return json({ ok: false, error: "signed_off_refused" }, 400);

  const { data: created, error: insertError } = await admin
    .from(live.record.table)
    .insert(live.record.row)
    .select("id")
    .maybeSingle();
  if (insertError) {
    if (insertError.code === "23505" && live.record.table === "accountant_requests") {
      return json({ ok: false, error: "accountant_request_already_open" }, 409);
    }
    return json({ ok: false, error: "record_not_saved" }, 500);
  }
  const recordId = created?.id as string | undefined;
  if (!recordId) return json({ ok: false, error: "record_not_saved" }, 500);

  const approvedAt = new Date().toISOString();
  const { data: marked, error: markError } = await admin
    .from("agent_findings")
    .update({
      status: "approved",
      title: text.title,
      detail: text.detail || null,
      evidence: settledDraftEvidence(row.evidence),
      approved_by: user.id,
      approved_at: approvedAt,
      approved_table: live.record.table,
      approved_row_id: recordId,
    })
    .eq("id", row.id)
    .is("status", null)
    .select("id")
    .maybeSingle();
  if (markError || !marked) {
    await admin.from(live.record.table).delete().eq("id", recordId);
    if (markError) return json({ ok: false, error: "decision_not_saved" }, 500);
    return await reread(admin, row.id, decision);
  }

  return json({
    ok: true,
    finding_id: row.id,
    decision: "approve" satisfies DraftDecision,
    already: false,
    status: "approved",
    record_table: live.record.table,
    record_id: recordId,
    approved_by: user.id,
    approved_at: approvedAt,
  });
});

function editFields(raw: unknown): { title?: string; detail?: string } | null | "invalid" {
  if (raw == null) return null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "invalid";
  const record = raw as Record<string, unknown>;
  const edits: { title?: string; detail?: string } = {};
  if ("title" in record) {
    if (typeof record.title !== "string") return "invalid";
    edits.title = record.title;
  }
  if ("detail" in record) {
    if (typeof record.detail !== "string") return "invalid";
    edits.detail = record.detail;
  }
  return edits;
}

async function callerIsFirmMember(
  admin: ReturnType<typeof createClient>,
  userId: string,
  clientId: string,
  firmId: string | null,
): Promise<boolean> {
  if (firmId) {
    const { data: member } = await admin
      .from("firm_memberships")
      .select("user_id")
      .eq("firm_id", firmId)
      .eq("user_id", userId)
      .maybeSingle();
    if (member?.user_id) return true;
    const { data: firm } = await admin.from("firms").select("owner_user_id").eq("id", firmId).maybeSingle();
    if (firm?.owner_user_id === userId) return true;
  }
  const { data: practice } = await admin
    .from("client_practice_access")
    .select("classification")
    .eq("client_id", clientId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  return Boolean(practice && practice.classification !== "read_only");
}

async function ensureActionPlan(
  admin: ReturnType<typeof createClient>,
  clientId: string,
): Promise<{ planId: string; seq: number } | { error: string }> {
  const { data: plan, error: planError } = await admin
    .from("action_plans")
    .select("id")
    .eq("client_id", clientId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (planError) return { error: "plan_lookup_failed" };
  let planId = plan?.id as string | undefined;
  if (!planId) {
    const { data: created, error: createError } = await admin
      .from("action_plans")
      .insert(actionPlanInsert(clientId, new Date()))
      .select("id")
      .maybeSingle();
    if (createError || !created?.id) return { error: "plan_not_saved" };
    planId = created.id as string;
  }
  const { data: latest, error: seqError } = await admin
    .from("action_items")
    .select("seq")
    .eq("plan_id", planId)
    .order("seq", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (seqError) return { error: "plan_lookup_failed" };
  return { planId, seq: ((latest?.seq as number | undefined) ?? 0) + 1 };
}

function decidedJson(
  findingId: string,
  decision: DraftDecision,
  prior: Extract<RepeatDecision, { action: "return" }>,
) {
  return json({
    ok: true,
    finding_id: findingId,
    decision,
    already: true,
    status: prior.status,
    ...(prior.status === "approved"
      ? {
          record_table: prior.recordTable,
          record_id: prior.recordId,
          approved_by: prior.approvedBy,
          approved_at: prior.approvedAt,
        }
      : { dismissed_reason: prior.dismissedReason }),
  });
}

async function reread(
  admin: ReturnType<typeof createClient>,
  findingId: string,
  decision: DraftDecision,
): Promise<Response> {
  const { data, error } = await admin
    .from("agent_findings")
    .select("id, status, dismissed_reason, approved_by, approved_at, approved_table, approved_row_id")
    .eq("id", findingId)
    .maybeSingle();
  if (error || !data) return json({ ok: false, error: "decision_not_saved" }, 500);
  const again = repeatDecision(decision, {
    status: (data.status as string | null) ?? null,
    dismissedReason: (data.dismissed_reason as string | null) ?? null,
    approvedTable: (data.approved_table as string | null) ?? null,
    approvedRowId: (data.approved_row_id as string | null) ?? null,
    approvedBy: (data.approved_by as string | null) ?? null,
    approvedAt: (data.approved_at as string | null) ?? null,
  });
  if (again.action === "return") return decidedJson(findingId, decision, again);
  if (again.action === "conflict") return json({ ok: false, error: again.error }, 409);
  return json({ ok: false, error: "decision_not_saved" }, 500);
}
