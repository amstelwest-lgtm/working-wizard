/**
 * Owner mints an accountant invite; public preview + redeem stay off the
 * owner-handoff `/?invite=` path.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  accountantInviteLandingPath,
  assertAccountantLinkPurpose,
  templateAccountantInviteDraft,
} from "@/lib/accountant-invite";
import {
  acceptAccountantInviteForUser,
  signUpInvitedAccountant,
} from "@/lib/accountant-invite.server";
import { invitePasteText, inviteSiteUrl, sendInviteViaResend } from "@/lib/client-invite-email";
import { resolveInviteToClientId } from "@/lib/invite-tokens.resolve";

const emailSchema = z.string().trim().email().max(200);

type AuthedRpc = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
};

function claimsEmailOf(claims: unknown): string | null {
  if (claims && typeof claims === "object" && "email" in claims) {
    const email = (claims as { email?: unknown }).email;
    return typeof email === "string" && email.includes("@") ? email : null;
  }
  return null;
}

export async function mintAccountantInviteToken(opts: {
  clientId: string;
  userId: string;
  email: string;
  supabase: AuthedRpc;
}): Promise<string> {
  const to = opts.email.trim().toLowerCase();
  const { data: token, error } = await opts.supabase.rpc("mint_accountant_invite", {
    p_client_id: opts.clientId,
    p_email: to,
  });

  if (!error && typeof token === "string" && token.length > 0) {
    return token;
  }

  const msg = error?.message ?? "";
  const missingRpc = msg.includes("does not exist") || error?.code === "42883";
  if (!missingRpc && msg) throw new Error(msg);

  const { data: client, error: clientErr } = await supabaseAdmin
    .from("clients")
    .select("id, owner_user_id, firm_id")
    .eq("id", opts.clientId)
    .maybeSingle();
  if (clientErr) throw new Error(clientErr.message);
  if (!client) throw new Error("Client not found");
  if (client.owner_user_id !== opts.userId) {
    throw new Error("Only the business owner can invite an accountant");
  }
  if (client.firm_id) {
    throw new Error("This workspace is already linked to a practice");
  }

  const raw = crypto.getRandomValues(new Uint8Array(24));
  const tokenHex = Array.from(raw, (b) => b.toString(16).padStart(2, "0")).join("");
  const row: Record<string, unknown> = {
    token: tokenHex,
    client_id: opts.clientId,
    created_by: opts.userId,
    purpose: "accountant_link",
    invited_email: to,
  };
  const { error: insErr } = await supabaseAdmin.from("invite_tokens").insert(row);
  if (insErr) {
    if ((insErr.message ?? "").includes("invited_email")) {
      delete row.invited_email;
      const retry = await supabaseAdmin.from("invite_tokens").insert(row);
      if (retry.error) throw new Error(retry.error.message);
      return tokenHex;
    }
    if ((insErr.message ?? "").includes("accountant_link")) {
      throw new Error(
        "Invite purpose accountant_link missing — run migration 20260911010000_owner_invite_accountant.sql.",
      );
    }
    throw new Error(insErr.message);
  }
  return tokenHex;
}

export type AccountantInviteMintResult = {
  token: string;
  url: string;
  subject: string;
  body: string;
  pasteText: string;
  emailed: boolean;
  email: string;
  sendError: string | null;
};

export const inviteAccountant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ clientId: z.string().uuid(), toEmail: emailSchema }).parse(input),
  )
  .handler(async ({ data, context }): Promise<AccountantInviteMintResult> => {
    const token = await mintAccountantInviteToken({
      clientId: data.clientId,
      userId: context.userId,
      email: data.toEmail,
      supabase: context.supabase as unknown as AuthedRpc,
    });
    const url = `${inviteSiteUrl()}${accountantInviteLandingPath(token)}`;

    const { data: client, error } = await supabaseAdmin
      .from("clients")
      .select("id, name, owner_user_id")
      .eq("id", data.clientId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!client) throw new Error("Client not found");

    let ownerName = "";
    try {
      const { data: owner } = await supabaseAdmin.auth.admin.getUserById(client.owner_user_id);
      ownerName =
        (owner.user?.user_metadata?.full_name as string | undefined)?.trim() ||
        (owner.user?.email ?? "").trim();
    } catch {
      ownerName = claimsEmailOf(context.claims) ?? "";
    }

    const draft = templateAccountantInviteDraft({
      clientName: client.name,
      ownerName,
      inviteUrl: url,
    });

    const toEmail = data.toEmail.trim().toLowerCase();
    const sent = await sendInviteViaResend({
      to: toEmail,
      subject: draft.subject,
      body: draft.body,
      replyTo: claimsEmailOf(context.claims),
      idempotencyKey: `accountant-invite-${client.id}-${token.slice(0, 16)}`,
    });

    return {
      token,
      url,
      subject: draft.subject,
      body: draft.body,
      pasteText: invitePasteText(draft.subject, draft.body),
      emailed: sent.ok,
      email: toEmail,
      sendError: sent.ok ? null : sent.error,
    };
  });

export const accountantInviteStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ clientId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: client, error } = await supabaseAdmin
      .from("clients")
      .select("id, name, owner_user_id, firm_id")
      .eq("id", data.clientId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!client) throw new Error("Client not found");
    if (client.owner_user_id !== context.userId) {
      throw new Error("Only the business owner can manage this invite");
    }

    let firmName: string | null = null;
    if (client.firm_id) {
      const { data: firm } = await supabaseAdmin
        .from("firms")
        .select("name")
        .eq("id", client.firm_id)
        .maybeSingle();
      firmName = (firm?.name ?? "").trim() || "your practice";
    }

    let pendingEmail: string | null = null;
    if (!client.firm_id) {
      const pending = await supabaseAdmin
        .from("invite_tokens")
        .select("invited_email, created_at")
        .eq("client_id", client.id)
        .eq("purpose", "accountant_link")
        .is("redeemed_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!pending.error) {
        pendingEmail = (pending.data as { invited_email?: string | null } | null)?.invited_email ?? null;
      }
    }

    return {
      clientId: client.id,
      clientName: client.name,
      firmLinked: Boolean(client.firm_id),
      firmName,
      pendingEmail,
    };
  });

export const previewAccountantInvite = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ token: z.string().trim().min(8).max(80) }).parse(input))
  .handler(async ({ data }) => {
    const resolved = await resolveInviteToClientId(data.token);
    assertAccountantLinkPurpose(resolved.purpose);
    if (resolved.legacy) throw new Error("This accountant invite link is invalid.");
    const { data: client, error } = await supabaseAdmin
      .from("clients")
      .select("name")
      .eq("id", resolved.clientId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!client) throw new Error("Invite link is invalid — client not found.");
    return {
      clientName: client.name as string,
      invitedEmail: resolved.invitedEmail ?? null,
    };
  });

export const acceptAccountantInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        token: z.string().trim().min(8).max(80),
        firmName: z.string().trim().max(80).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    return acceptAccountantInviteForUser({
      userId: context.userId,
      token: data.token,
      firmName: data.firmName,
    });
  });

export const signUpAccountantInvite = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        token: z.string().trim().min(8).max(80),
        email: emailSchema,
        password: z.string().min(6).max(200),
        fullName: z.string().trim().max(80).optional(),
        firmName: z.string().trim().max(80).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    return signUpInvitedAccountant({
      email: data.email,
      password: data.password,
      fullName: data.fullName,
      token: data.token,
      firmName: data.firmName,
    });
  });
