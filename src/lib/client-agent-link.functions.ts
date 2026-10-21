/**
 * Public /a/<token> actions. Service role only. The raw token is hashed
 * before lookup. File bytes are uploaded and downloaded with the service
 * role. The browser never receives a storage URL. Nothing is emailed,
 * extracted, or posted to a ledger.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { sendAgentFirmAllowed } from "@/lib/client-agent-send-allowlist";
import {
  SEND_ATTEMPT_WINDOW_MS,
  SEND_CONSENT_NOTICE,
  SEND_CONSENT_VERSION,
  SEND_STORAGE_BUCKET,
  SEND_FILE_BASE64_MAX,
  bytesFromBase64,
  consentReady,
  finishItem,
  gatePresentedSend,
  hashClientAddress,
  hashPresentedToken,
  itemLabel,
  mimeAllowed,
  pathBelongsToSend,
  sendAttemptLimited,
  sendStoragePath,
  sizeAllowed,
  storedMimeAllowed,
  type ItemQuality,
  type SendLinkReason,
} from "@/lib/client-agent-link";
import { isSupabaseAdminConfigured, supabaseAdmin } from "@/integrations/supabase/client.server";

type DbError = { message: string } | null;

type SendRow = {
  id: string;
  firm_id: string;
  expires_at: string;
  revoked_at: string | null;
  consent_at: string | null;
};

type ItemRow = {
  item_key: string;
  label: string | null;
  totals_only: boolean;
  status: string;
  quality: string | null;
  storage_path: string | null;
};

export type PublicItem = {
  itemKey: string;
  label: string;
  totalsOnly: boolean;
  status: string;
  quality: string | null;
  hasFile: boolean;
};

export type OpenLinkResult =
  | { ok: true; consented: boolean; notice: string; items: PublicItem[] }
  | { ok: false; reason: SendLinkReason };

const tokenInput = z.object({
  token: z
    .string()
    .trim()
    .min(20)
    .max(120)
    .regex(/^[A-Za-z0-9_-]+$/),
});

function clientAddress(): string {
  try {
    const request = getRequest();
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) {
      const first = forwarded.split(",")[0]?.trim();
      if (first) return first;
    }
    return request.headers.get("x-real-ip")?.trim() || "unknown";
  } catch {
    return "unknown";
  }
}

async function recentAttempts(ipHash: string): Promise<number> {
  const since = new Date(Date.now() - SEND_ATTEMPT_WINDOW_MS).toISOString();
  const { count, error } = await (
    supabaseAdmin as unknown as {
      from: (name: string) => {
        select: (
          cols: string,
          opts: { count: "exact"; head: boolean },
        ) => {
          eq: (
            column: string,
            value: string,
          ) => {
            gte: (
              column: string,
              value: string,
            ) => Promise<{ count: number | null; error: DbError }>;
          };
        };
      };
    }
  )
    .from("client_agent_send_attempts")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", since);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function recordAttempt(row: {
  send_id: string | null;
  token_hash: string | null;
  ip_hash: string;
  outcome: "ok" | "unknown" | "expired" | "revoked" | "limited";
}) {
  const { error } = await (
    supabaseAdmin as unknown as {
      from: (name: string) => {
        insert: (value: typeof row) => Promise<{ error: DbError }>;
      };
    }
  )
    .from("client_agent_send_attempts")
    .insert(row);
  if (error) throw new Error(error.message);
}

async function loadSend(tokenHash: string): Promise<SendRow | null> {
  const { data, error } = await (
    supabaseAdmin as unknown as {
      from: (name: string) => {
        select: (cols: string) => {
          eq: (
            column: string,
            value: string,
          ) => {
            maybeSingle: () => Promise<{ data: SendRow | null; error: DbError }>;
          };
        };
      };
    }
  )
    .from("client_agent_sends")
    .select("id, firm_id, expires_at, revoked_at, consent_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function loadItems(sendId: string): Promise<PublicItem[]> {
  const { data, error } = await (
    supabaseAdmin as unknown as {
      from: (name: string) => {
        select: (cols: string) => {
          eq: (
            column: string,
            value: string,
          ) => Promise<{ data: ItemRow[] | null; error: DbError }>;
        };
      };
    }
  )
    .from("client_agent_send_items")
    .select("item_key, label, totals_only, status, quality, storage_path")
    .eq("send_id", sendId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    itemKey: row.item_key,
    label: itemLabel(row.item_key, row.label),
    totalsOnly: row.totals_only === true,
    status: row.status,
    quality: row.quality,
    hasFile: typeof row.storage_path === "string" && row.storage_path.length > 0,
  }));
}

type Resolved =
  | { ok: true; send: SendRow; tokenHash: string; ipHash: string }
  | { ok: false; reason: SendLinkReason };

async function resolveToken(token: string): Promise<Resolved> {
  if (!isSupabaseAdminConfigured()) return { ok: false, reason: "unavailable" };
  const ipHash = await hashClientAddress(clientAddress());
  const limited = sendAttemptLimited(await recentAttempts(ipHash));
  const tokenHash = await hashPresentedToken(token);
  if (limited) {
    await recordAttempt({
      send_id: null,
      token_hash: tokenHash,
      ip_hash: ipHash,
      outcome: "limited",
    });
    return { ok: false, reason: "limited" };
  }
  const send = await loadSend(tokenHash);
  const decision = gatePresentedSend({
    limited: false,
    found: Boolean(send),
    firmId: send?.firm_id ?? null,
    revokedAt: send?.revoked_at ?? null,
    expiresAt: send?.expires_at ?? "",
    now: new Date(),
  });
  if (!send || decision !== "ok") {
    const outcome =
      decision === "expired" || decision === "revoked" || decision === "limited"
        ? decision
        : "unknown";
    await recordAttempt({
      send_id: send && sendAgentFirmAllowed(send.firm_id) ? send.id : null,
      token_hash: tokenHash,
      ip_hash: ipHash,
      outcome,
    });
    return { ok: false, reason: decision === "ok" ? "unavailable" : decision };
  }
  await recordAttempt({ send_id: send.id, token_hash: tokenHash, ip_hash: ipHash, outcome: "ok" });
  return { ok: true, send, tokenHash, ipHash };
}

function present(send: SendRow, items: PublicItem[]): OpenLinkResult {
  return {
    ok: true,
    consented: consentReady(send.consent_at),
    notice: SEND_CONSENT_NOTICE,
    items,
  };
}

export const openClientAgentLink = createServerFn({ method: "POST" })
  .inputValidator((input) => tokenInput.parse(input))
  .handler(async ({ data }): Promise<OpenLinkResult> => {
    const resolved = await resolveToken(data.token);
    if (!resolved.ok) return resolved;
    return present(resolved.send, await loadItems(resolved.send.id));
  });

export const consentClientAgentLink = createServerFn({ method: "POST" })
  .inputValidator((input) => tokenInput.parse(input))
  .handler(async ({ data }): Promise<OpenLinkResult> => {
    const resolved = await resolveToken(data.token);
    if (!resolved.ok) return resolved;
    if (!consentReady(resolved.send.consent_at)) {
      const { error } = await (
        supabaseAdmin as unknown as {
          from: (name: string) => {
            update: (row: Record<string, unknown>) => {
              eq: (column: string, value: string) => Promise<{ error: DbError }>;
            };
          };
        }
      )
        .from("client_agent_sends")
        .update({
          consent_at: new Date().toISOString(),
          consent_notice_version: SEND_CONSENT_VERSION,
        })
        .eq("id", resolved.send.id);
      if (error) throw new Error(error.message);
      resolved.send.consent_at = new Date().toISOString();
    }
    return present(resolved.send, await loadItems(resolved.send.id));
  });

const finishInput = z.object({
  token: tokenInput.shape.token,
  itemKey: z.string().regex(/^[a-z0-9_]+$/),
  quality: z.enum(["usable", "incomplete", "poor"]),
  explanation: z.string().max(2000).optional(),
});

type StoredObject = {
  size: number;
  type: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

type ObjectStorage = {
  upload: (
    path: string,
    body: Uint8Array,
    options: { contentType: string; upsert: boolean },
  ) => Promise<{ error: DbError }>;
  download: (path: string) => Promise<{ data: StoredObject | null; error: DbError }>;
  remove: (paths: string[]) => Promise<{ error: DbError }>;
};

function objectStorage(): ObjectStorage {
  return (
    supabaseAdmin as unknown as {
      storage: { from: (bucket: string) => ObjectStorage };
    }
  ).storage.from(SEND_STORAGE_BUCKET);
}

async function loadStoredPath(sendId: string, itemKey: string): Promise<string | null> {
  const { data, error } = await (
    supabaseAdmin as unknown as {
      from: (name: string) => {
        select: (cols: string) => {
          eq: (
            column: string,
            value: string,
          ) => {
            eq: (
              column: string,
              value: string,
            ) => {
              maybeSingle: () => Promise<{
                data: { storage_path: string | null } | null;
                error: DbError;
              }>;
            };
          };
        };
      };
    }
  )
    .from("client_agent_send_items")
    .select("storage_path")
    .eq("send_id", sendId)
    .eq("item_key", itemKey)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.storage_path ?? null;
}

async function updateItem(sendId: string, itemKey: string, patch: Record<string, unknown>) {
  const { error } = await (
    supabaseAdmin as unknown as {
      from: (name: string) => {
        update: (row: Record<string, unknown>) => {
          eq: (
            column: string,
            value: string,
          ) => {
            eq: (column: string, value: string) => Promise<{ error: DbError }>;
          };
        };
      };
    }
  )
    .from("client_agent_send_items")
    .update(patch)
    .eq("send_id", sendId)
    .eq("item_key", itemKey);
  if (error) throw new Error(error.message);
}

export const uploadClientAgentFile = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    tokenInput
      .extend({
        itemKey: z.string().regex(/^[a-z0-9_]+$/),
        mime: z.string().max(80),
        base64: z.string().min(4).max(SEND_FILE_BASE64_MAX),
      })
      .parse(input),
  )
  .handler(
    async ({
      data,
    }): Promise<{ ok: true } | { ok: false; reason: SendLinkReason | "mime" | "size" }> => {
      const resolved = await resolveToken(data.token);
      if (!resolved.ok) return resolved;
      if (!consentReady(resolved.send.consent_at)) return { ok: false, reason: "consent" };
      if (!mimeAllowed(data.mime)) return { ok: false, reason: "mime" };
      const bytes = bytesFromBase64(data.base64);
      if (!bytes || !sizeAllowed(bytes.byteLength)) return { ok: false, reason: "size" };
      const items = await loadItems(resolved.send.id);
      if (!items.some((item) => item.itemKey === data.itemKey))
        return { ok: false, reason: "unavailable" };

      const path = sendStoragePath(resolved.send.id, data.itemKey, crypto.randomUUID());
      const storage = objectStorage();
      const uploaded = await storage.upload(path, bytes, { contentType: data.mime, upsert: false });
      if (uploaded.error) return { ok: false, reason: "unavailable" };

      const downloaded = await storage.download(path);
      const stored = downloaded.data;
      if (downloaded.error || !stored) {
        await storage.remove([path]);
        return { ok: false, reason: "unavailable" };
      }
      const storedBytes = new Uint8Array(await stored.arrayBuffer());
      const storedType = stored.type || null;
      if (
        storedBytes.byteLength !== bytes.byteLength ||
        !sizeAllowed(storedBytes.byteLength) ||
        !storedMimeAllowed(data.mime, storedType)
      ) {
        await storage.remove([path]);
        return {
          ok: false,
          reason: storedType && !storedMimeAllowed(data.mime, storedType) ? "mime" : "size",
        };
      }

      const previous = await loadStoredPath(resolved.send.id, data.itemKey);
      try {
        await updateItem(resolved.send.id, data.itemKey, {
          status: "received",
          quality: "usable",
          explanation: null,
          mime: data.mime,
          size_bytes: storedBytes.byteLength,
          storage_path: path,
        });
      } catch (error) {
        await storage.remove([path]);
        throw error;
      }
      if (
        previous &&
        previous !== path &&
        pathBelongsToSend(previous, resolved.send.id, data.itemKey)
      ) {
        await storage.remove([previous]);
      }
      return { ok: true };
    },
  );

export const finishClientAgentItem = createServerFn({ method: "POST" })
  .inputValidator((input) => finishInput.parse(input))
  .handler(
    async ({
      data,
    }): Promise<{ ok: true } | { ok: false; reason: SendLinkReason | "explanation" | "empty" }> => {
      const resolved = await resolveToken(data.token);
      if (!resolved.ok) return resolved;
      if (!consentReady(resolved.send.consent_at)) return { ok: false, reason: "consent" };
      const items = await loadItems(resolved.send.id);
      const item = items.find((row) => row.itemKey === data.itemKey);
      if (!item) return { ok: false, reason: "unavailable" };
      const decision = finishItem({
        quality: data.quality,
        explanation: data.explanation ?? null,
        hasFile: item.hasFile,
      });
      if (!decision.ok) return decision;

      await updateItem(resolved.send.id, data.itemKey, {
        status: "received",
        quality: data.quality,
        explanation: decision.explanation,
      });
      return { ok: true };
    },
  );

export type { ItemQuality };
