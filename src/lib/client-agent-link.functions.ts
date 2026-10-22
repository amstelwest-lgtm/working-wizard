/**
 * Public /a/<token> actions. Service role only. The raw token is hashed
 * before lookup. File bytes are uploaded and downloaded with the service
 * role. The browser never receives a storage URL. The first Finish copies
 * each final file into the client's documents and emails the firm owner
 * once. The client is never emailed. Nothing is extracted or posted to a
 * ledger. Chat text, file passwords, and the owner address are not logged.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { canonicalAuthUrl } from "@/lib/app-origin";
import { CLAUDE_MODEL } from "@/lib/claude-config";
import {
  buildClientAgentArtifact,
  clientAgentDoneIdempotencyKey,
  completionDecision,
  copiesStillNeeded,
  indexedCopyKeys,
  type CompletionItem,
} from "@/lib/client-agent-done";
import { sendClientAgentDone } from "@/lib/client-agent-done-mail";
import { CLIENT_DOCUMENTS_BUCKET } from "@/lib/client-documents";
import {
  CLIENT_AGENT_CHAT_FALLBACK,
  CLIENT_AGENT_CHAT_LIMIT,
  CLIENT_AGENT_CHAT_WAIT,
  guideDocumentQuestion,
} from "@/lib/client-agent-chat";
import {
  CLIENT_AGENT_FILE_PASSWORD_KEY,
  filePasswordKey,
  openFilePassword,
  sealFilePassword,
} from "@/lib/client-agent-file-secret";
import { recipientFirstName } from "@/lib/client-agent-send";
import { sendAgentFirmAllowed } from "@/lib/client-agent-send-allowlist";
import { planTaxEnqueue, TAX_SPECIALIST_SETTING } from "@/lib/agent-tax-flag";
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
  client_id: string;
  firm_id: string;
  expires_at: string;
  revoked_at: string | null;
  consent_at: string | null;
  practice_display_name: string | null;
  recipient_first_name: string | null;
  completed_at: string | null;
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
      firstName: string | null;
      completed?: boolean;
      consented: boolean;
      notice: string;
      items: PublicItem[];
    }
  | ReturnType<typeof closedLink>;

function missingRelation(error: DbError, name: string): boolean {
  const message = error?.message ?? "";
  return message.includes(name) && /does not exist|schema cache|could not find/i.test(message);
}

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
  const columns = [
    "id, client_id, firm_id, expires_at, revoked_at, consent_at, practice_display_name, recipient_first_name, completed_at",
    "id, client_id, firm_id, expires_at, revoked_at, consent_at, practice_display_name, recipient_first_name",
    "id, client_id, firm_id, expires_at, revoked_at, consent_at, practice_display_name",
    "id, client_id, firm_id, expires_at, revoked_at, consent_at",
  ];
  let lastError: DbError = null;
  for (const columnList of columns) {
    const result = await query(columnList);
    if (!result.error) {
      if (!result.data) return null;
      return {
        ...result.data,
        client_id: result.data.client_id ?? "",
        practice_display_name: result.data.practice_display_name ?? null,
        recipient_first_name: result.data.recipient_first_name ?? null,
        completed_at: result.data.completed_at ?? null,
      };
    }
    lastError = result.error;
    const missing =
      missingRelation(result.error, "completed_at") ||
      missingRelation(result.error, "recipient_first_name") ||
      missingRelation(result.error, "practice_display_name") ||
      missingRelation(result.error, "client_id");
    if (!missing) break;
  }
  if (lastError) throw new Error(sendLinkLogLine({ event: "link", reason: "lookup" }));
  return null;
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
  const files = await loadFileMeta(sendId);
  return toPublicChecklist(
    (data ?? []).map((row) => {
      const extra = files?.get(row.item_key);
      const stored = typeof row.storage_path === "string" && row.storage_path.length > 0;
      return {
        sendId,
        itemKey: row.item_key,
        label: row.label,
        totalsOnly: row.totals_only === true,
        status: row.status,
        quality: row.quality,
        storagePath: stored || (extra?.count ?? 0) > 0 ? row.storage_path || "stored" : null,
        fileCount: extra?.count ?? (stored ? 1 : 0),
        passwordSaved: extra?.passwordSaved === true,
      };
    }),
    sendId,
  );
}

async function loadFileMeta(
  sendId: string,
): Promise<Map<string, { count: number; passwordSaved: boolean }> | null> {
  const { data, error } = await (
    supabaseAdmin as unknown as {
      from: (name: string) => {
        select: (cols: string) => {
          eq: (
            column: string,
            value: string,
          ) => Promise<{
            data: Array<{ item_key: string; password_box: string | null; created_at: string }> | null;
            error: DbError;
          }>;
        };
      };
    }
  )
    .from("client_agent_send_files")
    .select("item_key, password_box, created_at")
    .eq("send_id", sendId);
  if (error) {
    if (missingRelation(error, "client_agent_send_files")) return null;
    throw new Error(sendLinkLogLine({ event: "link", reason: "files" }));
  }
  const grouped = new Map<string, { count: number; passwordSaved: boolean; at: string }>();
  for (const row of data ?? []) {
    const current = grouped.get(row.item_key);
    const at = row.created_at ?? "";
    if (!current) {
      grouped.set(row.item_key, {
        count: 1,
        passwordSaved: Boolean(row.password_box),
        at,
      });
      continue;
    }
    current.count += 1;
    if (at >= current.at) {
      current.at = at;
      current.passwordSaved = Boolean(row.password_box);
    }
  }
  return new Map(
    [...grouped.entries()].map(([key, value]) => [
      key,
      { count: value.count, passwordSaved: value.passwordSaved },
    ]),
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
  const firstName = recipientFirstName(send.recipient_first_name);
  return {
    ok: true,
    practiceName,
    expiresAt: send.expires_at,
    firstName: firstName.ok ? firstName.name : null,
    completed: Boolean(send.completed_at),
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

function bucketStorage(bucket: string): ObjectStorage {
  return (
    supabaseAdmin as unknown as {
      storage: { from: (name: string) => ObjectStorage };
    }
  ).storage.from(bucket);
}

function objectStorage(): ObjectStorage {
  return bucketStorage(SEND_STORAGE_BUCKET);
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
    const filed = await insertSendFile({
      send_id: resolved.send.id,
      item_key: data.itemKey,
      storage_path: path,
      mime: stored.value.mime,
      size_bytes: stored.value.size,
    });
    if (filed === "failed") {
      await objectStorage().remove([path]);
      throw new Error(sendLinkLogLine({ event: "link", reason: "file" }));
    }
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
      filed === "legacy" &&
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

async function insertSendFile(row: {
  send_id: string;
  item_key: string;
  storage_path: string;
  mime: string;
  size_bytes: number;
}): Promise<"stored" | "legacy" | "failed"> {
  const { error } = await (
    supabaseAdmin as unknown as {
      from: (name: string) => {
        insert: (value: Record<string, unknown>) => Promise<{ error: DbError }>;
      };
    }
  )
    .from("client_agent_send_files")
    .insert(row);
  if (!error) return "stored";
  if (missingRelation(error, "client_agent_send_files")) return "legacy";
  return "failed";
}

export const saveClientAgentFilePassword = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    tokenInput
      .extend({
        itemKey: z.string().regex(/^[a-z0-9_]+$/),
        password: z.string().min(1).max(80),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<{ ok: true } | { ok: false; body: string }> => {
    const resolved = await resolveToken(data.token);
    if (!resolved.ok) return { ok: false, body: resolved.body };
    if (!consentReady(resolved.send.consent_at)) return { ok: false, body: "Agree first." };
    const password = data.password.replace(/\s+/g, " ").trim();
    if (!password || password.length > 80) return { ok: false, body: "That could not be saved." };
    const key = filePasswordKey(process.env[CLIENT_AGENT_FILE_PASSWORD_KEY]);
    if (!key) return { ok: false, body: "That could not be saved." };
    const sealed = await sealFilePassword(password, key);
    const saved = await storeFilePassword(resolved.send.id, data.itemKey, sealed);
    if (!saved) return { ok: false, body: "That could not be saved." };
    return { ok: true };
  });

async function storeFilePassword(
  sendId: string,
  itemKey: string,
  sealed: { iv: string; box: string },
): Promise<boolean> {
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
            ) => Promise<{
              data: Array<{ id: string; created_at: string }> | null;
              error: DbError;
            }>;
          };
        };
      };
    }
  )
    .from("client_agent_send_files")
    .select("id, created_at")
    .eq("send_id", sendId)
    .eq("item_key", itemKey);
  if (error || !data?.length) return false;
  const latest = [...data].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
  if (!latest) return false;
  const updated = await (
    supabaseAdmin as unknown as {
      from: (name: string) => {
        update: (row: Record<string, unknown>) => {
          eq: (column: string, value: string) => Promise<{ error: DbError }>;
        };
      };
    }
  )
    .from("client_agent_send_files")
    .update({ password_iv: sealed.iv, password_box: sealed.box })
    .eq("id", latest.id);
  return !updated.error;
}

/**
 * Opens one stored password for extraction, then deletes it.
 * Not a server function. The public page cannot call it.
 */
