/**
 * Device-facing routes: pair, refresh, upload. Bearer device access token.
 * Upload-only: cannot list clients, read documents, or call agents.
 */
import { randomBytes } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { isSupabaseAdminConfigured, supabaseAdmin } from "@/integrations/supabase/client.server";
import { SOURCE_DOCS_BUCKET } from "@/lib/source-document-hooks";
import {
  DESKTOP_SYNC_DAILY_BYTE_CAP,
  DESKTOP_SYNC_DAILY_FILE_CAP,
  DESKTOP_SYNC_RATE_MAX_PER_WINDOW,
  DESKTOP_SYNC_RATE_WINDOW_MS,
  DESKTOP_SYNC_REFRESH_TTL_MS,
  DESKTOP_SYNC_TOKEN_TTL_MS,
  desktopSyncFileRejected,
  hashDeviceToken,
  hashPairingCode,
  mimeAllowed,
  normalizeFolderLabel,
  sanitizeUploadFileName,
  sastUsageDay,
} from "@/lib/desktop-sync";
import {
  sha256HexOfBytes,
  sourceObjectPath,
  suffixSourceObjectName,
} from "@/lib/source-documents-ui";

type DbError = { message: string } | null;

const rateWindow = new Map<string, { start: number; count: number }>();

function table(name: string) {
  if (!supabaseAdmin) throw new Error("unavailable");
  return supabaseAdmin.from(name);
}

function missingDesktopTable(error: DbError): boolean {
  const message = error?.message ?? "";
  return /desktop_sync_/.test(message) && /does not exist|schema cache|could not find/i.test(message);
}

function bearerToken(): string | null {
  const request = getRequest();
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() ?? null;
}

type DeviceRow = {
  id: string;
  firm_id: string;
  device_label: string;
  token_hash: string;
  refresh_token_hash: string;
  token_expires_at: string;
  refresh_expires_at: string;
  revoked_at: string | null;
  linked_upload_user_id: string;
};

async function loadDeviceByAccessToken(token: string): Promise<DeviceRow | null> {
  const tokenHash = await hashDeviceToken(token);
  const row = await table("desktop_sync_devices")
    .select(
      "id, firm_id, device_label, token_hash, refresh_token_hash, token_expires_at, refresh_expires_at, revoked_at, linked_upload_user_id",
    )
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (row.error || !row.data) return null;
  return row.data as DeviceRow;
}

async function firmSyncEnabled(firmId: string): Promise<boolean> {
  const row = await table("desktop_sync_firms")
    .select("disabled_at")
    .eq("firm_id", firmId)
    .maybeSingle();
  if (row.error || !row.data) return false;
  return !row.data.disabled_at;
}

function rateLimited(deviceId: string): boolean {
  const now = Date.now();
  const entry = rateWindow.get(deviceId);
  if (!entry || now - entry.start > DESKTOP_SYNC_RATE_WINDOW_MS) {
    rateWindow.set(deviceId, { start: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > DESKTOP_SYNC_RATE_MAX_PER_WINDOW;
}

async function bumpDailyUsage(deviceId: string, bytes: number): Promise<boolean> {
  const day = sastUsageDay();
  const existing = await table("desktop_sync_daily_usage")
    .select("file_count, byte_count")
    .eq("device_id", deviceId)
    .eq("usage_day", day)
    .maybeSingle();
  const fileCount = Number(existing.data?.file_count ?? 0) + 1;
  const byteCount = Number(existing.data?.byte_count ?? 0) + bytes;
  if (fileCount > DESKTOP_SYNC_DAILY_FILE_CAP || byteCount > DESKTOP_SYNC_DAILY_BYTE_CAP) {
    return true;
  }
  await table("desktop_sync_daily_usage").upsert(
    {
      device_id: deviceId,
      usage_day: day,
      file_count: fileCount,
      byte_count: byteCount,
    },
    { onConflict: "device_id,usage_day" },
  );
  return false;
}

async function logActivity(
  firmId: string,
  kind: string,
  detail: Record<string, unknown>,
  deviceId: string,
) {
  await table("desktop_sync_activity").insert({
    firm_id: firmId,
    device_id: deviceId,
    kind,
    detail,
  });
}

async function targetLedgerForClient(clientId: string): Promise<"xero" | "qbo" | "sage" | null> {
  const [xero, qbo, sage] = await Promise.all([
    table("xero_connections").select("id").eq("client_id", clientId).limit(1),
    table("qbo_connections").select("id").eq("client_id", clientId).limit(1),
    table("sage_connections").select("id").eq("client_id", clientId).limit(1),
  ]);
  if ((xero.data?.length ?? 0) > 0) return "xero";
  if ((qbo.data?.length ?? 0) > 0) return "qbo";
  if ((sage.data?.length ?? 0) > 0) return "sage";
  return null;
}

async function invokeExtract(documentId: string, targetLedger: "xero" | "qbo" | "sage") {
  const base = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) return;
  try {
    await fetch(`${base}/functions/v1/extract-source-document`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        document_id: documentId,
        target_ledger: targetLedger,
        requested_mode: "draft",
      }),
    });
  } catch {
    // Extraction is best-effort; upload success stands without it.
  }
}

function newOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function pairDesktopSyncDeviceImpl(
  data: { pairingCode: string; deviceLabel?: string },
  apiBase: string,
): Promise<
  | {
      ok: true;
      accessToken: string;
      refreshToken: string;
      accessExpiresAt: string;
      refreshExpiresAt: string;
      folderMaps: Array<{ folderLabel: string; clientId: string }>;
      apiBase: string;
    }
  | { ok: false; reason: string }
> {
      if (!isSupabaseAdminConfigured()) return { ok: false, reason: "unavailable" };
      const codeHash = await hashPairingCode(data.pairingCode);
      const codeRow = await table("desktop_sync_pairing_codes")
        .select("id, firm_id, device_label, expires_at, used_at, created_by")
        .eq("code_hash", codeHash)
        .maybeSingle();
      if (codeRow.error) {
        if (missingDesktopTable(codeRow.error)) return { ok: false, reason: "unavailable" };
        throw new Error(codeRow.error.message);
      }
      const row = codeRow.data;
      if (!row || row.used_at) return { ok: false, reason: "code" };
      if (new Date(String(row.expires_at)).getTime() < Date.now()) return { ok: false, reason: "expired" };
      if (!(await firmSyncEnabled(String(row.firm_id)))) return { ok: false, reason: "off" };

      const access = newOpaqueToken();
      const refresh = newOpaqueToken();
      const accessHash = await hashDeviceToken(access);
      const refreshHash = await hashDeviceToken(refresh);
      const accessExpiresAt = new Date(Date.now() + DESKTOP_SYNC_TOKEN_TTL_MS).toISOString();
      const refreshExpiresAt = new Date(Date.now() + DESKTOP_SYNC_REFRESH_TTL_MS).toISOString();
      const label =
        (data.deviceLabel ?? "").replace(/\s+/g, " ").trim() || String(row.device_label).trim();

      const inserted = await table("desktop_sync_devices").insert({
        firm_id: row.firm_id,
        device_label: label,
        token_hash: accessHash,
        refresh_token_hash: refreshHash,
        token_expires_at: accessExpiresAt,
        refresh_expires_at: refreshExpiresAt,
        paired_by: row.created_by,
        linked_upload_user_id: row.created_by,
      });
      if (inserted.error) throw new Error(inserted.error.message);

      await table("desktop_sync_pairing_codes")
        .update({ used_at: new Date().toISOString() })
        .eq("id", row.id);

      const maps = await table("desktop_sync_folder_maps")
        .select("folder_label, client_id")
        .eq("firm_id", row.firm_id);
      const folderMaps = (maps.data ?? []).map((m) => ({
        folderLabel: String(m.folder_label),
        clientId: String(m.client_id),
      }));

      const deviceId = inserted.data?.[0]?.id;
      if (deviceId) {
        await logActivity(String(row.firm_id), "paired", { deviceLabel: label }, String(deviceId));
      }

      return {
        ok: true,
        accessToken: access,
        refreshToken: refresh,
        accessExpiresAt,
        refreshExpiresAt,
        folderMaps,
        apiBase,
      };
}

