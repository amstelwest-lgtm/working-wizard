/**
 * In-app Milōn bot — worker bee on Client Brain.
 * Reuses ask-ai auth, CORS, rate-limit RPC. Calls existing brain-propose /
 * brain-deliverable-draft. Does not rewrite Ask AI, Lighthouse, or extract.
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sanitize } from "../ask-ai/sanitizer.ts";
import { callClaudeRound, type ClaudeMessage, type ClaudeTool } from "./claude.ts";
import {
  BOT_MAX_HISTORY,
  BOT_MAX_TOOL_ROUNDS,
  BOT_RATE_LIMIT,
  BOT_SYSTEM,
  buildBlockers,
  buildBrainAnswer,
  buildInviteStatus,
  hashToolArgs,
  isBotToolName,
  numericRatios,
  summarizeToolArgs,
  toolResultStatus,
  type BotToolName,
  type BotToolStatus,
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

const TOOLS: ClaudeTool[] = [
  {
    name: "get_invite_status",
    description:
      "Owner-handoff / staff invite status for this client. Returns pending/redeemed/expired. Never returns a token.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_blockers",
    description: "List outstanding unanswered client_brain_questions for this client. Empty array if none.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "propose_next_steps",
    description:
      "Call the existing brain-propose function. Drafts next steps / GAP stubs only. Never signed off.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "draft_deliverable",
    description:
      "Call the existing brain-deliverable-draft function. Writes a draft pack only. Never ready or sent.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "answer_from_brain",
    description:
      "Read context_facts, brain_summary, and financial snapshot summaries. Missing fields stay empty — never invent.",
    input_schema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Optional focus such as cash, blockers, or GAP." },
      },
      additionalProperties: false,
    },
  },
];

type UserClient = SupabaseClient;
type AdminClient = SupabaseClient;

async function invokeExistingFunction(
  name: "brain-propose" | "brain-deliverable-draft",
  token: string,
  clientId: string,
): Promise<unknown> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const res = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      apikey: anonKey,
    },
    body: JSON.stringify({ clientId }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = typeof body?.error === "string" ? body.error : `${name} failed (${res.status})`;
    return { error: err, empty: false };
  }
  return body;
}

async function runTool(
  tool: BotToolName,
  args: Record<string, unknown>,
  ctx: {
    clientId: string;
    token: string;
    userClient: UserClient;
    adminClient: AdminClient;
  },
): Promise<unknown> {
  if (tool === "get_invite_status") {
    const [clientRes, inviteRes] = await Promise.all([
      ctx.userClient.from("clients").select("owner_user_id").eq("id", ctx.clientId).maybeSingle(),
      ctx.adminClient
        .from("invite_tokens")
        .select("purpose, created_at, expires_at, redeemed_at")
        .eq("client_id", ctx.clientId)
        .order("created_at", { ascending: false })
        .limit(8),
    ]);
    return buildInviteStatus({
      ownerUserId: (clientRes.data?.owner_user_id as string | null) ?? null,
      invites: (inviteRes.data ?? []) as Array<{
        purpose: string;
        created_at: string;
        expires_at: string;
        redeemed_at: string | null;
      }>,
    });
  }

  if (tool === "list_blockers") {
    const { data } = await ctx.userClient
      .from("client_brain_questions")
      .select("question_key, prompt_text, audience, last_asked_at")
      .eq("client_id", ctx.clientId)
      .eq("status", "unanswered")
      .order("created_at", { ascending: false })
      .limit(40);
    return buildBlockers(
      (data ?? []) as Array<{
        question_key: string;
        prompt_text: string | null;
        audience: string;
        last_asked_at: string | null;
      }>,
    );
  }

  if (tool === "propose_next_steps") {
    return invokeExistingFunction("brain-propose", ctx.token, ctx.clientId);
  }

  if (tool === "draft_deliverable") {
    return invokeExistingFunction("brain-deliverable-draft", ctx.token, ctx.clientId);
  }

  const topic = typeof args.topic === "string" ? args.topic.trim().toLowerCase() : "";
  const [factRes, clientRes, snapRes] = await Promise.all([
    ctx.userClient
      .from("context_facts")
      .select("fact_text, category")
      .eq("client_id", ctx.clientId)
      .is("superseded_by", null)
      .order("created_at", { ascending: false })
      .limit(30),
    ctx.userClient
      .from("clients")
      .select("brain_summary, cash_runway_weeks")
      .eq("id", ctx.clientId)
      .maybeSingle(),
    ctx.userClient
      .from("client_financial_snapshots")
      .select("period_label, period_date, ratios")
      .eq("client_id", ctx.clientId)
      .order("period_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  let facts = (factRes.data ?? []) as Array<{ fact_text: string; category: string | null }>;
  if (topic) {
    const filtered = facts.filter(
      (f) =>
        f.fact_text.toLowerCase().includes(topic) ||
        (f.category ?? "").toLowerCase().includes(topic),
    );
    if (filtered.length) facts = filtered;
  }
  const snap = snapRes.data;
  const cash =
    typeof clientRes.data?.cash_runway_weeks === "number" ? clientRes.data.cash_runway_weeks : null;
  return buildBrainAnswer({
    facts,
    brainSummary: clientRes.data?.brain_summary ?? null,
    financials: snap
      ? {
          period_label: (snap.period_label as string | null) ?? (snap.period_date as string | null) ?? null,
          ratios: numericRatios(snap.ratios),
          cash_runway_weeks: cash,
        }
      : cash != null
        ? { period_label: null, ratios: {}, cash_runway_weeks: cash }
        : null,
  });
}

async function auditToolCall(
  adminClient: AdminClient,
  input: {
    clientId: string;
    userId: string;
    tool: string;
    args: unknown;
    status: BotToolStatus;
  },
) {
  const args_hash = await hashToolArgs(input.args);
  const { error } = await adminClient.from("bot_tool_calls").insert({
    client_id: input.clientId,
    user_id: input.userId,
    tool: input.tool,
    args_hash,
    args_summary: summarizeToolArgs(input.tool, input.args),
    result_status: input.status,
  });
  if (error) console.warn("bot_tool_calls insert:", error.message);
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
    message?: string;
    history?: Array<{ role?: string; content?: string }>;
    audience?: string;
  };
  try {
    body = await req.json();
  } catch {
    return respond({ error: "Invalid JSON body" }, 400);
  }

  const clientId = body.clientId;
  const rawMessage = body.message;
  if (!clientId || !rawMessage?.trim()) {
    return respond({ error: "clientId and message are required" }, 400);
  }
  const audience = body.audience === "accountant" ? "accountant" : "owner";

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
    p_tier: "milon_bot",
    p_input_tokens: 0,
    p_output_tokens: 0,
    p_latency_ms: 0,
    p_limit: BOT_RATE_LIMIT,
  });
  if (rlErr) {
    console.warn("ask_ai_record_request unavailable:", rlErr.message);
  } else if (allowed === false) {
    return respond({ error: "Rate limit exceeded. You can ask the bot up to 30 times per hour." }, 429);
  }

  const message = sanitize(rawMessage);
  const history = (body.history ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-BOT_MAX_HISTORY)
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: sanitize(String(m.content)).slice(0, 1500),
    }));

  const messages: ClaudeMessage[] = [
    ...history,
    {
      role: "user",
      content: `Audience: ${audience}. Client id is already scoped — do not ask for it.\n\n${message}`,
    },
  ];

  const toolsUsed: Array<{ name: string; status: BotToolStatus }> = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let latencyMs = 0;
  let answer = "";

  if (!Deno.env.get("ANTHROPIC_API_KEY")) {
    return respond({
      answer: "AI is not configured (ANTHROPIC_API_KEY). The bot cannot run until that secret is set — same as Ask AI.",
      tools: [],
      skippedReason: "ai_not_configured",
    });
  }

  try {
    for (let round = 0; round < BOT_MAX_TOOL_ROUNDS; round++) {
      const claude = await callClaudeRound(BOT_SYSTEM, messages, TOOLS);
      inputTokens += claude.inputTokens;
      outputTokens += claude.outputTokens;
      latencyMs += claude.latencyMs;

      if (claude.toolUses.length === 0) {
        answer = claude.text;
        break;
      }

      messages.push({
        role: "assistant",
        content: [
          ...(claude.text ? [{ type: "text" as const, text: claude.text }] : []),
          ...claude.toolUses.map((t) => ({
            type: "tool_use" as const,
            id: t.id,
            name: t.name,
            input: t.input,
          })),
        ],
      });

      const results: Array<{ type: "tool_result"; tool_use_id: string; content: string }> = [];
      for (const use of claude.toolUses) {
        const name = isBotToolName(use.name) ? use.name : null;
        if (!name) {
          results.push({
            type: "tool_result",
            tool_use_id: use.id,
            content: JSON.stringify({ error: "Unknown tool", empty: true }),
          });
          toolsUsed.push({ name: use.name, status: "error" });
          continue;
        }
        let payload: unknown;
        try {
          payload = await runTool(name, use.input, { clientId, token, userClient, adminClient });
        } catch (e) {
          payload = { error: (e as Error).message || "Tool failed" };
        }
        const status = toolResultStatus(payload);
        toolsUsed.push({ name, status });
        await auditToolCall(adminClient, {
          clientId,
          userId: user.id,
          tool: name,
          args: use.input,
          status,
        });
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: JSON.stringify(payload),
        });
      }
      messages.push({ role: "user", content: results });
      answer = claude.text;
    }
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.startsWith("Rate limit")) return respond({ error: msg }, 429);
    if (/ANTHROPIC_API_KEY missing/i.test(msg)) {
      return respond({
        answer: "AI is not configured. No tool calls were made.",
        tools: [],
        skippedReason: "ai_not_configured",
      });
    }
    return respond({ error: msg }, 500);
  }

  adminClient
    .from("ask_ai_log")
    .update({
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      latency_ms: latencyMs,
    })
    .eq("user_id", user.id)
    .eq("tier", "milon_bot")
    .order("created_at", { ascending: false })
    .limit(1)
    .then(({ error: e }) => {
      if (e) console.warn("Token count update failed:", e.message);
    });

  if (!answer.trim()) {
    answer = toolsUsed.some((t) => t.status === "empty")
      ? "Nothing on file for that yet — I will not invent it."
      : "I could not complete that. Try again, or use Propose / Draft on the Summary tab.";
  }

  return respond({ answer, tools: toolsUsed });
});