export async function releaseClientAgentFilePassword(
  sendId: string,
  itemKey: string,
): Promise<string | null> {
  const key = filePasswordKey(process.env[CLIENT_AGENT_FILE_PASSWORD_KEY]);
  if (!key) return null;
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
            ) => Promise<{
              data: Array<{
                id: string;
                created_at: string;
                password_iv: string | null;
                password_box: string | null;
              }> | null;
              error: DbError;
            }>;
          };
        };
      };
    }
  )
    .from("client_agent_send_files")
    .select("id, created_at, password_iv, password_box")
    .eq("send_id", sendId)
    .eq("item_key", itemKey);
  if (error || !data?.length) return null;
  const latest = [...data].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
  if (!latest?.password_iv || !latest.password_box) return null;
  const plain = await openFilePassword(
    { iv: latest.password_iv, box: latest.password_box },
    key,
  );
  await (
    supabaseAdmin as unknown as {
      from: (name: string) => {
        update: (row: Record<string, unknown>) => {
          eq: (column: string, value: string) => Promise<{ error: DbError }>;
        };
      };
    }
  )
    .from("client_agent_send_files")
    .update({ password_iv: null, password_box: null })
    .eq("id", latest.id);
  return plain;
}

export const askClientAgentLink = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    tokenInput.extend({ message: z.string().max(400) }).parse(input),
  )
  .handler(async ({ data }): Promise<{ ok: true; reply: string } | ReturnType<typeof closedLink>> => {
    const resolved = await resolveToken(data.token);
    if (!resolved.ok) return resolved;
    if (!consentReady(resolved.send.consent_at)) return closedLink("consent");
    const turns = await countChatTurns(resolved.send.id);
    if (turns === null) return { ok: true, reply: CLIENT_AGENT_CHAT_FALLBACK };
    if (turns >= CLIENT_AGENT_CHAT_LIMIT) return { ok: true, reply: CLIENT_AGENT_CHAT_WAIT };
    const reply = await guideDocumentQuestion({
      message: data.message,
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: CLAUDE_MODEL,
    });
    await recordChatTurn(resolved.send.id);
    return { ok: true, reply };
  });

