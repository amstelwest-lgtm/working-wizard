/**
 * Desktop folder-sync rules. Pure module: no database, no network.
 * POPIA notice version is logged with partner consent (see settings UI).
 */
import { SOURCE_DOCS_MAX_BYTES } from "@/lib/source-document-hooks";
import { sha256Hex } from "@/lib/client-agent-send";

export const DESKTOP_SYNC_CONSENT_VERSION = "popia-desktop-sync-1";

export const DESKTOP_SYNC_MAX_BYTES = SOURCE_DOCS_MAX_BYTES;

/** Same set as public.source_documents.mime CHECK (see 20261013170000_source_documents_to_ledger). */
export const DESKTOP_SYNC_EXTENSIONS = [
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "heic",
  "heif",
] as const;

const EXT_SET = new Set(DESKTOP_SYNC_EXTENSIONS);

export const DESKTOP_SYNC_MIMES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

const MIME_SET = new Set(DESKTOP_SYNC_MIMES);

const SECRET_NAME =
  /(?:^|\/)(?:\.env(?:\..*)?|id_rsa|id_dsa|id_ed25519|.*\.pem|.*\.p12|.*\.pfx|.*\.key|credentials|\.ssh\/|chrome|firefox|edge|safari|outlook|thunderbird|1password|lastpass|bitwarden|login data|cookies)(?:\/|$)/i;

const HIDDEN_OR_SYSTEM =
  /(?:^|\/)\.|(?:^|\/)(?:\$recycle\.bin|system volume information|pagefile\.sys|hiberfil\.sys)(?:\/|$)/i;

export const DESKTOP_SYNC_TOKEN_TTL_MS = 60 * 60 * 1000;
export const DESKTOP_SYNC_REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const DESKTOP_SYNC_PAIRING_TTL_MS = 10 * 60 * 1000;
export const DESKTOP_SYNC_RATE_WINDOW_MS = 60 * 1000;
export const DESKTOP_SYNC_RATE_MAX_PER_WINDOW = 30;
export const DESKTOP_SYNC_DAILY_FILE_CAP = 200;
export const DESKTOP_SYNC_DAILY_BYTE_CAP = 500 * 1024 * 1024;
/** SAST calendar day for daily caps (UTC+2, no DST). */
export const DESKTOP_SYNC_CAP_TZ_OFFSET_MIN = 120;

export type DesktopSyncFolderMap = {
  folderLabel: string;
  clientId: string;
};

export function desktopSyncConsentNotice(practiceName: string): string {
  const name = practiceName.trim() || "Your practice";
  return [
    `${name} may turn on an optional desktop folder sync on a computer you choose.`,
    "Milōn reads only files you put in folders you name, one client per folder.",
    "Allowed types: PDF and images (JPEG, PNG, WebP, HEIC, HEIF), up to 20 MB each.",
    "Files upload into each client's source documents for review. Nothing is auto-filed to a ledger.",
    "Metadata sent: file name, size, hash, modified time, and the folder label — not the full path on disk.",
    "The practice is responsible for its clients' data; Milōn is the operator processing uploads you start.",
    "Source files are kept for five years unless you request deletion.",
    "Turn this off or disconnect a computer any time in Settings.",
  ].join(" ");
}

export function extensionAllowed(fileName: string): boolean {
  const base = fileName.split(/[/\\]/).pop() ?? fileName;
  const dot = base.lastIndexOf(".");
  if (dot < 1) return false;
  const ext = base.slice(dot + 1).toLowerCase();
  return EXT_SET.has(ext as (typeof DESKTOP_SYNC_EXTENSIONS)[number]);
}

export function mimeAllowed(mime: string | null | undefined): boolean {
  if (!mime) return false;
  const normalized = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  if (normalized === "image/jpg") return true;
  return MIME_SET.has(normalized as (typeof DESKTOP_SYNC_MIMES)[number]);
}

export function desktopSyncFileRejected(
  fileName: string,
  sizeBytes: number,
): "hidden" | "secret" | "size" | null {
  if (HIDDEN_OR_SYSTEM.test(fileName)) return "hidden";
  if (SECRET_NAME.test(fileName)) return "secret";
  if (sizeBytes <= 0 || sizeBytes > DESKTOP_SYNC_MAX_BYTES) return "size";
  return null;
}

export function desktopSyncUnsupportedType(
  fileName: string,
  mime?: string | null,
): "extension" | "mime" | null {
  if (!extensionAllowed(fileName)) return "extension";
  if (mime != null && mime !== "" && !mimeAllowed(mime)) return "mime";
  return null;
}

const MIME_BY_EXT: Record<string, (typeof DESKTOP_SYNC_MIMES)[number]> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
};

export function desktopSyncMimeForFileName(fileName: string): string {
  const base = fileName.split(/[/\\]/).pop() ?? fileName;
  const dot = base.lastIndexOf(".");
  if (dot < 1) return "application/octet-stream";
  const ext = base.slice(dot + 1).toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

export function folderLabelValid(label: string): boolean {
  const trimmed = label.trim();
  if (trimmed.length < 1 || trimmed.length > 80) return false;
  if (/[/\\]/.test(trimmed)) return false;
  return true;
}

export function normalizeFolderLabel(label: string): string {
  return label.replace(/\s+/g, " ").trim();
}

export function sanitizeUploadFileName(fileName: string): string {
  const base = fileName.split(/[/\\]/).pop() ?? "document";
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "");
  const clipped = cleaned.slice(0, 180);
  return clipped.length > 0 ? clipped : "document";
}

export async function hashDeviceToken(token: string): Promise<string> {
  return sha256Hex(`desktop-sync-device-v1|${token}`);
}

export async function hashPairingCode(code: string): Promise<string> {
  return sha256Hex(`desktop-sync-pair-v1|${code.replace(/\s+/g, "").toLowerCase()}`);
}

export function sastUsageDay(instant = new Date()): string {
  const shifted = new Date(instant.getTime() + DESKTOP_SYNC_CAP_TZ_OFFSET_MIN * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export type DesktopSyncActivityKind =
  | "enabled"
  | "disabled"
  | "paired"
  | "disconnected"
  | "upload"
  | "upload_rejected"
  | "upload_skipped";

export type PairingCodeSnapshot = {
  usedAt: string | null;
  expiresAt: string;
};

/** Unknown, already used, and expired are different failures. A live code returns null. */
export function pairingCodeFailureReason(
  row: PairingCodeSnapshot | null,
  nowMs = Date.now(),
): "code" | "used" | "expired" | null {
  if (!row) return "code";
  if (row.usedAt) return "used";
  const expires = Date.parse(row.expiresAt);
  if (!Number.isFinite(expires) || expires <= nowMs) return "expired";
  return null;
}

export function deviceTokenCanRead(): false {
  return false;
}
