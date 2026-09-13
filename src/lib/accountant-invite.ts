/**
 * Owner → accountant invite: pure helpers (URL, email copy, redeem plan).
 * Distinct from firm→owner handoff (`/?invite=&mode=signup`).
 */

export const ACCOUNTANT_INVITE_PURPOSE = "accountant_link" as const;

export type AccountantLinkPlan =
  | { kind: "reject_self" }
  | { kind: "reject_other_firm"; firmId: string }
  | { kind: "already_on_firm"; firmId: string }
  | { kind: "link_existing_firm"; firmId: string }
  | { kind: "create_firm" };

export function accountantInviteLandingPath(token: string): string {
  return `/join/${encodeURIComponent(token.trim())}`;
}

export function accountantInviteTokenFromPath(pathname: string): string | null {
  const pathOnly = pathname.split("?")[0] ?? pathname;
  const m = pathOnly.match(/^\/join\/([^/]+)$/);
  const token = m?.[1] ? decodeURIComponent(m[1]).trim() : "";
  return token || null;
}

/** Accountant join carried on `/auth/callback?join=` (OAuth redirectTo). */
export function accountantJoinFromCallbackSearch(search: string): string | null {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  if (!raw) return null;
  const token = new URLSearchParams(raw).get("join")?.trim() ?? "";
  return token || null;
}

/** Google `next` that points at `/join/:token`. */
export function accountantJoinTokenFromNext(next: string | undefined): string | null {
  if (!next || !next.startsWith("/")) return null;
  const path = next.split("?")[0] ?? next;
  return accountantInviteTokenFromPath(path);
}

export function defaultPracticeName(email: string, override?: string | null): string {
  const named = override?.trim();
  if (named) return named.slice(0, 80);
  const domain = email.split("@")[1]?.split(".")[0]?.trim() ?? "";
  if (!domain) return "Practice";
  return `${domain.charAt(0).toUpperCase()}${domain.slice(1)}`;
}

/**
 * Decide how redeem should link firm↔client.
 * Never transfers clients.owner_user_id. Never treats the invitee as a second owner.
 */
export function planAccountantLink(input: {
  clientOwnerUserId: string;
  clientFirmId: string | null;
  redeemerUserId: string;
  redeemerFirmId: string | null;
}): AccountantLinkPlan {
  if (input.redeemerUserId === input.clientOwnerUserId) return { kind: "reject_self" };
  if (input.clientFirmId) {
    if (input.redeemerFirmId && input.redeemerFirmId === input.clientFirmId) {
      return { kind: "already_on_firm", firmId: input.clientFirmId };
    }
    return { kind: "reject_other_firm", firmId: input.clientFirmId };
  }
  if (input.redeemerFirmId) {
    return { kind: "link_existing_firm", firmId: input.redeemerFirmId };
  }
  return { kind: "create_firm" };
}

export function assertOwnerHandoffPurpose(purpose: string | null | undefined): void {
  if (purpose === ACCOUNTANT_INVITE_PURPOSE) {
    throw new Error(
      "This invite is for an accountant. Open the join link from the email to accept as their practice.",
    );
  }
}

export function assertAccountantLinkPurpose(purpose: string | null | undefined): void {
  if (purpose !== ACCOUNTANT_INVITE_PURPOSE) {
    throw new Error("This invite is for a business owner, not an accountant.");
  }
}

export type AccountantInviteDraftInput = {
  clientName: string;
  ownerName: string;
  inviteUrl: string;
};

export function claimsEmailOf(claims: unknown): string | null {
  if (claims && typeof claims === "object" && "email" in claims) {
    const email = (claims as { email?: unknown }).email;
    return typeof email === "string" && email.includes("@") ? email : null;
  }
  return null;
}

/** Owner greeting for the invite email — JWT claims only. Never Auth Admin. */
export function claimsDisplayName(claims: unknown): string {
  if (!claims || typeof claims !== "object") return "";
  const rec = claims as Record<string, unknown>;
  const meta = rec.user_metadata;
  if (meta && typeof meta === "object") {
    const named =
      (meta as { full_name?: unknown; name?: unknown }).full_name ??
      (meta as { name?: unknown }).name;
    if (typeof named === "string" && named.trim()) return named.trim();
  }
  if (typeof rec.full_name === "string" && rec.full_name.trim()) return rec.full_name.trim();
  return claimsEmailOf(claims) ?? "";
}

export function templateAccountantInviteDraft(input: AccountantInviteDraftInput): {
  subject: string;
  body: string;
} {
  const owner = input.ownerName.trim() || "A business owner";
  const subject = `${input.clientName} invited you to their Milōn workspace`;
  const body = `Hi,

${owner} at ${input.clientName} invited you to join their Milōn workspace as their accountant. You will see the same numbers they do — score, cash, and next moves — from the practice portal.

Accept here (the link expires in 14 days):

${input.inviteUrl}

If you were not expecting this, you can ignore it.

${input.clientName}
via Milōn`;
  return { subject, body };
}