export const pairDesktopSyncDevice = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        pairingCode: z.string().max(32),
        deviceLabel: z.string().max(120).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const request = getRequest();
    return pairDesktopSyncDeviceImpl(data, new URL(request.url).origin);
  });

export async function refreshDesktopSyncDeviceImpl(data: { refreshToken: string }): Promise<
  | { ok: true; accessToken: string; accessExpiresAt: string; refreshToken: string; refreshExpiresAt: string }
  | { ok: false; reason: string }
> {
      if (!isSupabaseAdminConfigured()) return { ok: false, reason: "unavailable" };
      const refreshHash = await hashDeviceToken(data.refreshToken);
      const found = await table("desktop_sync_devices")
        .select(
          "id, firm_id, refresh_expires_at, revoked_at, refresh_token_hash",
        )
        .eq("refresh_token_hash", refreshHash)
        .maybeSingle();
      if (found.error || !found.data) return { ok: false, reason: "token" };
      const device = found.data as DeviceRow;
      if (device.revoked_at) return { ok: false, reason: "revoked" };
      if (new Date(device.refresh_expires_at).getTime() < Date.now()) return { ok: false, reason: "expired" };
      if (!(await firmSyncEnabled(device.firm_id))) return { ok: false, reason: "off" };

      const access = newOpaqueToken();
      const refresh = newOpaqueToken();
      const accessHash = await hashDeviceToken(access);
      const refreshHashNew = await hashDeviceToken(refresh);
      const accessExpiresAt = new Date(Date.now() + DESKTOP_SYNC_TOKEN_TTL_MS).toISOString();
      const refreshExpiresAt = new Date(Date.now() + DESKTOP_SYNC_REFRESH_TTL_MS).toISOString();

      const updated = await table("desktop_sync_devices")
        .update({
          token_hash: accessHash,
          refresh_token_hash: refreshHashNew,
          token_expires_at: accessExpiresAt,
          refresh_expires_at: refreshExpiresAt,
        })
        .eq("id", device.id);
      if (updated.error) throw new Error(updated.error.message);

      return {
        ok: true,
        accessToken: access,
        accessExpiresAt,
        refreshToken: refresh,
        refreshExpiresAt,
      };
}

export const refreshDesktopSyncDevice = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ refreshToken: z.string().min(20).max(200) }).parse(input))
  .handler(async ({ data }) => refreshDesktopSyncDeviceImpl(data));

