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
import {
  activeClientOwnerOnFile,
  clientOwnerLabel,
  practiceMemberMayInviteOwner,
} from "@/lib/client-owner-invite";
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
  ownerName: string | null;
  createdAt: string;
  expiresAt: string;
  url: string;
};

export type ClientOwnerOnFile = {
  membershipId: string;
  userId: string;
  name: string;
  email: string | null;
  joinedAt: string;
};

export type ClientOwnerInviteList = {
  contactEmail: string | null;
  ownerOnFile: boolean;
  owners: ClientOwnerOnFile[];
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
    .select("id, name, firm_id, contact_email")
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

export async function assertCanInviteClientOwner(sb: LooseSb, userId: string, clientId: string) {
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
    await assertCanInviteClientOwner(
      context.supabase as unknown as LooseSb,
      context.userId,
      data.clientId,
    );
    return { ok: true as const };
  });

type MembershipRow = {
  id: string;
  user_id: string;
  role: string;
  created_at: string;
};

/** This client's client_owner rows. Service role only after the access check above. */
async function loadClientOwnerMemberships(clientId: string): Promise<MembershipRow[]> {
  const { data, error } = await supabaseAdmin
    .from("client_memberships")
    .select("id, user_id, role, created_at")
    .eq("client_id", clientId)
    .eq("role", "client_owner")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as MembershipRow[];
}

async function ownerProfile(userId: string): Promise<{ fullName: string | null; email: string | null }> {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("email, full_name")
    .eq("id", userId)
    .maybeSingle();
  let email = String(data?.email ?? "").trim() || null;
  let fullName = String(data?.full_name ?? "").trim() || null;
  if (!email || !fullName) {
    try {
      const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
      email = email || (authUser.user?.email ?? "").trim() || null;
      const meta = authUser.user?.user_metadata?.full_name;
      if (!fullName && typeof meta === "string") fullName = meta.trim() || null;
    } catch {
      /* the profile row is enough when auth admin is unavailable */
    }
  }
  return { fullName, email };
}

export const listClientOwnerInvites = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ clientId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<ClientOwnerInviteList> => {
    const client = await assertCanInviteClientOwner(
      context.supabase as unknown as LooseSb,
      context.userId,
      data.clientId,
    );
    const contactEmail =
      String(client.contact_email ?? "")
        .trim()
        .toLowerCase() || null;
    const memberships = await loadClientOwnerMemberships(data.clientId);
    const owners: ClientOwnerOnFile[] = [];
    for (const row of memberships) {
      if (row.role !== "client_owner" || !row.user_id) continue;
      const profile = await ownerProfile(row.user_id);
      const label = clientOwnerLabel(profile);
      owners.push({
        membershipId: row.id,
        userId: row.user_id,
        name: label.name,
        email: label.email,
        joinedAt: row.created_at,
      });
    }
    const now = new Date().toISOString();
    const withEmail = await supabaseAdmin
      .from("invite_tokens")
      .select("id, invited_email, invited_name, created_at, expires_at, token")
      .eq("client_id", data.clientId)
      .eq("purpose", "owner_handoff")
      .is("redeemed_at", null)
      .is("revoked_at", null)
      .gt("expires_at", now)
      .order("created_at", { ascending: false })
      .limit(20);
    let raw: Array<Record<string, unknown>> = [];
    if (
      withEmail.error &&
      /invited_name|revoked_at/.test(withEmail.error.message ?? "")
    ) {
      const retryNamed = await supabaseAdmin
        .from("invite_tokens")
        .select("id, invited_email, created_at, expires_at, token")
        .eq("client_id", data.clientId)
        .eq("purpose", "owner_handoff")
        .is("redeemed_at", null)
        .gt("expires_at", now)
        .order("created_at", { ascending: false })
        .limit(20);
      if (retryNamed.error && (retryNamed.error.message ?? "").includes("invited_email")) {
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
      } else if (retryNamed.error) {
        throw new Error(retryNamed.error.message);
      } else {
        raw = (retryNamed.data ?? []) as Array<Record<string, unknown>>;
      }
    } else if (withEmail.error && (withEmail.error.message ?? "").includes("invited_email")) {
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
        const ownerName = String(row.invited_name ?? "").trim();
        return {
          id: String(row.id),
          email: invited || contactEmail,
          ownerName: ownerName || null,
          createdAt: String(row.created_at ?? ""),
          expiresAt: String(row.expires_at ?? ""),
          url: ownerInviteUrl(token),
        };
      })
      .filter((row): row is PendingOwnerInvite => Boolean(row));
    return {
      contactEmail,
      ownerOnFile: activeClientOwnerOnFile({
        clientId: data.clientId,
        memberships: memberships.map((row) => ({ clientId: data.clientId, role: row.role })),
      }),
      owners,
      pending,
    };
  });

