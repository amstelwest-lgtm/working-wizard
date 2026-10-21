/**
 * Mint and revoke a Tax Specialist link on a client file.
 * Writes go through the service role. The raw token is returned once
 * and is not stored. This file does not send mail.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { CANONICAL_APP_ORIGIN, canonicalAuthOrigin } from "@/lib/app-origin";
import {
  PHYSIO_ITEMS,
  SEND_AGENT_SLUG,
  SEND_CHECKLIST_KEY,
  agentLink,
  newSendToken,
  sendExpiresAt,
  sendStillOpen,
  sha256Hex,
} from "@/lib/client-agent-send";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  isSupabaseAdminConfigured,
  supabaseAdmin,
} from "@/integrations/supabase/client.server";

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
  return /client_agent_sends/.test(message) && /does not exist|schema cache|could not find/i.test(message);
}

function linkOrigin(): string {
  try {
    const req = getRequest();
    return canonicalAuthOrigin(req.headers.get("origin") || new URL(req.url).origin);
  } catch {
    return CANONICAL_APP_ORIGIN;
  }
}

async function firmOfClient(clientId: string): Promise<
  | { ok: true; firmId: string }
  | { ok: false; reason: "not_on_firm" | "unavailable" }
> {
  const { data, error } = await supabaseAdmin
    .from("clients")
    .select("firm_id")
    .eq("id", clientId)
    .maybeSingle();
  if (error) {
    if (missingTable(error)) return { ok: false, reason: "unavailable" };
    throw new Error(error.message);
  }
  const firmId = data?.firm_id ?? null;
  if (!firmId) return { ok: false, reason: "not_on_firm" };
  return { ok: true, firmId };
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
  totalsOnly: boolean;
  status: string;
  quality: string | null;
};

export type AgentSendRow = {
  id: string;
  expiresAt: string;
  revokedAt: string | null;
  consentAt: string | null;
  open: boolean;
  items: AgentSendItem[];
};

function parseSend(row: Record<string, unknown>, now: Date): AgentSendRow {
  const expiresAt = String(row.expires_at ?? "");
  const revokedAt = typeof row.revoked_at === "string" ? row.revoked_at : null;
  return {
    id: String(row.id),
    expiresAt,
    revokedAt,
    consentAt: typeof row.consent_at === "string" ? row.consent_at : null,
    open: sendStillOpen({ revokedAt, expiresAt }, now),
    items: [],
  };
}

export const listClientAgentSends = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ clientId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ migrated: boolean; sends: AgentSendRow[] }> => {
    if (!isSupabaseAdminConfigured()) return { migrated: false, sends: [] };
    const firm = await firmOfClient(data.clientId);
    if (!firm.ok) return { migrated: firm.reason !== "unavailable", sends: [] };
    if (!(await isFirmMember(context.userId, firm.firmId))) return { migrated: true, sends: [] };

    const listed = await table("client_agent_sends")
      .select("id, expires_at, revoked_at, consent_at, created_at")
      .eq("client_id", data.clientId)
      .eq("firm_id", firm.firmId)
      .order("created_at", { ascending: false });
    if (listed.error) {
      if (missingTable(listed.error)) return { migrated: false, sends: [] };
      throw new Error(listed.error.message);
    }
    const now = new Date();
    const sends = rows(listed.data).map((row) => parseSend(row, now));
    if (sends.length === 0) return { migrated: true, sends };

    for (const send of sends) {
      const found = await table("client_agent_send_items")
        .select("item_key, totals_only, status, quality")
        .eq("send_id", send.id);
      if (found.error) {
        if (missingTable(found.error)) return { migrated: false, sends: [] };
        throw new Error(found.error.message);
      }
      send.items = rows(found.data).map((row) => ({
        itemKey: String(row.item_key ?? ""),
        totalsOnly: row.totals_only === true,
        status: String(row.status ?? "open"),
        quality: typeof row.quality === "string" ? row.quality : null,
      }));
    }
    return { migrated: true, sends };
  });

export type MintAgentSendResult =
  | { ok: true; sendId: string; url: string; expiresAt: string }
  | { ok: false; reason: "already_open"; sendId: string; expiresAt: string }
  | { ok: false; reason: "not_on_firm" | "unavailable" | "forbidden" };

export const mintClientAgentSend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ clientId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<MintAgentSendResult> => {
    if (!isSupabaseAdminConfigured()) return { ok: false, reason: "unavailable" };
    const firm = await firmOfClient(data.clientId);
    if (!firm.ok) return { ok: false, reason: firm.reason };
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
      throw new Error(existing.error.message);
    }
    const now = new Date();
    const open = rows(existing.data)
      .map((row) => parseSend(row, now))
      .find((row) => row.open);
    if (open) return { ok: false, reason: "already_open", sendId: open.id, expiresAt: open.expiresAt };

    const token = newSendToken();
    const tokenHash = await sha256Hex(token);
    const expiresAt = sendExpiresAt(now).toISOString();
    const inserted = await table("client_agent_sends")
      .insert({
        firm_id: firm.firmId,
        client_id: data.clientId,
        agent: SEND_AGENT_SLUG,
        checklist_key: SEND_CHECKLIST_KEY,
        token_hash: tokenHash,
        sent_by: context.userId,
        expires_at: expiresAt,
      })
      .select("id, expires_at")
      .maybeSingle();
    if (inserted.error || !inserted.data?.id) {
      if (missingTable(inserted.error)) return { ok: false, reason: "unavailable" };
      throw new Error(inserted.error?.message || "The link could not be created.");
    }
    const sendId = String(inserted.data.id);
    const itemRows = PHYSIO_ITEMS.map((item) => ({
      send_id: sendId,
      item_key: item.itemKey,
      totals_only: item.totalsOnly,
      status: "open",
    }));
    const saved = await table("client_agent_send_items").insert(itemRows);
    if (saved.error) {
      await table("client_agent_sends").delete().eq("id", sendId);
      throw new Error(saved.error.message);
    }
    return {
      ok: true,
      sendId,
      url: agentLink(linkOrigin(), token),
      expiresAt: String(inserted.data.expires_at ?? expiresAt),
    };
  });

export type RevokeAgentSendResult =
  | { ok: true; revokedAt: string }
  | { ok: false; reason: "not_found" | "forbidden" | "unavailable" | "not_on_firm" };

export const revokeClientAgentSend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ clientId: z.string().uuid(), sendId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<RevokeAgentSendResult> => {
    if (!isSupabaseAdminConfigured()) return { ok: false, reason: "unavailable" };
    const firm = await firmOfClient(data.clientId);
    if (!firm.ok) return { ok: false, reason: firm.reason };
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
