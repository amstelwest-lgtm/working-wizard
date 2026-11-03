/**
 * POST { artifact_id }
 * Reads one Client library upload into client_artifacts.meta.
 * Caller JWT with client access, or the service role. verify_jwt is true.
 * Does not write cash, budget, waterfall, or a ledger.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ingestLibraryArtifact } from "../_shared/library-ingest.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function bearerRole(authHeader: string): string | null {
  try {
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const pad = (value: string) => value + "=".repeat((4 - (value.length % 4)) % 4);
    const payload = JSON.parse(atob(pad(parts[1].replace(/-/g, "+").replace(/_/g, "/"))));
    return typeof payload?.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ ok: false, error: "unauthorised" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ ok: false, error: "not_configured" }, 500);

  let body: { artifact_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }
  const artifactId = typeof body.artifact_id === "string" ? body.artifact_id : "";
  if (!UUID.test(artifactId)) return json({ ok: false, error: "artifact_id_required" }, 400);

  const serviceRole = bearerRole(authHeader) === "service_role";
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: artifact, error: loadError } = await admin
    .from("client_artifacts")
    .select("client_id")
    .eq("id", artifactId)
    .maybeSingle();
  if (loadError) return json({ ok: false, error: "load_failed" }, 500);
  const clientId = typeof artifact?.client_id === "string" ? artifact.client_id : "";
  if (!clientId) return json({ ok: false, error: "library_file_missing" }, 404);

  if (!serviceRole) {
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();
    if (authError || !user) return json({ ok: false, error: "unauthorised" }, 401);
    const { data: allowed, error: accessError } = await admin.rpc("has_client_access", {
      _user_id: user.id,
      _client_id: clientId,
    });
    if (accessError) return json({ ok: false, error: "access_check_failed" }, 500);
    if (allowed !== true) return json({ ok: false, error: "forbidden" }, 403);
  }

  const result = await ingestLibraryArtifact(admin, artifactId, clientId);
  if (!result.ok) return json({ ok: false, error: result.error ?? "ingest_failed" }, 422);
  return json({ ok: true, read: result.read, summary: result.summary });
});
