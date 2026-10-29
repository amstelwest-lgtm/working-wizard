/**
 * Accountant chat asks the Financial Manager for one rail PDF.
 * The user JWT is checked here. The Opus call stays in this function's
 * queue runner, started with trigger on_demand. This handler does not
 * call the model and does not write books.
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  callerMayPrepareClientReport,
  clientReportDownloadPath,
  isClientReportKey,
  planClientReportInvoke,
  type ClientReportKey,
} from "../../../src/lib/client-report-prepare.ts";
import { runnerEnabled } from "../../../src/lib/owner-handoff.ts";
import { QUEUE_RUNNER_CORS, queueRunnerJson } from "../_shared/agent-core/serve-runner.ts";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export async function handlePrepareClientReport(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: QUEUE_RUNNER_CORS });
  if (req.method !== "POST") return queueRunnerJson({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return queueRunnerJson({ error: "unauthorised" }, 401);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !anonKey || !serviceKey) return queueRunnerJson({ error: "not_configured" }, 500);

  let body: {
    mode?: unknown;
    clientId?: unknown;
    reportKey?: unknown;
    message?: unknown;
    turnId?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return queueRunnerJson({ error: "invalid_json" }, 400);
  }
  if (body.mode !== "prepare_client_report")
    return queueRunnerJson({ error: "mode_required" }, 400);
  const clientId = typeof body.clientId === "string" ? body.clientId : "";
  const reportKey = typeof body.reportKey === "string" ? body.reportKey : "";
  const message = typeof body.message === "string" ? body.message : "";
  const turnId = typeof body.turnId === "string" ? body.turnId : "";
  if (!isUuid(clientId) || !isClientReportKey(reportKey)) {
    return queueRunnerJson(
      { error: "client_and_report_required", applied: false, prepared: false },
      400,
    );
  }

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const admin: SupabaseClient = createClient(url, serviceKey);
  const {
    data: { user },
    error: authErr,
  } = await userClient.auth.getUser();
  if (authErr || !user) return queueRunnerJson({ error: "unauthorised" }, 401);

  const { data: client, error: clientError } = await admin
    .from("clients")
    .select("owner_user_id")
    .eq("id", clientId)
    .maybeSingle();
  if (clientError) return queueRunnerJson({ error: "access_check_failed" }, 500);
  if (!client) return queueRunnerJson({ error: "client_not_found" }, 404);

  const { data: writer, error: writerError } = await admin.rpc("is_client_writer", {
    _user_id: user.id,
    _client_id: clientId,
  });
  if (writerError) return queueRunnerJson({ error: "access_check_failed" }, 500);
  if (
    !callerMayPrepareClientReport({
      userId: user.id,
      ownerUserId: (client.owner_user_id as string | null) ?? null,
      isPracticeEditor: writer === true,
    })
  ) {
    return queueRunnerJson({ error: "forbidden", applied: false, prepared: false }, 403);
  }

  const { data: setting, error: settingError } = await admin
    .from("agent_settings")
    .select("value")
    .eq("key", "financial_manager_enabled")
    .maybeSingle();
  if (settingError) return queueRunnerJson({ error: "runner_check_failed" }, 500);

  const nonce = isUuid(turnId) ? turnId : crypto.randomUUID();
  const plan = planClientReportInvoke({
    clientId,
    reportKey,
    message,
    nonce,
    enabled: runnerEnabled(setting?.value),
  });
  if (!plan.ok) {
    return queueRunnerJson({
      ok: true,
      enqueued: false,
      prepared: false,
      applied: false,
      report_key: reportKey,
      reason: plan.reason,
    });
  }

  // on_demand. agent_invoke starts the runner in this function. A second
  // queue message would race the lease, so the chat does not also queue_send.
  const { error: invokeError } = await admin.rpc("agent_invoke", {
    p_function: "agent-financial-manager",
    p_body: plan.payload,
  });
  if (invokeError) {
    return queueRunnerJson(
      {
        error: "enqueue_failed",
        enqueued: false,
        prepared: false,
        applied: false,
        report_key: reportKey,
      },
      502,
    );
  }

  return queueRunnerJson({
    ok: true,
    enqueued: true,
    prepared: true,
    applied: false,
    report_key: reportKey as ClientReportKey,
    trigger: plan.payload.trigger,
    runner: "agent-financial-manager",
    download_path: clientReportDownloadPath(clientId, reportKey),
  });
}
