/**
 * IM cloud connect server surface. OAuth token persistence needs approved SQL;
 * picks and forwarding allowlists use clients.deliverable_inputs.imAccess.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertClientScope } from "@/lib/assert-client-scope";
import {
  forwardingAddress,
  INBOUND_FORWARD_DOMAIN_ENV,
} from "@/lib/im-inbound-forward";
import {
  loadImAccessSettings,
  saveImAccessSettings,
} from "@/lib/im-access-settings.server";
import {
  buildGoogleDriveAuthUrl,
  googleDriveCredentialsConfigured,
} from "@/lib/google-drive-read";
import {
  buildMicrosoftGraphAuthUrl,
  microsoftGraphCredentialsConfigured,
} from "@/lib/microsoft-graph-read";
import { cloudIngestPaused } from "@/lib/im-access-settings";
import {
  getImCloudConnectionMap,
  insertImCloudOAuthState,
  revokeImCloudProvider,
  syncImCloudFolderIds,
} from "@/lib/im-cloud-connection.server";
import { imCloudOauthSqlReady } from "@/lib/im-cloud-token";

const pickSchema = z.object({
  provider: z.enum(["google", "microsoft"]),
  folderId: z.string().min(1).max(256),
  label: z.string().max(120).optional(),
});

export const getImCloudConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const oauthSqlReady = imCloudOauthSqlReady();
    return {
      google: googleDriveCredentialsConfigured(),
      microsoft: microsoftGraphCredentialsConfigured(),
      inboundDomain: (process.env[INBOUND_FORWARD_DOMAIN_ENV] ?? "").trim() || null,
      oauthSqlReady,
      tokensNeedSql: !oauthSqlReady,
    };
  });

export const getImCloudStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ clientId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    assertClientScope(context.actingAsClientId, data.clientId);
    const settings = (await loadImAccessSettings(data.clientId)) ?? {
      version: 1 as const,
      picks: [],
      revokedAt: null,
      forwarding: { allowedSenders: [] },
    };
    const domain = (process.env[INBOUND_FORWARD_DOMAIN_ENV] ?? "").trim();
    const connected = await getImCloudConnectionMap(data.clientId);
    return {
      picks: settings.picks,
      revoked: cloudIngestPaused(settings),
      forwardingAddress: domain ? forwardingAddress(data.clientId, domain) : null,
      allowedSenders: settings.forwarding.allowedSenders,
      googleConnected: connected.google,
      microsoftConnected: connected.microsoft,
    };
  });

export const saveImCloudPicks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        clientId: z.string().uuid(),
        picks: z.array(pickSchema).max(8),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    assertClientScope(context.actingAsClientId, data.clientId);
    const ok = await saveImAccessSettings(data.clientId, { picks: data.picks, revokedAt: null });
    if (!ok) throw new Error("Could not save folder picks");
    const googleIds = data.picks.filter((p) => p.provider === "google").map((p) => p.folderId);
    const msIds = data.picks.filter((p) => p.provider === "microsoft").map((p) => p.folderId);
    await syncImCloudFolderIds(data.clientId, "google", googleIds);
    await syncImCloudFolderIds(data.clientId, "microsoft", msIds);
    return { ok: true };
  });

export const saveImCloudAllowedSenders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        clientId: z.string().uuid(),
        allowedSenders: z.array(z.string().email()).max(20),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    assertClientScope(context.actingAsClientId, data.clientId);
    const normalised = data.allowedSenders.map((e) => e.trim().toLowerCase());
    const ok = await saveImAccessSettings(data.clientId, {
      forwarding: { allowedSenders: normalised },
    });
    if (!ok) throw new Error("Could not save allowed senders");
    return { ok: true };
  });

export const disconnectImCloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ clientId: z.string().uuid(), provider: z.enum(["google", "microsoft", "all"]) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    assertClientScope(context.actingAsClientId, data.clientId);
    const settings = await loadImAccessSettings(data.clientId);
    const picks =
      settings?.picks.filter((p) => {
        if (data.provider === "all") return false;
        return p.provider !== data.provider;
      }) ?? [];
    const ok = await saveImAccessSettings(data.clientId, {
      picks,
      revokedAt: new Date().toISOString(),
    });
    if (!ok) throw new Error("Could not disconnect");
    await revokeImCloudProvider(data.clientId, data.provider);
    const tokensRevoked = imCloudOauthSqlReady();
    return { ok: true, tokensRevoked, note: tokensRevoked ? null : "tokens_need_sql" };
  });

export const getImCloudAuthUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        clientId: z.string().uuid(),
        provider: z.enum(["google", "microsoft"]),
        returnPath: z.string().max(200).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    assertClientScope(context.actingAsClientId, data.clientId);
    if (!imCloudOauthSqlReady()) {
      throw new Error("Cloud OAuth needs an approved database migration");
    }
    const settings = await loadImAccessSettings(data.clientId);
    const { state } = await insertImCloudOAuthState({
      clientId: data.clientId,
      provider: data.provider,
      returnPath: data.returnPath,
    });
    if (data.provider === "google") {
      if (!googleDriveCredentialsConfigured()) throw new Error("Google Drive OAuth is not configured");
      const redirectUri = `${process.env.PUBLIC_APP_URL ?? ""}/api/google-drive/callback`;
      return {
        authUrl: buildGoogleDriveAuthUrl({
          state,
          redirectUri,
          pickedFolderIds: settings?.picks.filter((p) => p.provider === "google").map((p) => p.folderId) ?? [],
        }),
      };
    }
    if (!microsoftGraphCredentialsConfigured()) throw new Error("Microsoft Graph OAuth is not configured");
    const redirectUri = `${process.env.PUBLIC_APP_URL ?? ""}/api/microsoft-drive/callback`;
    return { authUrl: buildMicrosoftGraphAuthUrl({ state, redirectUri }) };
  });