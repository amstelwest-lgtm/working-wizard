/**
 * Public /a/<token> actions. Service role only. The raw token is hashed
 * before lookup. The browser uploads straight to a one-time signed URL.
 * Confirm reads the size and the first bytes with the service role.
 * Finish copies the files into the client's documents and emails the firm
 * owner once. The client is never emailed. Chat text and file passwords
 * are not logged.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { canonicalAuthUrl } from "@/lib/app-origin";
import { CLAUDE_MODEL } from "@/lib/claude-config";
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
import {
  completionDecision,
  clientAgentDoneIdempotencyKey,
  copiesStillNeeded,
  indexedCopyKeys,
  type ArchiveFileRow,
  type CompletionItem,
} from "@/lib/client-agent-done";
import { sendClientAgentDone } from "@/lib/client-agent-done-mail";
import {
  copySendFileIfMissing,
  copySendFileToArchive,
  removeSendArchiveCopies,
} from "@/lib/client-agent-send-archive.server";
import { recipientFirstName } from "@/lib/client-agent-send";
import { sendAgentFirmAllowed } from "@/lib/client-agent-send-allowlist";
import {
  SEND_ATTEMPT_WINDOW_MS,
  SEND_STORAGE_BUCKET,
  UPLOAD_GRANT_TTL_MS,
  clientConsentNotice,
  CLIENT_AGENT_CHAT_ENABLED,
  CLIENT_AGENT_PASSWORD_UNSAVED,
  closedLink,
  confirmStoredObject,
  consentReady,
  consentWrite,
  declareUpload,
  finishItem,
  itemNotAvailable,
  hashClientAddress,
  hashPresentedToken,
  openLinkView,
  pathBelongsToSend,
  practiceDisplayName,
  readUploadGrant,
  resolvePresentedLink,
  sendAttemptLimited,
  sanitizeClientFileName,
  sendLinkLogLine,
  sendStoragePath,
  signUploadGrant,
  sniffDocumentMime,
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
  client_id: string;
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
  explanation: string | null;
};

export type PublicItem = PublicChecklistItem;

export type OpenLinkResult =
  | {
      ok: true;
      practiceName: string;
      expiresAt: string;
      firstName: string | null;
      consented: boolean;
      notice: string;
      items: PublicItem[];
      completed: boolean;
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

type CountResult = Promise<{ count: number | null; error: DbError }>;

async function countAttempts(
  column: "ip_hash" | "send_id",
  value: string,
  mode: "all" | "failures",
): Promise<number> {
  const since = new Date(Date.now() - SEND_ATTEMPT_WINDOW_MS).toISOString();
  const counted = (
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
            ) => CountResult & { neq: (column: string, value: string) => CountResult };
          };
        };
      };
    }
  )
    .from("client_agent_send_attempts")
    .select("id", { count: "exact", head: true })
    .eq(column, value)
    .gte("created_at", since);
  const { count, error } = await (mode === "failures" ? counted.neq("outcome", "ok") : counted);
  if (error) throw new Error(sendLinkLogLine({ event: "link", reason: "count" }));
  return count ?? 0;
}

function recentAttempts(ipHash: string): Promise<number> {
  return countAttempts("ip_hash", ipHash, "failures");
}

function recentSendAttempts(sendId: string): Promise<number> {
  return countAttempts("send_id", sendId, "all");
}

function recentSendFailures(sendId: string): Promise<number> {
  return countAttempts("send_id", sendId, "failures");
}

async function recordAttempt(row: {
  send_id: string | null;
  token_hash: string | null;
  ip_hash: string;
  outcome: AttemptOutcome;
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
  const named = await query(
    "id, client_id, firm_id, expires_at, revoked_at, consent_at, practice_display_name, recipient_first_name, completed_at",
  );
  if (!named.error) return named.data;
  const practice = await query(
    "id, client_id, firm_id, expires_at, revoked_at, consent_at, practice_display_name, recipient_first_name",
  );
  if (!practice.error && practice.data) {
    return { ...practice.data, completed_at: null };
  }
  const namedPractice = await query(
    "id, client_id, firm_id, expires_at, revoked_at, consent_at, practice_display_name",
  );
  if (!namedPractice.error && namedPractice.data) {
    return { ...namedPractice.data, recipient_first_name: null, completed_at: null };
  }
  const plain = await query("id, client_id, firm_id, expires_at, revoked_at, consent_at");
  if (plain.error) throw new Error(sendLinkLogLine({ event: "link", reason: "lookup" }));
  if (!plain.data) return null;
  return {
    ...plain.data,
    practice_display_name: null,
    recipient_first_name: null,
    completed_at: null,
  };
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
    .select("item_key, label, totals_only, status, quality, storage_path, explanation")
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
        displayNames: extra?.names ?? [],
        explanation: row.explanation,
      };
    }),
    sendId,
  );
}

async function loadFileMeta(
  sendId: string,
): Promise<Map<string, { count: number; passwordSaved: boolean; names: string[] }> | null> {
  const query = (columns: string) =>
    (
      supabaseAdmin as unknown as {
        from: (name: string) => {
          select: (cols: string) => {
            eq: (
              column: string,
              value: string,
            ) => Promise<{
              data: Array<{
                item_key: string;
                password_box: string | null;
                created_at: string;
                display_name?: string | null;
              }> | null;
              error: DbError;
            }>;
          };
        };
      }
    )
      .from("client_agent_send_files")
      .select(columns)
      .eq("send_id", sendId);
  let selected = await query("item_key, password_box, created_at, display_name");
  if (selected.error && missingRelation(selected.error, "display_name")) {
    selected = await query("item_key, password_box, created_at");
  }
  const { data, error } = selected;
  if (error) {
    if (missingRelation(error, "client_agent_send_files")) return null;
    throw new Error(sendLinkLogLine({ event: "link", reason: "files" }));
  }
  const grouped = new Map<string, { count: number; passwordSaved: boolean; at: string; names: string[] }>();
  const rows = [...(data ?? [])].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
  for (const row of rows) {
    const name = sanitizeClientFileName(row.display_name ?? "");
    const current = grouped.get(row.item_key);
    const at = row.created_at ?? "";
    if (!current) {
      grouped.set(row.item_key, {
        count: 1,
        passwordSaved: Boolean(row.password_box),
        at,
        names: name ? [name] : [],
      });
      continue;
    }
    current.count += 1;
    if (name) current.names.push(name);
    if (at >= current.at) {
      current.at = at;
      current.passwordSaved = Boolean(row.password_box);
    }
  }
  return new Map(
    [...grouped.entries()].map(([key, value]) => [
      key,
      { count: value.count, passwordSaved: value.passwordSaved, names: value.names },
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
  const sendFailureCount = await recentSendFailures(send.id);
  const decision = resolvePresentedLink({
    ipCount,
    sendCount,
    sendFailureCount,
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
    ...openLinkView({
      consented: consentReady(send.consent_at),
      notice: clientConsentNotice(practiceName),
      items,
    }),
    completed: Boolean(send.completed_at),
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

type ObjectStorage = {
  createSignedUploadUrl: (
    path: string,
    options: { upsert: boolean },
  ) => Promise<{
    data: { signedUrl: string; token: string; path: string } | null;
    error: DbError;
  }>;
  info: (path: string) => Promise<{
    data: { size?: number; metadata?: Record<string, unknown> } | null;
    error: DbError;
  }>;
  list: (
    folder: string,
    options: { search: string; limit: number },
  ) => Promise<{
    data: Array<{ name: string; metadata?: Record<string, unknown> | null }> | null;
    error: DbError;
  }>;
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
  const { data, error } = await (
    supabaseAdmin as unknown as {
      from: (name: string) => {
        update: (row: Record<string, unknown>) => {
          eq: (
            column: string,
            value: string,
          ) => {
            eq: (
              column: string,
              value: string,
            ) => {
              select: (cols: string) => Promise<{
                data: Array<{ item_key: string }> | null;
                error: DbError;
              }>;
            };
          };
        };
      };
    }
  )
    .from("client_agent_send_items")
    .update(patch)
    .eq("send_id", sendId)
    .eq("item_key", itemKey)
    .select("item_key");
  if (error || !data?.length) throw new Error(sendLinkLogLine({ event: "link", reason: "save" }));
}

function uploadGrantSecret(): string | null {
  const keys = [
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SERVICE_KEY",
    "NEXT_SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SECRET_KEY",
  ];
  for (const key of keys) {
    const value = (process.env[key] ?? "").trim();
    if (value) return value;
  }
  return null;
}

function storageEndpoint(): { url: string; key: string } | null {
  const urls = ["SUPABASE_URL", "NEXT_SUPABASE_URL", "VITE_SUPABASE_URL"];
  let url = "";
  for (const key of urls) {
    const value = (process.env[key] ?? "").trim();
    if (value) {
      url = value.replace(/\/$/, "");
      break;
    }
  }
  const service = uploadGrantSecret();
  if (!url || !service) return null;
  return { url, key: service };
}

async function noteRejected(resolved: { send: SendRow; tokenHash: string; ipHash: string }) {
  try {
    await recordAttempt({
      send_id: resolved.send.id,
      token_hash: resolved.tokenHash,
      ip_hash: resolved.ipHash,
      outcome: "rejected",
    });
  } catch {
    // A stored outcome the database does not know yet must not hide the refusal.
  }
}

function totalFromContentRange(header: string | null): number | null {
  const match = /\/(\d+)$/.exec(header ?? "");
  if (!match) return null;
  const total = Number(match[1]);
  return Number.isInteger(total) ? total : null;
}

/** First bytes only. A full-body response is cancelled. The range total is the object size. */
async function readObjectPrefix(path: string): Promise<{ bytes: Uint8Array; total: number | null } | null> {
  const endpoint = storageEndpoint();
  if (!endpoint) return null;
  const target = `${endpoint.url}/storage/v1/object/${SEND_STORAGE_BUCKET}/${path}`;
  const response = await fetch(target, {
    headers: {
      Authorization: `Bearer ${endpoint.key}`,
      apikey: endpoint.key,
      Range: "bytes=0-31",
    },
  });
  if (response.status !== 206 && response.status !== 200) {
    await response.body?.cancel();
    return null;
  }
  const length = Number(response.headers.get("content-length") ?? "0");
  if (response.status === 200 && length > 64) {
    await response.body?.cancel();
    return null;
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { bytes: bytes.subarray(0, 32), total: totalFromContentRange(response.headers.get("content-range")) };
}

async function storedObjectSize(path: string): Promise<number | null> {
  const storage = objectStorage();
  const info = await storage.info(path);
  const fromInfo = info.error ? null : objectByteSize(info.data);
  if (fromInfo != null) return fromInfo;
  const slash = path.lastIndexOf("/");
  const listed = await storage.list(slash >= 0 ? path.slice(0, slash) : "", {
    search: slash >= 0 ? path.slice(slash + 1) : path,
    limit: 10,
  });
  const name = slash >= 0 ? path.slice(slash + 1) : path;
  const match = listed.data?.find((row) => row.name === name);
  return objectByteSize({ metadata: match?.metadata ?? undefined });
}

function objectByteSize(info: { size?: number; metadata?: Record<string, unknown> } | null): number | null {
  if (!info) return null;
  if (typeof info.size === "number" && Number.isInteger(info.size)) return info.size;
  const meta = info.metadata?.size;
  if (typeof meta === "number" && Number.isInteger(meta)) return meta;
  if (typeof meta === "string" && /^\d+$/.test(meta)) return Number(meta);
  return null;
}

export const prepareClientAgentUpload = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    tokenInput
      .extend({
        itemKey: z.string().regex(/^[a-z0-9_]+$/),
        size: z.number().int(),
        mime: z.string().max(80),
        name: z.string().max(300).optional(),
      })
      .parse(input),
  )
  .handler(
    async ({
      data,
    }): Promise<
      | { ok: true; path: string; token: string; signedUrl: string; grant: string }
      | ReturnType<typeof closedLink>
    > => {
  const resolved = await resolveToken(data.token);
      if (!resolved.ok) return resolved;
      const items = await loadItems(resolved.send.id);
      if (!items.some((item) => item.itemKey === data.itemKey)) return closedLink("unavailable");
      const declared = declareUpload({
        consented: consentReady(resolved.send.consent_at),
        size: data.size,
        mime: data.mime,
      });
      if (!declared.ok) {
        await noteRejected(resolved);
        return declared;
      }
      const secret = uploadGrantSecret();
      if (!secret) throw new Error(sendLinkLogLine({ event: "link", reason: "upload" }));
      const path = sendStoragePath(resolved.send.id, data.itemKey, crypto.randomUUID());
      const signed = await objectStorage().createSignedUploadUrl(path, { upsert: false });
      if (signed.error || !signed.data?.token || !signed.data.signedUrl) {
        throw new Error(sendLinkLogLine({ event: "link", reason: "upload" }));
      }
      const displayName = sanitizeClientFileName(data.name ?? "");
      const grant = await signUploadGrant(secret, {
        sendId: resolved.send.id,
        itemKey: data.itemKey,
        path,
        size: data.size,
        mime: data.mime,
        exp: Date.now() + UPLOAD_GRANT_TTL_MS,
        ...(displayName ? { name: displayName } : {}),
      });
  return { ok: true, path, token: signed.data.token, signedUrl: signed.data.signedUrl, grant };
    },
  );

