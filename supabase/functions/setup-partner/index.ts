/**
 * Setup Partner — summary reads, one model call per turn, confirm → private brain rules.
 * No ledger writes. JWT required (verify_jwt).
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  SETUP_PARTNER_MAX_OUTPUT_TOKENS,
  SETUP_PARTNER_MODEL_TURN_CAP,
  SETUP_PARTNER_SOURCE_EVENT,
  SETUP_PARTNER_TASK_FEATURE,
  SETUP_PARTNER_TASK_WORKFLOW,
  buildSetupPartnerSummary,
  ledgerStatusFromBooksQuality,
  parseWorkflowMapJson,
  setupPartnerBrainRows,
  setupPartnerMapUserPrompt,
  setupPartnerPhraseUserPrompt,
  type SetupPartnerSummary,
  type SetupPartnerWorkflowMap,
} from "../../../src/lib/setup-partner.ts";
import {
  SETUP_PARTNER_MAP_SYSTEM,
  SETUP_PARTNER_PHRASE_SYSTEM,
} from "../_shared/agent-prompts/setup-partner.ts";
import { authenticateEdgeUser } from "../_shared/edge-auth.ts";
import { readBooksQuality, readReusedAnalystTool, type AgentToolCtx } from "../_shared/agent-desk.ts";
import { applyRedaction, createRedactionSession, rehydrateModelOutput } from "../_shared/redact-identifiers.ts";
import { callClaude } from "../ask-ai/anthropic.ts";
import {
  finishPrecardAttempt,
  readPrecardGate,
  recordPrecardUse,
} from "../_shared/precard-cap-gate.ts";
import { PRECARD_CAP_CODE, PRECARD_CAP_MESSAGE } from "../../../src/lib/precard-cap.ts";

function buildCorsHeaders(requestOrigin: string | null): Record<string, string> {
  const allowed = Deno.env.get("ALLOWED_ORIGINS");
  let allowOrigin = "*";
  if (allowed && requestOrigin) {
    const list = allowed.split(",").map((s) => s.trim());
    allowOrigin = list.includes(requestOrigin) ? requestOrigin : (list[0] ?? "*");
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

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

async function loadSummary(db: AgentToolCtx["db"], clientId: string, market: unknown): Promise<SetupPartnerSummary> {
  const ctx: AgentToolCtx = {
    agent: "financial_manager",
    clientId,
    runId: "setup-partner",
    correlationId: "setup-partner",
    firmId: null,
    db,
    pool: [],
    recordedKeys: new Set(),
    market,
  };
  const [booksQuality, snapshot, ratios] = await Promise.all([
    readBooksQuality(ctx),
    readReusedAnalystTool("get_financial_snapshot", ctx),
    readReusedAnalystTool("get_ratios", ctx),
  ]);
  const ledger = ledgerStatusFromBooksQuality(booksQuality);
  return buildSetupPartnerSummary({ ledger, booksQuality, snapshot, ratios });
}

type AdminClient = SupabaseClient<any, "public", any>;

async function retirePriorOnboarding(admin: AdminClient, firmId: string, clientId: string) {
  const { error } = await admin
    .from("milon_brain_rules")
    .update({ status: "retired" })
    .eq("firm_id", firmId)
    .eq("client_id", clientId)
    .eq("source_event", SETUP_PARTNER_SOURCE_EVENT)
    .in("task_type", [SETUP_PARTNER_TASK_WORKFLOW, SETUP_PARTNER_TASK_FEATURE])
    .eq("status", "active");
  if (error) console.error("setup_partner_retire_failed", error.message);
}

Deno.serve((req: Request) =>
  handleSetupPartner(req).catch((err) => {
    const cors = buildCorsHeaders(req.headers.get("Origin"));
    console.error("setup-partner failed", err instanceof Error ? err.message : err);
    return json({ error: "Something went wrong" }, 500, cors);
  }),
);

async function handleSetupPartner(req: Request): Promise<Response> {
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
  if (!supabaseUrl || !anonKey || !serviceKey) return respond({ error: "Not configured" }, 500);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const adminClient: AdminClient = createClient(supabaseUrl, serviceKey);

  const authResult = await authenticateEdgeUser({ token, auth: userClient.auth });
  if (!authResult.ok) return respond(authResult.body, authResult.status);
  const user = authResult.user;

  let body: {
    action?: unknown;
    clientId?: unknown;
    template?: unknown;
    summary?: unknown;
    answers?: unknown;
    map?: unknown;
    modelTurns?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return respond({ error: "Invalid JSON body" }, 400);
  }

  const action = typeof body.action === "string" ? body.action : "";
  const clientId = typeof body.clientId === "string" ? body.clientId : "";
  if (!isUuid(clientId)) return respond({ error: "clientId is required" }, 400);

  const { data: hasAccess, error: accessErr } = await adminClient.rpc("has_client_access", {
    _user_id: user.id,
    _client_id: clientId,
  });
  if (accessErr) {
    console.error("has_client_access error:", accessErr.message);
    return respond({ error: "Access check failed" }, 500);
  }
  if (!hasAccess) return respond({ error: "Client not accessible" }, 403);

  const { data: clientRow, error: clientErr } = await adminClient
    .from("clients")
    .select("firm_id, market, name")
    .eq("id", clientId)
    .maybeSingle();
  if (clientErr || !clientRow) return respond({ error: "Client not found" }, 404);
  const firmId = typeof clientRow.firm_id === "string" ? clientRow.firm_id : "";
  const market = clientRow.market;

  if (action === "summary") {
    const summary = await loadSummary(userClient, clientId, market);
    return respond({ summary });
  }

  if (action === "confirm") {
    const map = body.map as SetupPartnerWorkflowMap | undefined;
    if (!map || !Array.isArray(map.todaysFlow)) return respond({ error: "map is required" }, 400);
    if (!firmId) return respond({ error: "Client has no firm" }, 400);
    await retirePriorOnboarding(adminClient, firmId, clientId);
    const rows = setupPartnerBrainRows({
      firmId,
      clientId,
      approverId: user.id,
      map,
    });
    let inserted = 0;
    for (const row of rows) {
      const { error } = await userClient.from("milon_brain_rules").insert(row);
      if (error) {
        console.error("setup_partner_brain_insert_failed", error.message);
        continue;
      }
      inserted += 1;
    }
    return respond({ ok: true, inserted, attempted: rows.length });
  }

  const modelTurns = typeof body.modelTurns === "number" && body.modelTurns >= 0 ? body.modelTurns : 0;
  if (modelTurns >= SETUP_PARTNER_MODEL_TURN_CAP) {
    return respond({ error: "Session turn cap reached", code: "setup_partner_cap" }, 429);
  }

  let precard;
  try {
    precard = await readPrecardGate({ db: adminClient, clientId, kind: "bot" });
  } catch (err) {
    console.error("precard check failed", err instanceof Error ? err.message : err);
    return respond({ error: "Could not check the plan." }, 503);
  }
  if (!precard.allowed) {
    return respond(
      { error: precard.message || PRECARD_CAP_MESSAGE, code: PRECARD_CAP_CODE, limit: precard.limit },
      403,
    );
  }

  const clientName = typeof clientRow.name === "string" ? clientRow.name : "Client";
  const session = createRedactionSession({ clientName });

  if (action === "phrase_followup") {
    const template = typeof body.template === "string" ? body.template.trim() : "";
    if (!template) return respond({ error: "template is required" }, 400);
    const userPrompt = applyRedaction(setupPartnerPhraseUserPrompt(template), session);
    try {
      const res = await callClaude(SETUP_PARTNER_PHRASE_SYSTEM, userPrompt, {
        maxTokens: 120,
        temperature: 0.2,
      });
      if (precard.firmId) {
        await finishPrecardAttempt({
          decision: precard,
          succeeded: true,
          record: async () => {
            await recordPrecardUse(adminClient, precard.firmId!, "bot");
          },
        });
      }
      const text = rehydrateModelOutput(res.text, session).trim();
      return respond({ question: text || template, modelTurns: modelTurns + 1 });
    } catch (err) {
      console.error("setup_partner_phrase_failed", err instanceof Error ? err.message : err);
      return respond({ question: template, modelTurns: modelTurns + 1, skippedModel: true });
    }
  }

  if (action === "build_map") {
    const answers =
      body.answers && typeof body.answers === "object" && !Array.isArray(body.answers)
        ? (body.answers as Record<string, string>)
        : {};
    let summary = body.summary as SetupPartnerSummary | undefined;
    if (!summary) summary = await loadSummary(userClient, clientId, market);
    const userPrompt = applyRedaction(
      setupPartnerMapUserPrompt(summary, answers),
      session,
    );
    try {
      const res = await callClaude(SETUP_PARTNER_MAP_SYSTEM, userPrompt, {
        maxTokens: SETUP_PARTNER_MAX_OUTPUT_TOKENS,
        temperature: 0.2,
      });
      if (precard.firmId) {
        await finishPrecardAttempt({
          decision: precard,
          succeeded: true,
          record: async () => {
            await recordPrecardUse(adminClient, precard.firmId!, "bot");
          },
        });
      }
      const text = rehydrateModelOutput(res.text, session);
      const map = parseWorkflowMapJson(text, answers);
      return respond({ map, modelTurns: modelTurns + 1 });
    } catch (err) {
      console.error("setup_partner_map_failed", err instanceof Error ? err.message : err);
      const map = parseWorkflowMapJson("", answers);
      return respond({ map, modelTurns: modelTurns + 1, skippedModel: true });
    }
  }

  return respond({ error: "Unknown action" }, 400);
}
