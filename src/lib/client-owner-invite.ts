/**
 * Accountant → owner invite for a client that already exists.
 * Link-only mode is inviteClientOwner({ sendEmail: false }): no Resend call.
 */

export type OwnerInviteMode = "link" | "email";

export type OwnerInviteRequest = {
  clientId: string;
  toEmail: string | null;
  ownerName: string | null;
  sendEmail: boolean;
};

/** Firm member with a practice assignment, and the client row visible under RLS. */
export function practiceMemberMayInviteOwner(input: {
  clientVisible: boolean;
  practiceAssignment: boolean;
}): boolean {
  return input.clientVisible && input.practiceAssignment;
}

/**
 * An owner is on file only when this client has a client_owner membership.
 * `clients.owner_user_id` on a firm-created file is the accountant who clicked
 * Add client. Pending invites and other clients' memberships do not count.
 */
export function activeClientOwnerOnFile(input: {
  clientId: string;
  memberships: readonly { clientId: string; role: string }[];
}): boolean {
  return input.memberships.some(
    (row) => row.clientId === input.clientId && row.role === "client_owner",
  );
}

/** Name on the owner row. A blank profile falls back to the email. */
export function clientOwnerLabel(input: {
  fullName: string | null | undefined;
  email: string | null | undefined;
}): { name: string; email: string | null } {
  const email = (input.email ?? "").trim();
  const full = (input.fullName ?? "").trim();
  const mail = email.includes("@") ? email : null;
  const named = full && !full.includes("@") ? full : "";
  return { name: named || mail || "Owner", email: mail };
}

export function ownerInviteRequest(input: {
  clientId: string;
  toEmail: string;
  ownerName?: string | null;
  mode: OwnerInviteMode;
}): OwnerInviteRequest {
  const email = input.toEmail.trim();
  const name = (input.ownerName ?? "").trim();
  return {
    clientId: input.clientId,
    toEmail: email ? email : null,
    ownerName: name ? name.slice(0, 80) : null,
    sendEmail: input.mode === "email",
  };
}

/**
 * Copy invite link mints in one call (`sendEmail: false`). Access is checked
 * inside that call, before the token is written. A separate access round trip
 * here used to sit in front of the mint, and the mint then drafted an email.
 * Email mode still checks access before that slower send.
 * A result that says the email went out is a failure of link-only mode.
 */
export async function guardedOwnerInvite<T extends { emailed: boolean }>(
  assertAccess: () => Promise<unknown>,
  invite: (req: OwnerInviteRequest) => Promise<T>,
  input: { clientId: string; toEmail: string; ownerName?: string | null; mode: OwnerInviteMode },
): Promise<T> {
  const req = ownerInviteRequest(input);
  if (input.mode === "email") await assertAccess();
  const result = await invite(req);
  if (input.mode === "link" && (req.sendEmail || result.emailed)) {
    throw new Error("Copy invite link sent an email");
  }
  return result;
}
