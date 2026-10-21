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
  SEND_STORAGE_BUCKET,
  clientConsentNotice,
  SEND_FILE_BASE64_MAX,
  acceptClientFile,
  bytesFromBase64,
  closedLink,
  consentReady,
  consentWrite,
  finishItem,
  hashClientAddress,
  hashPresentedToken,
  openLinkView,
  pathBelongsToSend,
  practiceDisplayName,
  resolvePresentedLink,
  sendAttemptLimited,
  sendLinkLogLine,
  sendStoragePath,
  sizeAllowed,
  sniffDocumentMime,
  storeAcceptedFile,
  toPublicChecklist,
  type AttemptOutcome,
  type ItemQuality,
  type PublicChecklistItem,
} from "@/lib/client-agent-link";
import { isSupabaseAdminConfigured, supabaseAdmin } from "@/integrations/supabase/client.server";

type DbError = { message: string } | null;

type SendRow = {
  id: string;
  firm_id: string;
  expires_at: string;
  revoked_at: string | null;
  consent_at: string | null;
  practice_display_name: string | null;
};

type ItemRow = {
  item_key: string;
  label: string | null;
  totals_only: boolean;
  status: string;
  quality: string | null;
  storage_path: string | null;
};

export type PublicItem = PublicChecklistItem;

export type OpenLinkResult =
  | {
      ok: true;
      practiceName: string;
      expiresAt: string;
      consented: boolean;
      notice: string;
      items: PublicItem[];
    }
  | ReturnType<typeof closedLink>;

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

async function countAttempts(column: "ip_hash" | "send_id", value: string): Promise<number> {
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
    .eq(column, value)
    .gte("created_at", since);
  if (error) throw new Error(sendLinkLogLine({ event: "link", reason: "count" }));
  return count ?? 0;
}

function recentAttempts(ipHash: string): Promise<number> {
  return countAttempts("ip_hash", ipHash);
}

function recentSendAttempts(sendId: string): Promise<number> {
  return countAttempts("send_id", sendId);
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
  if (error) throw new Error(sendLinkLogLine({ event: "link", reason: "attempt" }));
}

