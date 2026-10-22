/**
 * Who may see one stored file password, and the audit mark for that read.
 * The ciphertext stays in the database. The plaintext is not logged and is
 * not part of the audit row.
 */

export const FILE_PASSWORD_READ_ACTION = "client_agent_file_password_read";

/** How long the accountant page keeps the plaintext before hiding it. */
export const FILE_PASSWORD_HIDE_MS = 30_000;

export type FilePasswordCaller = {
  userId: string | null;
  /** Firm owner, or a row in firm_memberships for the send's firm. */
  firmMember: boolean;
  /** The send-agent allowlist. Membership of a different firm is not enough. */
  firmAllowed: boolean;
};

export type FilePasswordRecord = {
  id: string;
  sendId: string;
  clientId: string;
  passwordIv: string | null;
  passwordBox: string | null;
} | null;

export type FilePasswordRevealResult =
  | { ok: true; password: string | null }
  | { ok: false; reason: "anon" | "forbidden" | "not_found" | "unavailable" };

export function sendFileHasPassword(box: unknown): boolean {
  return typeof box === "string" && box.trim().length > 0;
}

/** Who and which file. The password is not a field. */
export function filePasswordAuditDetails(
  fileId: string,
  sendId: string,
): { file_id: string; send_id: string } {
  return { file_id: fileId, send_id: sendId };
}

function sealedPair(file: FilePasswordRecord): { iv: string; box: string } | null {
  const iv = file?.passwordIv?.trim() ?? "";
  const box = file?.passwordBox?.trim() ?? "";
  if (!iv || !box) return null;
  return { iv, box };
}

/**
 * Refuse anon and anyone who is not a member of the file's firm.
 * A missing password returns nothing and does not open or audit.
 * A successful open is audited before the plaintext is returned.
 */
export async function revealFilePassword(input: {
  caller: FilePasswordCaller;
  requestedClientId: string;
  file: FilePasswordRecord;
  open: (sealed: { iv: string; box: string }) => Promise<string | null>;
  audit: (details: { file_id: string; send_id: string }) => Promise<boolean>;
}): Promise<FilePasswordRevealResult> {
  if (!input.caller.userId) return { ok: false, reason: "anon" };
  const file = input.file;
  if (!file || file.clientId !== input.requestedClientId) {
    return { ok: false, reason: "not_found" };
  }
  if (!input.caller.firmMember || !input.caller.firmAllowed) {
    return { ok: false, reason: "forbidden" };
  }
  const sealed = sealedPair(file);
  if (!sealed) return { ok: true, password: null };

  let plain: string | null = null;
  try {
    plain = await input.open(sealed);
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (!plain) return { ok: false, reason: "unavailable" };

  let recorded = false;
  try {
    recorded = await input.audit(filePasswordAuditDetails(file.id, file.sendId));
  } catch {
    recorded = false;
  }
  if (!recorded) return { ok: false, reason: "unavailable" };
  return { ok: true, password: plain };
}
