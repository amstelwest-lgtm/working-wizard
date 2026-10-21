/**
 * Rules for the public /a/<token> page. No database and no mail.
 * The Tax Specialist collects documents. She does not fill in a form
 * or make a SARS claim.
 */
import { MONTHS_LONG } from "@/lib/market/date-presets";
import { formatDate } from "@/lib/market/format";
import { SEND_FILE_MAX_BYTES, SEND_FILE_MIMES, sha256Hex } from "./client-agent-send";
import { SEND_AGENT_FIRM_ALLOWLIST, sendAgentFirmAllowed } from "./client-agent-send-allowlist";

export const SEND_CONSENT_VERSION = "popia-client-agent-2";

/**
 * SA year of assessment 2026 ends on the last day of February 2026.
 * Today can sit in the next financial year. These documents are for 2026.
 */
const DOCUMENT_YEAR_OF_ASSESSMENT = 2026;

export const SEND_ATTEMPT_LIMIT = 30;
export const SEND_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
export const SEND_STORAGE_BUCKET = "client-agent-sends";

/**
 * Client-facing practice name for the one allowlisted firm.
 * firms.name stays "My practice" for QA. This does not rename that row.
 */
export const SEND_PRACTICE_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  [SEND_AGENT_FIRM_ALLOWLIST[0]]: "Theo's practice",
};

const PUBLIC_LABELS: Record<string, string> = {
  practice_income_expenses: "Practice income and expenses",
  bank_statements: "Bank statements",
  travel_logbook: "Travel logbook",
  medical_aid_certificate: "Medical aid tax certificate (totals only)",
  ra_contribution_certificate: "Retirement annuity contribution certificate",
  irp5: "IRP5 (only if you had a salaried job)",
  it3b: "IT3(b)",
  other: "Divorce or maintenance order, plus proof of payments received",
};

const PUBLIC_ITEM_ORDER = [
  "practice_income_expenses",
  "bank_statements",
  "travel_logbook",
  "medical_aid_certificate",
  "ra_contribution_certificate",
  "irp5",
  "it3b",
  "other",
];

export type SendGate = "ok" | "unavailable" | "expired" | "revoked" | "limited";
export type SendLinkReason = "unavailable" | "limited" | "consent" | "mime" | "size";

export const GENERIC_LINK_STATUS = 200;
export const GENERIC_LINK_BODY = "This link is not available.";
export const LIMITED_LINK_BODY = "Too many attempts. Wait a little, then try again.";
export const CONSENT_LINK_BODY = "Agree at the start of the page before sending a document.";
export const FILE_LINK_BODY = "Use a PDF, JPG, PNG, or HEIC up to 20 MB.";

export type ClosedLink = {
  ok: false;
  status: typeof GENERIC_LINK_STATUS;
  reason: SendLinkReason;
  body: string;
};

/** One public refusal. Expired, revoked, and unknown share this status and body. */
export function closedLink(reason: SendLinkReason): ClosedLink {
  const body =
    reason === "limited"
      ? LIMITED_LINK_BODY
      : reason === "consent"
        ? CONSENT_LINK_BODY
        : reason === "mime" || reason === "size"
          ? FILE_LINK_BODY
          : GENERIC_LINK_BODY;
  return { ok: false, status: GENERIC_LINK_STATUS, reason, body };
}

export function sendAttemptLimited(recentCount: number): boolean {
  return recentCount >= SEND_ATTEMPT_LIMIT;
}

export async function hashPresentedToken(token: string): Promise<string> {
  return sha256Hex(token);
}

export async function hashClientAddress(address: string): Promise<string> {
  return sha256Hex(`client-agent-send-ip-v1|${address}`);
}

