/**
 * Drafts a Tax Specialist pack from the documents of one finished,
 * consented send. Firm owner / member only, and only for the one
 * allowlisted firm. The result is a deliverable_drafts row with
 * status 'draft' — the accountant reviews and approves it on the
 * client profile. Nothing is filed, mailed, or posted to a ledger.
 *
 * A password-protected PDF is opened server-side with the password the
 * client saved. Each use is written to audit_log first; if the audit row
 * cannot be stored, the password is not used and the file becomes a query.
 * Passwords, tokens, and document bytes are never logged or returned.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { CLAUDE_MODEL } from "@/lib/claude-config";
import {
  CLIENT_AGENT_FILE_PASSWORD_KEY,
  filePasswordKey,
  openFilePassword,
} from "@/lib/client-agent-file-secret";
import { itemLabel, sanitizeClientFileName } from "@/lib/client-agent-link";
import { SEND_STORAGE_BUCKET } from "@/lib/client-agent-link";
import { sendAgentFirmAllowed } from "@/lib/client-agent-send-allowlist";
import { extractSendFileContent, type SendFileContent } from "@/lib/tax-deliverable-extract.server";
import {
  TAX_PACK_KIND,
  missingItemQuery,
  parseTaxPackPayload,
  renderTaxPackBody,
  taxPackAlreadyOpen,
  taxPackAssumptions,
  taxPackDraftFailure,
  taxPackFileIntro,
  taxPackIsEmpty,
  taxPackPasswordStop,
  taxPackSystemPrompt,
  unreadableFileQuery,
  withExtraQueries,
  type TaxPackSourceFile,
} from "@/lib/tax-deliverable";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isSupabaseAdminConfigured, supabaseAdmin } from "@/integrations/supabase/client.server";

const FILE_PASSWORD_USED_ACTION = "client_agent_file_password_used";
const MAX_OPEN_TAX_PACKS = 3;
const MAX_FILES = 24;
/** Cap on the whole model payload (base64 + text), so one big send cannot time the call out. */
const MAX_TOTAL_CONTENT_CHARS = 6_000_000;
const CLAUDE_TIMEOUT_MS = 90_000;

type DbError = { message: string } | null;

type Query = PromiseLike<{ data: unknown; error: DbError }> & {
  select: (columns: string) => Query;
  insert: (row: unknown) => Query;
  eq: (column: string, value: string) => Query;
  order: (column: string, options: { ascending: boolean }) => Query;
  limit: (count: number) => Query;
  maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: DbError }>;
};

function table(name: string): Query {
  return (supabaseAdmin as unknown as { from: (table: string) => Query }).from(name);
}

function rows(data: unknown): Record<string, unknown>[] {
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}

async function firmOfClient(
  clientId: string,
): Promise<{ ok: true; firmId: string; clientName: string } | { ok: false }> {
  const { data, error } = await table("clients")
    .select("firm_id, name")
    .eq("id", clientId)
    .maybeSingle();
  if (error || !data?.firm_id || typeof data.firm_id !== "string") return { ok: false };
  const name = typeof data.name === "string" ? data.name.trim() : "";
  return { ok: true, firmId: data.firm_id, clientName: name || "Your client" };
}

async function isFirmMember(userId: string, firmId: string): Promise<boolean> {
  const firm = await table("firms").select("owner_user_id").eq("id", firmId).maybeSingle();
  if (firm.error) return false;
  if (firm.data?.owner_user_id === userId) return true;
  const member = await table("firm_memberships")
    .select("user_id")
    .eq("firm_id", firmId)
    .eq("user_id", userId)
    .maybeSingle();
  if (member.error) return false;
  return Boolean(member.data);
}

type SendFileRow = {
  id: string;
  itemKey: string;
  displayName: string | null;
  storagePath: string;
  mime: string;
  passwordIv: string | null;
  passwordBox: string | null;
};