async function countChatTurns(sendId: string): Promise<number | null> {
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
    .from("client_agent_send_chat_turns")
    .select("id", { count: "exact", head: true })
    .eq("send_id", sendId)
    .gte("created_at", since);
  if (error) {
    if (missingRelation(error, "client_agent_send_chat_turns")) return null;
    throw new Error(sendLinkLogLine({ event: "link", reason: "chat" }));
  }
  return count ?? 0;
}

async function recordChatTurn(sendId: string): Promise<void> {
  const { error } = await (
    supabaseAdmin as unknown as {
      from: (name: string) => {
        insert: (row: Record<string, unknown>) => Promise<{ error: DbError }>;
      };
    }
  )
    .from("client_agent_send_chat_turns")
    .insert({ send_id: sendId });
  if (error && !missingRelation(error, "client_agent_send_chat_turns")) {
    throw new Error(sendLinkLogLine({ event: "link", reason: "chat" }));
  }
}

export type { ItemQuality };

const FINISH_BODY = "That could not be finished. Please try again.";

async function loadCompletionItems(sendId: string): Promise<CompletionItem[]> {
  const { data, error } = await (
    supabaseAdmin as unknown as {
      from: (name: string) => {
        select: (cols: string) => {
          eq: (
            column: string,
            value: string,
          ) => Promise<{
            data: Array<{
              item_key: string;
              label: string | null;
              status: string;
              quality: string | null;
              storage_path: string | null;
              mime: string | null;
              size_bytes: number | null;
              explanation: string | null;
            }> | null;
            error: DbError;
          }>;
        };
      };
    }
  )
    .from("client_agent_send_items")
    .select("item_key, label, status, quality, storage_path, mime, size_bytes, explanation")
    .eq("send_id", sendId);
  if (error) throw new Error(sendLinkLogLine({ event: "link", reason: "items" }));
  return (data ?? []).map((row) => ({
    itemKey: row.item_key,
    label: row.label,
    status: row.status,
    quality: row.quality,
    storagePath: row.storage_path,
    mime: row.mime,
    sizeBytes: row.size_bytes,
    explanation: row.explanation,
  }));
}

