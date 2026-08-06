import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sanitize } from "./sanitizer.ts";
import { classify } from "./classifier.ts";
import { buildContext } from "./context-builder.ts";
import { buildPrompt } from "./prompt.ts";
import { callClaude } from "./anthropic.ts";

const RATE_LIMIT = 30; // questions per user per hour

/**
 * Build CORS headers.
 * If ALLOWED_ORIGINS is set (comma-separated list), reflect the origin only when
 * it appears in that list. Otherwise allow all origins (development / unset).
 */
function buildCorsHeaders(requestOrigin: string | null): Record<string, string> {
  const allowed = Deno.env.get("ALLOWED_ORIGINS");
  let allowOrigin = "*";
  if (allowed && requestOrigin) {
    const list = allowed.split(",").map((s) => s.trim());
    if (list.includes(requestOrigin)) {
      allowOrigin = requestOrigin;
    } else {
      // Origin not in allowlist — still return headers so the client gets a
      // 403/error response rather than a CORS network error masking the real issue.
      allowOrigin = list[0] ?? "*";
    }
  }
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(body: unknown, status = 200, corsHeaders?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...(corsHeaders ?? { "Access-Control-Allow-Origin": "*" }), "Content-Type": "application/json" },
  });
}

/** SHA-256 of the canonical question text, hex-encoded. */
async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req: Request) => {
  // Build per-request CORS headers respecting the ALLOWED_ORIGINS env var.
  const cors = buildCorsHeaders(req.headers.get("Origin"));
  const respond = (body: unknown, status = 200) => json(body, status, cors);

  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);

  // ── Auth — extract JWT ────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return respond({ error: "Unauthorised" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey    = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  // userClient: JWT-scoped, RLS enforced on all data reads
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  // adminClient: service-role, bypasses RLS for audit-log inserts and cache writes
  // ONLY used after the user has been authenticated and authorised below.
  const adminClient = createClient(supabaseUrl, serviceKey);

  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return respond({ error: "Unauthorised" }, 401);

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: { clientId?: string; question?: string };
  try {
    body = await req.json();
  } catch {
    return respond({ error: "Invalid JSON body" }, 400);
  }

  const { clientId, question: rawQuestion } = body;
  if (!clientId || !rawQuestion?.trim()) {
    return respond({ error: "clientId and question are required" }, 400);
  }

  // ── Authorization: has_client_access covers owner + member + firm ─────────
  // Called via adminClient (service-role) because the RLS-hardening migration
  // revokes EXECUTE on has_client_access from authenticated/anon roles.
  // The user identity was already validated above via JWT; we pass user.id
  // explicitly so the SECURITY DEFINER function applies the correct scoping.
  const { data: hasAccess, error: accessErr } = await adminClient
    .rpc("has_client_access", { _user_id: user.id, _client_id: clientId });

  if (accessErr) {
    console.error("has_client_access error:", accessErr.message);
    return respond({ error: "Access check failed" }, 500);
  }
  if (!hasAccess) {
    return respond({ error: "Client not accessible" }, 403);
  }

  // ── Sanitise & classify ───────────────────────────────────────────────────
  const question = sanitize(rawQuestion);
  const tier     = classify(question);

  // ── Cache lookup — definitional questions only ────────────────────────────
  // question_hash is SHA-256(canonical question) — raw question text is never stored.
  // Cache reads/writes use adminClient (service role only; no authenticated SELECT policy).
  if (tier === "none") {
    const canonical = question.toLowerCase().replace(/\s+/g, " ").trim();
    const hash = await sha256(canonical);

    const { data: cached } = await adminClient
      .from("ask_ai_cache")
      .select("answer, hit_count")
      .eq("question_hash", hash)
      .maybeSingle();

    if (cached?.answer) {
      // Atomically record cache hit + enforce rate limit.
      const { data: allowed } = await adminClient.rpc("ask_ai_record_request", {
        p_user_id: user.id,
        p_client_id: clientId,
        p_tier: "none_cached",
        p_input_tokens: 0,
        p_output_tokens: 0,
        p_latency_ms: 0,
        p_limit: RATE_LIMIT,
      });
      if (allowed === false) {
        return respond({ error: "Rate limit exceeded. You can ask up to 30 questions per hour." }, 429);
      }

      // Increment hit count (fire-and-forget — non-critical).
      adminClient
        .from("ask_ai_cache")
        .update({ hit_count: ((cached.hit_count as number) ?? 0) + 1 })
        .eq("question_hash", hash)
        .then(() => {});

      return respond({ answer: cached.answer, cached: true, chips: deriveChips(question, tier) });
    }
  }

  // ── Atomically check rate limit + record request (before calling the model) ──
  const { data: allowed, error: rlErr } = await adminClient.rpc("ask_ai_record_request", {
    p_user_id: user.id,
    p_client_id: clientId,
    p_tier: tier,
    p_input_tokens: 0,
    p_output_tokens: 0,
    p_latency_ms: 0,
    p_limit: RATE_LIMIT,
  });

  if (rlErr) {
    console.warn("ask_ai_record_request unavailable (migration not run?):", rlErr.message);
  } else if (allowed === false) {
    return respond({ error: "Rate limit exceeded. You can ask up to 30 questions per hour." }, 429);
  }

  // ── Build context (userClient — RLS enforced on tenant data reads) ────────
  const ctx = await buildContext(userClient, clientId, tier, question);
  const { system, user: userPrompt } = buildPrompt(question, ctx, tier);

  // ── Call Claude ───────────────────────────────────────────────────────────
  let geminiResult;
  try {
    geminiResult = await callClaude(system, userPrompt);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.startsWith("Rate limit")) return respond({ error: msg }, 429);
    return respond({ error: msg }, 500);
  }

  // ── Update token counts in the log row (best-effort, fire-and-forget) ─────
  adminClient.from("ask_ai_log")
    .update({
      input_tokens: geminiResult.inputTokens,
      output_tokens: geminiResult.outputTokens,
      latency_ms: geminiResult.latencyMs,
    })
    .eq("user_id", user.id)
    .eq("tier", tier)
    .order("created_at", { ascending: false })
    .limit(1)
    .then(({ error: e }) => {
      if (e) console.warn("Token count update failed:", e.message);
    });

  // ── Cache definitional answers (hash key, service-role write) ─────────────
  if (tier === "none" && geminiResult.text) {
    const canonical = question.toLowerCase().replace(/\s+/g, " ").trim();
    const hash = await sha256(canonical);
    await adminClient.from("ask_ai_cache").upsert({
      question_hash: hash,
      answer: geminiResult.text,
      hit_count: 0,
      created_at: new Date().toISOString(),
    }).then(({ error: e }) => {
      if (e) console.warn("Cache write failed:", e.message);
    });
  }

  return respond({ answer: geminiResult.text, chips: deriveChips(question, tier) });
});

function deriveChips(question: string, tier: string): string[] {
  const lower = question.toLowerCase();
  if (lower.includes("cash") || lower.includes("runway")) {
    return ["How can I speed up collections?", "What's my cash conversion cycle?"];
  }
  if (lower.includes("margin") || lower.includes("profit")) {
    return ["Which cost line is growing fastest?", "How do I cut fixed costs?"];
  }
  if (lower.includes("hire") || lower.includes("employee")) {
    return ["What's my sales per employee?", "Can I afford an extra hire next quarter?"];
  }
  if (tier === "full") {
    return ["What should I focus on this month?", "Where am I weakest vs industry?"];
  }
  return ["Explain this ratio in plain terms", "What's the industry benchmark?"];
}