function cleanPracticeName(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

const clientAgentDateMarket = {
  locale: "en-ZA",
  timezone: "Africa/Johannesburg",
};

/** Calendar day in Africa/Johannesburg. An instant after 22:00 UTC is the next day. */
export function clientAgentExpiryLabel(expiresAt: Date | string): string {
  const label = formatDate(expiresAt, clientAgentDateMarket);
  return label === "—" ? "soon" : label;
}

/** One friendly line on the consent page. Internal rules stay out of this sentence. */
export function clientAgentIntro(practiceName: string, expiresAt: Date | string): string {
  const practice = cleanPracticeName(practiceName) || "your accountant";
  const expiry = clientAgentExpiryLabel(expiresAt);
  return `Hi, I'm the Tax Specialist for ${practice}. I'll help you gather the documents your accountant needs. It takes about 5 minutes, and you can come back to this link any time before ${expiry}.`;
}

/** Wording stored against popia-client-agent-2. The practice name is filled in. */
export function clientConsentNotice(practiceName: string): string {
  const practice = cleanPracticeName(practiceName) || "your accountant";
  return `I agree that ${practice} may securely store the documents I upload here for my tax file, using Milōn. Medical aid: send the tax certificate totals only.`;
}

function longCalendarDay(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  const month = MONTHS_LONG[Number(match[2]) - 1] ?? "";
  return `${Number(match[3])} ${month} ${match[1]}`;
}

function februaryYearEnd(year: number): string {
  const day = new Date(Date.UTC(year, 2, 0)).getUTCDate();
  return `${year}-02-${String(day).padStart(2, "0")}`;
}

/**
 * Day after the previous February year end. 28 February 2026 starts on
 * 1 March 2025. Kept here so company-tax form names stay out of this bundle.
 */
function assessmentWindowStart(yearEnd: string): string {
  const match = /^(\d{4})-02-\d{2}$/.exec(yearEnd);
  if (!match) return yearEnd;
  return `${Number(match[1]) - 1}-03-01`;
}

/** 1 March through the last day of February for that year of assessment. */
export function documentYearWindow(year = DOCUMENT_YEAR_OF_ASSESSMENT): string {
  const end = februaryYearEnd(year);
  const start = assessmentWindowStart(end);
  return `${longCalendarDay(start)} to ${longCalendarDay(end)}`;
}

const ITEM_HELP: Record<string, string> = {
  practice_income_expenses:
    "Your income and expense summary for the year, or your bookkeeping export.",
  bank_statements: `All business accounts, ${documentYearWindow()}.`,
  travel_logbook: "Your business kilometres for the year, if you claim travel.",
  medical_aid_certificate: "Totals only. Do not send a line-by-line breakdown.",
  ra_contribution_certificate: "The annual certificate from your retirement annuity provider.",
  irp5: "From your employer, if you had a salaried job.",
  it3b: "Interest certificates from your bank or investments.",
  other: "A copy of the order and proof of payments received.",
};

export const CLIENT_AGENT_FILE_NOTE = "PDF, JPG, PNG or HEIC, up to 20 MB each.";

/** One short line for a checklist row. File types are not repeated here. */
export function clientAgentItemHelp(item: { itemKey: string }): string {
  return ITEM_HELP[item.itemKey] ?? "";
}

/**
 * Name on the client page. A stored practice_display_name wins.
 * The allowlisted firm otherwise uses its client-facing name, not firms.name.
 * Every other firm falls back to the firm name.
 */
export function practiceDisplayName(input: {
  firmId?: string | null;
  practiceDisplayName?: string | null;
  firmName?: string | null;
}): string {
  const custom = cleanPracticeName(input.practiceDisplayName);
  if (custom) return custom.slice(0, 120);
  const known = input.firmId ? SEND_PRACTICE_DISPLAY_NAMES[input.firmId] : undefined;
  if (known) return known;
  const firm = cleanPracticeName(input.firmName);
  if (firm) return firm.slice(0, 120);
  return "Your accountant";
}

/** Value stored on a new send. Null when this firm has no client-facing override. */
export function sendPracticeDisplayName(firmId: string): string | null {
  return SEND_PRACTICE_DISPLAY_NAMES[firmId] ?? null;
}

export function itemLabel(itemKey: string, storedLabel: string | null): string {
  const custom = storedLabel?.trim();
  if (custom) return custom;
  return PUBLIC_LABELS[itemKey] ?? "Document";
}

/** A presented token can open the page only when the send's firm is allowlisted. */
export function gatePresentedSend(input: {
  limited: boolean;
  found: boolean;
  firmId: string | null;
  revokedAt: string | null;
  expiresAt: string;
  now: Date;
}): SendGate {
  if (input.limited) return "limited";
  if (!input.found || !sendAgentFirmAllowed(input.firmId)) return "unavailable";
  if (input.revokedAt) return "revoked";
  const expires = new Date(input.expiresAt).getTime();
  if (!Number.isFinite(expires) || expires <= input.now.getTime()) return "expired";
  return "ok";
}

export type AttemptOutcome = "ok" | "unknown" | "expired" | "revoked" | "limited";

/**
 * Public result for a presented token. The raw token is not an input:
 * the caller has already looked the send up by its hash.
 * IP and per-send counts both come from client_agent_send_attempts.
 */
export function resolvePresentedLink(input: {
  ipCount: number;
  sendCount: number | null;
  found: boolean;
  firmId: string | null;
  revokedAt: string | null;
  expiresAt: string;
  now: Date;
}): { public: { ok: true } | ClosedLink; outcome: AttemptOutcome } {
  if (sendAttemptLimited(input.ipCount)) {
    return { public: closedLink("limited"), outcome: "limited" };
  }
  const gate = gatePresentedSend({
    limited: false,
    found: input.found,
    firmId: input.firmId,
    revokedAt: input.revokedAt,
    expiresAt: input.expiresAt,
    now: input.now,
  });
  if (gate === "unavailable") return { public: closedLink("unavailable"), outcome: "unknown" };
  if (gate === "revoked" || gate === "expired") {
    return { public: closedLink("unavailable"), outcome: gate };
  }
  if (input.sendCount != null && sendAttemptLimited(input.sendCount)) {
    return { public: closedLink("unavailable"), outcome: "limited" };
  }
  return { public: { ok: true }, outcome: "ok" };
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

export function consentWrite(now: Date): { consent_at: string; consent_notice_version: string } {
  return {
    consent_at: now.toISOString(),
    consent_notice_version: SEND_CONSENT_VERSION,
  };
}

export type PublicChecklistItem = {
  itemKey: string;
  label: string;
  totalsOnly: boolean;
  status: string;
  quality: string | null;
  hasFile: boolean;
};

type ChecklistRow = {
  sendId: string;
  itemKey: string;
  label: string | null;
  totalsOnly: boolean;
  status: string;
  quality: string | null;
  storagePath: string | null;
  firmId?: string;
  fileName?: string;
  bytes?: Uint8Array;
};

/** Her own checklist only. Firm fields, file names, and file bytes stay off the page. */
export function toPublicChecklist(rows: ChecklistRow[], sendId: string): PublicChecklistItem[] {
  return rows
    .filter((row) => row.sendId === sendId)
    .map((row) => ({
      itemKey: row.itemKey,
      label: itemLabel(row.itemKey, row.label),
      totalsOnly: row.totalsOnly,
      status: row.status,
      quality: row.quality,
      hasFile: typeof row.storagePath === "string" && row.storagePath.length > 0,
    }))
    .sort((a, b) => {
      const ai = PUBLIC_ITEM_ORDER.indexOf(a.itemKey);
      const bi = PUBLIC_ITEM_ORDER.indexOf(b.itemKey);
      return (
        (ai === -1 ? PUBLIC_ITEM_ORDER.length : ai) - (bi === -1 ? PUBLIC_ITEM_ORDER.length : bi)
      );
    });
}

/** The checklist is empty until consent is stored. */
export function openLinkView(input: {
  consented: boolean;
  notice: string;
  items: PublicChecklistItem[];
}): { consented: boolean; notice: string; items: PublicChecklistItem[] } {
  if (!input.consented) return { consented: false, notice: input.notice, items: [] };
  return { consented: true, notice: input.notice, items: input.items };
}

export type DocumentMime = "application/pdf" | "image/jpeg" | "image/png" | "image/heic";

const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);

function asciiAt(bytes: Uint8Array, start: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) out += String.fromCharCode(bytes[start + i] ?? 0);
  return out;
}