export const confirmClientAgentUpload = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    tokenInput
      .extend({
        itemKey: z.string().regex(/^[a-z0-9_]+$/),
        path: z.string().min(1).max(240),
        grant: z.string().min(1).max(2000),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<{ ok: true } | ReturnType<typeof closedLink>> => {
  const resolved = await resolveToken(data.token);
    if (!resolved.ok) return resolved;
    if (!consentReady(resolved.send.consent_at)) return closedLink("consent");
    const items = await loadItems(resolved.send.id);
    if (!items.some((item) => item.itemKey === data.itemKey)) return closedLink("unavailable");
    const secret = uploadGrantSecret();
    const grant = secret ? await readUploadGrant(secret, data.grant) : null;
    if (
      !grant ||
      grant.path !== data.path ||
      grant.sendId !== resolved.send.id ||
      grant.itemKey !== data.itemKey ||
      !pathBelongsToSend(data.path, resolved.send.id, data.itemKey)
    ) {
      await noteRejected(resolved);
      return closedLink("unavailable");
    }
    const storage = objectStorage();
    const prefix = await readObjectPrefix(data.path);
    const listedSize = await storedObjectSize(data.path);
    const objectSize = listedSize ?? prefix?.total ?? null;
    const sniffed = prefix ? sniffDocumentMime(prefix.bytes) : null;
    const decision = confirmStoredObject({
      grant,
      claimedPath: data.path,
      sendId: resolved.send.id,
      itemKey: data.itemKey,
      objectSize,
      sniffed,
    });
    if (!decision.ok) {
      if (pathBelongsToSend(grant.path, resolved.send.id, data.itemKey)) {
        await storage.remove([grant.path]);
      }
      await noteRejected(resolved);
      return decision;
    }
    const existing = await findSendFile(resolved.send.id, data.path);
    if (existing === "missing") {
      const filed = await insertSendFile({
        send_id: resolved.send.id,
        item_key: data.itemKey,
        storage_path: data.path,
        mime: decision.mime,
        size_bytes: decision.size,
        display_name: sanitizeClientFileName(grant.name ?? ""),
      });
      if (filed === "failed") {
        await storage.remove([data.path]);
        throw new Error(sendLinkLogLine({ event: "link", reason: "file" }));
      }
    }
    try {
      await updateItem(resolved.send.id, data.itemKey, {
        status: "received",
        quality: "usable",
        explanation: null,
        mime: decision.mime,
        size_bytes: decision.size,
        storage_path: data.path,
      });
    } catch (error) {
      await deleteSendFile(resolved.send.id, data.path);
      await storage.remove([data.path]);
      throw error;
    }
    // The firm sees the file as soon as it is stored — a send the client
    // never finishes still reaches the client's documents. Best effort:
    // listing the sends heals a copy this step could not make.
    try {
      const item = items.find((row) => row.itemKey === data.itemKey);
      const displayName = sanitizeClientFileName(grant.name ?? "");
      await copySendFileIfMissing({
        clientId: resolved.send.client_id,
        sendId: resolved.send.id,
        file: {
          itemKey: data.itemKey,
          label: item?.label ?? data.itemKey,
          sourcePath: data.path,
          mime: decision.mime,
          size: decision.size,
          displayName: displayName || null,
        },
      });
    } catch {
      // The upload stands. The copy is retried when the firm opens the file.
    }
  return { ok: true };
  });

export const removeClientAgentFile = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    tokenInput
      .extend({
        itemKey: z.string().regex(/^[a-z0-9_]+$/),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<{ ok: true } | ReturnType<typeof closedLink>> => {
    const resolved = await resolveToken(data.token);
    if (!resolved.ok) return resolved;
    if (!consentReady(resolved.send.consent_at)) return closedLink("consent");
    const items = await loadItems(resolved.send.id);
    if (!items.some((item) => item.itemKey === data.itemKey)) return closedLink("unavailable");
    const rows = await listSendFiles(resolved.send.id, data.itemKey);
    const previous = await loadStoredPath(resolved.send.id, data.itemKey);
    await updateItem(resolved.send.id, data.itemKey, {
      status: "open",
      quality: null,
      explanation: null,
      mime: null,
      size_bytes: null,
      storage_path: null,
    });
    const paths = new Set<string>();
    if (rows !== "legacy") {
      for (const row of rows) {
        if (pathBelongsToSend(row.storage_path, resolved.send.id, data.itemKey)) {
          paths.add(row.storage_path);
        }
        await deleteSendFileById(row.id);
      }
    }
    if (previous && pathBelongsToSend(previous, resolved.send.id, data.itemKey)) paths.add(previous);
    if (paths.size > 0) await objectStorage().remove([...paths]);
    // A file removed before Finish also leaves the client's documents, so a
    // replaced upload is not kept twice. A completed send is never touched.
    if (!resolved.send.completed_at && paths.size > 0) {
      try {
        await removeSendArchiveCopies({
          clientId: resolved.send.client_id,
          sendId: resolved.send.id,
          sourcePaths: [...paths],
        });
      } catch {
        // The removal on the send side stands either way.
      }
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

export const undoClientAgentItem = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    tokenInput
      .extend({
        itemKey: z.string().regex(/^[a-z0-9_]+$/),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<{ ok: true } | ReturnType<typeof closedLink>> => {
    const resolved = await resolveToken(data.token);
    if (!resolved.ok) return resolved;
    if (!consentReady(resolved.send.consent_at)) return closedLink("consent");
    const items = await loadItems(resolved.send.id);
    const item = items.find((row) => row.itemKey === data.itemKey);
    if (!item || !itemNotAvailable(item)) return closedLink("unavailable");
    await updateItem(resolved.send.id, data.itemKey, {
      status: "open",
      quality: null,
      explanation: null,
    });
    return { ok: true };
  });

async function findSendFile(sendId: string, path: string): Promise<"present" | "missing"> {
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
              limit: (count: number) => Promise<{ data: Array<{ id: string }> | null; error: DbError }>;
            };
          };
        };
      };
    }
  )
    .from("client_agent_send_files")
    .select("id")
    .eq("send_id", sendId)
    .eq("storage_path", path)
    .limit(1);
  if (error) {
    if (missingRelation(error, "client_agent_send_files")) return "missing";
    throw new Error(sendLinkLogLine({ event: "link", reason: "file" }));
  }
  return data && data.length > 0 ? "present" : "missing";
}