export const revokeClientOwnerInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ clientId: z.string().uuid(), inviteId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertCanInviteClientOwner(
      context.supabase as unknown as LooseSb,
      context.userId,
      data.clientId,
    );
    const revokedAt = new Date().toISOString();
    const expired = new Date(Date.now() - 1000).toISOString();
    const stamped = await supabaseAdmin
      .from("invite_tokens")
      .update({ revoked_at: revokedAt, expires_at: expired })
      .eq("id", data.inviteId)
      .eq("client_id", data.clientId)
      .eq("purpose", "owner_handoff")
      .is("redeemed_at", null)
      .select("id");
    let rows = stamped.data;
    let error = stamped.error;
    if (error && (error.message ?? "").includes("revoked_at")) {
      const tombstone = await supabaseAdmin
        .from("invite_tokens")
        .update({ expires_at: "1970-01-01T00:00:00.000Z" })
        .eq("id", data.inviteId)
        .eq("client_id", data.clientId)
        .eq("purpose", "owner_handoff")
        .is("redeemed_at", null)
        .select("id");
      rows = tombstone.data;
      error = tombstone.error;
    }
    if (error) throw new Error(error.message);
    if (!rows?.length) throw new Error("Invite not found");
    return { ok: true as const };
  });

export const removeClientOwner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ clientId: z.string().uuid(), membershipId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertCanInviteClientOwner(
      context.supabase as unknown as LooseSb,
      context.userId,
      data.clientId,
    );
    const { data: row, error: readErr } = await supabaseAdmin
      .from("client_memberships")
      .select("id, client_id, user_id, role")
      .eq("id", data.membershipId)
      .eq("client_id", data.clientId)
      .eq("role", "client_owner")
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!row) throw new Error("Owner membership not found");
    const { error } = await supabaseAdmin
      .from("client_memberships")
      .delete()
      .eq("id", row.id)
      .eq("client_id", data.clientId)
      .eq("role", "client_owner");
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const resendClientOwnerInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ clientId: z.string().uuid(), inviteId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const visible = await assertCanInviteClientOwner(
      context.supabase as unknown as LooseSb,
      context.userId,
      data.clientId,
    );
    const now = new Date().toISOString();
    const tokenQuery = await supabaseAdmin
      .from("invite_tokens")
      .select("id, token, invited_email, expires_at, redeemed_at, purpose, revoked_at")
      .eq("id", data.inviteId)
      .eq("client_id", data.clientId)
      .eq("purpose", "owner_handoff")
      .maybeSingle();
    let tokenRow: {
      token?: string;
      invited_email?: string | null;
      expires_at?: string | null;
      redeemed_at?: string | null;
      revoked_at?: string | null;
    } | null = null;
    if (tokenQuery.error && (tokenQuery.error.message ?? "").includes("revoked_at")) {
      const retry = await supabaseAdmin
        .from("invite_tokens")
        .select("id, token, invited_email, expires_at, redeemed_at, purpose")
        .eq("id", data.inviteId)
        .eq("client_id", data.clientId)
        .eq("purpose", "owner_handoff")
        .maybeSingle();
      if (retry.error && (retry.error.message ?? "").includes("invited_email")) {
        const again = await supabaseAdmin
          .from("invite_tokens")
          .select("id, token, expires_at, redeemed_at, purpose")
          .eq("id", data.inviteId)
          .eq("client_id", data.clientId)
          .eq("purpose", "owner_handoff")
          .maybeSingle();
        if (again.error) throw new Error(again.error.message);
        tokenRow = again.data;
      } else if (retry.error) {
        throw new Error(retry.error.message);
      } else {
        tokenRow = retry.data;
      }
    } else if (tokenQuery.error && (tokenQuery.error.message ?? "").includes("invited_email")) {
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
    if (row.revoked_at) throw new Error("This invite was revoked");
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
