/**
 * Poll picked Google Drive / OneDrive folders → source-documents (review queue).
 * Requires im_cloud_connections migration + IM_CLOUD_OAUTH_SQL_READY=1.
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

serve(async (req) => {
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });
  if (Deno.env.get("IM_CLOUD_OAUTH_SQL_READY") !== "1") {
    return Response.json({ ok: false, reason: "sql_migration_required" }, { status: 503 });
  }
  return Response.json({ ok: true, polled: 0, note: "token_store_pending" });
});