async function deleteSendFile(sendId: string, path: string): Promise<void> {
  const { error } = await (
    supabaseAdmin as unknown as {
      from: (name: string) => {
        delete: () => {
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
    .from("client_agent_send_files")
    .delete()
    .eq("send_id", sendId)
    .eq("storage_path", path);
  if (error && !missingRelation(error, "client_agent_send_files")) {
    throw new Error(sendLinkLogLine({ event: "link", reason: "file" }));
  }
}

async function deleteSendFileById(id: string): Promise<void> {
  const { error } = await (
    supabaseAdmin as unknown as {
      from: (name: string) => {
        delete: () => {
          eq: (column: string, value: string) => Promise<{ error: DbError }>;
        };
      };
    }
  )
    .from("client_agent_send_files")
    .delete()
    .eq("id", id);
  if (error && !missingRelation(error, "client_agent_send_files")) {
    throw new Error(sendLinkLogLine({ event: "link", reason: "file" }));
  }
}

async function listSendFiles(
  sendId: string,
  itemKey: string,
): Promise<Array<{ id: string; storage_path: string }> | "legacy"> {
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
              data: Array<{ id: string; storage_path: string }> | null;
              error: DbError;
            }>;
          };
        };
      };
    }
  )
    .from("client_agent_send_files")
    .select("id, storage_path")
    .eq("send_id", sendId)
    .eq("item_key", itemKey);
  if (error) {
    if (missingRelation(error, "client_agent_send_files")) return "legacy";
    throw new Error(sendLinkLogLine({ event: "link", reason: "file" }));
  }
  return data ?? [];
}

