/**
 * Tax document review. Service role only.
 * Reads the shared files from one finished send, asks for one accountant
 * review, and stores it. Does not deploy from this repo. Does not email,
 * and does not write a client deliverable.
 *
 * deploy: agent-tax-specialist
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callClaudeRound } from "../_shared/agent-core/claude.ts";
import { TAX_SPECIALIST_QUEUE, TAX_SPECIALIST_SETTING, taxSpecialistEnabled } from "../../../src/lib/agent-tax-flag.ts";
import {
  estimateTaxReviewTokens,
  reviewTaxSend,
  taxReviewExceedsCap,
  taxReviewSystemPrompt,
  taxReviewUserPrompt,
  type TaxArtifact,
} from "../../../src/lib/tax-specialist-review.ts";

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

function bearerRole(authHeader: string): string | null {
  try {
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const pad = (s: string) => s + "=".repeat((4 - (s.length % 4)) % 4);
    const payload = JSON.parse(atob(pad(parts[1].replace(/-/g, "+").replace(/_/g, "/"))));
    return typeof payload?.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

// deno-lint-ignore no-explicit-any
type Admin = any;

async function artifactText(db: Admin, path: string, mime: string): Promise<string> {
  if (!/text\/|json|csv/.test(mime)) return "";
  const downloaded = await db.storage.from("client-documents").download(path);
  if (downloaded.error || !downloaded.data) return "";
  const text = await downloaded.data.text();
  return text.slice(0, 8000);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (bearerRole(req.headers.get("authorization") ?? "") !== "service_role") {
    return json({ error: "forbidden" }, 403);
  }

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !serviceKey) return json({ error: "not_configured" }, 500);
  const db = createClient(url, serviceKey);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const sendId = body.send_id;
  const clientId = body.client_id;
  const firmId = body.firm_id;
  const msgId = typeof body.msg_id === "number" ? body.msg_id : null;
  if (!isUuid(sendId) || !isUuid(clientId) || !isUuid(firmId)) {
    return json({ error: "payload_required" }, 400);
  }

  const setting = await db
    .from("agent_settings")
    .select("value")
    .eq("key", TAX_SPECIALIST_SETTING)
    .maybeSingle();
  if (!taxSpecialistEnabled(setting.data?.value, firmId)) {
    return json({ skipped: true, reason: "disabled" });
  }

  const started = await db.rpc("begin_agent_run", {
    p_agent: "tax_specialist",
    p_client_id: clientId,
    p_trigger: "upload",
    p_inputs: `send:${sendId}`,
    p_audience: "accountant",
    p_correlation_id: null,
    p_attempt: 1,
  });
  if (started.error) return json({ error: "run_not_started" }, 500);
  const run = Array.isArray(started.data) ? started.data[0] : started.data;
  const runId = run?.run_id as string | undefined;
  if (!runId) return json({ error: "run_not_started" }, 500);
  if (run.is_new === false && (run.status === "succeeded" || run.status === "partial")) {
    if (msgId != null) {
      await db.rpc("agent_queue_archive", { p_queue: TAX_SPECIALIST_QUEUE, p_msg_id: msgId });
    }
    return json({ ok: true, already: true, run_id: runId });
  }

  const listed = await db
    .from("client_artifacts")
    .select("id, storage_path, visibility, meta")
    .eq("client_id", clientId)
    .eq("visibility", "shared");
  if (listed.error) return json({ error: "artifacts_unreadable" }, 500);
  const artifacts: TaxArtifact[] = [];
  for (const row of listed.data ?? []) {
    const meta = row.meta && typeof row.meta === "object" ? (row.meta as Record<string, unknown>) : {};
    if (meta.source !== "client_agent_send" || meta.send_id !== sendId) continue;
    const mime = typeof meta.mime === "string" ? meta.mime : "";
    const fileName = typeof meta.file_name === "string" ? meta.file_name : "document";
    const itemKey = typeof meta.item_key === "string" ? meta.item_key : null;
    const text = typeof row.storage_path === "string" ? await artifactText(db, row.storage_path, mime) : "";
    artifacts.push({ id: String(row.id), fileName, itemKey, text });
  }

  const estimate = estimateTaxReviewTokens(artifacts);
  const capped = taxReviewExceedsCap(estimate);
  let model: unknown = null;
  let usage: { inputTokens: number; outputTokens: number; cacheWriteTokens: number; cacheReadTokens: number } | undefined;
  if (!capped && artifacts.length > 0) {
    const round = await callClaudeRound(taxReviewSystemPrompt(), [
      { role: "user", content: taxReviewUserPrompt(artifacts) },
    ], [
      {
        name: "record_tax_review",
        description: "Record the accountant review.",
        input_schema: { type: "object", additionalProperties: true },
      },
    ], { maxTokens: Math.max(estimate.outputTokens, 256), temperature: 0 });
    const tool = round.toolUses.find((use) => use.name === "record_tax_review");
    model = tool?.input ?? round.text;
    usage = {
      inputTokens: round.inputTokens,
      outputTokens: round.outputTokens,
      cacheWriteTokens: round.cacheCreationTokens,
      cacheReadTokens: round.cacheReadTokens,
    };
  }

  const review = reviewTaxSend({
    sendId,
    artifacts,
    model: capped ? null : model,
    usage: capped ? undefined : usage,
  });

  const existing = await db
    .from("agent_findings")
    .select("id")
    .eq("run_id", runId)
    .eq("kind", "tax_document_review")
    .limit(1);
  if (!existing.error && (existing.data ?? []).length === 0) {
    await db.from("agent_findings").insert({
      agent: "tax_specialist",
      client_id: clientId,
      run_id: runId,
      kind: "tax_document_review",
      severity: "info",
      title: review.title,
      detail: review.detail,
      evidence: review.evidence,
      last_seen: new Date().toISOString(),
    });
  }
  for (const question of review.questions) {
    await db.from("client_brain_questions").upsert(
      {
        client_id: clientId,
        question_key: question.question_key,
        prompt_text: question.prompt_text,
        audience: "accountant",
        status: "unanswered",
      },
      { onConflict: "client_id,question_key", ignoreDuplicates: true },
    );
  }

  await db
    .from("agent_runs")
    .update({
      status: "succeeded",
      summary: review.detail,
      input_tokens: review.inputTokens,
      output_tokens: review.outputTokens,
      cache_write_tokens: review.cacheWriteTokens,
      cache_read_tokens: review.cacheReadTokens,
      cost_usd: review.costUsd,
      finished_at: new Date().toISOString(),
      stop_reason: review.skippedForCost ? "cost_cap" : "objective_complete",
    })
    .eq("id", runId);

  if (msgId != null) {
    await db.rpc("agent_queue_archive", { p_queue: TAX_SPECIALIST_QUEUE, p_msg_id: msgId });
  }
  return json({
    ok: true,
    run_id: runId,
    cost_usd: review.costUsd,
    skipped_for_cost: review.skippedForCost,
  });
});
