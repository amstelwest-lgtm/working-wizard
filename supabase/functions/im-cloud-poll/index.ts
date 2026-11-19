/**
 * Poll picked Google Drive / OneDrive folders (read-only listing).
 * Requires im_cloud_connections + IM_CLOUD_OAUTH_SQL_READY=1 + IM_CLOUD_TOKEN_KEY.
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { googleDriveListChildren } from "../../../src/lib/google-drive-read.ts";
import { microsoftGraphListFolderByItemId } from "../../../src/lib/microsoft-graph-read.ts";
import { refreshImCloudTokens } from "../../../src/lib/im-cloud-oauth.server.ts";
import { decryptImCloudSecret, encryptImCloudSecret } from "../../../src/lib/im-cloud-token.ts";

type ConnectionRow = {
  id: string;
  client_id: string;
  provider: "google" | "microsoft";
  folder_ids: string[];
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  token_expiry: string;
  revoked_at: string | null;
};

async function accessTokenForRow(
  supabase: ReturnType<typeof createClient>,
  row: ConnectionRow,
): Promise<string | null> {
  if (row.revoked_at != null || !row.access_token_enc || !row.refresh_token_enc) return null;
  const expiryMs = Date.parse(row.token_expiry);
  const fresh = Number.isFinite(expiryMs) && expiryMs > Date.now() + 60_000;
  if (fresh) return decryptImCloudSecret(row.access_token_enc);
  const refreshPlain = decryptImCloudSecret(row.refresh_token_enc);
  const refreshed = await refreshImCloudTokens(row.provider, refreshPlain);
  const tokenExpiry = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
  await supabase
    .from("im_cloud_connections")
    .update({
      access_token_enc: encryptImCloudSecret(refreshed.access_token),
      refresh_token_enc: encryptImCloudSecret(refreshed.refresh_token),
      token_expiry: tokenExpiry,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);
  return refreshed.access_token;
}

serve(async (req) => {
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });
  if (Deno.env.get("IM_CLOUD_OAUTH_SQL_READY") !== "1") {
    return Response.json({ ok: false, reason: "sql_migration_required" }, { status: 503 });
  }
  if (!(Deno.env.get("IM_CLOUD_TOKEN_KEY") ?? "").trim()) {
    return Response.json({ ok: false, reason: "token_key_missing" }, { status: 503 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) {
    return Response.json({ ok: false, reason: "supabase_not_configured" }, { status: 503 });
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const { data, error } = await supabase
    .from("im_cloud_connections")
    .select(
      "id, client_id, provider, folder_ids, access_token_enc, refresh_token_enc, token_expiry, revoked_at",
    )
    .is("revoked_at", null);

  if (error) {
    console.error("[im-cloud-poll] list failed", { code: error.code });
    return Response.json({ ok: false, reason: "list_failed" }, { status: 500 });
  }

  let polled = 0;
  let listed = 0;
  const rows = (data ?? []) as ConnectionRow[];

  for (const row of rows) {
    if (row.revoked_at != null) continue;
    let token: string | null = null;
    try {
      token = await accessTokenForRow(supabase, row);
    } catch (e) {
      console.error("[im-cloud-poll] token failed", {
        client: row.client_id,
        message: e instanceof Error ? e.message.slice(0, 80) : "unknown",
      });
      continue;
    }
    if (!token) continue;
    polled += 1;
    for (const folderId of row.folder_ids ?? []) {
      if (!folderId) continue;
      try {
        if (row.provider === "google") {
          listed += (await googleDriveListChildren(token, folderId)).length;
        } else {
          listed += (await microsoftGraphListFolderByItemId(token, folderId)).length;
        }
      } catch (e) {
        console.error("[im-cloud-poll] list failed", {
          provider: row.provider,
          client: row.client_id,
          message: e instanceof Error ? e.message.slice(0, 60) : "unknown",
        });
      }
    }
    await supabase
      .from("im_cloud_connections")
      .update({ last_polled_at: new Date().toISOString() })
      .eq("id", row.id);
  }

  return Response.json({ ok: true, polled, listed });
});