/**
 * Owner hands one action to a bot.
 * The caller must own the client or belong to that client's workspace.
 * The queued agent_runs row is written with the service role.
 * Each bot has a runner. A runner whose agent_settings flag is false does not start.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { agentIdempotencyKey, agentInputHash } from "../../../src/lib/agent-bus.ts";
import {
  HANDOFF_TRIGGER,
  callerMayHandOff,
  handoffDecision,
  handoffInputs,
  handoffRequestNote,
  runnerEnabled,
} from "../../../src/lib/owner-handoff.ts";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "unauthorised" }, 401);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !anonKey || !serviceKey) return json({ error: "not_configured" }, 500);

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const admin = createClient(url, serviceKey);
  const {
    data: { user },
    error: authErr,
  } = await userClient.auth.getUser();
  if (authErr || !user) return json({ error: "unauthorised" }, 401);

  let body: { clientId?: unknown; actionItemId?: unknown; agent?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const clientId = typeof body.clientId === "string" ? body.clientId : "";
  const actionItemId = typeof body.actionItemId === "string" ? body.actionItemId : "";
  const agent = typeof body.agent === "string" ? body.agent : "";
  if (!isUuid(clientId) || !isUuid(actionItemId)) return json({ error: "client_and_action_required" }, 400);

  const decision = handoffDecision(agent);
  if (!decision.ok) {
    return json({ error: decision.error, missing: decision.missing }, 400);
  }

  const { data: client, error: clientError } = await admin
    .from("clients")
    .select("owner_user_id, firm_id")
    .eq("id", clientId)
    .maybeSingle();
  if (clientError) return json({ error: "access_check_failed" }, 500);
  if (!client) return json({ error: "client_not_found" }, 404);

  const { data: membership, error: memberError } = await admin
    .from("client_memberships")
    .select("user_id")
    .eq("client_id", clientId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (memberError) return json({ error: "access_check_failed" }, 500);
  if (
    !callerMayHandOff({
      userId: user.id,
      ownerUserId: (client.owner_user_id as string | null) ?? null,
      isWorkspaceMember: Boolean(membership?.user_id),
    })
  ) {
    return json({ error: "forbidden" }, 403);
  }

  const { data: action, error: actionError } = await admin
    .from("action_items")
    .select("id, client_id")
    .eq("id", actionItemId)
    .maybeSingle();
  if (actionError) return json({ error: "action_lookup_failed" }, 500);
  if (!action) return json({ error: "action_not_found" }, 404);
  if (action.client_id !== clientId) return json({ error: "action_client_mismatch" }, 403);

  const { data: setting, error: settingError } = await admin
    .from("agent_settings")
    .select("value")
    .eq("key", decision.settingKey)
    .maybeSingle();
  if (settingError) return json({ error: "runner_check_failed" }, 500);
  if (!runnerEnabled(setting?.value)) {
    return json(
      {
        error: "runner_disabled",
        missing: `${decision.displayName} has a runner at supabase/functions/${decision.runner}, but agent_settings.${decision.settingKey} is false, so a hand-off will not start it.`,
      },
      409,
    );
  }

  const inputs = handoffInputs(actionItemId);
  const idempotencyKey = await agentIdempotencyKey({
    agent: decision.agent,
    clientId,
    trigger: HANDOFF_TRIGGER,
    inputs,
  });
  const inputHash = await agentInputHash(inputs);
  const correlationId = crypto.randomUUID();

  const { data: inserted, error: insertError } = await admin
    .from("agent_runs")
    .insert({
      agent: decision.agent,
      client_id: clientId,
      firm_id: (client.firm_id as string | null) ?? null,
      trigger: HANDOFF_TRIGGER,
      audience: "owner",
      idempotency_key: idempotencyKey,
      input_hash: inputHash,
      correlation_id: correlationId,
      status: "queued",
      action_item_id: actionItemId,
      attempt: 1,
    })
    .select("id, status")
    .maybeSingle();

  let runId = inserted?.id as string | undefined;
  let status = (inserted?.status as string | undefined) ?? "queued";
  let created = Boolean(runId);
  if (insertError) {
    if (insertError.code !== "23505") return json({ error: "run_not_queued" }, 500);
    const { data: existing, error: existingError } = await admin
      .from("agent_runs")
      .select("id, status")
      .eq("agent", decision.agent)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existingError || !existing?.id) return json({ error: "run_not_queued" }, 500);
    runId = existing.id as string;
    status = existing.status as string;
    created = false;
  }
  if (!runId) return json({ error: "run_not_queued" }, 500);

  if (!created) {
    return json({ ok: true, runId, status, already: true, runner: decision.runner });
  }

  const { error: invokeError } = await admin.rpc("agent_invoke", {
    p_function: decision.runner,
    p_body: {
      client_id: clientId,
      trigger: HANDOFF_TRIGGER,
      inputs,
      correlation_id: correlationId,
    },
  });
  if (invokeError) {
    await admin
      .from("agent_runs")
      .update({
        status: "failed",
        error: "runner_not_triggered",
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId);
    return json({ error: "runner_not_triggered", missing: invokeError.message }, 502);
  }

  const { error: noteError } = await admin.from("action_updates").insert({
    action_item_id: actionItemId,
    client_id: clientId,
    actor_type: "system",
    actor_label: decision.displayName,
    note: handoffRequestNote(decision.displayName),
  });
  if (noteError) return json({ error: "note_not_written", runId }, 500);

  return json({ ok: true, runId, status: "queued", runner: decision.runner });
});
