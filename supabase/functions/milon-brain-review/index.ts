/**
 * Brain P1: on-demand weekly pattern review + Theo approve/reject queue.
 * POST { action: "run_review" | "list" | "approve" | "reject", id?: string, days?: number }
 * Caller JWT must pass is_milon_ops (owner allowlist or Milōn IT).
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  anonymiseMilonBrainLessonText,
  groupMilonBrainPatterns,
  isBrainReviewRowDecidable,
  lessonCandidateInsert,
  MILON_BRAIN_LAYER_MILON_WIDE,
  MILON_BRAIN_LAYER_PRIVATE,
  MILON_BRAIN_REVIEW_DEFAULT_DAYS,
  MILON_BRAIN_STATUS_ACTIVE,
  MILON_BRAIN_STATUS_PENDING,
  MILON_BRAIN_TASK_FEATURE_IDEA,
  nextBrainReviewStatus,
  type BrainReviewPrivateRow,
  type BrainReviewQueueItem,
} from "../../../src/lib/milon-brain-review.ts";

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

async function callerIsMilonOps(
  userClient: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data, error } = await userClient.rpc("is_milon_ops", { _user_id: userId });
  if (error) {
    console.error("is_milon_ops_failed", error.message);
    return false;
  }
  return data === true;
}

function reviewSince(days: number): string {
  const ms = days * 86400000;
  return new Date(Date.now() - ms).toISOString();
}

async function loadPrivateRules(
  admin: SupabaseClient,
  sinceIso: string,
): Promise<BrainReviewPrivateRow[]> {
  const { data, error } = await admin
    .from("milon_brain_rules")
    .select("id, firm_id, client_id, task_type, rule_text, created_at")
    .eq("layer", MILON_BRAIN_LAYER_PRIVATE)
    .eq("status", MILON_BRAIN_STATUS_ACTIVE)
    .gte("created_at", sinceIso)
    .neq("task_type", MILON_BRAIN_TASK_FEATURE_IDEA)
    .limit(5000);
  if (error) throw new Error(error.message);
  return (data ?? []) as BrainReviewPrivateRow[];
}

async function runBrainReviewScan(
  admin: SupabaseClient,
  input: { days?: number },
): Promise<{ groupsMatched: number; created: number; skippedExisting: number }> {
  const days = input.days ?? MILON_BRAIN_REVIEW_DEFAULT_DAYS;
  const sinceIso = reviewSince(days);
  const rows = await loadPrivateRules(admin, sinceIso);
  const groups = groupMilonBrainPatterns(rows);
  let created = 0;
  let skippedExisting = 0;
  for (const group of groups) {
    const { data: existing } = await admin
      .from("milon_brain_rules")
      .select("id")
      .eq("layer", MILON_BRAIN_LAYER_MILON_WIDE)
      .eq("status", MILON_BRAIN_STATUS_PENDING)
      .eq("pattern_key", group.patternKey)
      .maybeSingle();
    if (existing?.id) {
      skippedExisting += 1;
      continue;
    }
    const sourceId = rows.find(
      (r) =>
        group.firmIds.includes(r.firm_id) &&
        anonymiseMilonBrainLessonText(r.rule_text) ===
          anonymiseMilonBrainLessonText(group.sampleRuleText),
    )?.id;
    if (!sourceId) continue;
    const row = lessonCandidateInsert({
      patternKey: group.patternKey,
      taskType: group.taskType,
      sampleRuleText: group.sampleRuleText,
      sourceRuleId: sourceId,
    });
    const { error } = await admin.from("milon_brain_rules").insert(row);
    if (error) {
      if (error.code === "23505") {
        skippedExisting += 1;
        continue;
      }
      throw new Error(error.message);
    }
    created += 1;
  }
  return { groupsMatched: groups.length, created, skippedExisting };
}

async function listBrainReviewQueue(admin: SupabaseClient): Promise<BrainReviewQueueItem[]> {
  const [pendingRes, ideasRes] = await Promise.all([
    admin
      .from("milon_brain_rules")
      .select("id, task_type, rule_text, status, layer, firm_id, created_at, pattern_key")
      .eq("layer", MILON_BRAIN_LAYER_MILON_WIDE)
      .eq("status", MILON_BRAIN_STATUS_PENDING)
      .order("created_at", { ascending: false })
      .limit(100),
    admin
      .from("milon_brain_rules")
      .select("id, task_type, rule_text, status, layer, firm_id, created_at, pattern_key")
      .eq("layer", MILON_BRAIN_LAYER_PRIVATE)
      .eq("task_type", MILON_BRAIN_TASK_FEATURE_IDEA)
      .eq("status", MILON_BRAIN_STATUS_ACTIVE)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  if (pendingRes.error) throw new Error(pendingRes.error.message);
  if (ideasRes.error) throw new Error(ideasRes.error.message);
  const lessonItems: BrainReviewQueueItem[] = (pendingRes.data ?? []).map((row) => ({
    id: String(row.id),
    kind: "lesson_candidate",
    task_type: String(row.task_type),
    rule_text: String(row.rule_text),
    status: String(row.status),
    layer: String(row.layer),
    firm_id: (row.firm_id as string | null) ?? null,
    created_at: String(row.created_at),
    pattern_key: (row.pattern_key as string | null) ?? null,
  }));
  const ideaItems: BrainReviewQueueItem[] = (ideasRes.data ?? []).map((row) => ({
    id: String(row.id),
    kind: "feature_idea",
    task_type: String(row.task_type),
    rule_text: String(row.rule_text),
    status: String(row.status),
    layer: String(row.layer),
    firm_id: (row.firm_id as string | null) ?? null,
    created_at: String(row.created_at),
    pattern_key: (row.pattern_key as string | null) ?? null,
  }));
  return [...lessonItems, ...ideaItems];
}

async function decideBrainReviewRow(
  admin: SupabaseClient,
  input: { id: string; decision: "approve" | "reject"; approverId: string },
): Promise<{ ok: true; status: string }> {
  const { data: row, error: readErr } = await admin
    .from("milon_brain_rules")
    .select("id, layer, status, task_type")
    .eq("id", input.id)
    .maybeSingle();
  if (readErr) throw new Error(readErr.message);
  if (!row) throw new Error("not_found");
  const layer = String(row.layer);
  const status = String(row.status);
  const taskType = String(row.task_type);
  if (!isBrainReviewRowDecidable({ layer, status, task_type: taskType })) {
    throw new Error("not_decidable");
  }
  const nextStatus = nextBrainReviewStatus(input.decision);
  const { error: writeErr } = await admin
    .from("milon_brain_rules")
    .update({
      status: nextStatus,
      approver_id: input.approverId,
    })
    .eq("id", input.id);
  if (writeErr) throw new Error(writeErr.message);
  return { ok: true, status: nextStatus };
}

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

  const allowed = await callerIsMilonOps(userClient, user.id);
  if (!allowed) return json({ ok: false, error: "forbidden" }, 403);

  let body: { action?: unknown; id?: unknown; days?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }
  const action = body.action;
  if (action !== "run_review" && action !== "list" && action !== "approve" && action !== "reject") {
    return json({ ok: false, error: "action_invalid" }, 400);
  }

  try {
    if (action === "list") {
      const items = await listBrainReviewQueue(admin);
      return json({ ok: true, items });
    }
    if (action === "run_review") {
      const days = typeof body.days === "number" && body.days > 0 ? Math.floor(body.days) : undefined;
      const result = await runBrainReviewScan(admin, { days });
      return json({ ok: true, ...result });
    }
    const id = typeof body.id === "string" ? body.id : "";
    if (!isUuid(id)) return json({ ok: false, error: "id_required" }, 400);
  const decision = action === "approve" ? "approve" : "reject";
    const decided = await decideBrainReviewRow(admin, {
      id,
      decision,
      approverId: user.id,
    });
    return json({ ...decided, ok: true, id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "not_found") return json({ ok: false, error: "not_found" }, 404);
    if (message === "not_decidable") return json({ ok: false, error: "not_decidable" }, 409);
    console.error("milon_brain_review_failed", message);
    return json({ ok: false, error: "review_failed" }, 500);
  }
});