async function loadCopiedKeys(clientId: string, sendId: string) {
  const { data, error } = await (
    supabaseAdmin as unknown as {
      from: (name: string) => {
        select: (cols: string) => {
          eq: (
            column: string,
            value: string,
          ) => Promise<{ data: Array<{ meta: unknown }> | null; error: DbError }>;
        };
      };
    }
  )
    .from("client_artifacts")
    .select("meta")
    .eq("client_id", clientId);
  if (error) return null;
  return indexedCopyKeys(data ?? [], sendId);
}

async function firmOwnerEmail(firmId: string): Promise<string | null> {
  const { data, error } = await (
    supabaseAdmin as unknown as {
      from: (name: string) => {
        select: (cols: string) => {
          eq: (
            column: string,
            value: string,
          ) => {
            maybeSingle: () => Promise<{
              data: { owner_user_id: string | null } | null;
              error: DbError;
            }>;
          };
        };
      };
    }
  )
    .from("firms")
    .select("owner_user_id")
    .eq("id", firmId)
    .maybeSingle();
  if (error || !data?.owner_user_id) return null;
  const looked = await (
    supabaseAdmin as unknown as {
      auth: {
        admin: {
          getUserById: (
            id: string,
          ) => Promise<{ data: { user: { email?: string | null } | null } | null }>;
        };
      };
    }
  ).auth.admin.getUserById(data.owner_user_id);
  const email = looked.data?.user?.email?.trim() ?? "";
  if (!email.includes("@")) return null;
  return email;
}

