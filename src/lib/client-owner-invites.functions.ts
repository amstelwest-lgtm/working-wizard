/**
 * Pending owner invites on an existing client.
 * invite_tokens is deny-all, so reads and revoke go through the service role
 * only after the caller's own client (RLS) and practice assignment succeed.
 * Mint and send stay on inviteClientOwner.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  draftOwnerInviteEmail,
  inviteSiteUrl,
  sendInviteViaResend,
} from "@/lib/client-invite-email";
import { practiceMemberMayInviteOwner } from "@/lib/client-owner-invite";
import { isMissingMarketSupport } from "@/lib/market";

type LooseSb = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (
        col: string,
        val: string,
      ) => {
        maybeSingle: () => Promise<{
          data: Record<string, unknown> | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
};

export type PendingOwnerInvite = {
  id: string;
  email: string | null;
  createdAt: string;
  expiresAt: string;
  url: string;
};

export type ClientOwnerInviteList = {
  contactEmail: string | null;
  ownerOnFile: boolean;
  pending: PendingOwnerInvite[];
};

function claimsEmailOf(claims: unknown): string | null {
  if (claims && typeof claims === "object" && "email" in claims) {
    const email = (claims as { email?: unknown }).email;
    return typeof email === "string" && email.includes("@") ? email : null;
  }
  return null;
}

async function loadVisibleClient(sb: LooseSb, clientId: string) {
  const { data, error } = await sb
    .from("clients")
    .select("id, name, firm_id, contact_email, owner_user_id")
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function practiceAssignment(sb: LooseSb, userId: string, clientId: string): Promise<boolean> {
  const { data, error } = await sb.rpc("has_active_practice_assignment", {
    _user_id: userId,
    _client_id: clientId,
  });
  if (error) {
    const missing = error.message.includes("does not exist") || error.code === "42883";
    if (missing) {
      throw new Error("Practice assignment check is missing — run the practice access migrations.");
    }
    throw new Error(error.message);
  }
  return data === true;
}

async function assertFirmMemberCanInvite(sb: LooseSb, userId: string, clientId: string) {
  const client = await loadVisibleClient(sb, clientId);
  const assigned = client ? await practiceAssignment(sb, userId, clientId) : false;
  if (
    !practiceMemberMayInviteOwner({ clientVisible: Boolean(client), practiceAssignment: assigned })
  ) {
    throw new Error("Only a firm member with access to this client can invite the owner");
  }
  return client!;
}

function ownerInviteUrl(token: string): string {
  return `${inviteSiteUrl()}/?invite=${encodeURIComponent(token)}&mode=signup`;
}

type ResendClient = {
  name?: string;
  client_code?: string | null;
  firm_id?: string | null;
  market?: unknown;
};

/** Market stays on the row when the column exists. A missing column is null, never a guessed market. */
async function loadResendClient(clientId: string): Promise<ResendClient | null> {
  const full = await supabaseAdmin
    .from("clients")
    .select("id, name, client_code, firm_id, market")
    .eq("id", clientId)
    .maybeSingle();
  if (!full.error) return full.data;
  const message = full.error.message ?? "";
  const missingMarket = isMissingMarketSupport(full.error);
  const missingCode = message.includes("client_code");
  if (!missingMarket && !missingCode) throw new Error(full.error.message);

  if (missingMarket) {
    const retry = await supabaseAdmin
      .from("clients")
      .select("id, name, client_code, firm_id")
      .eq("id", clientId)
      .maybeSingle();
    if (retry.error && (retry.error.message ?? "").includes("client_code")) {
      const again = await supabaseAdmin
        .from("clients")
        .select("id, name, firm_id")
        .eq("id", clientId)
        .maybeSingle();
      if (again.error) throw new Error(again.error.message);
      return again.data ? { ...again.data, client_code: null, market: null } : null;
    }
    if (retry.error) throw new Error(retry.error.message);
    return retry.data ? { ...retry.data, market: null } : null;
  }

  const retry = await supabaseAdmin
    .from("clients")
    .select("id, name, firm_id, market")
    .eq("id", clientId)
    .maybeSingle();
  if (retry.error && isMissingMarketSupport(retry.error)) {
    const again = await supabaseAdmin
      .from("clients")
      .select("id, name, firm_id")
      .eq("id", clientId)
      .maybeSingle();
    if (again.error) throw new Error(again.error.message);
    return again.data ? { ...again.data, client_code: null, market: null } : null;
  }
  if (retry.error) throw new Error(retry.error.message);
  return retry.data ? { ...retry.data, client_code: null } : null;
}

export const assertClientOwnerInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ clientId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertFirmMemberCanInvite(
      context.supabase as unknown as LooseSb,
      context.userId,
      data.clientId,
    );
    return { ok: true as const };
  });