async function loadSendFiles(sendId: string): Promise<SendFileRow[] | null> {
  const { data, error } = await table("client_agent_send_files")
    .select("id, item_key, display_name, storage_path, mime, password_iv, password_box")
    .eq("send_id", sendId)
    .order("created_at", { ascending: true });
  if (error) return null;
  return rows(data).flatMap((row) => {
    const id = typeof row.id === "string" ? row.id : "";
    const itemKey = typeof row.item_key === "string" ? row.item_key : "";
    const storagePath = typeof row.storage_path === "string" ? row.storage_path : "";
    const mime = typeof row.mime === "string" ? row.mime : "";
    if (!id || !itemKey || !storagePath || !mime) return [];
    const displayName = sanitizeClientFileName(
      typeof row.display_name === "string" ? row.display_name : "",
    );
    return [
      {
        id,
        itemKey,
        displayName: displayName || null,
        storagePath,
        mime,
        passwordIv: typeof row.password_iv === "string" ? row.password_iv : null,
        passwordBox: typeof row.password_box === "string" ? row.password_box : null,
      },
    ];
  });
}

type SendItemRow = {
  itemKey: string;
  label: string | null;
  status: string;
  quality: string | null;
  explanation: string | null;
};

async function loadSendItems(sendId: string): Promise<SendItemRow[]> {
  const { data, error } = await table("client_agent_send_items")
    .select("item_key, label, status, quality, explanation")
    .eq("send_id", sendId);
  if (error) return [];
  return rows(data).map((row) => ({
    itemKey: String(row.item_key ?? ""),
    label: typeof row.label === "string" ? row.label : null,
    status: String(row.status ?? "open"),
    quality: typeof row.quality === "string" ? row.quality : null,
    explanation: typeof row.explanation === "string" ? row.explanation : null,
  }));
}

function sendStorage() {
  return (
    supabaseAdmin as unknown as {
      storage: {
        from: (bucket: string) => {
          download: (path: string) => Promise<{ data: Blob | null; error: DbError }>;
        };
      };
    }
  ).storage.from(SEND_STORAGE_BUCKET);
}

/** The audit row is stored before the password is used. No row, no use. */
async function auditPasswordUse(input: {
  userId: string;
  firmId: string;
  clientId: string;
  fileId: string;
  sendId: string;
}): Promise<boolean> {
  try {
    const inserted = await table("audit_log").insert({
      actor_id: input.userId,
      action: FILE_PASSWORD_USED_ACTION,
      firm_id: input.firmId,
      client_id: input.clientId,
      subject_user_id: null,
      details: { file_id: input.fileId, send_id: input.sendId, purpose: "tax_pack_draft" },
    });
    return !inserted.error;
  } catch {
    return false;
  }
}

type ClaudeContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } };

function contentBlockFor(fileId: string, content: SendFileContent): ClaudeContentBlock[] {
  if (content.kind === "pdf") {
    return [
      { type: "text", text: `FILE ${fileId}:` },
      {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: content.base64 },
      },
    ];
  }
  if (content.kind === "image") {
    return [
      { type: "text", text: `FILE ${fileId}:` },
      {
        type: "image",
        source: { type: "base64", media_type: content.mediaType, data: content.base64 },
      },
    ];
  }
  if (content.kind === "text") {
    return [{ type: "text", text: `FILE ${fileId} (extracted text):\n${content.text}` }];
  }
  return [];
}

function contentChars(blocks: readonly ClaudeContentBlock[]): number {
  let total = 0;
  for (const block of blocks) {
    if (block.type === "text") total += block.text.length;
    else total += block.source.data.length;
  }
  return total;
}

