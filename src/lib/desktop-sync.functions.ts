/**
 * Partner settings for desktop folder sync. Service role after firm guards.
 * Device upload routes live in desktop-sync-device.functions.ts.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isSupabaseAdminConfigured, supabaseAdmin } from "@/integrations/supabase/client.server";
import { desktopSyncFirmAllowed } from "@/lib/desktop-sync-allowlist";
import {
  DESKTOP_SYNC_CONSENT_VERSION,
  DESKTOP_SYNC_PAIRING_TTL_MS,
  desktopSyncConsentNotice,
  folderLabelValid,
  hashPairingCode,
  normalizeFolderLabel,
  type DesktopSyncFolderMap,
} from "@/lib/desktop-sync";

type DbError = { message: string } | null;

function table(name: string) {
  if (!supabaseAdmin) throw new Error("unavailable");
  return supabaseAdmin.from(name);
}

function missingDesktopTable(error: DbError): boolean {
  const message = error?.message ?? "";
  return /desktop_sync_/.test(message) && /does not exist|schema cache|could not find/i.test(message);
}

async function isFirmOwner(userId: string, firmId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("firms")
    .select("owner_user_id")
    .eq("id", firmId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.owner_user_id === userId;
}

async function firmEnabled(firmId: string): Promise<boolean> {
  const row = await table("desktop_sync_firms")
    .select("firm_id, disabled_at")
    .eq("firm_id", firmId)
    .maybeSingle();
  if (row.error) {
    if (missingDesktopTable(row.error)) return false;
    throw new Error(row.error.message);
  }
  if (!row.data) return false;
  return !row.data.disabled_at;
}

function pairingCodeRaw(): string {
  const part = () => {
    const bytes = new Uint8Array(3);
    crypto.getRandomValues(bytes);
    return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 4).toUpperCase();
  };
  return `${part()}-${part()}`;
}

async function logActivity(
  firmId: string,
  kind: string,
  detail: Record<string, unknown>,
  deviceId?: string | null,
  actorUserId?: string | null,
) {
  const inserted = await table("desktop_sync_activity").insert({
    firm_id: firmId,
    device_id: deviceId ?? null,
    actor_user_id: actorUserId ?? null,
    kind,
    detail,
  });
  if (inserted.error && !missingDesktopTable(inserted.error)) throw new Error(inserted.error.message);
}

export type DesktopSyncStatus = {
  available: boolean;
  enabled: boolean;
  notice: string;
  noticeVersion: string;
  folderMaps: DesktopSyncFolderMap[];
  devices: Array<{
    id: string;
    deviceLabel: string;
    pairedAt: string;
    revokedAt: string | null;
  }>;
  openPairingCode: string | null;
  openPairingExpiresAt: string | null;
  activity: Array<{ kind: string; createdAt: string; detail: Record<string, unknown> }>;
};

export const loadDesktopSyncStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ firmId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<DesktopSyncStatus> => {
    const empty: DesktopSyncStatus = {
      available: false,
      enabled: false,
      notice: "",
      noticeVersion: DESKTOP_SYNC_CONSENT_VERSION,
      folderMaps: [],
      devices: [],
      openPairingCode: null,
      openPairingExpiresAt: null,
      activity: [],
    };
    if (!isSupabaseAdminConfigured() || !desktopSyncFirmAllowed(data.firmId)) return empty;
    if (!(await isFirmOwner(context.userId, data.firmId))) return empty;

    const firm = await supabaseAdmin.from("firms").select("name").eq("id", data.firmId).maybeSingle();
    const practiceName = typeof firm.data?.name === "string" ? firm.data.name : "";
    empty.notice = desktopSyncConsentNotice(practiceName);
    empty.available = true;

    const enabledRow = await table("desktop_sync_firms")
      .select("firm_id, disabled_at")
      .eq("firm_id", data.firmId)
      .maybeSingle();
    if (enabledRow.error) {
      if (missingDesktopTable(enabledRow.error)) return empty;
      throw new Error(enabledRow.error.message);
    }
    empty.enabled = Boolean(enabledRow.data && !enabledRow.data.disabled_at);

    const maps = await table("desktop_sync_folder_maps")
      .select("folder_label, client_id")
      .eq("firm_id", data.firmId)
      .order("folder_label", { ascending: true });
    if (!maps.error) {
      empty.folderMaps = (maps.data ?? []).map((row) => ({
        folderLabel: String(row.folder_label),
        clientId: String(row.client_id),
      }));
    }

    const devices = await table("desktop_sync_devices")
      .select("id, device_label, paired_at, revoked_at")
      .eq("firm_id", data.firmId)
      .order("paired_at", { ascending: false });
    if (!devices.error) {
      empty.devices = (devices.data ?? []).map((row) => ({
        id: String(row.id),
        deviceLabel: String(row.device_label),
        pairedAt: String(row.paired_at),
        revokedAt: typeof row.revoked_at === "string" ? row.revoked_at : null,
      }));
    }

    const pairing = await table("desktop_sync_pairing_codes")
      .select("code_hash, expires_at")
      .eq("firm_id", data.firmId)
      .is("used_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1);
    // Raw pairing code is never stored; only returned once at mint time.

    const activity = await table("desktop_sync_activity")
      .select("kind, created_at, detail")
      .eq("firm_id", data.firmId)
      .order("created_at", { ascending: false })
      .limit(40);
    if (!activity.error) {
      empty.activity = (activity.data ?? []).map((row) => ({
        kind: String(row.kind),
        createdAt: String(row.created_at),
        detail:
          row.detail && typeof row.detail === "object" ? (row.detail as Record<string, unknown>) : {},
      }));
    }

    return empty;
  });

export const enableDesktopSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        firmId: z.string().uuid(),
        folderMaps: z.array(
          z.object({
            folderLabel: z.string().max(80),
            clientId: z.string().uuid(),
          }),
        ),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true } | { ok: false; reason: string }> => {
    if (!isSupabaseAdminConfigured()) return { ok: false, reason: "unavailable" };
    if (!desktopSyncFirmAllowed(data.firmId)) return { ok: false, reason: "not_allowed" };
    if (!(await isFirmOwner(context.userId, data.firmId))) return { ok: false, reason: "forbidden" };

    if (data.folderMaps.length < 1) return { ok: false, reason: "folders" };
    const labels = new Set<string>();
    for (const map of data.folderMaps) {
      const label = normalizeFolderLabel(map.folderLabel);
      if (!folderLabelValid(label)) return { ok: false, reason: "folder" };
      if (labels.has(label.toLowerCase())) return { ok: false, reason: "folder_dup" };
      labels.add(label.toLowerCase());
      const client = await supabaseAdmin
        .from("clients")
        .select("firm_id")
        .eq("id", map.clientId)
        .maybeSingle();
      if (client.error || client.data?.firm_id !== data.firmId) return { ok: false, reason: "client" };
    }

    const folderLabels = data.folderMaps.map((m) => normalizeFolderLabel(m.folderLabel));
    const now = new Date().toISOString();
    const upserted = await table("desktop_sync_firms").upsert(
      {
        firm_id: data.firmId,
        enabled_at: now,
        enabled_by: context.userId,
        consent_notice_version: DESKTOP_SYNC_CONSENT_VERSION,
        consent_folder_labels: folderLabels,
        disabled_at: null,
      },
      { onConflict: "firm_id" },
    );
    if (upserted.error) {
      if (missingDesktopTable(upserted.error)) return { ok: false, reason: "unavailable" };
      throw new Error(upserted.error.message);
    }

    await table("desktop_sync_folder_maps").delete().eq("firm_id", data.firmId);
    for (const map of data.folderMaps) {
      const label = normalizeFolderLabel(map.folderLabel);
      const inserted = await table("desktop_sync_folder_maps").insert({
        firm_id: data.firmId,
        folder_label: label,
        client_id: map.clientId,
      });
      if (inserted.error) throw new Error(inserted.error.message);
    }

    await logActivity(
      data.firmId,
      "enabled",
      { noticeVersion: DESKTOP_SYNC_CONSENT_VERSION, folderLabels },
      null,
      context.userId,
    );
    await supabaseAdmin.rpc("write_audit_log", {
      _action: "desktop_sync_enabled",
      _firm_id: data.firmId,
      _client_id: null,
      _subject_user_id: null,
      _details: { noticeVersion: DESKTOP_SYNC_CONSENT_VERSION, folderLabels },
      _actor_id: context.userId,
    });
    return { ok: true };
  });

export const disableDesktopSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ firmId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true } | { ok: false; reason: string }> => {
    if (!isSupabaseAdminConfigured()) return { ok: false, reason: "unavailable" };
    if (!desktopSyncFirmAllowed(data.firmId)) return { ok: false, reason: "not_allowed" };
    if (!(await isFirmOwner(context.userId, data.firmId))) return { ok: false, reason: "forbidden" };

    const now = new Date().toISOString();
    const updated = await table("desktop_sync_firms")
      .update({ disabled_at: now })
      .eq("firm_id", data.firmId);
    if (updated.error) {
      if (missingDesktopTable(updated.error)) return { ok: false, reason: "unavailable" };
      throw new Error(updated.error.message);
    }

    await table("desktop_sync_devices")
      .update({ revoked_at: now })
      .eq("firm_id", data.firmId)
      .is("revoked_at", null);

    await logActivity(data.firmId, "disabled", {}, null, context.userId);
    return { ok: true };
  });

export const mintDesktopPairingCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        firmId: z.string().uuid(),
        deviceLabel: z.string().max(120),
      })
      .parse(input),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<
      | { ok: true; code: string; expiresAt: string }
      | { ok: false; reason: string }
    > => {
      if (!isSupabaseAdminConfigured()) return { ok: false, reason: "unavailable" };
      if (!desktopSyncFirmAllowed(data.firmId)) return { ok: false, reason: "not_allowed" };
      if (!(await isFirmOwner(context.userId, data.firmId))) return { ok: false, reason: "forbidden" };
      if (!(await firmEnabled(data.firmId))) return { ok: false, reason: "off" };

      const label = data.deviceLabel.replace(/\s+/g, " ").trim();
      if (label.length < 1) return { ok: false, reason: "label" };

      const code = pairingCodeRaw();
      const codeHash = await hashPairingCode(code);
      const expiresAt = new Date(Date.now() + DESKTOP_SYNC_PAIRING_TTL_MS).toISOString();

      const inserted = await table("desktop_sync_pairing_codes").insert({
        firm_id: data.firmId,
        code_hash: codeHash,
        device_label: label,
        expires_at: expiresAt,
        created_by: context.userId,
      });
      if (inserted.error) {
        if (missingDesktopTable(inserted.error)) return { ok: false, reason: "unavailable" };
        throw new Error(inserted.error.message);
      }

      await logActivity(data.firmId, "paired", { deviceLabel: label, stage: "code_minted" }, null, context.userId);
      return { ok: true, code, expiresAt };
    },
  );

export const revokeDesktopDevice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ firmId: z.string().uuid(), deviceId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true } | { ok: false; reason: string }> => {
    if (!isSupabaseAdminConfigured()) return { ok: false, reason: "unavailable" };
    if (!desktopSyncFirmAllowed(data.firmId)) return { ok: false, reason: "not_allowed" };
    if (!(await isFirmOwner(context.userId, data.firmId))) return { ok: false, reason: "forbidden" };

    const now = new Date().toISOString();
    const updated = await table("desktop_sync_devices")
      .update({ revoked_at: now })
      .eq("id", data.deviceId)
      .eq("firm_id", data.firmId);
    if (updated.error) {
      if (missingDesktopTable(updated.error)) return { ok: false, reason: "unavailable" };
      throw new Error(updated.error.message);
    }

    await logActivity(
      data.firmId,
      "disconnected",
      { deviceId: data.deviceId },
      data.deviceId,
      context.userId,
    );
    return { ok: true };
  });

/** @internal exported for tests */
export function desktopDeviceTokens(): { access: string; refresh: string } {
  const token = () => {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  };
  return { access: token(), refresh: token() };
}