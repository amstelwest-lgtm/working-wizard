/**
 * Mint and revoke a Tax Specialist link on a client file.
 * Writes go through the service role. The raw token is returned once
 * and is not stored. Mail goes out only from mint, after an explicit send.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { CANONICAL_APP_ORIGIN, canonicalAuthOrigin } from "@/lib/app-origin";
import { copiedDocumentPaths, reviewDecision } from "@/lib/client-agent-done";
import { practiceDisplayName, sanitizeClientFileName, sendPracticeDisplayName } from "@/lib/client-agent-link";
import { filePasswordKey, openFilePassword } from "@/lib/client-agent-file-secret";
import {
  FILE_PASSWORD_READ_ACTION,
  filePasswordAuditDetails,
  revealFilePassword,
  sendFileHasPassword,
  type FilePasswordRevealResult,
} from "@/lib/client-agent-file-password-reveal";
import { sendClientAgentInvite } from "@/lib/client-agent-invite-mail";
import {
  SEND_AGENT_SLUG,
  SEND_CHECKLIST_KEY,
  agentLink,
  chooseSendItems,
  newSendToken,
  recipientEmail,
  recipientFirstName,
  sendExpiresAt,
  sendStillOpen,
  sha256Hex,
} from "@/lib/client-agent-send";
import { sendAgentFirmAllowed } from "@/lib/client-agent-send-allowlist";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isSupabaseAdminConfigured, supabaseAdmin } from "@/integrations/supabase/client.server";

type DbError = { message: string; code?: string } | null;

type Query = PromiseLike<{ data: unknown; error: DbError }> & {
  select: (columns: string) => Query;
  insert: (row: unknown) => Query;
  update: (row: Record<string, unknown>) => Query;
  delete: () => Query;
  eq: (column: string, value: string) => Query;
  is: (column: string, value: null) => Query;
  order: (column: string, options: { ascending: boolean }) => Query;
  maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: DbError }>;
};

function table(name: string): Query {
  return (supabaseAdmin as unknown as { from: (table: string) => Query }).from(name);
}

function rows(data: unknown): Record<string, unknown>[] {
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}

function missingTable(error: DbError): boolean {
  const message = error?.message ?? "";
  return (
    /client_agent_sends/.test(message) &&
    /does not exist|schema cache|could not find/i.test(message)
  );
}

function linkOrigin(): string {
  try {
    const req = getRequest();
    return canonicalAuthOrigin(req.headers.get("origin") || new URL(req.url).origin);
  } catch {
    return CANONICAL_APP_ORIGIN;
  }
}

async function firmOfClient(
  clientId: string,
): Promise<
  | { ok: true; firmId: string; contactEmail: string | null }
  | { ok: false; reason: "not_on_firm" | "unavailable" }
> {
  const { data, error } = await supabaseAdmin
    .from("clients")
    .select("firm_id, contact_email")
    .eq("id", clientId)
    .maybeSingle();
  if (error) {
    if (missingTable(error)) return { ok: false, reason: "unavailable" };
    throw new Error("The client could not be read.");
  }
  const firmId = data?.firm_id ?? null;
  if (!firmId) return { ok: false, reason: "not_on_firm" };
  const raw = typeof data?.contact_email === "string" ? data.contact_email : "";
  return { ok: true, firmId, contactEmail: recipientEmail(raw) };
}

async function loadFirmName(firmId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("firms")
    .select("name")
    .eq("id", firmId)
    .maybeSingle();
  if (error || typeof data?.name !== "string") return null;
  const name = data.name.trim();
  return name || null;
}

function missingSendColumn(error: DbError, column: string): boolean {
  const message = error?.message ?? "";
  return message.includes(column) && /does not exist|schema cache|could not find/i.test(message);
}

function missingFilesTable(error: DbError): boolean {
  const message = error?.message ?? "";
  return (
    /client_agent_send_files/.test(message) &&
    /does not exist|schema cache|could not find/i.test(message)
  );
}

async function isFirmMember(userId: string, firmId: string): Promise<boolean> {
  const { data: firm, error: firmError } = await supabaseAdmin
    .from("firms")
    .select("owner_user_id")
    .eq("id", firmId)
    .maybeSingle();
  if (firmError) throw new Error(firmError.message);
  if (firm?.owner_user_id === userId) return true;

  const { data: member, error: memberError } = await supabaseAdmin
    .from("firm_memberships")
    .select("user_id")
    .eq("firm_id", firmId)
    .eq("user_id", userId)
    .maybeSingle();
  if (memberError) throw new Error(memberError.message);
  return Boolean(member);
}

export type AgentSendItem = {
  itemKey: string;
  label: string | null;
  totalsOnly: boolean;
  status: string;
  quality: string | null;
  explanation: string | null;
  documentPaths: string[];
};

export type AgentSendFile = {
  id: string;
  itemKey: string;
  displayName: string | null;
  hasPassword: boolean;
};

export type AgentSendRow = {
  id: string;
  expiresAt: string;
  revokedAt: string | null;
  consentAt: string | null;
  completedAt: string | null;
  reviewedAt: string | null;
  open: boolean;
  items: AgentSendItem[];
  files: AgentSendFile[];
};

function parseSend(row: Record<string, unknown>, now: Date): AgentSendRow {
  const expiresAt = String(row.expires_at ?? "");
  const revokedAt = typeof row.revoked_at === "string" ? row.revoked_at : null;
  return {
    id: String(row.id),
    expiresAt,
    revokedAt,
    consentAt: typeof row.consent_at === "string" ? row.consent_at : null,
    completedAt: typeof row.completed_at === "string" ? row.completed_at : null,
    reviewedAt: typeof row.reviewed_at === "string" ? row.reviewed_at : null,
    open: sendStillOpen({ revokedAt, expiresAt }, now),
    items: [],
    files: [],
  };
}

async function loadSendFiles(sendId: string): Promise<AgentSendFile[]> {
  const load = (columns: string) =>
    table("client_agent_send_files")
      .select(columns)
      .eq("send_id", sendId)
      .order("created_at", { ascending: false });

  let found = await load("id, item_key, display_name, password_box, created_at");
  if (found.error && missingSendColumn(found.error, "display_name")) {
    found = await load("id, item_key, password_box, created_at");
  }
  if (found.error && missingSendColumn(found.error, "password_box")) {
    found = await load("id, item_key, created_at");
  }
  if (found.error) {
    if (missingFilesTable(found.error)) return [];
    throw new Error("The links could not be read.");
  }
  return rows(found.data).flatMap((row) => {
    const id = typeof row.id === "string" ? row.id : "";
    if (!id) return [];
    const displayName = sanitizeClientFileName(
      typeof row.display_name === "string" ? row.display_name : "",
    );
    return [
      {
        id,
        itemKey: typeof row.item_key === "string" ? row.item_key : "",
        displayName: displayName || null,
        hasPassword: sendFileHasPassword(row.password_box),
      },
    ];
  });
}

export const listClientAgentSends = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ clientId: z.string().uuid() }).parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      migrated: boolean;
      allowed: boolean;
      sends: AgentSendRow[];
      contactEmail: string | null;
    }> => {
      if (!isSupabaseAdminConfigured()) {
        return { migrated: false, allowed: false, sends: [], contactEmail: null };
      }
      const firm = await firmOfClient(data.clientId);
      if (!firm.ok) {
        return {
          migrated: firm.reason !== "unavailable",
          allowed: false,
          sends: [],
          contactEmail: null,
        };
      }
      if (!sendAgentFirmAllowed(firm.firmId)) {
        return { migrated: true, allowed: false, sends: [], contactEmail: null };
      }
      if (!(await isFirmMember(context.userId, firm.firmId))) {
        return { migrated: true, allowed: false, sends: [], contactEmail: null };
      }

      let listed = await table("client_agent_sends")
        .select("id, expires_at, revoked_at, consent_at, created_at, completed_at, reviewed_at")
        .eq("client_id", data.clientId)
        .eq("firm_id", firm.firmId)
        .order("created_at", { ascending: false });
      if (listed.error && missingSendColumn(listed.error, "reviewed_at")) {
        listed = await table("client_agent_sends")
          .select("id, expires_at, revoked_at, consent_at, created_at, completed_at")
          .eq("client_id", data.clientId)
          .eq("firm_id", firm.firmId)
          .order("created_at", { ascending: false });
      }
      if (listed.error && missingSendColumn(listed.error, "completed_at")) {
        listed = await table("client_agent_sends")
          .select("id, expires_at, revoked_at, consent_at, created_at")
          .eq("client_id", data.clientId)
          .eq("firm_id", firm.firmId)
          .order("created_at", { ascending: false });
      }
      if (listed.error) {
        if (missingTable(listed.error)) {
          return { migrated: false, allowed: false, sends: [], contactEmail: null };
        }
        throw new Error("The links could not be read.");
      }
      const now = new Date();
      const sends = rows(listed.data).map((row) => parseSend(row, now));
      if (sends.length === 0) {
        return { migrated: true, allowed: true, sends, contactEmail: firm.contactEmail };
      }

      for (const send of sends) {
        const found = await table("client_agent_send_items")
          .select("item_key, label, totals_only, status, quality, explanation")
          .eq("send_id", send.id);
        if (found.error) {
          if (missingTable(found.error)) {
            return { migrated: false, allowed: false, sends: [], contactEmail: null };
          }
          throw new Error("The links could not be read.");
        }
        send.items = rows(found.data).map((row) => ({
          itemKey: String(row.item_key ?? ""),
          label: typeof row.label === "string" ? row.label : null,
          totalsOnly: row.totals_only === true,
          status: String(row.status ?? "open"),
          quality: typeof row.quality === "string" ? row.quality : null,
          explanation: typeof row.explanation === "string" ? row.explanation : null,
          documentPaths: [],
        }));
        send.files = await loadSendFiles(send.id);
      }
      const artifacts = await table("client_artifacts")
        .select("storage_path, visibility, meta")
        .eq("client_id", data.clientId);
      const artifactRows = artifacts.error ? [] : rows(artifacts.data);
      for (const send of sends) {
        if (!send.completedAt) continue;
        for (const item of send.items) {
          item.documentPaths = copiedDocumentPaths(
            artifactRows as Array<{ storage_path: unknown; visibility: unknown; meta: unknown }>,
            send.id,
            item.itemKey,
          );
        }
      }
      return { migrated: true, allowed: true, sends, contactEmail: firm.contactEmail };
    },
  );

export type MintAgentSendResult =
  | { ok: true; sendId: string; url: string; expiresAt: string }
  | { ok: false; reason: "already_open"; sendId: string; expiresAt: string }
  | {
      ok: false;
      reason:
        | "not_on_firm"
        | "unavailable"
        | "forbidden"
        | "not_allowed"
        | "address"
        | "name"
        | "empty"
        | "items"
        | "other"
        | "email";
    };

export const mintClientAgentSend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        clientId: z.string().uuid(),
        recipientEmail: z.string().max(200),
        recipientFirstName: z.string().max(80).optional(),
        items: z
          .array(
            z.object({
              itemKey: z.string().max(80),
              label: z.string().max(240).optional(),
            }),
          )
          .max(16),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<MintAgentSendResult> => {
    if (!isSupabaseAdminConfigured()) return { ok: false, reason: "unavailable" };
    const firm = await firmOfClient(data.clientId);
    if (!firm.ok) return { ok: false, reason: firm.reason };
    if (!sendAgentFirmAllowed(firm.firmId)) return { ok: false, reason: "not_allowed" };
    if (!(await isFirmMember(context.userId, firm.firmId))) {
      return { ok: false, reason: "forbidden" };
    }

    const existing = await table("client_agent_sends")
      .select("id, expires_at, revoked_at")
      .eq("client_id", data.clientId)
      .eq("firm_id", firm.firmId)
      .eq("agent", SEND_AGENT_SLUG)
      .is("revoked_at", null)
      .order("created_at", { ascending: false });
    if (existing.error) {
      if (missingTable(existing.error)) return { ok: false, reason: "unavailable" };
      throw new Error("The link could not be created.");
    }
    const now = new Date();
    const open = rows(existing.data)
      .map((row) => parseSend(row, now))
      .find((row) => row.open);
    if (open)
      return { ok: false, reason: "already_open", sendId: open.id, expiresAt: open.expiresAt };

    const to = recipientEmail(data.recipientEmail);
    if (!to) return { ok: false, reason: "address" };
    const firstName = recipientFirstName(data.recipientFirstName);
    if (!firstName.ok) return { ok: false, reason: "name" };
    const chosen = chooseSendItems(data.items);
    if (!chosen.ok) return { ok: false, reason: chosen.reason };

    const token = newSendToken();
    const tokenHash = await sha256Hex(token);
    const expiresAt = sendExpiresAt(now).toISOString();
    const storedPracticeName = sendPracticeDisplayName(firm.firmId);
    const practiceName = practiceDisplayName({
      firmId: firm.firmId,
      practiceDisplayName: storedPracticeName,
      firmName: await loadFirmName(firm.firmId),
    });
    let sendRow: Record<string, unknown> = {
      firm_id: firm.firmId,
      client_id: data.clientId,
      agent: SEND_AGENT_SLUG,
      checklist_key: SEND_CHECKLIST_KEY,
      token_hash: tokenHash,
      sent_by: context.userId,
      expires_at: expiresAt,
      ...(storedPracticeName ? { practice_display_name: storedPracticeName } : {}),
      ...(firstName.name ? { recipient_first_name: firstName.name } : {}),
    };
    let inserted = await table("client_agent_sends")
      .insert(sendRow)
      .select("id, expires_at")
      .maybeSingle();
    for (const column of ["practice_display_name", "recipient_first_name"] as const) {
      if (inserted.error && missingSendColumn(inserted.error, column)) {
        const next = { ...sendRow };
        delete next[column];
        sendRow = next;
        inserted = await table("client_agent_sends")
          .insert(sendRow)
          .select("id, expires_at")
          .maybeSingle();
      }
    }
    if (inserted.error || !inserted.data?.id) {
      if (missingTable(inserted.error)) return { ok: false, reason: "unavailable" };
      throw new Error("The link could not be created.");
    }
    const sendId = String(inserted.data.id);
    const itemRows = chosen.items.map((item) => ({
      send_id: sendId,
      item_key: item.itemKey,
      label: item.label,
      totals_only: item.totalsOnly,
      status: "open",
    }));
    const saved = await table("client_agent_send_items").insert(itemRows);
    if (saved.error) {
      await table("client_agent_sends").delete().eq("id", sendId);
      throw new Error("The link could not be created.");
    }
    const url = agentLink(linkOrigin(), token);
    const mailed = await sendClientAgentInvite({
      practiceName,
      to,
      firstName: firstName.name,
      link: url,
      expiresAt: String(inserted.data.expires_at ?? expiresAt),
      idempotencyKey: `client-agent-invite/${sendId}`,
      apiKey: process.env.RESEND_API_KEY,
      fromEmail: process.env.RESEND_FROM_EMAIL,
    });
    if (!mailed.ok) {
      await table("client_agent_sends").delete().eq("id", sendId);
      return { ok: false, reason: "email" };
    }
    return {
      ok: true,
      sendId,
      url,
      expiresAt: String(inserted.data.expires_at ?? expiresAt),
    };
  });

export type RevokeAgentSendResult =
  | { ok: true; revokedAt: string }
  | {
      ok: false;
      reason: "not_found" | "forbidden" | "unavailable" | "not_on_firm" | "not_allowed";
    };

export const revokeClientAgentSend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ clientId: z.string().uuid(), sendId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<RevokeAgentSendResult> => {
    if (!isSupabaseAdminConfigured()) return { ok: false, reason: "unavailable" };
    const firm = await firmOfClient(data.clientId);
    if (!firm.ok) return { ok: false, reason: firm.reason };
    if (!sendAgentFirmAllowed(firm.firmId)) return { ok: false, reason: "not_allowed" };
    if (!(await isFirmMember(context.userId, firm.firmId))) {
      return { ok: false, reason: "forbidden" };
    }

    const found = await table("client_agent_sends")
      .select("id, client_id, firm_id, revoked_at")
      .eq("id", data.sendId)
      .maybeSingle();
    if (found.error) {
      if (missingTable(found.error)) return { ok: false, reason: "unavailable" };
      throw new Error(found.error.message);
    }
    const row = found.data;
    if (!row || row.client_id !== data.clientId || row.firm_id !== firm.firmId) {
      return { ok: false, reason: "not_found" };
    }
    if (typeof row.revoked_at === "string") return { ok: true, revokedAt: row.revoked_at };

    const revokedAt = new Date().toISOString();
    const updated = await table("client_agent_sends")
      .update({ revoked_at: revokedAt })
      .eq("id", data.sendId)
      .eq("client_id", data.clientId);
    if (updated.error) throw new Error(updated.error.message);
    return { ok: true, revokedAt };
  });

export const revealClientAgentFilePassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ clientId: z.string().uuid(), fileId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<FilePasswordRevealResult> => {
    const userId = context.userId;
    if (!userId) return { ok: false, reason: "anon" };
    if (!isSupabaseAdminConfigured()) return { ok: false, reason: "unavailable" };

    const found = await table("client_agent_send_files")
      .select("id, send_id")
      .eq("id", data.fileId)
      .maybeSingle();
    if (found.error) return { ok: false, reason: "unavailable" };
    const fileId = typeof found.data?.id === "string" ? found.data.id : "";
    const sendId = typeof found.data?.send_id === "string" ? found.data.send_id : "";
    if (!fileId || !sendId) return { ok: false, reason: "not_found" };

    const send = await table("client_agent_sends")
      .select("id, client_id, firm_id")
      .eq("id", sendId)
      .maybeSingle();
    if (send.error) return { ok: false, reason: "unavailable" };
    const clientId = typeof send.data?.client_id === "string" ? send.data.client_id : "";
    const firmId = typeof send.data?.firm_id === "string" ? send.data.firm_id : "";
    if (!clientId || !firmId || clientId !== data.clientId) return { ok: false, reason: "not_found" };

    const firm = await firmOfClient(data.clientId);
    if (!firm.ok || firm.firmId !== firmId) return { ok: false, reason: "not_found" };

    const member = await isFirmMember(userId, firm.firmId);
    const firmAllowed = sendAgentFirmAllowed(firm.firmId);

    let passwordIv: string | null = null;
    let passwordBox: string | null = null;
    if (member && firmAllowed) {
      const sealed = await table("client_agent_send_files")
        .select("password_iv, password_box")
        .eq("id", fileId)
        .maybeSingle();
      if (sealed.error) return { ok: false, reason: "unavailable" };
      passwordIv = typeof sealed.data?.password_iv === "string" ? sealed.data.password_iv : null;
      passwordBox = typeof sealed.data?.password_box === "string" ? sealed.data.password_box : null;
    }

    return revealFilePassword({
      caller: { userId, firmMember: member, firmAllowed },
      requestedClientId: data.clientId,
      file: { id: fileId, sendId, clientId, passwordIv, passwordBox },
      open: async (sealed) => {
        const key = filePasswordKey(process.env.CLIENT_AGENT_FILE_PASSWORD_KEY);
        if (!key) return null;
        return openFilePassword(sealed, key);
      },
      audit: async (details) => {
        try {
          const inserted = await table("audit_log").insert({
            actor_id: userId,
            action: FILE_PASSWORD_READ_ACTION,
            firm_id: firmId,
            client_id: clientId,
            subject_user_id: null,
            details: filePasswordAuditDetails(details.file_id, details.send_id),
          });
          return !inserted.error;
        } catch {
          return false;
        }
      },
    });
  });

export type ReviewAgentSendResult =
  | { ok: true; reviewedAt: string }
  | {
      ok: false;
      reason: "forbidden" | "not_allowed" | "not_found" | "not_ready" | "unavailable" | "not_on_firm";
    };

export const reviewClientAgentSend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ clientId: z.string().uuid(), sendId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<ReviewAgentSendResult> => {
    if (!isSupabaseAdminConfigured()) return { ok: false, reason: "unavailable" };
    const firm = await firmOfClient(data.clientId);
    if (!firm.ok) return { ok: false, reason: firm.reason };
    const member = await isFirmMember(context.userId, firm.firmId);
    const found = await table("client_agent_sends")
      .select("id, client_id, firm_id, completed_at, reviewed_at")
      .eq("id", data.sendId)
      .maybeSingle();
    if (found.error) {
      if (missingTable(found.error) || missingSendColumn(found.error, "reviewed_at")) {
        return { ok: false, reason: "unavailable" };
      }
      throw new Error("The link could not be read.");
    }
    const row = found.data;
    const same = Boolean(row) && row?.client_id === data.clientId && row?.firm_id === firm.firmId;
    const decision = reviewDecision({
      member,
      firmAllowed: sendAgentFirmAllowed(firm.firmId),
      found: Boolean(same),
      completedAt: typeof row?.completed_at === "string" ? row.completed_at : null,
      reviewedAt: typeof row?.reviewed_at === "string" ? row.reviewed_at : null,
    });
    if (!decision.ok) return decision;
    if (decision.already) return { ok: true, reviewedAt: String(row?.reviewed_at) };
    const reviewedAt = new Date().toISOString();
    const updated = await table("client_agent_sends")
      .update({ reviewed_at: reviewedAt })
      .eq("id", data.sendId)
      .eq("client_id", data.clientId)
      .is("reviewed_at", null);
    if (updated.error) throw new Error("The review could not be saved.");
    return { ok: true, reviewedAt };
  });
