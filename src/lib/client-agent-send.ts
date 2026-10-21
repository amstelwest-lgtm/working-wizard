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

/** Every item_key the send-items check allows, in checklist order. */
export const SEND_ITEM_KEYS = [
  "practice_income_expenses",
  "bank_statements",
  "travel_logbook",
  "medical_aid_certificate",
  "ra_contribution_certificate",
  "irp5",
  "it3b",
  "other",
] as const;

export type SendItemKey = (typeof SEND_ITEM_KEYS)[number];

/** Plain names on the accountant picker and, except for "other", on the client page. */
export const SEND_ITEM_LABELS: Record<SendItemKey, string> = {
  practice_income_expenses: "Practice income and expenses",
  bank_statements: "Bank statements",
  travel_logbook: "Travel logbook",
  medical_aid_certificate: "Medical aid tax certificate (totals only)",
  ra_contribution_certificate: "Retirement annuity contribution certificate",
  irp5: "IRP5 (only if you had a salaried job)",
  it3b: "IT3(b)",
  other: "Something else",
};

/** The five documents a new send used before the picker. They start ticked. */
export const SEND_DEFAULT_ITEM_KEYS: readonly PhysioItemKey[] = PHYSIO_ITEMS.map(
  (item) => item.itemKey,
);

/** Matches client_agent_send_items.label: trimmed, at most 200 characters. */
export const SEND_OTHER_LABEL_MAX = 200;

export type ChosenSendItem = {
  itemKey: SendItemKey;
  label: string;
  totalsOnly: boolean;
};

function cleanItemLabel(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * The documents for one new send. Unknown keys, duplicates, an empty list,
 * and a ticked "other" without a label are refused. Medical aid stays totals-only.
 */
export function chooseSendItems(
  input: readonly { itemKey?: string | null; label?: string | null }[] | null | undefined,
): { ok: true; items: ChosenSendItem[] } | { ok: false; reason: "empty" | "items" | "other" } {
  if (!input || input.length === 0) return { ok: false, reason: "empty" };
  const allowed = new Set<string>(SEND_ITEM_KEYS);
  const seen = new Set<string>();
  const items: ChosenSendItem[] = [];
  for (const row of input) {
    const itemKey = row?.itemKey ?? "";
    if (!allowed.has(itemKey) || seen.has(itemKey)) return { ok: false, reason: "items" };
    seen.add(itemKey);
    if (itemKey === "other") {
      const label = cleanItemLabel(row.label);
      if (!label || label.length > SEND_OTHER_LABEL_MAX) return { ok: false, reason: "other" };
      items.push({ itemKey, label, totalsOnly: false });
      continue;
    }
    const key = itemKey as SendItemKey;
    items.push({
      itemKey: key,
      label: SEND_ITEM_LABELS[key],
      totalsOnly: key === "medical_aid_certificate",
    });
  }
  return { ok: true, items };
}

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