export async function desktopSyncDeviceUploadImpl(
  data: {
    folderLabel: string;
    fileName: string;
    mime: string;
    sizeBytes: number;
    sha256: string;
    contentBase64: string;
  },
  accessToken: string | null,
): Promise<{ ok: true; duplicate: boolean; documentId: string | null } | { ok: false; reason: string }> {
      if (!isSupabaseAdminConfigured()) return { ok: false, reason: "unavailable" };
      const token = accessToken;
      if (!token) return { ok: false, reason: "unauthorised" };
      const device = await loadDeviceByAccessToken(token);
      if (!device) return { ok: false, reason: "token" };
      if (device.revoked_at) return { ok: false, reason: "revoked" };
      if (new Date(device.token_expires_at).getTime() < Date.now()) return { ok: false, reason: "expired" };
      if (!(await firmSyncEnabled(device.firm_id))) return { ok: false, reason: "off" };
      if (rateLimited(device.id)) return { ok: false, reason: "rate" };

      const reject = desktopSyncFileRejected(data.fileName, data.sizeBytes);
      if (reject) {
        await logActivity(
          device.firm_id,
          "upload_rejected",
          { reason: reject, fileName: data.fileName, folderLabel: data.folderLabel },
          device.id,
        );
        return { ok: false, reason: reject };
      }
      if (!mimeAllowed(data.mime)) return { ok: false, reason: "mime" };

      const label = normalizeFolderLabel(data.folderLabel);
      const map = await table("desktop_sync_folder_maps")
        .select("client_id")
        .eq("firm_id", device.firm_id)
        .eq("folder_label", label)
        .maybeSingle();
      if (map.error || !map.data?.client_id) {
        await logActivity(
          device.firm_id,
          "upload_rejected",
          { reason: "folder", folderLabel: label },
          device.id,
        );
        return { ok: false, reason: "folder" };
      }
      const clientId = String(map.data.client_id);

      if (await bumpDailyUsage(device.id, data.sizeBytes)) return { ok: false, reason: "cap" };

      const bytes = Buffer.from(data.contentBase64, "base64");
      const sha = (await sha256HexOfBytes(new Uint8Array(bytes))).toLowerCase();
      if (sha !== data.sha256.toLowerCase()) return { ok: false, reason: "hash" };

      const safeName = sanitizeUploadFileName(data.fileName);
      let objectName = safeName;
      let storagePath = "";
      for (let attempt = 0; attempt < 4; attempt += 1) {
        objectName = attempt === 0 ? safeName : suffixSourceObjectName(safeName, attempt + 1);
        storagePath = sourceObjectPath(clientId, objectName);
        const uploaded = await supabaseAdmin.storage.from(SOURCE_DOCS_BUCKET).upload(storagePath, bytes, {
          contentType: data.mime,
          upsert: false,
        });
        if (!uploaded.error) break;
        const conflict = /exist|duplicate|409/i.test(uploaded.error.message);
        if (!conflict || attempt === 3) return { ok: false, reason: "storage" };
      }

      const registered = await supabaseAdmin.rpc("register_desktop_sync_source_document", {
        p_client_id: clientId,
        p_storage_path: storagePath,
        p_sha256: sha,
        p_mime: data.mime,
        p_size_bytes: data.sizeBytes,
        p_uploaded_by: device.linked_upload_user_id,
      });
      if (registered.error) {
        await supabaseAdmin.storage.from(SOURCE_DOCS_BUCKET).remove([storagePath]);
        if (missingDesktopTable(registered.error)) return { ok: false, reason: "unavailable" };
        return { ok: false, reason: "register" };
      }
      const body =
        registered.data && typeof registered.data === "object"
          ? (registered.data as Record<string, unknown>)
          : {};
      if (body.ok !== true) {
        await supabaseAdmin.storage.from(SOURCE_DOCS_BUCKET).remove([storagePath]);
        return { ok: false, reason: typeof body.error === "string" ? body.error : "register" };
      }
      const documentId = typeof body.document_id === "string" ? body.document_id : null;
      const duplicate = body.duplicate === true;
      const ledger = await targetLedgerForClient(clientId);
      if (documentId && !duplicate && ledger) {
        await invokeExtract(documentId, ledger);
      }

      await logActivity(
        device.firm_id,
        "upload",
        {
          folderLabel: label,
          fileName: data.fileName,
          clientId,
          documentId,
          duplicate,
        },
        device.id,
      );

      return { ok: true, duplicate, documentId };
}

export const desktopSyncDeviceUpload = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        folderLabel: z.string().max(80),
        fileName: z.string().max(240),
        mime: z.string().max(120),
        sizeBytes: z.number().int().positive(),
        sha256: z.string().regex(/^[0-9a-f]{64}$/i),
        contentBase64: z.string().max(28_000_000),
      })
      .parse(input),
  )
  .handler(async ({ data }) => desktopSyncDeviceUploadImpl(data, bearerToken()));

/** @internal negative test: device tokens must not reach client list routes */
export const desktopSyncDeviceScopes = {
  canReadDocuments: false,
  canListClients: false,
  canCallAgents: false,
} as const;

export const probeDesktopSyncDeviceRead = createServerFn({ method: "GET" }).handler(async () => {
  const token = bearerToken();
  if (!token) return { ok: false, blocked: "unauthorised" as const };
  const device = await loadDeviceByAccessToken(token);
  if (!device) return { ok: false, blocked: "token" as const };
  const clients = await table("clients").select("id").eq("firm_id", device.firm_id).limit(1);
  return { ok: false, blocked: "forbidden" as const, leaked: Boolean(clients.data?.length) };
});