/**
 * Client Brain deliverable draft — Claude drafts an advisory pack with an
 * explicit assumptions list into deliverable_drafts.
 *
 * Reuses ask-ai auth, CORS, rate-limit RPC, and callClaude.
 * Writes status=draft only. Never ready / sent / discarded.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callClaude } from "../ask-ai/anthropic.ts";
import {
  DRAFT_RATE_LIMIT,
  composeDraftBody,
  filterNewDeliverableDraft,
  parseClaudeDeliverablePayload,
} from "./logic.ts";

function buildCorsHeaders(requestOrigin: string | null): Record<string, string> {
  const allowed = Deno.env.get("ALLOWED_ORIGINS");
  let allowOrigin = "*";
  if (allowed && requestOrigin) {
    const list = allowed.split(",").map((s) => s.trim());
    if (list.includes(requestOrigin)) {
      allowOrigin = requestOrigin;
    } else {
      allowOrigin = list[0] ?? "*";
    }
  }
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function json(body: unknown, status = 200, corsHeaders?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...(corsHeaders ?? { "Access-Control-Allow-Origin": "*" }), "Content-Type": "application/json" },
  });
}

const SYSTEM = `You are a sharp SME CFO copilot drafting an advisory pack an accountant will review before sending.
Return ONLY valid JSON, no markdown, no prose.
Schema:
{"kind":"advisory|client_email|meeting_agenda|exec_summary","subject":"","body":"","assumptions":[""]}
Rules:
- Ground the body in the provided context. If evidence is missing, return {"kind":"advisory","subject":"","body":"","assumptions":[]}.
- Never invent figures, names, or claims. Missing facts stay missing.
- assumptions is an explicit list of things the accountant must tick before sign-off. Empty array if none are warranted.
- Do not mark the draft ready or sent. Do not include a status field.
- body is the deliverable the accountant could send after sign-off. For client_email, do not put SUBJECT inside body; use subject.
- Keep body under 900 words. Max 8 assumptions.`;

function compact(value: unknown, max = 800): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function ratioLines(raw: unknown): string[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof val !== "number" || !Number.isFinite(val)) continue;
    out.push(`${key}: ${val}`);
    if (out.length >= 16) break;
  }
  return out;
}

Deno.serve(async (req: Request) => {
  const cors = buildCorsHeaders(req.headers.get("Origin"));
  const respond = (body: unknown, status = 200) => json(body, status, cors);

  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return respond({ error: "Unauthorised" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const adminClient = createClient(supabaseUrl, serviceKey);

  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return respond({ error: "Unauthorised" }, 401);

  let body: { clientId?: string };
  try {
    body = await req.json();
  } catch {
    return respond({ error: "Invalid JSON body" }, 400);
  }
  const clientId = body.clientId;
  if (!clientId) return respond({ error: "clientId is required" }, 400);

  const { data: hasAccess, error: accessErr } = await adminClient
    .rpc("has_client_access", { _user_id: user.id, _client_id: clientId });
  if (accessErr) {
    console.error("has_client_access error:", accessErr.message);
    return respond({ error: "Access check failed" }, 500);
  }
  if (!hasAccess) return respond({ error: "Client not accessible" }, 403);

  const { data: allowed, error: rlErr } = await adminClient.rpc("ask_ai_record_request", {
    p_user_id: user.id,
    p_client_id: clientId,
    p_tier: "brain_deliverable",
    p_input_tokens: 0,
    p_output_tokens: 0,
    p_latency_ms: 0,
    p_limit: DRAFT_RATE_LIMIT,
  });
  if (rlErr) {
    console.warn("ask_ai_record_request unavailable:", rlErr.message);
  } else if (allowed === false) {
    return respond({ error: "Rate limit exceeded. Try drafting again in an hour." }, 429);
  }

  const [clientRes, snapRes, factRes, stepRes, draftRes] = await Promise.all([
    userClient
      .from("clients")
      .select("name, business_type, operating_profile, brain_summary")
      .eq("id", clientId)
      .maybeSingle(),
    userClient
      .from("client_financial_snapshots")
      .select("period_label, period_date, ratios, source")
      .eq("client_id", clientId)
      .order("period_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    userClient
      .from("context_facts")
      .select("fact_text, category, source")
      .eq("client_id", clientId)
      .is("superseded_by", null)
      .order("created_at", { ascending: false })
      .limit(20),
    userClient
      .from("proposed_next_steps")
      .select("title, rationale, status")
      .eq("client_id", clientId)
      .in("status", ["proposed", "approved", "edited"])
      .order("created_at", { ascending: false })
      .limit(12),
    userClient
      .from("deliverable_drafts")
      .select("kind, body, status")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const client = clientRes.data;
  const existingDrafts = (draftRes.data ?? []) as Array<{
    kind: string | null;
    body: string | null;
    status: string;
  }>;

  const contextLines: string[] = [];
  if (client?.name) contextLines.push(`Client: ${client.name}`);
  if (client?.business_type) contextLines.push(`Business type: ${client.business_type}`);
  const profile = client?.operating_profile;
  if (profile && typeof profile === "object") {
    contextLines.push(`Operating profile: ${compact(profile, 1200)}`);
  }
  const brainSummary = client?.brain_summary;
  if (brainSummary && typeof brainSummary === "object") {
    const blob = brainSummary as Record<string, unknown>;
    if (blob.headline || blob.body || blob.summary) {
      contextLines.push(`Brain summary: ${compact(blob.headline ?? blob.body ?? blob.summary, 800)}`);
    }
    if (blob.gap_report) contextLines.push(`GAP: ${compact(blob.gap_report, 800)}`);
    if (blob.competitors) contextLines.push(`Competitors: ${compact(blob.competitors, 600)}`);
    if (blob.business_map) contextLines.push(`Business map: ${compact(blob.business_map, 600)}`);
  }
  const snap = snapRes.data;
  if (snap) {
    contextLines.push(`Latest snapshot: ${snap.period_label ?? snap.period_date ?? "unknown"} (${snap.source ?? "n/a"})`);
    const ratios = ratioLines(snap.ratios);
    if (ratios.length) contextLines.push(`Ratios:\n  ${ratios.join("\n  ")}`);
  }
  const facts = (factRes.data ?? []) as Array<{ fact_text: string; category: string | null }>;
  if (facts.length) {
    contextLines.push(
      "Context facts:\n" +
        facts
          .slice(0, 12)
          .map((f) => `  - ${f.category ? `${f.category}: ` : ""}${f.fact_text}`)
          .join("\n"),
    );
  }
  const steps = (stepRes.data ?? []) as Array<{ title: string; rationale: string | null; status: string }>;
  if (steps.length) {
    contextLines.push(
      "Next steps:\n" +
        steps.map((s) => `  - [${s.status}] ${s.title}${s.rationale ? ` — ${s.rationale}` : ""}`).join("\n"),
    );
  }

  let skippedReason: "ai_not_configured" | "empty_context" | "similar_open" | "empty_draft" | undefined;
  let payload = parseClaudeDeliverablePayload("{}");

  if (!Deno.env.get("ANTHROPIC_API_KEY")) {
    skippedReason = "ai_not_configured";
  } else if (contextLines.length === 0) {
    skippedReason = "empty_context";
  } else {
    try {
      const claude = await callClaude(
        SYSTEM,
        `Draft one advisory pack from this client brain. Empty body and empty assumptions when evidence is missing.\n\n${contextLines.join("\n")}`,
        { maxTokens: 1800, temperature: 0.2 },
      );
      payload = parseClaudeDeliverablePayload(claude.text);
      adminClient
        .from("ask_ai_log")
        .update({
          input_tokens: claude.inputTokens,
          output_tokens: claude.outputTokens,
          latency_ms: claude.latencyMs,
        })
        .eq("user_id", user.id)
        .eq("tier", "brain_deliverable")
        .order("created_at", { ascending: false })
        .limit(1)
        .then(({ error: e }) => {
          if (e) console.warn("Token count update failed:", e.message);
        });
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.startsWith("Rate limit")) return respond({ error: msg }, 429);
      if (/ANTHROPIC_API_KEY missing/i.test(msg)) {
        skippedReason = "ai_not_configured";
      } else {
        return respond({ error: msg }, 500);
      }
    }
  }

  const toInsert = filterNewDeliverableDraft(payload, existingDrafts);
  if (!toInsert) {
    if (!skippedReason) {
      skippedReason = payload?.body?.trim() ? "similar_open" : "empty_draft";
    }
    return respond({ draftInserted: false, skippedReason });
  }

  const { error: insErr } = await userClient.from("deliverable_drafts").insert({
    client_id: clientId,
    kind: toInsert.kind,
    body: composeDraftBody(toInsert.subject, toInsert.body),
    assumption_checklist: toInsert.assumptions,
    status: "draft",
    created_by: user.id,
  });
  if (insErr) {
    console.error("deliverable_drafts insert:", insErr.message);
    return respond({ error: insErr.message }, 500);
  }

  return respond({ draftInserted: true });
});
