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
  const m = pathname.match(/^\/join\/([^/]+)$/);
  const token = m?.[1] ? decodeURIComponent(m[1]).trim() : "";
  return token || null;
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
