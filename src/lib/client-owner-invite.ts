/**
 * Accountant → owner invite for a client that already exists.
 * Link-only mode is inviteClientOwner({ sendEmail: false }): no Resend call.
 */

export type OwnerInviteMode = "link" | "email";

export type OwnerInviteRequest = {
  clientId: string;
  toEmail: string | null;
  sendEmail: boolean;
};

/** Firm member with a practice assignment, and the client row visible under RLS. */
export function practiceMemberMayInviteOwner(input: {
  clientVisible: boolean;
  practiceAssignment: boolean;
}): boolean {
  return input.clientVisible && input.practiceAssignment;
}

export function ownerInviteRequest(input: {
  clientId: string;
  toEmail: string;
  mode: OwnerInviteMode;
}): OwnerInviteRequest {
  const email = input.toEmail.trim();
  return {
    clientId: input.clientId,
    toEmail: email ? email : null,
    sendEmail: input.mode === "email",
  };
}

/**
 * Copy invite link. Asserts access, then mints with sendEmail false.
 * A result that says the email went out is a failure of link-only mode.
 */
export async function guardedOwnerInvite<T extends { emailed: boolean }>(
  assertAccess: () => Promise<unknown>,
  invite: (req: OwnerInviteRequest) => Promise<T>,
  input: { clientId: string; toEmail: string; mode: OwnerInviteMode },
): Promise<T> {
  await assertAccess();
  const req = ownerInviteRequest(input);
  const result = await invite(req);
  if (input.mode === "link" && (req.sendEmail || result.emailed)) {
    throw new Error("Copy invite link sent an email");
  }
  return result;
}
