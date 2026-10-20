/**
 * Owner-invite claim rules. Pure: no Supabase, safe for the join page and tests.
 *
 * An opaque invite token is the credential: 24 random bytes (192 bits), unique,
 * single-use (`redeemed_at`), expiring (14 days), and revocable. Revoke (#659)
 * writes `expires_at` into the past, which this module rejects as expired.
 *
 * `clients.client_code` (MLN-XXXXXX) is a short public identifier (~30 bits),
 * shown on the practice board. It is not a second factor for a live token.
 * A legacy client-UUID claim has no token row, so that path still requires the
 * code when the client has one. The code value is never returned to the browser.
 */

export function normalizeClientCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function clientCodesMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return false;
  return normalizeClientCode(a) === normalizeClientCode(b);
}

export type OwnerInviteClaimKind = "token" | "legacy";

/** A row in invite_tokens is a token claim. A bare client UUID is the code path. */
export function ownerInviteClaimKind(input: {
  legacy?: boolean;
  tokenId: string | null;
}): OwnerInviteClaimKind {
  if (input.legacy || !input.tokenId) return "legacy";
  return "token";
}

/** Token invites never ask for the code. The legacy UUID path does, when one is on file. */
export function ownerInviteRequiresClientCode(input: {
  kind: OwnerInviteClaimKind;
  clientCode: string | null | undefined;
}): boolean {
  if (input.kind === "token") return false;
  return Boolean(input.clientCode?.trim());
}

const CODE_REQUIRED = "Enter the client code from your accountant (MLN-XXXXXX).";
const CODE_MISMATCH = "That client code does not match this invite. Check the email and try again.";

/**
 * Server-side gate. A live token joins with no submitted code (a wrong code
 * from the client is ignored). A legacy UUID still has to match the code.
 */
export function evaluateOwnerInviteClaim(input: {
  legacy?: boolean;
  tokenId: string | null;
  clientCode: string | null | undefined;
  submittedCode?: string | null;
}): void {
  if (
    !ownerInviteRequiresClientCode({
      kind: ownerInviteClaimKind(input),
      clientCode: input.clientCode,
    })
  ) {
    return;
  }
  if (!input.submittedCode?.trim()) throw new Error(CODE_REQUIRED);
  if (!clientCodesMatch(input.clientCode, input.submittedCode)) throw new Error(CODE_MISMATCH);
}

export type InviteTokenBlock = "used" | "expired";

/**
 * Used wins over expired. A revoke tombstone is `expires_at` in the past with
 * `redeemed_at` still null, so it comes back as expired.
 */
export function inviteTokenUnusableReason(
  row: { redeemed_at: string | null; expires_at: string | null },
  now = Date.now(),
): InviteTokenBlock | null {
  if (row.redeemed_at) return "used";
  if (row.expires_at && new Date(row.expires_at).getTime() < now) return "expired";
  return null;
}

export function inviteTokenUnusableMessage(reason: InviteTokenBlock): string {
  if (reason === "used") return "This invite has already been used.";
  return "This invite has expired. Ask your accountant for a new link.";
}

/**
 * Reject a token row. The same user who already redeemed it may retry
 * (Google callback remount). Everyone else, including a revoke tombstone, is refused.
 */
export function assertInviteTokenUsable(
  row: { redeemed_at: string | null; expires_at: string | null; redeemed_by?: string | null },
  opts?: { redeemedByUserId?: string; now?: number },
): { alreadyRedeemedByCaller: boolean } {
  const reason = inviteTokenUnusableReason(row, opts?.now);
  if (reason === "used") {
    if (opts?.redeemedByUserId && row.redeemed_by && row.redeemed_by === opts.redeemedByUserId) {
      return { alreadyRedeemedByCaller: true };
    }
    throw new Error(inviteTokenUnusableMessage("used"));
  }
  if (reason === "expired") throw new Error(inviteTokenUnusableMessage("expired"));
  return { alreadyRedeemedByCaller: false };
}

export type OwnerInvitePreview = {
  clientName: string;
  /** Inviting practice display name. Nothing else from the firm row. */
  firmName: string | null;
  requiresClientCode: boolean;
};

/** Public preview. The client code stays on the server. */
export function ownerInvitePreviewPayload(input: {
  clientName: string;
  firmName: string | null | undefined;
  legacy?: boolean;
  tokenId: string | null;
  clientCode: string | null | undefined;
}): OwnerInvitePreview {
  return {
    clientName: input.clientName,
    firmName: input.firmName?.trim() || null,
    requiresClientCode: ownerInviteRequiresClientCode({
      kind: ownerInviteClaimKind(input),
      clientCode: input.clientCode,
    }),
  };
}

/** "Ben Accountants invited you to join Northwind". Falls back to "Your accountant". */
export function ownerInviteLead(
  firmName: string | null | undefined,
  clientName: string | null | undefined,
): string {
  const who = firmName?.trim() || "Your accountant";
  const client = clientName?.trim();
  if (client) return `${who} invited you to join ${client}`;
  return `${who} invited you to join your business workspace`;
}

/** A person's name for an anonymous page. An email address is not a name. */
export function publicPersonName(raw: string | null | undefined): string | null {
  const name = (raw ?? "").trim();
  if (!name || name.includes("@")) return null;
  return name.slice(0, 80);
}

export type AccountantInvitePreview = {
  clientName: string;
  invitedEmail: string | null;
  /** Inviting owner's display name. Never their email or user id. */
  inviterName: string | null;
};

export function accountantInvitePreviewPayload(input: {
  clientName: string;
  invitedEmail: string | null | undefined;
  ownerName: string | null | undefined;
}): AccountantInvitePreview {
  return {
    clientName: input.clientName,
    invitedEmail: input.invitedEmail?.trim() || null,
    inviterName: publicPersonName(input.ownerName),
  };
}

/** Owner → accountant join. Names the owner; the business name is the fallback. */
export function accountantInviteLead(input: {
  inviterName: string | null | undefined;
  clientName: string | null | undefined;
}): string {
  const who = publicPersonName(input.inviterName);
  const client = input.clientName?.trim();
  if (who && client) return `${who} invited you to join ${client}`;
  if (client) return `${client} invited you as their accountant`;
  return "A business owner invited you as their accountant";
}
