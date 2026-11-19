/**
 * im_cloud_connections + im_cloud_oauth_states via service role only.
 */
import type { ImAccessProvider } from "@/lib/im-access-settings";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadImAccessSettings, saveImAccessSettings } from "@/lib/im-access-settings.server";
import { exchangeImCloudCode, refreshImCloudTokens } from "@/lib/im-cloud-oauth.server";
import {
  encryptImCloudSecret,
  decryptImCloudSecret,
  imCloudTokenKeyConfigured,
  requireImCloudOauthSqlReady,
} from "@/lib/im-cloud-token";
import { sanitizeImCloudReturnPath } from "@/lib/im-cloud-oauth-state";

export type ImCloudConnectionRow = {
  id: string;
  client_id: string;
  provider: ImAccessProvider;
  folder_ids: string[];
  drive_id: string | null;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  token_expiry: string;
  connected_at: string;
  last_polled_at: string | null;
  revoked_at: string | null;
};

function folderIdsForProvider(clientId: string, provider: ImAccessProvider): Promise<string[]> {
  return loadImAccessSettings(clientId).then((settings) => {
    const picks = settings?.picks.filter((p) => p.provider === provider) ?? [];
    return picks.map((p) => p.folderId);
  });
}

export async function insertImCloudOAuthState(input: {
  clientId: string;
  provider: ImAccessProvider;
  returnPath?: string;
}): Promise<{ state: string }> {
  requireImCloudOauthSqlReady();
  if (!imCloudTokenKeyConfigured()) {
    throw new Error("IM_CLOUD_TOKEN_KEY is not configured");
  }
  const state = crypto.randomUUID();
  const returnPath = sanitizeImCloudReturnPath(input.returnPath, input.clientId);
  const { error } = await supabaseAdmin.from("im_cloud_oauth_states").insert({
    state,
    client_id: input.clientId,
    provider: input.provider,
    return_path: returnPath,
  });
  if (error) throw new Error("im_cloud_state_insert_failed");
  return { state };
}

export async function listActiveImCloudConnections(): Promise<ImCloudConnectionRow[]> {
  const { data, error } = await supabaseAdmin
    .from("im_cloud_connections")
    .select(
      "id, client_id, provider, folder_ids, drive_id, access_token_enc, refresh_token_enc, token_expiry, connected_at, last_polled_at, revoked_at",
    )
    .is("revoked_at", null);
  if (error) throw new Error("im_cloud_connections_list_failed");
  return (data ?? []) as ImCloudConnectionRow[];
}

export async function getImCloudConnectionMap(
  clientId: string,
): Promise<Record<ImAccessProvider, boolean>> {
  if (process.env.IM_CLOUD_OAUTH_SQL_READY !== "1") {
    return { google: false, microsoft: false };
  }
  const { data, error } = await supabaseAdmin
    .from("im_cloud_connections")
    .select("provider, revoked_at")
    .eq("client_id", clientId);
  if (error) return { google: false, microsoft: false };
  const rows = data ?? [];
  const active = (p: ImAccessProvider) =>
    rows.some((r) => r.provider === p && r.revoked_at == null);
  return { google: active("google"), microsoft: active("microsoft") };
}

export async function persistImCloudTokensFromCode(input: {
  clientId: string;
  provider: ImAccessProvider;
  code: string;
}): Promise<void> {
  requireImCloudOauthSqlReady();
  const tokens = await exchangeImCloudCode(input.provider, input.code);
  const folderIds = await folderIdsForProvider(input.clientId, input.provider);
  const tokenExpiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  const row = {
    client_id: input.clientId,
    provider: input.provider,
    folder_ids: folderIds,
    access_token_enc: encryptImCloudSecret(tokens.access_token),
    refresh_token_enc: encryptImCloudSecret(tokens.refresh_token),
    token_expiry: tokenExpiry,
    revoked_at: null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabaseAdmin.from("im_cloud_connections").upsert(row, {
    onConflict: "client_id,provider",
  });
  if (error) throw new Error("im_cloud_connection_upsert_failed");
  await saveImAccessSettings(input.clientId, { revokedAt: null });
}

export async function syncImCloudFolderIds(
  clientId: string,
  provider: ImAccessProvider,
  folderIds: string[],
): Promise<void> {
  if (process.env.IM_CLOUD_OAUTH_SQL_READY !== "1") return;
  const { data } = await supabaseAdmin
    .from("im_cloud_connections")
    .select("id, revoked_at")
    .eq("client_id", clientId)
    .eq("provider", provider)
    .maybeSingle();
  if (!data || data.revoked_at != null) return;
  await supabaseAdmin
    .from("im_cloud_connections")
    .update({ folder_ids: folderIds, updated_at: new Date().toISOString() })
    .eq("client_id", clientId)
    .eq("provider", provider);
}

export async function revokeImCloudProvider(
  clientId: string,
  provider: ImAccessProvider | "all",
): Promise<void> {
  if (process.env.IM_CLOUD_OAUTH_SQL_READY !== "1") return;
  const revokedAt = new Date().toISOString();
  const patch = {
    revoked_at: revokedAt,
    access_token_enc: null,
    refresh_token_enc: null,
    updated_at: revokedAt,
  };
  let q = supabaseAdmin.from("im_cloud_connections").update(patch).eq("client_id", clientId);
  if (provider !== "all") q = q.eq("provider", provider);
  const { error } = await q;
  if (error) throw new Error("im_cloud_revoke_failed");
}

export async function ensureFreshImCloudAccessToken(
  row: ImCloudConnectionRow,
): Promise<string | null> {
  if (row.revoked_at != null) return null;
  if (!row.access_token_enc || !row.refresh_token_enc) return null;

  const expiryMs = Date.parse(row.token_expiry);
  const stillFresh = Number.isFinite(expiryMs) && expiryMs > Date.now() + 60_000;

  if (stillFresh) {
    return decryptImCloudSecret(row.access_token_enc);
  }

  const refreshPlain = decryptImCloudSecret(row.refresh_token_enc);
  const refreshed = await refreshImCloudTokens(row.provider, refreshPlain);
  const tokenExpiry = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
  const { error } = await supabaseAdmin
    .from("im_cloud_connections")
    .update({
      access_token_enc: encryptImCloudSecret(refreshed.access_token),
      refresh_token_enc: encryptImCloudSecret(refreshed.refresh_token),
      token_expiry: tokenExpiry,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);
  if (error) throw new Error("im_cloud_token_refresh_persist_failed");
  return refreshed.access_token;
}

export async function touchImCloudLastPolled(connectionId: string): Promise<void> {
  await supabaseAdmin
    .from("im_cloud_connections")
    .update({ last_polled_at: new Date().toISOString() })
    .eq("id", connectionId);
}