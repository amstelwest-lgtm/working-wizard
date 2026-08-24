/**
 * Mint an owner-invite, draft the email (Claude, with template fallback),
 * optionally send it, always return a paste-ready message.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mintOwnerInviteToken } from "@/lib/invite-tokens.functions";
import {
  draftOwnerInviteEmail,
  invitePasteText,
  inviteSiteUrl,
  sendInviteViaResend,
} from "@/lib/client-invite-email";

const emailSchema = z.string().trim().email().max(200).optional().nullable();

export type OwnerInviteResult = {
  token: string;
  url: string;
  subject: string;
  body: string;
  pasteText: string;
  draftedBy: "claude" | "template";
  emailed: boolean;
  email: string | null;
  sendError: string | null;
};

function claimsEmailOf(claims: unknown): string | null {
  if (claims && typeof claims === "object" && "email" in claims) {
    const email = (claims as { email?: unknown }).email;
    return typeof email === "string" && email.includes("@") ? email : null;
  }
  return null;
}

export const inviteClientOwner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        clientId: z.string().uuid(),
        toEmail: emailSchema,
        sendEmail: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<OwnerInviteResult> => {
    const userId = context.userId;
    const token = await mintOwnerInviteToken({
      clientId: data.clientId,
      userId,
      supabase: context.supabase as unknown as {
        rpc: (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
      },
    });
    const url = `${inviteSiteUrl()}/?invite=${token}&mode=signup`;

    let client: {
      id: string;
      name: string;
      contact_email: string | null;
      firm_id: string | null;
      client_code?: string | null;
    } | null = null;

    const first = await supabaseAdmin
      .from("clients")
      .select("id, name, client_code, contact_email, firm_id")
      .eq("id", data.clientId)
      .maybeSingle();
    if (first.error && (first.error.message ?? "").includes("client_code")) {
      const retry = await supabaseAdmin
        .from("clients")
        .select("id, name, contact_email, firm_id")
        .eq("id", data.clientId)
        .maybeSingle();
      if (retry.error) throw new Error(retry.error.message);
      client = retry.data ? { ...retry.data, client_code: null } : null;
    } else if (first.error) {
      throw new Error(first.error.message);
    } else {
      client = first.data;
    }
    if (!client) throw new Error("Client not found");

    let firmName = "";
    let accountantName = "";
    let accountantEmail: string | null = null;
    if (client.firm_id) {
      const { data: firm } = await supabaseAdmin
        .from("firms")
        .select("name, brand_contact_name, brand_contact_email")
        .eq("id", client.firm_id)
        .maybeSingle();
      firmName = (firm?.name ?? "").trim();
      accountantName = (firm?.brand_contact_name ?? "").trim();
      accountantEmail = (firm?.brand_contact_email ?? "").trim() || null;
    }

    const claimsEmail = claimsEmailOf(context.claims);
    let metaName = "";
    let userEmail = claimsEmail;
    try {
      const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
      metaName = (authUser.user?.user_metadata?.full_name as string | undefined)?.trim() ?? "";
      userEmail = (authUser.user?.email ?? "").trim() || claimsEmail;
    } catch {
      /* brand + claims are enough to draft */
    }
    if (!accountantName) accountantName = metaName || userEmail || "Your accountant";
    if (!accountantEmail) accountantEmail = userEmail;

    const toEmail = (data.toEmail || client.contact_email || "").trim().toLowerCase() || null;
    const shouldSend = data.sendEmail !== false && Boolean(toEmail);

    const draft = await draftOwnerInviteEmail({
      clientName: client.name,
      clientCode: client.client_code ?? null,
      inviteUrl: url,
      firmName,
      accountantName,
      accountantEmail,
    });

    if (toEmail && toEmail !== (client.contact_email ?? "").toLowerCase()) {
      await supabaseAdmin.from("clients").update({ contact_email: toEmail }).eq("id", client.id);
    }

    let emailed = false;
    let sendError: string | null = null;
    if (shouldSend && toEmail) {
      const sent = await sendInviteViaResend({
        to: toEmail,
        subject: draft.subject,
        body: draft.body,
        replyTo: accountantEmail,
        idempotencyKey: `owner-invite-${client.id}-${token.slice(0, 16)}`,
      });
      if (sent.ok) emailed = true;
      else sendError = sent.error;
    }

    return {
      token,
      url,
      subject: draft.subject,
      body: draft.body,
      pasteText: invitePasteText(draft.subject, draft.body),
      draftedBy: draft.draftedBy,
      emailed,
      email: toEmail,
      sendError,
    };
  });

/** Send an already-drafted invite (same token/body) after the accountant types an email. */
export const sendDraftedOwnerInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        clientId: z.string().uuid(),
        toEmail: z.string().trim().email().max(200),
        subject: z.string().trim().min(1).max(200),
        body: z.string().trim().min(1).max(8000),
        token: z.string().min(8).max(80),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: client, error } = await supabaseAdmin
      .from("clients")
      .select("id, contact_email, firm_id")
      .eq("id", data.clientId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!client) throw new Error("Client not found");

    await supabaseAdmin
      .from("clients")
      .update({ contact_email: data.toEmail.toLowerCase() })
      .eq("id", data.clientId);

    let replyTo: string | null = null;
    if (client.firm_id) {
      const { data: firm } = await supabaseAdmin
        .from("firms")
        .select("brand_contact_email")
        .eq("id", client.firm_id)
        .maybeSingle();
      replyTo = (firm?.brand_contact_email ?? "").trim() || null;
    }
    if (!replyTo) {
      replyTo = claimsEmailOf(context.claims);
      try {
        const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(context.userId);
        replyTo = (authUser.user?.email ?? "").trim() || replyTo;
      } catch {
        /* keep claims email */
      }
    }

    const sent = await sendInviteViaResend({
      to: data.toEmail.toLowerCase(),
      subject: data.subject,
      body: data.body,
      replyTo,
      idempotencyKey: `owner-invite-${data.clientId}-${data.token.slice(0, 16)}`,
    });
    if (!sent.ok) throw new Error(sent.error);
    return { emailed: true as const, email: data.toEmail.toLowerCase() };
  });