async function callClaude(input: {
  apiKey: string;
  system: string;
  content: ClaudeContentBlock[];
}): Promise<{ text: string } | { failed: "model" | "timeout" }> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), CLAUDE_TIMEOUT_MS);
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: abort.signal,
      headers: {
        "x-api-key": input.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 3000,
        temperature: 0,
        system: input.system,
        messages: [{ role: "user", content: input.content }],
      }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return { failed: "model" };
    }
    const json = (await response.json()) as { content?: Array<{ type?: string; text?: string }> };
    const text = (json.content ?? [])
      .filter((part) => part.type === "text")
      .map((part) => part.text ?? "")
      .join("")
      .trim();
    return { text };
  } catch (error) {
    return { failed: (error as Error)?.name === "AbortError" ? "timeout" : "model" };
  } finally {
    clearTimeout(timer);
  }
}

export type DraftTaxPackResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "unavailable"
        | "not_on_firm"
        | "not_allowed"
        | "forbidden"
        | "not_found"
        | "not_ready"
        | "no_files"
        | "passwords_needed"
        | "already_open"
        | "draft_limit"
        | "ai_not_configured"
        | "model"
        | "timeout"
        | "empty";
      /** Display names of files that need their password saved first. */
      passwordNeeded?: string[];
    };

export const draftTaxPackFromSend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ clientId: z.string().uuid(), sendId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<DraftTaxPackResult> => {
    // A thrown error must reach the page as a reason, not a 500.
    try {
      return await draftTaxPack(data, context.userId);
    } catch {
      return { ok: false, reason: "unavailable" };
    }
  });

