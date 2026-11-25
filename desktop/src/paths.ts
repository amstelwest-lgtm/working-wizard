/**
 * Object names match src/lib/source-documents-ui.ts so the storage path is
 * `{client_id}/{object_name}`, the same path register_source_document accepts.
 */
import { SOURCE_DOCS_MAX_BYTES } from "./public-config";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Extensions the tray watches. Intake itself still rejects csv and xlsx. */
export const WATCH_EXTENSIONS = ["pdf", "xlsx", "csv", "png", "jpg", "jpeg", "heic"] as const;

/** MIME values register_source_document and the source-docs bucket allow. */
export const INTAKE_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const SECRET_NAME =
  /(?:^|[/\\])(?:\.env(?:\..*)?|id_rsa|id_dsa|id_ed25519|.*\.pem|.*\.p12|.*\.pfx|.*\.key|credentials)$/i;

export function fileExtension(fileName: string): string {
  const base = fileName.split(/[/\\]/).pop() ?? fileName;
  const dot = base.lastIndexOf(".");
  if (dot < 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

export function watchedExtension(fileName: string): boolean {
  return (WATCH_EXTENSIONS as readonly string[]).includes(fileExtension(fileName));
}

export function mimeForFileName(fileName: string): string | null {
  return MIME_BY_EXT[fileExtension(fileName)] ?? null;
}

export function intakeAcceptsMime(mime: string | null): boolean {
  return mime != null && INTAKE_MIME.has(mime);
}

/** Skip dotfiles, Office lock files, partial downloads, and key material. */
export function ignoredLocalFile(fileName: string): boolean {
  const base = fileName.split(/[/\\]/).pop() ?? fileName;
  if (!base || base.startsWith(".") || base.startsWith("~$")) return true;
  if (/\.(tmp|crdownload|partial|download)$/i.test(base)) return true;
  if (SECRET_NAME.test(fileName)) return true;
  return false;
}

export function sizeError(bytes: number): string | null {
  if (!Number.isFinite(bytes) || bytes <= 0) return "This file is empty.";
  if (bytes > SOURCE_DOCS_MAX_BYTES) return "This file is over 20 MB.";
  return null;
}

/** Same cleaning rules as sanitizeSourceObjectName in source-documents-ui.ts. */
export function sanitizeSourceObjectName(fileName: string): string {
  const base = fileName.split(/[/\\]/).pop() ?? "";
  const cleaned = base
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/-+\./g, ".")
    .replace(/\.+/g, ".")
    .replace(/^[-.]+|[-.]+$/g, "");
  const sliced = cleaned.slice(0, 200);
  return sliced || "document";
}

export function suffixSourceObjectName(name: string, n: number): string {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  const suffix = `-${n}`;
  const room = 200 - suffix.length - ext.length;
  return `${stem.slice(0, Math.max(1, room))}${suffix}${ext}`.slice(0, 200);
}

/** `{client_id}/{object_name}` with a lowercase client id and no extra folder. */
export function sourceObjectPath(clientId: string, fileName: string): string {
  const id = clientId.trim().toLowerCase();
  if (!UUID.test(id)) throw new Error("client_invalid");
  const name = sanitizeSourceObjectName(fileName);
  if (!/^[A-Za-z0-9._-]{1,200}$/.test(name) || name.includes("/")) {
    throw new Error("storage_path_invalid");
  }
  return `${id}/${name}`;
}

export function isUuid(value: string): boolean {
  return UUID.test(value);
}
