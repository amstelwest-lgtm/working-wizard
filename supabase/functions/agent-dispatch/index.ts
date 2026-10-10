/**
 * Reads due analyst events and asks Postgres (pg_net) to call agent-analyst.
 * The cron job that posts here is created inactive, and this function also
 * returns without reading the queue while agent_settings.enabled is false.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

function flagOn(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "string") return value === "true";
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (bearerRole(req.headers.get("authorization") ?? "") !== "service_role") {
    return json({ error: "forbidden" }, 403);
  }

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !serviceKey) return json({ error: "not_configured" }, 500);
  const db = createClient(url, serviceKey);

  const { data: setting, error: settingError } = await db
    .from("agent_settings")
    .select("value")
    .eq("key", "enabled")
    .maybeSingle();
  if (settingError) return json({ error: settingError.message }, 500);
  if (!flagOn(setting?.value)) return json({ skipped: true, reason: "disabled" });

  const { data: promoted, error: promoteError } = await db.rpc("promote_due_agent_events");
  if (promoteError) return json({ error: promoteError.message }, 500);

  const { data: batch, error: readError } = await db.rpc("agent_queue_read", {
    p_queue: "agent_analyst",
    p_vt: 120,
    p_qty: 5,
  });
  if (readError) return json({ error: readError.message }, 500);

  const messages = (batch ?? []) as Array<{ msg_id: number; message: Record<string, unknown> }>;
  let kicked = 0;
  for (const message of messages) {
    const payload = message.message ?? {};
    const { error } = await db.rpc("agent_invoke", {
      p_function: "agent-analyst",
      p_body: { ...payload, msg_id: message.msg_id },
    });
    if (error) {
      console.warn("agent_invoke", error.message);
      continue;
    }
    kicked += 1;
  }

  return json({ promoted: promoted ?? 0, kicked });
});
