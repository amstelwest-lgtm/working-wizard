/**
 * Opaque owner-invite tokens — mint from the firm dashboard.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ownerInvitePreviewPayload, type OwnerInvitePreview } from "@/lib/invite-claim";

type AuthedRpc = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
};

export async function mintOwnerInviteToken(opts: {
  clientId: string;
  userId: string;
  supabase: AuthedRpc;
}): Promise<string> {
  const { data: token, error } = await opts.supabase.rpc("mint_owner_invite", {
    p_client_id: opts.clientId,
  });

  if (!error && typeof token === "string" && token.length > 0) {
    return token;
  }

  const msg = error?.message ?? "";
  const missingRpc = msg.includes("does not exist") || error?.code === "42883";
  if (!missingRpc && msg) {
    throw new Error(msg);
  }

  const { data: allowed, error: accessErr } = await supabaseAdmin.rpc("has_client_access", {
    _user_id: opts.userId,
    _client_id: opts.clientId,
  });
  if (accessErr) throw new Error(accessErr.message);
  if (!allowed) throw new Error("No access to this client");

  const raw = crypto.getRandomValues(new Uint8Array(24));
  const tokenHex = Array.from(raw, (b) => b.toString(16).padStart(2, "0")).join("");

  const { error: insErr } = await supabaseAdmin.from("invite_tokens").insert({
    token: tokenHex,
    client_id: opts.clientId,
    created_by: opts.userId,
    purpose: "owner_handoff",
  });
  if (insErr) {
    if ((insErr.message ?? "").includes("does not exist")) {
      throw new Error(
        "Invite tokens table missing — run migration 20260818120000_founder_pilot_roles_invites.sql in Supabase.",
      );
    }
    throw new Error(insErr.message);
  }
  return tokenHex;
}

export const mintOwnerInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ clientId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const token = await mintOwnerInviteToken({
      clientId: data.clientId,
      userId: context.userId,
      supabase: context.supabase as unknown as AuthedRpc,
    });
    return { token };
  });

type PreviewClient = {
  name: string;
  firm_id: string | null;
  client_code: string | null;
};

/** Name, firm id, and code. The code is for the server gate only — never the response. */
async function loadPreviewClient(clientId: string): Promise<PreviewClient> {
  const first = await supabaseAdmin
    .from("clients")
    .select("name, firm_id, client_code")
    .eq("id", clientId)
    .maybeSingle();
  if (first.error && (first.error.message ?? "").includes("client_code")) {
    const retry = await supabaseAdmin
      .from("clients")
      .select("name, firm_id")
      .eq("id", clientId)
      .maybeSingle();
    if (retry.error) throw new Error(retry.error.message);
    if (!retry.data) throw new Error("Invite link is invalid — client not found.");
    return {
      name: retry.data.name as string,
      firm_id: retry.data.firm_id ?? null,
      client_code: null,
    };
  }
  if (first.error) throw new Error(first.error.message);
  if (!first.data) throw new Error("Invite link is invalid — client not found.");
  return {
    name: first.data.name as string,
    firm_id: first.data.firm_id ?? null,
    client_code: (first.data as { client_code?: string | null }).client_code ?? null,
  };
}

/** Practice display name only. A missing firm does not block the invite. */
async function loadInvitingFirmName(firmId: string | null): Promise<string | null> {
  if (!firmId) return null;
  const { data, error } = await supabaseAdmin
    .from("firms")
    .select("name")
    .eq("id", firmId)
    .maybeSingle();
  if (error || !data) return null;
  const name = String(data.name ?? "").trim();
  return name || null;
}

/**
 * Public: resolve an invite token to the business name and inviting firm.
 * Does not redeem. Does not return the client code or any other firm/client columns.
 */
export const previewOwnerInvite = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ token: z.string().trim().min(8).max(80) }).parse(input))
  .handler(async ({ data }): Promise<OwnerInvitePreview> => {
    const { resolveInviteToClientId } = await import("@/lib/invite-tokens.resolve");
    const { assertOwnerHandoffPurpose } = await import("@/lib/accountant-invite");
    const resolved = await resolveInviteToClientId(data.token);
    assertOwnerHandoffPurpose(resolved.purpose);
    const client = await loadPreviewClient(resolved.clientId);
    const firmName = await loadInvitingFirmName(client.firm_id);
    return ownerInvitePreviewPayload({
      clientName: client.name,
      firmName,
      legacy: resolved.legacy,
      tokenId: resolved.tokenId,
      clientCode: client.client_code,
    });
  });
