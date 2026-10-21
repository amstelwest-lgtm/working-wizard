/**
 * Rules for the public /a/<token> page. No database and no mail.
 * The Tax Specialist collects documents. She does not fill in a form
 * or make a SARS claim.
 */
import { PHYSIO_ITEMS, SEND_FILE_MAX_BYTES, SEND_FILE_MIMES, sha256Hex } from "./client-agent-send";
import { sendAgentFirmAllowed } from "./client-agent-send-allowlist";

export const SEND_CONSENT_VERSION = "popia-client-agent-1";

export const SEND_CONSENT_NOTICE =
  "I agree that Milōn may store the documents I send on this link for my accountant. Medical aid amounts are totals only. The Tax Specialist does not fill in a form, does not send a form back, does not log into SARS, and does not make a SARS claim.";

export const SEND_LINK_BODY =
  "The Tax Specialist collects the documents on this list. She does not fill in a form, and she does not send a form back. She does not log into SARS, and she does not make a SARS claim.";

export const SEND_ATTEMPT_LIMIT = 30;
export const SEND_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
export const SEND_STORAGE_BUCKET = "client-agent-sends";

const EXTRA_LABELS: Record<string, string> = {
  bank_statements: "Bank statements",
  travel_logbook: "Travel logbook",
};

export type SendLinkReason = "unavailable" | "expired" | "revoked" | "limited" | "consent";

export function sendAttemptLimited(recentCount: number): boolean {
  return recentCount >= SEND_ATTEMPT_LIMIT;
}

export async function hashPresentedToken(token: string): Promise<string> {
  return sha256Hex(token);
}

export async function hashClientAddress(address: string): Promise<string> {
  return sha256Hex(`client-agent-send-ip-v1|${address}`);
}

export function itemLabel(itemKey: string, storedLabel: string | null): string {
  const custom = storedLabel?.trim();
  if (custom) return custom;
  const known = PHYSIO_ITEMS.find((item) => item.itemKey === itemKey);
  if (known) return known.label;
  return EXTRA_LABELS[itemKey] ?? "Document";
}

/** A presented token can open the page only when the send's firm is allowlisted. */
export function gatePresentedSend(input: {
  limited: boolean;
  found: boolean;
  firmId: string | null;
  revokedAt: string | null;
  expiresAt: string;
  now: Date;
}): "ok" | SendLinkReason {
  if (input.limited) return "limited";
  if (!input.found || !sendAgentFirmAllowed(input.firmId)) return "unavailable";
  if (input.revokedAt) return "revoked";
  const expires = new Date(input.expiresAt).getTime();
  if (!Number.isFinite(expires) || expires <= input.now.getTime()) return "expired";
  return "ok";
}

export function sendStoragePath(sendId: string, itemKey: string, objectId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sendId)) {
    throw new Error("bad send");
  }
  if (!/^[a-z0-9_]+$/.test(itemKey)) throw new Error("bad item");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(objectId)) {
    throw new Error("bad object");
  }
  return `${sendId}/${itemKey}/${objectId}`;
}

export function pathBelongsToSend(path: string, sendId: string, itemKey: string): boolean {
  const expected = new RegExp(
    `^${sendId}/${itemKey}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
    "i",
  );
  return expected.test(path) && !path.includes("..");
}

export function mimeAllowed(mime: string): boolean {
  return (SEND_FILE_MIMES as readonly string[]).includes(mime);
}

export function sizeAllowed(size: number): boolean {
  return Number.isInteger(size) && size > 0 && size <= SEND_FILE_MAX_BYTES;
}

export const SEND_FILE_BASE64_MAX = 4 * Math.ceil(SEND_FILE_MAX_BYTES / 3);

/** Standard base64 of a file the browser hands to the server. No storage path. */
export function bytesFromBase64(value: string): Uint8Array | null {
  if (value.length < 4 || value.length % 4 !== 0 || value.length > SEND_FILE_BASE64_MAX)
    return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const expected = (value.length / 4) * 3 - padding;
  if (expected < 1 || expected > SEND_FILE_MAX_BYTES) return null;
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    return null;
  }
  if (binary.length !== expected) return null;
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Metadata from storage may be empty or a generic type. A gif is never kept. */
export function storedMimeAllowed(declared: string, metadataMime: string | null): boolean {
  if (!mimeAllowed(declared)) return false;
  if (!metadataMime) return true;
  if (metadataMime === "application/octet-stream") return true;
  return mimeAllowed(metadataMime);
}

export function consentReady(consentAt: string | null): boolean {
  return typeof consentAt === "string" && consentAt.length > 0;
}

export type ItemQuality = "usable" | "incomplete" | "poor";

export function finishItem(input: {
  quality: ItemQuality;
  explanation: string | null;
  hasFile: boolean;
}): { ok: true; explanation: string | null } | { ok: false; reason: "explanation" | "empty" } {
  const explanation = input.explanation?.trim() ?? "";
  if (!input.hasFile && input.quality === "usable") return { ok: false, reason: "empty" };
  if ((input.quality === "incomplete" || input.quality === "poor") && explanation.length === 0) {
    return { ok: false, reason: "explanation" };
  }
  return { ok: true, explanation: explanation.length > 0 ? explanation : null };
}
