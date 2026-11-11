/**
 * Setup Partner — firm interview, one model call per turn, confirm → practice plan.
 * client_setup is a private brain rule. product_gap merges on dedupe_key via service role.
 * Bespoke is logged only. No ledger writes. JWT required (verify_jwt).
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  SETUP_PARTNER_MAX_OUTPUT_TOKENS,
  SETUP_PARTNER_MODEL_TURN_CAP,
  SETUP_PARTNER_SOURCE_EVENT,
  SETUP_PARTNER_TASK_FEATURE,
  SETUP_PARTNER_TASK_WORKFLOW,
  buildSetupPartnerSummary,
  FIRM_INTERVIEW_TURN_CAP,
  firmInterviewShouldStop,
  firmSetupPartnerSummary,
  ledgerStatusFromBooksQuality,
  ASK_QUESTION_TOOL,
  EXTRACT_WORKFLOW_TOOL,
  FIRM_INTERVIEW_RETRY,
  firmInterviewUserError,
  interviewTurnFromModel,
  parseWorkflowMapJson,
  workflowMapFromModel,
  setupPartnerMapUserPrompt,
  setupPartnerPhraseUserPrompt,
  setupPartnerScreenshotNotes,
  type SetupPartnerCountry,
  type SetupPartnerSummary,
  type SetupPartnerWorkflowMap,
} from "../../../src/lib/setup-partner.ts";
import {
  bespokeLogRow,
  buildPracticeImplementationPlan,
  clientSetupBrainRows,
  mergeProductGap,
  productGapInsertRow,
  type PracticePlanStep,
} from "../../../src/lib/setup-partner-plan.ts";
import {
  SETUP_PARTNER_MAP_SYSTEM,
  SETUP_PARTNER_PHRASE_SYSTEM,
} from "../_shared/agent-prompts/setup-partner.ts";
import { authenticateEdgeUser } from "../_shared/edge-auth.ts";
import {
  readBooksQuality,
  readReusedAnalystTool,
  type AgentToolCtx,
} from "../_shared/agent-desk.ts";
import {
  applyRedaction,
  createRedactionSession,
  rehydrateModelOutput,
} from "../_shared/redact-identifiers.ts";
import { callClaude } from "../ask-ai/anthropic.ts";
import { CLAUDE_OPUS_55 } from "../../../src/lib/claude-request.ts";
import { edgeModelForAgent } from "../_shared/claude-model.ts";
import {
  finishPrecardAttempt,
  readPrecardGate,
  recordPrecardUse,
} from "../_shared/precard-cap-gate.ts";
import { parseMarketSelection } from "../../../src/lib/market/parse.ts";
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
    headers: {
      ...(corsHeaders ?? { "Access-Control-Allow-Origin": "*" }),
      "Content-Type": "application/json",
    },
  });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function coverageCountry(market: unknown): SetupPartnerCountry | null {
  return parseMarketSelection(market)?.country ?? null;
}

function coverageMarketNote(country: SetupPartnerCountry | null): string {
  if (country === "US") {
    return "Firm country: US. In milonCoverage, Tax Specialist owns sales-tax prep for accountant review (no filing). Do not write ZA or SARS.";
  }
  if (country === "ZA") {
    return "Firm country: ZA. In milonCoverage, Tax Specialist owns ZA tax prep for accountant review (no filing).";
  }
  return "Firm country is unset. In milonCoverage, Tax Specialist owns tax prep for accountant review (no filing). Do not write ZA or SARS.";
}

async function loadSummary(
  db: AgentToolCtx["db"],
  clientId: string,
  market: unknown,
): Promise<SetupPartnerSummary> {
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

async function retirePriorOnboarding(admin: AdminClient, firmId: string, clientId: string | null) {
  let query = admin
    .from("milon_brain_rules")
    .update({ status: "retired" })
    .eq("firm_id", firmId)
    .eq("source_event", SETUP_PARTNER_SOURCE_EVENT)
    .in("task_type", [SETUP_PARTNER_TASK_WORKFLOW, SETUP_PARTNER_TASK_FEATURE])
    .eq("status", "active");
  query = clientId
    ? query.or(`client_id.eq.${clientId},client_id.is.null`)
    : query.is("client_id", null);
  const { error } = await query;
  if (error) console.error("setup_partner_retire_failed", error.message);
}

async function callerCanUseFirm(
  admin: AdminClient,
  userId: string,
  firmId: string,
): Promise<boolean> {
  const { data: member, error } = await admin.rpc("is_firm_member", {
    _user_id: userId,
    _firm_id: firmId,
  });
  if (!error && member === true) return true;
  const { data: firm } = await admin
    .from("firms")
    .select("owner_user_id")
    .eq("id", firmId)
    .maybeSingle();
  return firm?.owner_user_id === userId;
}

async function upsertProductGap(
  admin: AdminClient,
  input: {
    step: PracticePlanStep;
    firmId: string;
    clientId: string | null;
    approverId: string;
    seenAt: string;
  },
): Promise<"created" | "merged" | "failed"> {
  const sighting = {
    dedupeKey: input.step.dedupe_key,
    capability: input.step.capability,
    stepType: input.step.step_type,
    effort: input.step.effort,
    fitNote: input.step.fit_note,
    firmId: input.firmId,
    clientId: input.clientId,
    seenAt: input.seenAt,
  };
  const readExisting = async () => {
    const { data, error } = await admin
      .from("milon_brain_rules")
      .select("id, rule_text")
      .eq("layer", "milon_wide")
      .eq("status", "pending")
      .eq("task_type", SETUP_PARTNER_TASK_FEATURE)
      .eq("pattern_key", input.step.dedupe_key)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  };
  const writeMerge = async (id: string, ruleText: string | null) => {
    const merged = mergeProductGap(ruleText, sighting);
    const { error } = await admin
      .from("milon_brain_rules")
      .update({ rule_text: merged.rule_text })
      .eq("id", id);
    if (error) throw new Error(error.message);
  };
  try {
    const existing = await readExisting();
    if (existing?.id) {
      await writeMerge(
        String(existing.id),
        typeof existing.rule_text === "string" ? existing.rule_text : null,
      );
      return "merged";
    }
    const row = productGapInsertRow({ ...sighting, approverId: input.approverId });
    const { error } = await admin.from("milon_brain_rules").insert(row);
    if (error) {
      if (error.code !== "23505") throw new Error(error.message);
      const raced = await readExisting();
      if (!raced?.id) throw new Error(error.message);
      await writeMerge(
        String(raced.id),
        typeof raced.rule_text === "string" ? raced.rule_text : null,
      );
      return "merged";
    }
    return "created";
  } catch (err) {
    console.error("setup_partner_gap_write_failed", err instanceof Error ? err.message : err);
    return "failed";
  }
}

function hasPnl(financials: unknown): boolean {
  if (!financials || typeof financials !== "object") return false;
  const row = financials as Record<string, unknown>;
  if (row.profit_and_loss || row.pnl) return true;
  const figures = row.figures;
  if (figures && typeof figures === "object") {
    const nested = figures as Record<string, unknown>;
    if (nested.revenue != null || nested.profit_and_loss != null || nested.net_profit != null) {
      return true;
    }
  }
  return typeof row.revenue === "number";
}

async function firmLedgerContext(admin: SupabaseClient, firmId: string): Promise<string> {
  const { data, error } = await admin
    .from("clients")
    .select("id, name, market, financials")
    .eq("firm_id", firmId)
    .limit(12);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  if (!rows.length) return "Connected data: no clients on file. No ledger is known from Milōn.";
  const ids = rows.map((row) => String((row as { id?: unknown }).id ?? "")).filter(Boolean);
  const tables = [
    ["xero_connections", "Xero"],
    ["qbo_connections", "QuickBooks"],
    ["sage_connections", "Sage"],
  ] as const;
  const byClient = new Map<string, string[]>();
  for (const [table, label] of tables) {
    if (!ids.length) break;
    const { data: links, error: linkError } = await admin
      .from(table)
      .select("client_id, last_synced_at, sync_status")
      .in("client_id", ids);
    if (linkError) continue;
    for (const link of links ?? []) {
      const id = String((link as { client_id?: unknown }).client_id ?? "");
      const syncedAt = (link as { last_synced_at?: unknown }).last_synced_at;
      const status = (link as { sync_status?: unknown }).sync_status;
      const synced = typeof syncedAt === "string" && syncedAt ? syncedAt.slice(0, 10) : "never";
      const connected = status !== "disconnected" && status !== "error";
      const line = connected
        ? `${label} connected, last sync ${synced}`
        : `${label} not connected`;
      byClient.set(id, [...(byClient.get(id) ?? []), line]);
    }
  }
  const lines = rows.map((row) => {
    const rec = row as { id?: unknown; name?: unknown; market?: unknown; financials?: unknown };
    const name = typeof rec.name === "string" && rec.name ? rec.name : "Client";
    const country =
      rec.market && typeof rec.market === "object" && "country" in rec.market
        ? String((rec.market as { country?: unknown }).country ?? "")
        : "";
    const books = byClient.get(String(rec.id ?? "")) ?? ["ledger not connected"];
    return `- ${name}${country ? ` (${country})` : ""}: ${books.join("; ")}; has P&L ${hasPnl(rec.financials) ? "yes" : "no"}`;
  });
  return `Connected books already in Milōn. Do not ask for a provider, connection, last sync, or whether a P&L exists when it is listed:\n${lines.join("\n")}`;
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
    firmId?: unknown;
    template?: unknown;
    summary?: unknown;
    answers?: unknown;
    map?: unknown;
    modelTurns?: unknown;
    screenshots?: unknown;
    messages?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return respond({ error: "Invalid JSON body" }, 400);
  }

  const action = typeof body.action === "string" ? body.action : "";
  const clientIdRaw = typeof body.clientId === "string" ? body.clientId : "";
  const firmIdRaw = typeof body.firmId === "string" ? body.firmId : "";
  let clientId: string | null = null;
  let firmId = "";
  let market: unknown = null;
  let clientName = "Practice";

  if (isUuid(clientIdRaw)) {
    clientId = clientIdRaw;
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
    firmId = typeof clientRow.firm_id === "string" ? clientRow.firm_id : "";
    market = clientRow.market;
    clientName = typeof clientRow.name === "string" ? clientRow.name : "Client";
  } else if (isUuid(firmIdRaw)) {
    const allowed = await callerCanUseFirm(adminClient, user.id, firmIdRaw);
    if (!allowed) return respond({ error: "Firm not accessible" }, 403);
    const { data: firmRow, error: firmErr } = await adminClient
      .from("firms")
      .select("name, market")
      .eq("id", firmIdRaw)
      .maybeSingle();
    if (firmErr || !firmRow) return respond({ error: "Firm not found" }, 404);
    firmId = firmIdRaw;
    market = firmRow.market;
    clientName = typeof firmRow.name === "string" && firmRow.name ? firmRow.name : "Practice";
  } else {
    return respond({ error: "clientId or firmId is required" }, 400);
  }

  if (action === "summary") {
    if (!clientId) return respond({ summary: firmSetupPartnerSummary() });
    const summary = await loadSummary(userClient, clientId, market);
    return respond({ summary });
  }

  if (action === "confirm") {
    const map = body.map as SetupPartnerWorkflowMap | undefined;
    if (!map || !Array.isArray(map.todaysFlow)) return respond({ error: "map is required" }, 400);
    if (!firmId) return respond({ error: "Client has no firm" }, 400);
    const plan = buildPracticeImplementationPlan(map);
    await retirePriorOnboarding(adminClient, firmId, clientId);
    const rows = clientSetupBrainRows({
      firmId,
      approverId: user.id,
      steps: plan.steps,
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
    const seenAt = new Date().toISOString();
    let productCreated = 0;
    let productMerged = 0;
    for (const step of plan.steps) {
      if (step.bucket !== "product_gap") continue;
      const outcome = await upsertProductGap(adminClient, {
        step,
        firmId,
        clientId,
        approverId: user.id,
        seenAt,
      });
      if (outcome === "created") productCreated += 1;
      else if (outcome === "merged") productMerged += 1;
    }
    let bespokeLogged = 0;
    for (const step of plan.steps) {
      if (step.bucket !== "bespoke") continue;
      const row = bespokeLogRow({ firmId, clientId, approverId: user.id, step });
      const { error } = await adminClient.from("milon_brain_rules").insert(row);
      if (error) {
        console.error("setup_partner_bespoke_log_failed", error.message);
        continue;
      }
      console.info("setup_partner_bespoke", firmId, step.dedupe_key);
      bespokeLogged += 1;
    }
    return respond({
      ok: true,
      inserted,
      attempted: rows.length,
      plan,
      productGaps: { created: productCreated, merged: productMerged },
      bespokeLogged,
    });
  }

  const modelTurns =
    typeof body.modelTurns === "number" && body.modelTurns >= 0 ? body.modelTurns : 0;
  if (modelTurns >= SETUP_PARTNER_MODEL_TURN_CAP) {
    return respond({ error: "Session turn cap reached", code: "setup_partner_cap" }, 429);
  }

  let precard;
  try {
    precard = await readPrecardGate(
      clientId
        ? { db: adminClient, clientId, kind: "bot" }
        : { db: adminClient, firmId, kind: "bot" },
    );
  } catch (err) {
    console.error("precard check failed", err instanceof Error ? err.message : err);
    return respond({ error: "Could not check the plan." }, 503);
  }
  if (!precard.allowed) {
    return respond(
      {
        error: precard.message || PRECARD_CAP_MESSAGE,
        code: PRECARD_CAP_CODE,
        limit: precard.limit,
      },
      403,
    );
  }

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

  if (action === "firm_turn") {
    if (clientId) return respond({ error: "firm_turn is the practice interview" }, 400);
    const modelTurns =
      typeof body.modelTurns === "number" && body.modelTurns >= 0 ? body.modelTurns : 0;
    if (firmInterviewShouldStop(modelTurns, false) && modelTurns >= FIRM_INTERVIEW_TURN_CAP) {
      return respond({ question: "", done: true, modelTurns });
    }
    const history = Array.isArray(body.messages) ? body.messages : [];
    const lines = history
      .map((row) => {
        if (!row || typeof row !== "object") return "";
        const rec = row as { role?: unknown; content?: unknown };
        const role = rec.role === "assistant" ? "Q" : "A";
        const content = typeof rec.content === "string" ? rec.content.trim() : "";
        return content ? `${role}: ${content}` : "";
      })
      .filter(Boolean);
    let connected = "Connected data: unavailable.";
    try {
      connected = await firmLedgerContext(adminClient, firmId);
    } catch (err) {
      console.error("setup_partner_context_failed", err instanceof Error ? err.message : err);
    }
    const userPrompt = [
      connected,
      "",
      "Conversation so far:",
      lines.length ? lines.join("\n") : "(none yet)",
      "",
      "Call the ask_question tool. One sentence. One question mark. Set done true and question to an empty string when you can map the workflow. Do not write JSON in the message.",
    ].join("\n");
    const interviewModel = edgeModelForAgent("financial_manager") || CLAUDE_OPUS_55;
    let attempts = 0;
    const ask = async () => {
      attempts += 1;
      const res = await callClaude(SETUP_PARTNER_MAP_SYSTEM, userPrompt, {
        maxTokens: 1024,
        temperature: 0.4,
        model: interviewModel,
        timeoutMs: 25_000,
        tools: [ASK_QUESTION_TOOL],
        toolChoice: { type: "tool", name: ASK_QUESTION_TOOL.name },
      });
      return interviewTurnFromModel({
        text: rehydrateModelOutput(res.text, session),
        toolUses: res.toolUses,
      });
    };
    try {
      let parsed = await ask();
      if (!parsed.done && !parsed.question && attempts < 2) parsed = await ask();
      if (!parsed.done && !parsed.question) {
        return respond({ error: FIRM_INTERVIEW_RETRY, retry: true }, 503);
      }
      if (precard.firmId) {
        await finishPrecardAttempt({
          decision: precard,
          succeeded: true,
          record: async () => {
            await recordPrecardUse(adminClient, precard.firmId!, "bot");
          },
        });
      }
      const nextTurns = modelTurns + 1;
      const done = firmInterviewShouldStop(nextTurns, parsed.done);
      return respond({
        question: done ? "" : parsed.question,
        done,
        modelTurns: nextTurns,
        model: interviewModel,
      });
    } catch (err) {
      console.error("setup_partner_turn_failed", err instanceof Error ? err.message : err);
      try {
        if (attempts >= 2) throw err;
        const parsed = await ask();
        if (parsed.question || parsed.done) {
          const nextTurns = modelTurns + 1;
          const done = firmInterviewShouldStop(nextTurns, parsed.done);
          return respond({
            question: done ? "" : parsed.question,
            done,
            modelTurns: nextTurns,
            model: interviewModel,
          });
        }
      } catch (retryErr) {
        console.error("setup_partner_turn_retry_failed", retryErr instanceof Error ? retryErr.message : retryErr);
      }
      const message = firmInterviewUserError(
        err instanceof Error ? err.message : FIRM_INTERVIEW_RETRY,
      );
      return respond({ error: message, retry: true }, 503);
    }
  }

  if (action === "build_map") {
    const answers =
      body.answers && typeof body.answers === "object" && !Array.isArray(body.answers)
        ? (body.answers as Record<string, string>)
        : {};
    let summary = body.summary as SetupPartnerSummary | undefined;
    if (!summary) {
      summary = clientId
        ? await loadSummary(userClient, clientId, market)
        : firmSetupPartnerSummary();
    }
    const country = coverageCountry(market);
    const transcript = typeof answers.transcript === "string" ? answers.transcript.trim() : "";
    if (!clientId && transcript) {
      const interviewModel = edgeModelForAgent("financial_manager") || CLAUDE_OPUS_55;
      let modelText: string | null = null;
      let toolUses: Array<{ name: string; input: Record<string, unknown> }> = [];
      try {
        const res = await callClaude(
          "Call the extract_workflow tool. One step per distinct answer, with who, tool, cadence, and pain. Do not paste the transcript as one step, and do not write JSON in the message.",
          transcript,
          {
            maxTokens: 1200,
            model: interviewModel,
            timeoutMs: 25_000,
            tools: [EXTRACT_WORKFLOW_TOOL],
            toolChoice: { type: "tool", name: EXTRACT_WORKFLOW_TOOL.name },
          },
        );
        modelText = rehydrateModelOutput(res.text, session);
        toolUses = res.toolUses;
      } catch (err) {
        console.error("setup_partner_structure_failed", err instanceof Error ? err.message : err);
      }
      const map = workflowMapFromModel({
        transcript,
        text: modelText,
        toolUses,
        country,
      });
      return respond({ map, modelTurns: modelTurns + 1, structured: Boolean(modelText) });
    }
    const userPrompt = applyRedaction(
      `${setupPartnerMapUserPrompt(summary, answers, setupPartnerScreenshotNotes(body.screenshots))}\n\n${coverageMarketNote(country)}`,
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
      const map = parseWorkflowMapJson(text, answers, country);
      return respond({ map, modelTurns: modelTurns + 1 });
    } catch (err) {
      console.error("setup_partner_map_failed", err instanceof Error ? err.message : err);
      const map = parseWorkflowMapJson("", answers, country);
      return respond({ map, modelTurns: modelTurns + 1, skippedModel: true });
    }
  }

  return respond({ error: "Unknown action" }, 400);
}
