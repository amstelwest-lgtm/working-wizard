/**
 * Owner-invite claim rules. Pure: no Supabase, safe for the join page and tests.
 *
 * An opaque invite token is the credential: 24 random bytes (192 bits), unique,
 * single-use (`redeemed_at`), expiring (14 days), and revocable. Revoke sets
 * `revoked_at`. A past `expires_at` with no revoke mark is still expiry.
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

export type InviteTokenBlock = "used" | "expired" | "revoked";

export const INVITE_USED_MESSAGE = "This invite was already used, sign in";
export const INVITE_REVOKED_MESSAGE =
  "This invite was revoked, ask your accountant for a new link";
export const INVITE_EXPIRED_MESSAGE =
  "This invite has expired. Ask your accountant for a new link.";

/**
 * Epoch-style expiry written when `revoked_at` is not on the row yet.
 * A natural 14-day expiry is never this old.
 */
const REVOKE_TOMBSTONE_MS = Date.parse("1980-01-01T00:00:00.000Z");

export function inviteRevokeTombstone(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false;
  const at = new Date(expiresAt).getTime();
  return !Number.isNaN(at) && at <= REVOKE_TOMBSTONE_MS;
}

/**
 * Used wins. A real revoke is `revoked_at`, or an epoch tombstone when that
 * column is missing. `expires_at` a second ago with no revoke mark is expiry:
 * that used to be how revoke was stored, and it is not a client_owner.
 */
export function inviteTokenUnusableReason(
  row: { redeemed_at: string | null; expires_at: string | null; revoked_at?: string | null },
  now = Date.now(),
): InviteTokenBlock | null {
  if (row.redeemed_at) return "used";
  if (row.revoked_at || inviteRevokeTombstone(row.expires_at)) return "revoked";
  if (row.expires_at && new Date(row.expires_at).getTime() < now) return "expired";
  return null;
}

export function inviteTokenUnusableMessage(reason: InviteTokenBlock): string {
  if (reason === "used") return INVITE_USED_MESSAGE;
  if (reason === "revoked") return INVITE_REVOKED_MESSAGE;
  return INVITE_EXPIRED_MESSAGE;
}

/** Revoked and used invites show the message and a Sign in button, not the sign-up form. */
export function inviteJoinHidesSignup(message: string | null | undefined): boolean {
  const text = (message ?? "").trim();
  if (!text) return false;
  return text.includes(INVITE_USED_MESSAGE) || text.includes(INVITE_REVOKED_MESSAGE);
}

/**
 * Reject a token row. The same user who already redeemed it may retry
 * (Google callback remount). Everyone else, including a revoke tombstone, is refused.
 */
export function assertInviteTokenUsable(
  row: {
    redeemed_at: string | null;
    expires_at: string | null;
    redeemed_by?: string | null;
    revoked_at?: string | null;
  },
  opts?: { redeemedByUserId?: string; now?: number },
): { alreadyRedeemedByCaller: boolean } {
  const reason = inviteTokenUnusableReason(row, opts?.now);
  if (reason === "used") {
    if (opts?.redeemedByUserId && row.redeemed_by && row.redeemed_by === opts.redeemedByUserId) {
      return { alreadyRedeemedByCaller: true };
    }
    throw new Error(inviteTokenUnusableMessage("used"));
  }
  if (reason) throw new Error(inviteTokenUnusableMessage(reason));
  return { alreadyRedeemedByCaller: false };
}

export type OwnerInvitePreview = {
  clientName: string;
  /** Inviting practice display name. Nothing else from the firm row. */
  firmName: string | null;
  requiresClientCode: boolean;
  /** Name typed on the invite. An email address is not shown. */
  inviteeName: string | null;
};

/** Public preview. The client code stays on the server. */
export function ownerInvitePreviewPayload(input: {
  clientName: string;
  firmName: string | null | undefined;
  legacy?: boolean;
  tokenId: string | null;
  clientCode: string | null | undefined;
  inviteeName?: string | null;
}): OwnerInvitePreview {
  return {
    clientName: input.clientName,
    firmName: input.firmName?.trim() || null,
    requiresClientCode: ownerInviteRequiresClientCode({
      kind: ownerInviteClaimKind(input),
      clientCode: input.clientCode,
    }),
    inviteeName: publicPersonName(input.inviteeName),
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

/** Join-page greeting. A stored owner name is a hello in front of the lead. */
export function ownerInviteGreeting(input: {
  firmName: string | null | undefined;
  clientName: string | null | undefined;
  inviteeName?: string | null;
}): string {
  const lead = ownerInviteLead(input.firmName, input.clientName);
  const person = publicPersonName(input.inviteeName);
  if (!person) return lead;
  return `Hi ${person}. ${lead}`;
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