/** File type from the bytes themselves. Extension and declared MIME are not read. */
export function sniffDocumentMime(bytes: Uint8Array): DocumentMime | null {
  if (bytes.length >= 5 && asciiAt(bytes, 0, 4) === "%PDF") return "application/pdf";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    asciiAt(bytes, 4, 4) === "ftyp" &&
    HEIC_BRANDS.has(asciiAt(bytes, 8, 4))
  ) {
    return "image/heic";
  }
  return null;
}

export type AcceptFile = { ok: true; mime: DocumentMime; bytes: Uint8Array } | ClosedLink;

/**
 * Consent, then size, then magic bytes. A refusal is returned before the
 * caller is allowed to write to storage.
 */
export function acceptClientFile(input: {
  consented: boolean;
  bytes: Uint8Array | null;
}): AcceptFile {
  if (!input.consented) return closedLink("consent");
  if (!input.bytes || !sizeAllowed(input.bytes.byteLength)) return closedLink("size");
  const mime = sniffDocumentMime(input.bytes);
  if (!mime) return closedLink("mime");
  return { ok: true, mime, bytes: input.bytes };
}

export async function storeAcceptedFile<T>(
  decision: AcceptFile,
  write: (file: { mime: DocumentMime; bytes: Uint8Array }) => Promise<T>,
): Promise<{ ok: true; value: T } | ClosedLink> {
  if (!decision.ok) return decision;
  return { ok: true, value: await write({ mime: decision.mime, bytes: decision.bytes }) };
}

const LOG_KEYS = new Set(["event", "outcome", "reason"]);

/** A log line may carry only short machine codes. Tokens, names, and notes are dropped. */
export function sendLinkLogLine(input: Record<string, unknown>): string {
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!LOG_KEYS.has(key) || typeof value !== "string") continue;
    if (!/^[a-z0-9_-]{1,32}$/.test(value)) continue;
    safe[key] = value;
  }
  return JSON.stringify(safe);
}

/** Access logs keep the route and drop the token that sits in the path. */
export function linkLogPath(pathname: string): string {
  if (pathname === "/a" || pathname.startsWith("/a/")) return "/a/[token]";
  return pathname;
}

export function linkPrivacyHeaders(pathname: string): Record<string, string> | null {
  if (pathname !== "/a" && !pathname.startsWith("/a/")) return null;
  return {
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow",
  };
}

export const SEND_LINK_META = [
  { title: "Tax Specialist — Milōn" },
  { name: "robots", content: "noindex, nofollow" },
  { name: "referrer", content: "no-referrer" },
] as const;
