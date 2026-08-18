/**
 * Resolve / redeem opaque invite tokens (service role).
 * Kept separate from the mint server fn so invite-member.server stays free of
 * createServerFn imports.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";

type InviteTokenRow = {
  id: string;
  client_id: string;
  expires_at: string | null;
  redeemed_at: string | null;
};

// Table added by migration 20260818120000 — may precede generated Database types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const inviteTokens = () => (supabaseAdmin as any).from("invite_tokens");

/** Resolve an invite token (or legacy client UUID) to a client id. */
export async function resolveInviteToClientId(invite: string): Promise<{
  clientId: string;
  tokenId: string | null;
}> {
  const trimmed = invite.trim();
  if (!trimmed) throw new Error("Invite link is invalid.");

  try {
    const { data, error } = await inviteTokens()
      .select("id, client_id, expires_at, redeemed_at")
      .eq("token", trimmed)
      .maybeSingle();

    if (!error && data) {
      const row = data as InviteTokenRow;
      if (row.redeemed_at) throw new Error("This invite has already been used.");
      if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
        throw new Error("This invite has expired. Ask your accountant for a new link.");
      }
      return { clientId: row.client_id, tokenId: row.id };
    }

    if (error && !(error.message ?? "").includes("does not exist")) {
      // Fall through to legacy UUID only when table is missing.
      const msg = error.message ?? "";
      if (!msg.includes("relation") && !msg.includes("schema cache")) {
        console.warn("[invite] token lookup:", msg);
      }
    }
  } catch (err) {
    console.warn("[invite] token lookup failed", err);
  }

  // Legacy UUID invite (links minted before invite_tokens). Still accepted.
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (uuidRe.test(trimmed)) {
    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("id")
      .eq("id", trimmed)
      .maybeSingle();
    if (!client) throw new Error("Invite link is invalid — client not found.");
    return { clientId: client.id, tokenId: null };
  }

  throw new Error("Invite link is invalid.");
}

export async function markInviteRedeemed(tokenId: string | null, userId: string) {
  if (!tokenId) return;
  try {
    await inviteTokens()
      .update({
        redeemed_at: new Date().toISOString(),
        redeemed_by: userId,
      })
      .eq("id", tokenId)
      .is("redeemed_at", null);
  } catch (err) {
    console.warn("[invite] mark redeemed failed", err);
  }
}
