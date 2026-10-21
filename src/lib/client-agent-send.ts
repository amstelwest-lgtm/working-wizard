/**
 * Rules for a firm-sent Tax Specialist link. No database and no mail.
 * The public page is a later change. This module only mints the address
 * the accountant copies.
 */

export const SEND_AGENT_SLUG = "tax-specialist" as const;
export const SEND_CHECKLIST_KEY = "za-physio-tax-pack" as const;
export const SEND_EXPIRY_DAYS = 14;
export const SEND_FILE_MAX_BYTES = 20 * 1024 * 1024;

export const SEND_FILE_MIMES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
] as const;

export const PHYSIO_ITEMS = [
  { itemKey: "irp5", label: "IRP5", totalsOnly: false },
  {
    itemKey: "medical_aid_certificate",
    label: "Medical aid tax certificate (totals only)",
    totalsOnly: true,
  },
  {
    itemKey: "ra_contribution_certificate",
    label: "Retirement annuity contribution certificate",
    totalsOnly: false,
  },
  { itemKey: "it3b", label: "IT3(b)", totalsOnly: false },
  {
    itemKey: "practice_income_expenses",
    label: "Practice income and expenses",
    totalsOnly: false,
  },
] as const;

export type PhysioItemKey = (typeof PHYSIO_ITEMS)[number]["itemKey"];

/**
 * Shown on the accountant's client file. She collects documents.
 * She does not fill in a form or make a SARS claim.
 */
export const SEND_AGENT_BODY =
  "The Tax Specialist collects the documents on this list. She does not fill in a form, and she does not send a form back. She does not log into SARS, and she does not make a SARS claim. Send emails the document list to the address you confirm.";

export const SEND_AGENT_ONCE =
  "The invite was sent. Copy this link now if you also want to pass it on. It is shown once and is not stored. It expires 14 days after it is created.";

/** Given name for the invite. Blank becomes null. Longer than 60 is refused. */
export function recipientFirstName(
  value: string | null | undefined,
): { ok: true; name: string | null } | { ok: false } {
  const trimmed = (value ?? "").replace(/\s+/g, " ").trim();
  if (!trimmed) return { ok: true, name: null };
  if (trimmed.length > 60) return { ok: false };
  return { ok: true, name: trimmed };
}

/** Address the accountant confirmed. Blank or malformed is refused. */
export function recipientEmail(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim().toLowerCase();
  if (!trimmed || trimmed.length > 200) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return trimmed;
}

export function sendExpiresAt(now: Date): Date {
  return new Date(now.getTime() + SEND_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
}

/** Public path for the later client page. Not the sample at /talk. */
export function agentLink(origin: string, token: string): string {
  const base = origin.replace(/\/$/, "");
  return `${base}/a/${token}`;
}

export function newSendToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function sha256Hex(value: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(buf)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function sendStillOpen(
  row: { revokedAt: string | null; expiresAt: string },
  now: Date,
): boolean {
  if (row.revokedAt) return false;
  const expires = new Date(row.expiresAt).getTime();
  return Number.isFinite(expires) && expires > now.getTime();
}
