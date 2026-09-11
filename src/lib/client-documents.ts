/**
 * Client documents — the owner's archive of uploaded files, with a per-file
 * visibility choice. Shared, dependency-free pieces; see
 * client-documents-browser.ts for the Storage calls.
 *
 * Storage: private bucket `client-documents`, objects at
 * `{clientId}/{artifactId}.{ext}`, one client_artifacts row (kind = 'upload')
 * per object. RLS decides who may list/download an object from the row's
 * `visibility` — the UI only reflects it. See
 * supabase/migrations/20260911120000_upload_visibility.sql.
 */

export const CLIENT_DOCUMENTS_BUCKET = "client-documents";

export const UPLOAD_VISIBILITIES = ["private", "shared"] as const;
export type UploadVisibility = (typeof UPLOAD_VISIBILITIES)[number];

/** Safe default: nothing leaves the owner's side unless they chose to share. */
export const DEFAULT_UPLOAD_VISIBILITY: UploadVisibility = "private";

export type UploadSource = "bank_pack" | "cash_pack" | "financial_statement";

export const UPLOAD_VISIBILITY_COPY: Record<
  UploadVisibility,
  { label: string; help: string; badge: string }
> = {
  shared: {
    label: "Share with accountant",
    help: "Your linked accountant can open this file and see it in your Client Brain summary, so their advice can draw on it.",
    badge: "Shared with accountant",
  },
  private: {
    label: "Keep private",
    help: "The file stays with you in Milōn. Your accountant will not see, list or download it. Figures you confirm from it are still saved to your board as usual.",
    badge: "Private",
  },
};

export const UPLOAD_VISIBILITY_INTRO =
  "Who can see the file itself? This is separate from the figures you confirm — those always go to your board.";

export function isUploadVisibility(v: unknown): v is UploadVisibility {
  return v === "private" || v === "shared";
}

export function coerceUploadVisibility(v: unknown): UploadVisibility {
  return isUploadVisibility(v) ? v : DEFAULT_UPLOAD_VISIBILITY;
}

export function uploadVisibilityLabel(v: unknown): string {
  return UPLOAD_VISIBILITY_COPY[coerceUploadVisibility(v)].badge;
}

export function uploadSourceLabel(source: unknown): string {
  if (source === "bank_pack") return "Bank statements";
  if (source === "cash_pack") return "Bank statements (cash)";
  if (source === "financial_statement") return "Financial statement";
  return "Upload";
}

const EXT_BY_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "text/csv": "csv",
  "text/plain": "txt",
  "text/tab-separated-values": "tsv",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel.sheet.macroenabled.12": "xlsm",
  "application/vnd.oasis.opendocument.spreadsheet": "ods",
};

const MIME_BY_EXT: Record<string, string> = Object.fromEntries(
  Object.entries(EXT_BY_MIME).map(([mime, ext]) => [ext, mime]),
);

const SAFE_EXTS = new Set(Object.values(EXT_BY_MIME));

/** File extension for the archived object — from the name, then the MIME type, else "bin". */
export function documentExtension(file: { name: string; type?: string }): string {
  const fromName = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (fromName && fromName !== file.name.toLowerCase() && SAFE_EXTS.has(fromName)) return fromName;
  const fromType = file.type ? EXT_BY_MIME[file.type.toLowerCase()] : undefined;
  return fromType ?? "bin";
}

/** MIME type to store with the object — the bucket only accepts the list in the migration. */
export function documentContentType(file: { name: string; type?: string }): string {
  const ext = documentExtension(file);
  return MIME_BY_EXT[ext] ?? (file.type || "application/octet-stream");
}

/** `{clientId}/{artifactId}.{ext}` — the row's storage_path and the object name. */
export function clientDocumentPath(clientId: string, artifactId: string, ext: string): string {
  return `${clientId}/${artifactId}.${ext}`;
}

export type ClientDocumentMeta = {
  file_name: string;
  bytes: number;
  mime: string;
  source: UploadSource;
  account_label?: string;
};

/** Read the meta blob defensively — rows may predate this shape. */
export function parseDocumentMeta(meta: unknown): Partial<ClientDocumentMeta> {
  if (!meta || typeof meta !== "object") return {};
  const m = meta as Record<string, unknown>;
  return {
    file_name: typeof m.file_name === "string" ? m.file_name : undefined,
    bytes: typeof m.bytes === "number" ? m.bytes : undefined,
    mime: typeof m.mime === "string" ? m.mime : undefined,
    source:
      m.source === "bank_pack" || m.source === "cash_pack" || m.source === "financial_statement"
        ? m.source
        : undefined,
    account_label: typeof m.account_label === "string" ? m.account_label : undefined,
  };
}

export function formatBytes(bytes: number | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
