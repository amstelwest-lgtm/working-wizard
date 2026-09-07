/**
 * Client Brain propose — Claude drafts next steps + GAP/competitor stubs,
 * and slow-drips one outstanding owner question.
 *
 * Reuses ask-ai auth, CORS, rate-limit RPC, and callClaude.
 * Writes status=proposed / gap status=draft only. Never signed_off.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callClaude } from "../ask-ai/anthropic.ts";
import {
  PROPOSE_RATE_LIMIT,
  applyDraftBrainPatches,
  filterNewProposedSteps,
  ownerDripCandidatesFromStored,
  parseClaudeProposePayload,
  pickNextOwnerDrip,
  activeOwnerDrip,
  type DripCandidate,
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

const SYSTEM = `You are a sharp SME CFO copilot briefing an accountant.
Return ONLY valid JSON, no markdown, no prose.
Schema:
{"next_steps":[{"title":"","rationale":"","assumptions":[""]}],"gap_items":[{"key":"","title":"","detail":"","severity":"high|medium|low"}],"competitors":[{"name":"","notes":"","threat":""}]}
Rules:
- Ground every item in the provided context. If evidence is missing, use an empty array for that key.
- Never invent figures, competitor names, GAP items, or next steps.
- Max 3 next_steps, max 3 gap_items, max 3 competitors.
- Do not mark anything signed_off. Do not treat drafts as truth.
- Titles must be concrete actions an accountant could Approve / Edit / Reject.`;

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

  let body: {
    clientId?: string;
    outstanding?: Array<{ key?: string; prompt?: string; audience?: string }>;
  };
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
    p_tier: "brain_propose",
    p_input_tokens: 0,
    p_output_tokens: 0,
    p_latency_ms: 0,
    p_limit: PROPOSE_RATE_LIMIT,
  });
  if (rlErr) {
    console.warn("ask_ai_record_request unavailable:", rlErr.message);
  } else if (allowed === false) {
    return respond({ error: "Rate limit exceeded. Try proposing again in an hour." }, 429);
  }

  const [clientRes, snapRes, stepRes, qRes] = await Promise.all([
    userClient
      .from("clients")
      .select("name, business_type, operating_profile, brain_summary, brain_summary_updated_at")
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
      .from("proposed_next_steps")
      .select("title, status")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(50),
    userClient
      .from("client_brain_questions")
      .select("id, question_key, prompt_text, status, audience, last_asked_at")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(80),
  ]);

  const client = clientRes.data;
  const brainSummary = client?.brain_summary ?? null;
  const existingSteps = (stepRes.data ?? []) as Array<{ title: string; status: string }>;
  const storedQuestions = (qRes.data ?? []) as Array<{
    id: string;
    question_key: string;
    prompt_text: string | null;
    status: string;
    audience: string;
    last_asked_at: string | null;
  }>;

  const storedByKey = new Map(storedQuestions.map((q) => [q.question_key, q]));
  const fromBody = (body.outstanding ?? [])
    .filter((q) => q.key && (q.audience === "owner" || q.audience === "both" || !q.audience))
    .map((q) => {
      const row = storedByKey.get(q.key!);
      return {
        key: q.key!,
        prompt: (q.prompt ?? "").trim() || q.key!,
        audience: (q.audience === "owner" ? "owner" : "both") as "owner" | "both",
        lastAskedAt: row?.last_asked_at ?? null,
        storedId: row?.id,
      };
    });
  const dripCandidates =
    fromBody.length > 0 ? fromBody : ownerDripCandidatesFromStored(storedQuestions);
  const now = new Date();
  const existingDrip = activeOwnerDrip(dripCandidates, now);
  let drip: DripCandidate | null = existingDrip;
  if (!drip) {
    const next = pickNextOwnerDrip(dripCandidates, now);
    if (next) {
      const stamped = new Date().toISOString();
      if (next.storedId) {
        await userClient
          .from("client_brain_questions")
          .update({ last_asked_at: stamped })
          .eq("id", next.storedId)
          .eq("client_id", clientId);
      } else {
        await userClient.from("client_brain_questions").upsert(
          {
            client_id: clientId,
            question_key: next.key,
            prompt_text: next.prompt,
            audience: next.audience,
            status: "unanswered",
            last_asked_at: stamped,
          },
          { onConflict: "client_id,question_key" },
        );
      }
      drip = { ...next, lastAskedAt: stamped };
    }
  }

  const contextLines: string[] = [];
  if (client?.name) contextLines.push(`Client: ${client.name}`);
  if (client?.business_type) contextLines.push(`Business type: ${client.business_type}`);
  const profile = client?.operating_profile;
  if (profile && typeof profile === "object") {
    contextLines.push(`Operating profile: ${compact(profile, 1200)}`);
  }
  if (brainSummary && typeof brainSummary === "object") {
    const blob = brainSummary as Record<string, unknown>;
    if (blob.headline || blob.body || blob.summary) {
      contextLines.push(`Brain summary: ${compact(blob.headline ?? blob.body ?? blob.summary, 600)}`);
    }
    if (blob.gap_report) contextLines.push(`Existing GAP: ${compact(blob.gap_report, 800)}`);
    if (blob.competitors) contextLines.push(`Existing competitors: ${compact(blob.competitors, 600)}`);
    if (blob.business_map) contextLines.push(`Business map: ${compact(blob.business_map, 600)}`);
  }
  const snap = snapRes.data;
  if (snap) {
    contextLines.push(`Latest snapshot: ${snap.period_label ?? snap.period_date ?? "unknown"} (${snap.source ?? "n/a"})`);
    const ratios = ratioLines(snap.ratios);
    if (ratios.length) contextLines.push(`Ratios:\n  ${ratios.join("\n  ")}`);
  }
  const unanswered = storedQuestions.filter((q) => q.status === "unanswered");
  if (unanswered.length) {
    contextLines.push(
      "Unanswered questions:\n" +
        unanswered
          .slice(0, 12)
          .map((q) => `  - ${q.question_key}: ${q.prompt_text ?? ""}`)
          .join("\n"),
    );
  }
  const openSteps = existingSteps.filter((s) => s.status === "proposed" || s.status === "edited");
  if (openSteps.length) {
    contextLines.push("Open proposed next steps:\n" + openSteps.map((s) => `  - ${s.title}`).join("\n"));
  }

  let skippedReason: "ai_not_configured" | "empty_context" | undefined;
  let payload = parseClaudeProposePayload("{}");

  if (!Deno.env.get("ANTHROPIC_API_KEY")) {
    skippedReason = "ai_not_configured";
  } else if (contextLines.length === 0) {
    skippedReason = "empty_context";
  } else {
    try {
      const claude = await callClaude(
        SYSTEM,
        `Propose next steps from this client brain. Empty arrays when evidence is missing.\n\n${contextLines.join("\n")}`,
        { maxTokens: 1400, temperature: 0.2 },
      );
      payload = parseClaudeProposePayload(claude.text);
      adminClient
        .from("ask_ai_log")
        .update({
          input_tokens: claude.inputTokens,
          output_tokens: claude.outputTokens,
          latency_ms: claude.latencyMs,
        })
        .eq("user_id", user.id)
        .eq("tier", "brain_propose")
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

  const toInsert = filterNewProposedSteps(payload.next_steps, existingSteps);
  let stepsInserted = 0;
  if (toInsert.length) {
    const { error: insErr } = await userClient.from("proposed_next_steps").insert(
      toInsert.map((step) => ({
        client_id: clientId,
        title: step.title,
        rationale: step.rationale,
        assumptions: step.assumptions,
        status: "proposed",
        created_by: user.id,
      })),
    );
    if (insErr) {
      console.error("proposed_next_steps insert:", insErr.message);
      return respond({ error: insErr.message }, 500);
    }
    stepsInserted = toInsert.length;
  }

  const nowIso = new Date().toISOString();
  const patched = applyDraftBrainPatches(brainSummary, payload, nowIso);
  if (patched.gapAdded > 0 || patched.competitorAdded > 0) {
    const { error: sumErr } = await userClient
      .from("clients")
      .update({
        brain_summary: patched.blob,
        brain_summary_updated_at: nowIso,
      })
      .eq("id", clientId);
    if (sumErr) {
      console.error("brain_summary update:", sumErr.message);
      return respond({ error: sumErr.message }, 500);
    }
  }

  return respond({
    stepsInserted,
    gapDrafts: patched.gapAdded,
    competitorDrafts: patched.competitorAdded,
    drip: drip ? { key: drip.key, prompt: drip.prompt } : null,
    skippedReason: skippedReason,
  });
});
