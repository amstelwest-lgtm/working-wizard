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

const inviteTokens = () => supabaseAdmin.from("invite_tokens");

function isMissingRelation(err: unknown): boolean {
  const msg =
    err && typeof err === "object" && "message" in err
      ? String((err as { message: unknown }).message ?? "")
      : err instanceof Error
        ? err.message
        : String(err ?? "");
  return msg.includes("does not exist") || msg.includes("relation") || msg.includes("schema cache");
}

async function resolveLegacyUuid(trimmed: string): Promise<{
  clientId: string;
  tokenId: null;
  legacy: true;
}> {
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id")
    .eq("id", trimmed)
    .maybeSingle();
  if (!client) throw new Error("Invite link is invalid — client not found.");
  // Soft-deprecation: still works so old clipboard links don't brick, but
  // firm dashboards should mint opaque tokens going forward.
  console.warn(
    "[invite] legacy client-UUID invite accepted — remint an opaque token from the firm dashboard",
  );
  return { clientId: client.id, tokenId: null, legacy: true };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeClientCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function clientCodesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return normalizeClientCode(a) === normalizeClientCode(b);
}

/** Resolve an invite token (or legacy client UUID) to a client id. */
export async function resolveInviteToClientId(invite: string): Promise<{
  clientId: string;
  tokenId: string | null;
  /** True when the invite was a raw client UUID (deprecated path). */
  legacy?: boolean;
}> {
  const trimmed = invite.trim();
  if (!trimmed) throw new Error("Invite link is invalid.");

  const { data, error } = await inviteTokens()
    .select("id, client_id, expires_at, redeemed_at")
    .eq("token", trimmed)
    .maybeSingle();

  if (error) {
    if (isMissingRelation(error)) {
      // Migration not applied — allow legacy UUID invites only.
      if (UUID_RE.test(trimmed)) return resolveLegacyUuid(trimmed);
      throw new Error(
        "Invite system not ready — run migration 20260818120000_founder_pilot_roles_invites.sql.",
      );
    }
    throw new Error(error.message);
  }

  if (data) {
    const row = data as InviteTokenRow;
    if (row.redeemed_at) throw new Error("This invite has already been used.");
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
      throw new Error("This invite has expired. Ask your accountant for a new link.");
    }
    return { clientId: row.client_id, tokenId: row.id };
  }

  // Token table exists but no row — try legacy UUID clipboard links.
  if (UUID_RE.test(trimmed)) return resolveLegacyUuid(trimmed);

  throw new Error("Invite link is invalid.");
}

export async function markInviteRedeemed(tokenId: string | null, userId: string) {
  if (!tokenId) return;
  const { data, error } = await inviteTokens()
    .update({
      redeemed_at: new Date().toISOString(),
      redeemed_by: userId,
    })
    .eq("id", tokenId)
    .is("redeemed_at", null)
    .select("id");

  if (error) {
    if (isMissingRelation(error)) return;
    throw new Error(`Invite redeem failed: ${error.message}`);
  }
  if (!data || (Array.isArray(data) && data.length === 0)) {
    throw new Error("This invite has already been used.");
  }
}

/** Claim an invite before creating the user (prevents double-redeem races). */
export async function claimInviteToken(tokenId: string | null): Promise<void> {
  if (!tokenId) return;
  const { data, error } = await inviteTokens()
    .update({ redeemed_at: new Date().toISOString() })
    .eq("id", tokenId)
    .is("redeemed_at", null)
    .select("id");

  if (error) {
    if (isMissingRelation(error)) return;
    throw new Error(`Invite claim failed: ${error.message}`);
  }
  if (!data || (Array.isArray(data) && data.length === 0)) {
    throw new Error("This invite has already been used.");
  }
}

/** Release a provisional claim if signup fails after claimInviteToken. */
export async function releaseInviteToken(tokenId: string | null): Promise<void> {
  if (!tokenId) return;
  try {
    await inviteTokens()
      .update({ redeemed_at: null, redeemed_by: null })
      .eq("id", tokenId)
      .is("redeemed_by", null);
  } catch {
    /* best-effort */
  }
}

/** Attach the redeeming user after a successful claim + signup. */
export async function attachInviteRedeemer(tokenId: string | null, userId: string): Promise<void> {
  if (!tokenId) return;
  try {
    await inviteTokens().update({ redeemed_by: userId }).eq("id", tokenId);
  } catch {
    /* best-effort */
  }
}