async function draftTaxPack(
  data: { clientId: string; sendId: string },
  userId: string,
): Promise<DraftTaxPackResult> {
  {
    if (!isSupabaseAdminConfigured()) return { ok: false, reason: "unavailable" };
    const firm = await firmOfClient(data.clientId);
    if (!firm.ok) return { ok: false, reason: "not_on_firm" };
    if (!sendAgentFirmAllowed(firm.firmId)) return { ok: false, reason: "not_allowed" };
    if (!(await isFirmMember(userId, firm.firmId))) {
      return { ok: false, reason: "forbidden" };
    }

    const send = await table("client_agent_sends")
      .select("id, client_id, firm_id, consent_at, completed_at")
      .eq("id", data.sendId)
      .maybeSingle();
    if (send.error) return { ok: false, reason: "unavailable" };
    const sendRow = send.data;
    if (!sendRow || sendRow.client_id !== data.clientId || sendRow.firm_id !== firm.firmId) {
      return { ok: false, reason: "not_found" };
    }
    if (typeof sendRow.consent_at !== "string" || typeof sendRow.completed_at !== "string") {
      return { ok: false, reason: "not_ready" };
    }

    const existing = await table("deliverable_drafts")
      .select("kind, body, status")
      .eq("client_id", data.clientId)
      .order("created_at", { ascending: false })
      .limit(40);
    if (existing.error) return { ok: false, reason: "unavailable" };
    const drafts = rows(existing.data) as Array<{
      kind: string | null;
      body: string | null;
      status: string;
    }>;
    if (taxPackAlreadyOpen(drafts, data.sendId)) return { ok: false, reason: "already_open" };
    const openPacks = drafts.filter(
      (row) => row.kind === TAX_PACK_KIND && (row.status === "draft" || row.status === "ready"),
    );
    if (openPacks.length >= MAX_OPEN_TAX_PACKS) return { ok: false, reason: "draft_limit" };

    const apiKey = (process.env.ANTHROPIC_API_KEY ?? "").trim();
    if (!apiKey) return { ok: false, reason: "ai_not_configured" };

    const fileRows = await loadSendFiles(data.sendId);
    if (!fileRows) return { ok: false, reason: "unavailable" };
    if (fileRows.length === 0) return { ok: false, reason: "no_files" };
    const items = await loadSendItems(data.sendId);
    const labels = new Map(
      items.map((item) => [item.itemKey, itemLabel(item.itemKey, item.label)]),
    );

    const files: TaxPackSourceFile[] = [];
    const blocks: ClaudeContentBlock[] = [];
    const extraQueries: string[] = [];
    const passwordNeeded: string[] = [];
    const key = filePasswordKey(process.env[CLIENT_AGENT_FILE_PASSWORD_KEY]);
    for (const file of fileRows.slice(0, MAX_FILES)) {
      const ref: TaxPackSourceFile = {
        fileId: file.id,
        itemKey: file.itemKey,
        displayName: file.displayName,
      };
      // One bad file must never kill the whole draft — it becomes a query.
      try {
        const downloaded = await sendStorage().download(file.storagePath);
        if (downloaded.error || !downloaded.data) {
          extraQueries.push(unreadableFileQuery(ref, "parse"));
          continue;
        }
        const bytes = new Uint8Array(await downloaded.data.arrayBuffer());

        let password: string | null = null;
        if (file.passwordIv && file.passwordBox && key) {
          const audited = await auditPasswordUse({
            userId,
            firmId: firm.firmId,
            clientId: data.clientId,
            fileId: file.id,
            sendId: data.sendId,
          });
          if (audited) {
            try {
              password = await openFilePassword(
                { iv: file.passwordIv, box: file.passwordBox },
                key,
              );
            } catch {
              password = null;
            }
          }
        }

        const content = await extractSendFileContent({ bytes, mime: file.mime, password });
        if (content.kind === "unreadable") {
          if (content.reason === "password") {
            passwordNeeded.push(ref.displayName ?? itemLabel(ref.itemKey, null));
          }
          extraQueries.push(unreadableFileQuery(ref, content.reason));
          continue;
        }
        const fileBlocks = contentBlockFor(file.id, content);
        if (contentChars(blocks) + contentChars(fileBlocks) > MAX_TOTAL_CONTENT_CHARS) {
          extraQueries.push(unreadableFileQuery(ref, "oversized"));
          continue;
        }
        files.push(ref);
        blocks.push(...fileBlocks);
      } catch {
        extraQueries.push(unreadableFileQuery(ref, "parse"));
      }
    }

    const blocked = taxPackPasswordStop(passwordNeeded);
    if (blocked) return blocked;

    for (const item of items) {
      const skipped =
        item.status === "received" && (item.quality === "incomplete" || item.quality === "poor");
      if (!skipped) continue;
      extraQueries.push(
        missingItemQuery(
          labels.get(item.itemKey) ?? itemLabel(item.itemKey, null),
          item.explanation,
        ),
      );
    }

    if (files.length === 0) return { ok: false, reason: "no_files" };

    const intro = taxPackFileIntro(files);
    const checklist = items
      .map((item) => `- ${labels.get(item.itemKey) ?? item.itemKey}: ${item.status}`)
      .join("\n");
    const content: ClaudeContentBlock[] = [
      {
        type: "text",
        text: `${intro}\n\nThe document list the practice asked for:\n${checklist}\n\nDraft the tax pack JSON from these documents only.`,
      },
      ...blocks,
    ];

    const reply = await callClaude({ apiKey, system: taxPackSystemPrompt(), content });
    // Locked files already returned above. A model or timeout failure still
    // names any that were collected, so the panel can list them.
    if ("failed" in reply) return taxPackDraftFailure(reply.failed, passwordNeeded);
    const parsed = parseTaxPackPayload(reply.text, files);
    if (!parsed) return taxPackDraftFailure("model", passwordNeeded);
    const draft = withExtraQueries(parsed, extraQueries);
    if (taxPackIsEmpty(draft) && draft.queries.length === 0) return { ok: false, reason: "empty" };

    const body = renderTaxPackBody({
      draft,
      files,
      clientName: firm.clientName,
      sendId: data.sendId,
    });
    const inserted = await table("deliverable_drafts").insert({
      client_id: data.clientId,
      kind: TAX_PACK_KIND,
      body,
      assumption_checklist: taxPackAssumptions(draft, files),
      status: "draft",
      created_by: userId,
    });
    if (inserted.error) return { ok: false, reason: "unavailable" };
    return { ok: true };
  }
}
