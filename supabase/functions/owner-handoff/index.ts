/**
 * Owner hands one action to a bot.
 * The caller must own the client or belong to that client's workspace.
 * The queued agent_runs row is written with the service role.
 * Each bot has a runner. A runner whose agent_settings flag is false does not start.
 * The assignment is still recorded. This function never posts to a ledger.
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { agentIdempotencyKey, agentInputHash } from "../../../src/lib/agent-bus.ts";
import {
  HANDOFF_TRIGGER,
  callerMayHandOff,
  handoffCollisionResult,
  handoffDecision,
  handoffRequestNote,
  personAssignmentNote,
  planHandoffRun,
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

type AdminClient = SupabaseClient<any, "public", any>;

/** Stores this row's assignee and appends a note. Older notes are left in place. */
async function writeAssignment(
  admin: AdminClient,
  input: {
    clientId: string;
    actionItemId: string;
    ownerId: string | null;
    actorType: "system" | "owner_app";
    actorLabel: string;
    note: string;
  },
): Promise<string | null> {
  const { error: ownerError } = await admin
    .from("action_items")
    .update({ owner_id: input.ownerId, sent_at: null })
    .eq("id", input.actionItemId);
  if (ownerError) return "assignee_not_stored";
  const { error: noteError } = await admin.from("action_updates").insert({
    action_item_id: input.actionItemId,
    client_id: input.clientId,
    actor_type: input.actorType,
    actor_label: input.actorLabel,
    note: input.note,
  });
  if (noteError) return "note_not_written";
  return null;
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

  let body: { clientId?: unknown; actionItemId?: unknown; agent?: unknown; personId?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const clientId = typeof body.clientId === "string" ? body.clientId : "";
  const actionItemId = typeof body.actionItemId === "string" ? body.actionItemId : "";
  const agent = typeof body.agent === "string" ? body.agent : "";
  const personId = typeof body.personId === "string" ? body.personId : "";
  if (!isUuid(clientId) || !isUuid(actionItemId)) return json({ error: "client_and_action_required" }, 400);
  if (personId && !isUuid(personId)) return json({ error: "person_required" }, 400);

  const decision = personId ? null : handoffDecision(agent);
  if (!personId && (!decision || !decision.ok)) {
    return json(
      {
        error: decision && !decision.ok ? decision.error : "unknown_agent",
        missing: decision && !decision.ok ? decision.missing : "That is not one of the three bots.",
      },
      400,
    );
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

  const handoffActor = user.email?.split("@")[0]?.trim() || "Accountant";

  if (personId) {
    const { data: employee, error: employeeError } = await admin
      .from("client_employees")
      .select("id, name, client_id")
      .eq("id", personId)
      .maybeSingle();
    if (employeeError) return json({ error: "person_lookup_failed" }, 500);
    if (!employee || employee.client_id !== clientId) return json({ error: "person_not_on_file" }, 400);
    const cleared = await cancelQueuedRuns(admin, actionItemId);
    if (cleared) return json({ error: cleared }, 500);
    const name = typeof employee.name === "string" && employee.name.trim() ? employee.name.trim() : "Team member";
    const failed = await writeAssignment(admin, {
      clientId,
      actionItemId,
      ownerId: personId,
      actorType: "owner_app",
      actorLabel: handoffActor,
      note: personAssignmentNote(name),
    });
    if (failed) return json({ error: failed }, 500);
    return json({ ok: true, noted: true, status: "person", assignee: name });
  }

  if (!decision || !decision.ok) {
    return json({ error: "unknown_agent", missing: "That is not one of the three bots." }, 400);
  }

  const { data: setting, error: settingError } = await admin
    .from("agent_settings")
    .select("value")
    .eq("key", decision.settingKey)
    .maybeSingle();
  if (settingError) return json({ error: "runner_check_failed" }, 500);
  if (!runnerEnabled(setting?.value)) {
    const failed = await writeAssignment(admin, {
      clientId,
      actionItemId,
      ownerId: null,
      actorType: "owner_app",
      actorLabel: handoffActor,
      note: handoffRequestNote(decision.displayName),
    });
    if (failed) return json({ error: failed }, 500);
    return json({
      ok: true,
      noted: true,
      assigned: true,
      dispatched: false,
      status: "assigned",
      runner: decision.runner,
    });
  }

  const { data: newestRows, error: newestError } = await admin
    .from("agent_runs")
    .select("id, status")
    .eq("action_item_id", actionItemId)
    .eq("agent", decision.agent)
    .order("queued_at", { ascending: false })
    .limit(1);
  if (newestError) return json({ error: "run_lookup_failed" }, 500);
  const newestRow = (newestRows?.[0] ?? null) as { id?: string; status?: string } | null;
  const plan = planHandoffRun(
    newestRow?.id ? { id: newestRow.id, status: typeof newestRow.status === "string" ? newestRow.status : "" } : null,
    actionItemId,
  );
  if (plan.action === "reuse") {
    return json({
      ok: true,
      reused: true,
      noted: false,
      runId: plan.runId,
      status: plan.status,
      runner: decision.runner,
    });
  }

  const inputs = plan.inputs;
  const invokeInputs = inputs;
  const idempotencyKey = await agentIdempotencyKey({
    agent: decision.agent,
    clientId,
    trigger: HANDOFF_TRIGGER,
    inputs,
  });
  const inputHash = await agentInputHash(inputs);
  const invokeCorrelation = crypto.randomUUID();

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
      correlation_id: invokeCorrelation,
      status: "queued",
      action_item_id: actionItemId,
      attempt: 1,
    })
    .select("id, status")
    .maybeSingle();

  if (insertError) {
    if (insertError.code !== "23505") return json({ error: "run_insert_failed" }, 500);
    const { data: winner, error: winnerError } = await admin
      .from("agent_runs")
      .select("id, status")
      .eq("agent", decision.agent)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (winnerError || !winner?.id) return json({ error: "run_lookup_failed" }, 500);
    const collision = handoffCollisionResult({
      id: winner.id as string,
      status: typeof winner.status === "string" ? winner.status : "queued",
    });
    return json({ ...collision, ok: true, runner: decision.runner });
  }
  const runId = inserted?.id as string | undefined;
  if (!runId) return json({ error: "run_insert_failed" }, 500);

  // Commit the assignee before the slow agent call. A reload during agent_invoke
  // already sees this note. If the call fails, the note stays and the run is
  // marked failed below.
  const failed = await writeAssignment(admin, {
    clientId,
    actionItemId,
    ownerId: null,
    actorType: "owner_app",
    actorLabel: handoffActor,
    note: handoffRequestNote(decision.displayName),
  });
  if (failed) return json({ error: failed, runId }, 500);

  const { error: invokeError } = await admin.rpc("agent_invoke", {
    p_function: decision.runner,
    p_body: {
      client_id: clientId,
      trigger: HANDOFF_TRIGGER,
      inputs: invokeInputs,
      correlation_id: invokeCorrelation,
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
    return json({ error: "runner_not_triggered", missing: invokeError.message, noted: true, runId }, 502);
  }

  return json({ ok: true, noted: true, runId, status: "queued", runner: decision.runner });
});

/** A person now owns the row, so a queued bot run on it is not current work. */
async function cancelQueuedRuns(admin: AdminClient, actionItemId: string): Promise<string | null> {
  const { error } = await admin
    .from("agent_runs")
    .update({
      status: "cancelled",
      stop_reason: "assigned_to_person",
      finished_at: new Date().toISOString(),
    })
    .eq("action_item_id", actionItemId)
    .in("status", ["queued", "running"]);
  if (error) return "run_not_cleared";
  return null;
}