async function clientNameOf(clientId: string): Promise<string> {
  const { data } = await (
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
    .from("clients")
    .select("name")
    .eq("id", clientId)
    .maybeSingle();
  const name = data?.name?.trim() ?? "";
  return name || "Your client";
}

async function copyOneFile(input: {
  clientId: string;
  sendId: string;
  file: { itemKey: string; label: string; sourcePath: string; mime: string; size: number };
}): Promise<boolean> {
  const downloaded = await bucketStorage(SEND_STORAGE_BUCKET).download(input.file.sourcePath);
  if (downloaded.error || !downloaded.data) return false;
  const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
  const sniffed = sniffDocumentMime(bytes);
  if (!sniffed || sniffed !== input.file.mime) return false;
  const artifactId = crypto.randomUUID();
  const row = buildClientAgentArtifact({
    artifactId,
    clientId: input.clientId,
    sendId: input.sendId,
    itemKey: input.file.itemKey,
    label: input.file.label,
    mime: sniffed,
    size: bytes.byteLength,
    sourcePath: input.file.sourcePath,
  });
  const uploaded = await bucketStorage(CLIENT_DOCUMENTS_BUCKET).upload(row.storage_path, bytes, {
    contentType: sniffed,
    upsert: false,
  });
  if (uploaded.error) return false;
  const inserted = await (
    supabaseAdmin as unknown as {
      from: (name: string) => {
        insert: (value: Record<string, unknown>) => Promise<{ error: DbError }>;
      };
    }
  )
    .from("client_artifacts")
    .insert({
      id: row.id,
      client_id: row.client_id,
      kind: row.kind,
      storage_path: row.storage_path,
      visibility: row.visibility,
      created_by: row.created_by,
      meta: row.meta,
    });
  if (inserted.error) {
    await bucketStorage(CLIENT_DOCUMENTS_BUCKET).remove([row.storage_path]);
    return false;
  }
  return true;
}

async function enqueueTaxReview(input: {
  firmId: string;
  sendId: string;
  clientId: string;
}): Promise<void> {
  try {
    const read = await (
      supabaseAdmin as unknown as {
        from: (name: string) => {
          select: (columns: string) => {
            eq: (
              column: string,
              value: string,
            ) => {
              maybeSingle: () => Promise<{ data: { value?: unknown } | null; error: DbError }>;
            };
          };
        };
      }
    )
      .from("agent_settings")
      .select("value")
      .eq("key", TAX_SPECIALIST_SETTING)
      .maybeSingle();
    if (read.error) return;
    const plan = planTaxEnqueue({
      already: false,
      setting: read.data?.value ?? null,
      firmId: input.firmId,
      sendId: input.sendId,
      clientId: input.clientId,
    });
    if (!plan.enqueue) return;
    await (
      supabaseAdmin as unknown as {
        rpc: (
          name: string,
          args: { p_queue: string; p_payload: { send_id: string; client_id: string; firm_id: string }; p_delay: number },
        ) => Promise<{ error: DbError }>;
      }
    ).rpc("agent_queue_send", {
      p_queue: plan.queue,
      p_payload: plan.payload,
      p_delay: 0,
    });
  } catch {
    return;
  }
}

async function markCompleted(sendId: string): Promise<boolean> {
  const { error } = await (
    supabaseAdmin as unknown as {
      from: (name: string) => {
        update: (row: Record<string, unknown>) => {
          eq: (
            column: string,
            value: string,
          ) => {
            is: (column: string, value: null) => Promise<{ error: DbError }>;
          };
        };
      };
    }
  )
    .from("client_agent_sends")
    .update({ completed_at: new Date().toISOString() })
    .eq("id", sendId)
    .is("completed_at", null);
  return !error;
}

export const completeClientAgentSend = createServerFn({ method: "POST" })
  .inputValidator((input) => tokenInput.parse(input))
  .handler(async ({ data }): Promise<{ ok: true } | { ok: false; body: string }> => {
    const resolved = await resolveToken(data.token);
    if (!resolved.ok) return { ok: false, body: "This link is not available." };
    const items = await loadCompletionItems(resolved.send.id);
    const decision = completionDecision({
      consentAt: resolved.send.consent_at,
      completedAt: resolved.send.completed_at,
      sendId: resolved.send.id,
      items,
    });
    if (!decision.ok) {
      return {
        ok: false,
        body:
          decision.reason === "consent"
            ? "Please agree before finishing."
            : "Finish each document first.",
      };
    }
    if (decision.already) return { ok: true };
    if (!/^[0-9a-f-]{36}$/i.test(resolved.send.client_id)) {
      return { ok: false, body: FINISH_BODY };
    }
    const existing = await loadCopiedKeys(resolved.send.client_id, resolved.send.id);
    if (!existing) return { ok: false, body: FINISH_BODY };
    const pending = copiesStillNeeded(decision.files, resolved.send.id, existing);
    for (const file of pending) {
      const copied = await copyOneFile({
        clientId: resolved.send.client_id,
        sendId: resolved.send.id,
        file,
      });
      if (!copied) return { ok: false, body: FINISH_BODY };
    }
    const owner = await firmOwnerEmail(resolved.send.firm_id);
    if (!owner) return { ok: false, body: FINISH_BODY };
    const practiceName = practiceDisplayName({
      firmId: resolved.send.firm_id,
      practiceDisplayName: resolved.send.practice_display_name,
      firmName: await loadFirmName(resolved.send.firm_id),
    });
    const mailed = await sendClientAgentDone({
      practiceName,
      to: owner,
      clientName: await clientNameOf(resolved.send.client_id),
      received: decision.received,
      missing: decision.missing,
      notes: decision.notes,
      link: canonicalAuthUrl(`/clients/${resolved.send.client_id}?section=send-agent`),
      idempotencyKey: clientAgentDoneIdempotencyKey(resolved.send.id),
      apiKey: process.env.RESEND_API_KEY,
      fromEmail: process.env.RESEND_FROM_EMAIL,
    });
    if (!mailed.ok) return { ok: false, body: FINISH_BODY };
    const marked = await markCompleted(resolved.send.id);
    if (!marked) return { ok: false, body: FINISH_BODY };
    await enqueueTaxReview({
      firmId: resolved.send.firm_id,
      sendId: resolved.send.id,
      clientId: resolved.send.client_id,
    });
    return { ok: true };
  });
