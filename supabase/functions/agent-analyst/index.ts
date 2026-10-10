/**
 * Milōn Analyst. Service-role only. Reads the books on file and records findings.
 * Invoked by agent-dispatch via pg_net. Does not consume pre-card Bot answers.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sanitizeAgentError } from "../../../src/lib/agent-bus.ts";
import { runAnalystJob } from "./run.ts";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (bearerRole(req.headers.get("authorization") ?? "") !== "service_role") {
    return json({ error: "forbidden" }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const clientId = typeof body.client_id === "string" ? body.client_id : "";
  const trigger = typeof body.trigger === "string" ? body.trigger : "";
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) return json({ error: "client_id required" }, 400);
  if (!["sync", "upload", "schedule", "on_demand", "message", "retry"].includes(trigger)) {
    return json({ error: "trigger required" }, 400);
  }

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !serviceKey) return json({ error: "not_configured" }, 500);
  const db = createClient(url, serviceKey);

  try {
    const result = await runAnalystJob(db, {
      msgId: typeof body.msg_id === "number" ? body.msg_id : null,
      clientId,
      trigger,
      inputs: typeof body.inputs === "string" ? body.inputs : "",
      attempt: typeof body.attempt === "number" && body.attempt >= 1 ? Math.floor(body.attempt) : 1,
      correlationId: typeof body.correlation_id === "string" ? body.correlation_id : null,
    });
    return json(result);
  } catch (err) {
    const message = sanitizeAgentError(err instanceof Error ? err.message : "Analyst run failed");
    console.warn("agent-analyst", message);
    return json({ error: message }, 500);
  }
});