export const listClientOwnerInvites = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ clientId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<ClientOwnerInviteList> => {
    const client = await assertFirmMemberCanInvite(
      context.supabase as unknown as LooseSb,
      context.userId,
      data.clientId,
    );
    const contactEmail =
      String(client.contact_email ?? "")
        .trim()
        .toLowerCase() || null;
    const now = new Date().toISOString();
    const withEmail = await supabaseAdmin
      .from("invite_tokens")
      .select("id, invited_email, created_at, expires_at, token")
      .eq("client_id", data.clientId)
      .eq("purpose", "owner_handoff")
      .is("redeemed_at", null)
      .gt("expires_at", now)
      .order("created_at", { ascending: false })
      .limit(20);
    let raw: Array<Record<string, unknown>> = [];
    if (withEmail.error && (withEmail.error.message ?? "").includes("invited_email")) {
      const retry = await supabaseAdmin
        .from("invite_tokens")
        .select("id, created_at, expires_at, token")
        .eq("client_id", data.clientId)
        .eq("purpose", "owner_handoff")
        .is("redeemed_at", null)
        .gt("expires_at", now)
        .order("created_at", { ascending: false })
        .limit(20);
      if (retry.error) throw new Error(retry.error.message);
      raw = (retry.data ?? []) as Array<Record<string, unknown>>;
    } else if (withEmail.error) {
      throw new Error(withEmail.error.message);
    } else {
      raw = (withEmail.data ?? []) as Array<Record<string, unknown>>;
    }
    const pending: PendingOwnerInvite[] = raw
      .map((row) => {
        const token = String(row.token ?? "");
        if (!token) return null;
        const invited = String(row.invited_email ?? "")
          .trim()
          .toLowerCase();
        return {
          id: String(row.id),
          email: invited || contactEmail,
          createdAt: String(row.created_at ?? ""),
          expiresAt: String(row.expires_at ?? ""),
          url: ownerInviteUrl(token),
        };
      })
      .filter((row): row is PendingOwnerInvite => Boolean(row));
    return {
      contactEmail,
      ownerOnFile: Boolean(client.owner_user_id),
      pending,
    };
  });

export const revokeClientOwnerInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ clientId: z.string().uuid(), inviteId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertFirmMemberCanInvite(
      context.supabase as unknown as LooseSb,
      context.userId,
      data.clientId,
    );
    const revokedAt = new Date(Date.now() - 1000).toISOString();
    const { data: rows, error } = await supabaseAdmin
      .from("invite_tokens")
      .update({ expires_at: revokedAt })
      .eq("id", data.inviteId)
      .eq("client_id", data.clientId)
      .eq("purpose", "owner_handoff")
      .is("redeemed_at", null)
      .select("id");
    if (error) throw new Error(error.message);
    if (!rows?.length) throw new Error("Invite not found");
    return { ok: true as const };
  });

export const resendClientOwnerInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ clientId: z.string().uuid(), inviteId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const visible = await assertFirmMemberCanInvite(
      context.supabase as unknown as LooseSb,
      context.userId,
      data.clientId,
    );
    const now = new Date().toISOString();
    const tokenQuery = await supabaseAdmin
      .from("invite_tokens")
      .select("id, token, invited_email, expires_at, redeemed_at, purpose")
      .eq("id", data.inviteId)
      .eq("client_id", data.clientId)
      .eq("purpose", "owner_handoff")
      .maybeSingle();
    let tokenRow: {
      token?: string;
      invited_email?: string | null;
      expires_at?: string | null;
      redeemed_at?: string | null;
    } | null = null;
    if (tokenQuery.error && (tokenQuery.error.message ?? "").includes("invited_email")) {
      const retry = await supabaseAdmin
        .from("invite_tokens")
        .select("id, token, expires_at, redeemed_at, purpose")
        .eq("id", data.inviteId)
        .eq("client_id", data.clientId)
        .eq("purpose", "owner_handoff")
        .maybeSingle();
      if (retry.error) throw new Error(retry.error.message);
      tokenRow = retry.data;
    } else if (tokenQuery.error) {
      throw new Error(tokenQuery.error.message);
    } else {
      tokenRow = tokenQuery.data;
    }
    const row = tokenRow;
    if (!row?.token) throw new Error("Invite not found");
    if (row.redeemed_at) throw new Error("This invite was already used");
    if (row.expires_at && row.expires_at <= now) throw new Error("This invite has expired");

    const email =
      String(row.invited_email ?? "")
        .trim()
        .toLowerCase() ||
      String(visible.contact_email ?? "")
        .trim()
        .toLowerCase();
    if (!email) throw new Error("Add an owner email, then email the invite");

    const client = await loadResendClient(data.clientId);
    if (!client) throw new Error("Client not found");

    let firmName = "";
    let accountantName = "";
    let accountantEmail: string | null = claimsEmailOf(context.claims);
    if (client.firm_id) {
      const { data: firm } = await supabaseAdmin
        .from("firms")
        .select("name, brand_contact_name, brand_contact_email")
        .eq("id", client.firm_id)
        .maybeSingle();
      firmName = String(firm?.name ?? "").trim();
      accountantName = String(firm?.brand_contact_name ?? "").trim();
      accountantEmail = String(firm?.brand_contact_email ?? "").trim() || accountantEmail;
    }
    if (!accountantName) accountantName = accountantEmail || "Your accountant";

    const url = ownerInviteUrl(row.token);
    const draft = await draftOwnerInviteEmail({
      clientName: String(client.name ?? "this business"),
      clientCode: client.client_code ?? null,
      inviteUrl: url,
      firmName,
      accountantName,
      accountantEmail,
      market: client.market,
    });
    const sent = await sendInviteViaResend({
      to: email,
      subject: draft.subject,
      body: draft.body,
      replyTo: accountantEmail,
      idempotencyKey: `owner-invite-resend-${data.inviteId}-${Date.now()}`,
    });
    return {
      emailed: sent.ok,
      sendError: sent.ok ? null : sent.error,
      email,
      url,
    };
  });
