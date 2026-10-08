/**
 * Staff-invite landing decisions. Pure: no Supabase, no firm signup, no billing.
 * Acceptance itself stays on redeemAccessToken.
 */

export const STAFF_INVITE_INVALID_MESSAGE =
  "This invite is no longer valid. Ask your firm admin to send a new one.";

export const STAFF_INVITE_USED_MESSAGE = "This link has already been used.";

export type StaffInvitePhase =
  | "invalid"
  | "used"
  | "mismatch"
  | "auto_accept"
  | "create"
  | "signin";

export function emailsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = (a ?? "").trim().toLowerCase();
  const right = (b ?? "").trim().toLowerCase();
  return left.length > 0 && left === right;
}

/**
 * What /access/:token shows for a firm_staff_invites link.
 * Expired and revoked (tombstoned as expired) invites are invalid.
 * A signed-in address that is not the invited one never auto-accepts.
 */
export function staffInvitePhase(input: {
  expired: boolean;
  used: boolean;
  accountExists: boolean;
  signedInEmail: string | null;
  invitedEmail: string | null;
}): StaffInvitePhase {
  if (input.expired) return "invalid";
  if (input.used) return "used";
  const invited = (input.invitedEmail ?? "").trim();
  if (input.signedInEmail?.trim()) {
    if (!emailsMatch(input.signedInEmail, invited)) return "mismatch";
    return "auto_accept";
  }
  return input.accountExists ? "signin" : "create";
}

/** Confirmation and Google return. Only an /access path is accepted. */
export function callbackNextParam(search: string): string | undefined {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const next = new URLSearchParams(raw).get("next");
  if (!next || !next.startsWith("/access/") || next.startsWith("//")) return undefined;
  if (next.includes("\\") || next.includes("://") || next.includes("@")) return undefined;
  return next;
}

export function staffInviteCallbackPath(token: string): string {
  return `/auth/callback?next=${encodeURIComponent(`/access/${token}`)}`;
}

export function staffInviteEmailRedirectTo(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}${staffInviteCallbackPath(token)}`;
}

export function staffInviteSignOutLabel(email: string): string {
  return `Sign out and use ${email.trim()}`;
}