async function loadSend(tokenHash: string): Promise<SendRow | null> {
  const query = (columns: string) =>
    (
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
      .select(columns)
      .eq("token_hash", tokenHash)
      .maybeSingle();
  const wide = await query(
    "id, firm_id, expires_at, revoked_at, consent_at, practice_display_name",
  );
  if (!wide.error) return wide.data;
  const plain = await query("id, firm_id, expires_at, revoked_at, consent_at");
  if (plain.error) throw new Error(sendLinkLogLine({ event: "link", reason: "lookup" }));
  if (!plain.data) return null;
  return { ...plain.data, practice_display_name: null };
}

async function loadFirmName(firmId: string): Promise<string | null> {
  const { data, error } = await (
    supabaseAdmin as unknown as {
      from: (name: string) => {
        select: (cols: string) => {
          eq: (
            column: string,
            value: string,
          ) => {
            maybeSingle: () => Promise<{ data: { name: string | null } | null; error: DbError }>;
          };
        };
      };
    }
  )
    .from("firms")
    .select("name")
    .eq("id", firmId)
    .maybeSingle();
  if (error || !data?.name) return null;
  return data.name;
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
  if (error) throw new Error(sendLinkLogLine({ event: "link", reason: "items" }));
  return toPublicChecklist(
    (data ?? []).map((row) => ({
      sendId,
      itemKey: row.item_key,
      label: row.label,
      totalsOnly: row.totals_only === true,
      status: row.status,
      quality: row.quality,
      storagePath: row.storage_path,
    })),
    sendId,
  );
}

type Resolved =
  | { ok: true; send: SendRow; tokenHash: string; ipHash: string }
  | ReturnType<typeof closedLink>;

function attemptSendId(send: SendRow | null, outcome: AttemptOutcome): string | null {
  if (!send || outcome === "unknown" || !sendAgentFirmAllowed(send.firm_id)) return null;
  return send.id;
}

async function resolveToken(token: string): Promise<Resolved> {
  if (!isSupabaseAdminConfigured()) return closedLink("unavailable");
  const ipHash = await hashClientAddress(clientAddress());
  const tokenHash = await hashPresentedToken(token);
  const now = new Date();
  const ipCount = await recentAttempts(ipHash);
  if (sendAttemptLimited(ipCount)) {
    await recordAttempt({
      send_id: null,
      token_hash: tokenHash,
      ip_hash: ipHash,
      outcome: "limited",
    });
    const limited = resolvePresentedLink({
      ipCount,
      sendCount: null,
      found: false,
      firmId: null,
      revokedAt: null,
      expiresAt: "",
      now,
    }).public;
    return limited.ok ? closedLink("limited") : limited;
  }
  const send = await loadSend(tokenHash);
  const opened = resolvePresentedLink({
    ipCount,
    sendCount: null,
    found: Boolean(send),
    firmId: send?.firm_id ?? null,
    revokedAt: send?.revoked_at ?? null,
    expiresAt: send?.expires_at ?? "",
    now,
  });
  if (!opened.public.ok || !send) {
    await recordAttempt({
      send_id: attemptSendId(send, opened.outcome),
      token_hash: tokenHash,
      ip_hash: ipHash,
      outcome: opened.outcome,
    });
    return opened.public.ok ? closedLink("unavailable") : opened.public;
  }
  const sendCount = await recentSendAttempts(send.id);
  const decision = resolvePresentedLink({
    ipCount,
    sendCount,
    found: true,
    firmId: send.firm_id,
    revokedAt: send.revoked_at,
    expiresAt: send.expires_at,
    now,
  });
  await recordAttempt({
    send_id: attemptSendId(send, decision.outcome),
    token_hash: tokenHash,
    ip_hash: ipHash,
    outcome: decision.outcome,
  });
  if (!decision.public.ok) return decision.public;
  return { ok: true, send, tokenHash, ipHash };
}

async function present(send: SendRow, items: PublicItem[]): Promise<OpenLinkResult> {
  const practiceName = practiceDisplayName({
    firmId: send.firm_id,
    practiceDisplayName: send.practice_display_name,
    firmName: await loadFirmName(send.firm_id),
  });
  return {
    ok: true,
    practiceName,
    expiresAt: send.expires_at,
    ...openLinkView({
      consented: consentReady(send.consent_at),
      notice: clientConsentNotice(practiceName),
      items,
    }),
  };
}

export const openClientAgentLink = createServerFn({ method: "POST" })
  .inputValidator((input) => tokenInput.parse(input))
  .handler(async ({ data }): Promise<OpenLinkResult> => {
    const resolved = await resolveToken(data.token);
    if (!resolved.ok) return resolved;
    return await present(resolved.send, await loadItems(resolved.send.id));
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
        .update(consentWrite(new Date()))
        .eq("id", resolved.send.id);
      if (error) throw new Error(sendLinkLogLine({ event: "link", reason: "consent" }));
      resolved.send.consent_at = new Date().toISOString();
    }
    return await present(resolved.send, await loadItems(resolved.send.id));
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
  if (error) throw new Error(sendLinkLogLine({ event: "link", reason: "path" }));
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
  if (error) throw new Error(sendLinkLogLine({ event: "link", reason: "save" }));
}

export const uploadClientAgentFile = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    tokenInput
      .extend({
        itemKey: z.string().regex(/^[a-z0-9_]+$/),
        base64: z.string().min(4).max(SEND_FILE_BASE64_MAX),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<{ ok: true } | ReturnType<typeof closedLink>> => {
    const resolved = await resolveToken(data.token);
    if (!resolved.ok) return resolved;
    const items = await loadItems(resolved.send.id);
    if (!items.some((item) => item.itemKey === data.itemKey)) return closedLink("unavailable");

    const decision = acceptClientFile({
      consented: consentReady(resolved.send.consent_at),
      bytes: bytesFromBase64(data.base64),
    });
    const path = sendStoragePath(resolved.send.id, data.itemKey, crypto.randomUUID());
    const stored = await storeAcceptedFile(decision, async (file) => {
      const storage = objectStorage();
      const uploaded = await storage.upload(path, file.bytes, {
        contentType: file.mime,
        upsert: false,
      });
      if (uploaded.error) {
        throw new Error(sendLinkLogLine({ event: "link", reason: "upload" }));
      }
      const downloaded = await storage.download(path);
      const object = downloaded.data;
      if (downloaded.error || !object) {
        await storage.remove([path]);
        return null;
      }
      const storedBytes = new Uint8Array(await object.arrayBuffer());
      const sniffed = sniffDocumentMime(storedBytes);
      if (
        storedBytes.byteLength !== file.bytes.byteLength ||
        !sizeAllowed(storedBytes.byteLength) ||
        sniffed !== file.mime
      ) {
        await storage.remove([path]);
        return null;
      }
      return { mime: sniffed, size: storedBytes.byteLength };
    });
    if (!stored.ok) return stored;
    if (!stored.value) return closedLink("mime");

    const previous = await loadStoredPath(resolved.send.id, data.itemKey);
    try {
      await updateItem(resolved.send.id, data.itemKey, {
        status: "received",
        quality: "usable",
        explanation: null,
        mime: stored.value.mime,
        size_bytes: stored.value.size,
        storage_path: path,
      });
    } catch (error) {
      await objectStorage().remove([path]);
      throw error;
    }
    if (
      previous &&
      previous !== path &&
      pathBelongsToSend(previous, resolved.send.id, data.itemKey)
    ) {
      await objectStorage().remove([previous]);
    }
    return { ok: true };
  });

export const finishClientAgentItem = createServerFn({ method: "POST" })
  .inputValidator((input) => finishInput.parse(input))
  .handler(
    async ({
      data,
    }): Promise<
      | { ok: true }
      | ReturnType<typeof closedLink>
      | { ok: false; status: 200; reason: "explanation" | "empty"; body: string }
    > => {
      const resolved = await resolveToken(data.token);
      if (!resolved.ok) return resolved;
      if (!consentReady(resolved.send.consent_at)) return closedLink("consent");
      const items = await loadItems(resolved.send.id);
      const item = items.find((row) => row.itemKey === data.itemKey);
      if (!item) return closedLink("unavailable");
      const decision = finishItem({
        quality: data.quality,
        explanation: data.explanation ?? null,
        hasFile: item.hasFile,
      });
      if (!decision.ok) {
        return {
          ok: false,
          status: 200,
          reason: decision.reason,
          body:
            decision.reason === "explanation"
              ? "Add a short explanation."
              : "Add a file, or say what is missing.",
        };
      }

      await updateItem(resolved.send.id, data.itemKey, {
        status: "received",
        quality: data.quality,
        explanation: decision.explanation,
      });
      return { ok: true };
    },
  );

export type { ItemQuality };