async function insertSendFile(row: {
  send_id: string;
  item_key: string;
  storage_path: string;
  mime: string;
  size_bytes: number;
  display_name?: string;
}): Promise<"stored" | "legacy" | "failed"> {
  const write = (value: Record<string, unknown>) =>
    (
      supabaseAdmin as unknown as {
        from: (name: string) => {
          insert: (next: Record<string, unknown>) => Promise<{ error: DbError }>;
        };
      }
    )
      .from("client_agent_send_files")
      .insert(value);
  const payload: Record<string, unknown> = {
    send_id: row.send_id,
    item_key: row.item_key,
    storage_path: row.storage_path,
    mime: row.mime,
    size_bytes: row.size_bytes,
  };
  if (row.display_name) payload.display_name = row.display_name;
  const first = await write(payload);
  if (!first.error) return "stored";
  if (payload.display_name && missingRelation(first.error, "display_name")) {
    delete payload.display_name;
    const second = await write(payload);
    if (!second.error) return "stored";
    if (missingRelation(second.error, "client_agent_send_files")) return "legacy";
    return "failed";
  }
  if (missingRelation(first.error, "client_agent_send_files")) return "legacy";
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
    if (!key) return { ok: false, body: CLIENT_AGENT_PASSWORD_UNSAVED };
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

async function loadArchiveFileRows(sendId: string): Promise<ArchiveFileRow[] | "legacy"> {
  const load = (columns: string) =>
    (
      supabaseAdmin as unknown as {
        from: (name: string) => {
          select: (cols: string) => {
            eq: (
              column: string,
              value: string,
            ) => Promise<{ data: Array<Record<string, unknown>> | null; error: DbError }>;
          };
        };
      }
    )
      .from("client_agent_send_files")
      .select(columns)
      .eq("send_id", sendId);
  let found = await load("item_key, storage_path, mime, size_bytes, display_name");
  if (found.error && missingRelation(found.error, "display_name")) {
    found = await load("item_key, storage_path, mime, size_bytes");
  }
  if (found.error) {
    if (missingRelation(found.error, "client_agent_send_files")) return "legacy";
    throw new Error(sendLinkLogLine({ event: "link", reason: "file" }));
  }
  return (found.data ?? []).flatMap((row) => {
    const itemKey = typeof row.item_key === "string" ? row.item_key : "";
    const storagePath = typeof row.storage_path === "string" ? row.storage_path : "";
    if (!itemKey || !storagePath) return [];
    const displayName = sanitizeClientFileName(
      typeof row.display_name === "string" ? row.display_name : "",
    );
    return [
      {
        itemKey,
        storagePath,
        mime: typeof row.mime === "string" ? row.mime : null,
        sizeBytes: typeof row.size_bytes === "number" ? row.size_bytes : null,
        displayName: displayName || null,
      },
    ];
  });
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

async function markCompleted(sendId: string): Promise<boolean> {
  const { error } = await (
    supabaseAdmin as unknown as {
      from: (name: string) => {
        update: (row: Record<string, unknown>) => {
          eq: (
            column: string,
            value: string,
          ) => {
            is: (
              column: string,
              value: null,
            ) => {
              select: (cols: string) => Promise<{ data: Array<{ id: string }> | null; error: DbError }>;
            };
          };
        };
      };
    }
  )
    .from("client_agent_sends")
    .update({ completed_at: new Date().toISOString() })
    .eq("id", sendId)
    .is("completed_at", null)
    .select("id");
  if (!error) return true;
  if (missingRelation(error, "completed_at")) return false;
  return false;
}

export const completeClientAgentSend = createServerFn({ method: "POST" })
  .inputValidator((input) => tokenInput.parse(input))
  .handler(async ({ data }): Promise<{ ok: true } | { ok: false; body: string }> => {
    const resolved = await resolveToken(data.token);
    if (!resolved.ok) return { ok: false, body: resolved.body };
    const items = await loadCompletionItems(resolved.send.id);
    const fileRows = await loadArchiveFileRows(resolved.send.id);
    const decision = completionDecision({
      consentAt: resolved.send.consent_at,
      completedAt: resolved.send.completed_at,
      sendId: resolved.send.id,
      items,
      ...(fileRows !== "legacy" && fileRows.length > 0 ? { fileRows } : {}),
    });
    if (!decision.ok) {
      return {
        ok: false,
        body:
          decision.reason === "consent"
            ? "Please agree before finishing."
            : "Add each document, or say you don't have it.",
      };
    }
    if (decision.already) return { ok: true };
    if (!/^[0-9a-f-]{36}$/i.test(resolved.send.client_id)) return { ok: false, body: FINISH_BODY };
    const existing = await loadCopiedKeys(resolved.send.client_id, resolved.send.id);
    if (!existing) return { ok: false, body: FINISH_BODY };
    const pending = copiesStillNeeded(decision.files, resolved.send.id, existing);
    for (const file of pending) {
      const copied = await copySendFileToArchive({
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
    return { ok: true };
  });

export const askClientAgentLink = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    tokenInput.extend({ message: z.string().max(400) }).parse(input),
  )
  .handler(async ({ data }): Promise<{ ok: true; reply: string } | ReturnType<typeof closedLink>> => {
    const resolved = await resolveToken(data.token);
    if (!resolved.ok) return resolved;
    if (!consentReady(resolved.send.consent_at)) return closedLink("consent");
    if (!CLIENT_AGENT_CHAT_ENABLED) return { ok: true, reply: CLIENT_AGENT_CHAT_FALLBACK };
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
