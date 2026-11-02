/**
 * Client library tabs. Files already on the client — no new table.
 * A file can sit in more than one tab. All files is the overview.
 */
import { SEND_ITEM_LABELS, type SendItemKey } from "@/lib/client-agent-send";
import { formatBytes, uploadSourceLabel, type UploadSource } from "@/lib/client-documents";
import { libraryTypeLabel } from "@/lib/connections-library-upload";

export const CLIENT_LIBRARY_TABS = [
  "profit",
  "cash",
  "from-client",
  "review",
  "shared",
  "all",
] as const;

export type ClientLibraryTab = (typeof CLIENT_LIBRARY_TABS)[number];

export const CLIENT_LIBRARY_DEFAULT_TAB: ClientLibraryTab = "all";

export const CLIENT_LIBRARY_TAB_LABEL: Record<ClientLibraryTab, string> = {
  profit: "Profit & loss",
  cash: "Cash & bank",
  "from-client": "From client",
  review: "Needs review",
  shared: "Shared",
  all: "All files",
};

export const CLIENT_LIBRARY_TAB_SENTENCE: Record<ClientLibraryTab, string> = {
  profit: "Profit and loss, management accounts, and budgets, by year.",
  cash: "Bank statements and aged balances, by year.",
  "from-client": "Files the client sent or uploaded, by year.",
  review: "Files still waiting to be read or approved, by year.",
  shared: "Files the client shared with the accountant, by year.",
  all: "Every file on this client, by year.",
};

const PROFIT_TYPES = new Set([
  "financial_statement",
  "management_accounts",
  "budget",
  "income_statement",
  "balance_sheet",
  "full_annual_financials",
  "profit_and_loss",
  "pl",
]);

const CASH_TYPES = new Set(["bank_statement", "aged", "cash"]);

const PROFIT_ITEM_KEYS = new Set(["practice_income_expenses"]);
const CASH_ITEM_KEYS = new Set(["bank_statements"]);

const FROM_CLIENT_SOURCES = new Set<UploadSource>([
  "client_agent_send",
  "bank_pack",
  "cash_pack",
  "financial_statement",
]);

const DOC_TYPE_LABEL: Record<string, string> = {
  bill: "Bill",
  receipt: "Receipt",
  bank_statement: "Bank statement",
  income_statement: "Profit and loss",
  balance_sheet: "Balance sheet",
  management_accounts: "Management accounts",
  full_annual_financials: "Annual financials",
  profit_and_loss: "Profit and loss",
};

export type LibraryFileOrigin = "upload" | "source";

export type LibraryFileInput = {
  id: string;
  name: string;
  at?: string | null;
  visibility?: string | null;
  source?: string | null;
  documentType?: string | null;
  itemKey?: string | null;
  accountLabel?: string | null;
  summary?: string | null;
  periodLabel?: string | null;
  bytes?: number | null;
  storagePath?: string | null;
  needsReview?: boolean;
  fromClient?: boolean;
  statusLabel?: string | null;
  origin?: LibraryFileOrigin;
  /** client_artifacts id when the row can be opened, shared, or removed. */
  uploadId?: string | null;
};

export type LibraryFile = {
  id: string;
  name: string;
  at: string | null;
  year: string;
  typeLabel: string;
  sourceLabel: string;
  summary: string;
  statusLabel: string;
  visibility: "shared" | "private" | "";
  visibilityLabel: string;
  storagePath: string | null;
  bytesLabel: string;
  needsReview: boolean;
  tabs: Array<Exclude<ClientLibraryTab, "all">>;
  origin: LibraryFileOrigin;
  uploadId: string | null;
};

export type LibraryYearGroup = {
  year: string;
  label: string;
  files: LibraryFile[];
};

const YEAR = /(19|20)\d{2}/g;

function yearsIn(text: string | null | undefined): string[] {
  if (!text) return [];
  return [...text.matchAll(YEAR)].map((match) => match[0]);
}

function lastYear(text: string | null | undefined): string | null {
  const found = yearsIn(text);
  return found.length ? found[found.length - 1] : null;
}

/** Period, then the read, then the file name, then the day it was saved. */
export function libraryYear(input: {
  periodLabel?: string | null;
  summary?: string | null;
  name?: string | null;
  at?: string | null;
}): string {
  const fromPeriod = lastYear(input.periodLabel);
  if (fromPeriod) return fromPeriod;
  const fromSummary = lastYear(input.summary);
  if (fromSummary) return fromSummary;
  const fromName = lastYear(input.name);
  if (fromName) return fromName;
  const iso = (input.at ?? "").match(/^(\d{4})-\d{2}-\d{2}/);
  if (iso) return iso[1];
  return "Undated";
}

export function libraryYearLabel(year: string): string {
  return year === "Undated" ? "No year on file" : year;
}

function isUploadSource(value: string | null | undefined): value is UploadSource {
  return (
    value === "bank_pack" ||
    value === "cash_pack" ||
    value === "financial_statement" ||
    value === "client_agent_send" ||
    value === "connections"
  );
}

function typeLabel(input: LibraryFileInput): string {
  const type = (input.documentType ?? "").trim().toLowerCase();
  if (type) {
    const named = libraryTypeLabel(type);
    if (named) return named;
    if (DOC_TYPE_LABEL[type]) return DOC_TYPE_LABEL[type];
  }
  const item = (input.itemKey ?? "").trim();
  if (item && item in SEND_ITEM_LABELS) return SEND_ITEM_LABELS[item as SendItemKey];
  if (isUploadSource(input.source)) return uploadSourceLabel(input.source);
  return "File";
}

function sourceLabel(input: LibraryFileInput): string {
  if (isUploadSource(input.source)) return uploadSourceLabel(input.source);
  if (input.fromClient) return "From the client";
  return "On file";
}

/**
 * A Send-an-agent file belongs in From client, and in Needs review until
 * the firm marks that send reviewed. `reviewed: true` on the artifact meta
 * is the only way it leaves the review tab.
 */
export function clientSendLibraryFlags(meta: Record<string, unknown> | null | undefined): {
  fromClient: true;
  needsReview: boolean;
  statusLabel: string;
} | null {
  if (!meta || meta.source !== "client_agent_send") return null;
  const reviewed = meta.reviewed === true;
  return {
    fromClient: true,
    needsReview: !reviewed,
    statusLabel: reviewed ? "Reviewed" : "Waiting to be read",
  };
}

export function classifyLibraryFile(input: LibraryFileInput): LibraryFile {
  const type = (input.documentType ?? "").trim().toLowerCase();
  const item = (input.itemKey ?? "").trim().toLowerCase();
  const source = isUploadSource(input.source) ? input.source : null;
  const visibility =
    input.visibility === "shared" || input.visibility === "private" ? input.visibility : "";
  const tabs: LibraryFile["tabs"] = [];
  if (PROFIT_TYPES.has(type) || source === "financial_statement" || PROFIT_ITEM_KEYS.has(item)) {
    tabs.push("profit");
  }
  if (
    CASH_TYPES.has(type) ||
    source === "bank_pack" ||
    source === "cash_pack" ||
    CASH_ITEM_KEYS.has(item)
  ) {
    tabs.push("cash");
  }
  if (input.fromClient || (source != null && FROM_CLIENT_SOURCES.has(source))) {
    tabs.push("from-client");
  }
  if (input.needsReview) tabs.push("review");
  if (visibility === "shared") tabs.push("shared");

  const summary = [input.accountLabel?.trim(), input.summary?.trim()].filter(Boolean).join(" · ");
  return {
    id: input.id,
    name: input.name.trim() || "File",
    at: input.at ?? null,
    year: libraryYear({
      periodLabel: input.periodLabel,
      summary: input.summary,
      name: input.name,
      at: input.at,
    }),
    typeLabel: typeLabel(input),
    sourceLabel: sourceLabel(input),
    summary,
    statusLabel: (input.statusLabel ?? "").trim(),
    visibility,
    visibilityLabel: visibility === "shared" ? "Shared" : visibility === "private" ? "Private" : "",
    storagePath: input.storagePath ?? null,
    bytesLabel: formatBytes(input.bytes ?? undefined),
    needsReview: Boolean(input.needsReview),
    tabs,
    origin: input.origin ?? "upload",
    uploadId: input.uploadId ?? (input.origin === "source" ? null : input.id),
  };
}

export function libraryFilesForTab(
  files: readonly LibraryFile[],
  tab: ClientLibraryTab,
  query: string,
): LibraryFile[] {
  const q = query.trim().toLowerCase();
  return files.filter((file) => {
    if (tab !== "all" && !file.tabs.includes(tab)) return false;
    if (!q) return true;
    const hay = [
      file.name,
      file.typeLabel,
      file.sourceLabel,
      file.summary,
      file.statusLabel,
      file.visibilityLabel,
      file.year,
      file.bytesLabel,
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

export function groupLibraryFilesByYear(files: readonly LibraryFile[]): LibraryYearGroup[] {
  const buckets = new Map<string, LibraryFile[]>();
  for (const file of files) {
    const list = buckets.get(file.year) ?? [];
    list.push(file);
    buckets.set(file.year, list);
  }
  const years = [...buckets.keys()].sort((a, b) => {
    if (a === "Undated") return 1;
    if (b === "Undated") return -1;
    return Number(b) - Number(a);
  });
  return years.map((year) => ({
    year,
    label: libraryYearLabel(year),
    files: (buckets.get(year) ?? []).slice().sort((a, b) => {
      const at = (b.at ?? "").localeCompare(a.at ?? "");
      if (at !== 0) return at;
      return a.name.localeCompare(b.name);
    }),
  }));
}

export function libraryReviewCount(files: readonly LibraryFile[]): number {
  return files.filter((file) => file.tabs.includes("review")).length;
}

/** Keep the other tabs. Shared is only the visibility flag. */
export function libraryFileWithVisibility(
  file: LibraryFile,
  visibility: "shared" | "private",
): LibraryFile {
  const tabs: LibraryFile["tabs"] = file.tabs.filter((tab) => tab !== "shared");
  if (visibility === "shared") tabs.push("shared");
  return {
    ...file,
    visibility,
    visibilityLabel: visibility === "shared" ? "Shared" : "Private",
    tabs,
  };
}

export function libraryEmptyCopy(tab: ClientLibraryTab, query: string): string {
  if (query.trim()) return "No files match that search.";
  if (tab === "profit") return "No profit and loss files for this client yet.";
  if (tab === "cash") return "No cash and bank files for this client yet.";
  if (tab === "from-client") return "Nothing has come in from the client yet.";
  if (tab === "review") return "Nothing is waiting for review.";
  if (tab === "shared") return "No shared files yet. Files the client marks shared appear here.";
  return "Nothing in the library yet. Files from Connections, and files the client shares, appear here.";
}

/**
 * A source document still needs a person when it is unread, unreadable, or
 * waiting on approve. A bank statement that stays on file does not.
 */
export function sourceDocumentNeedsReview(input: {
  status: string;
  docType?: string | null;
  proposalStatus?: string | null;
}): boolean {
  const status = input.status;
  const proposal = input.proposalStatus ?? "";
  if (status === "duplicate" || status === "rejected_intake") return false;
  if (proposal === "approved" || proposal === "posted" || proposal === "rejected") return false;
  if (proposal === "proposed" || proposal === "failed") return true;
  const docType = (input.docType ?? "").toLowerCase();
  if (docType === "bank_statement") return false;
  if (status === "extracted" && docType && docType !== "bill" && docType !== "receipt")
    return false;
  return (
    status === "received" ||
    status === "extracting" ||
    status === "extracted" ||
    status === "extract_failed" ||
    status === "proposed"
  );
}

function sourceStatusLabel(input: {
  status: string;
  proposalStatus?: string | null;
  needsReview: boolean;
}): string {
  const proposal = input.proposalStatus ?? "";
  if (proposal === "approved" || proposal === "posted") return "Approved";
  if (proposal === "rejected" || input.status === "rejected_intake") return "Rejected";
  if (input.status === "duplicate") return "Duplicate";
  if (proposal === "failed" || input.status === "extract_failed") return "Could not be read";
  if (proposal === "proposed") return "Needs approval";
  if (input.needsReview) return "Waiting to be read";
  return "On file";
}

function fileNameFromPath(path: string | null | undefined): string {
  const name = (path ?? "").split("/").pop() ?? "";
  return name || "Document";
}

function latestByDocument<T extends { document_id: string; created_at?: string | null }>(
  rows: readonly T[],
): Map<string, T> {
  const map = new Map<string, T>();
  const sorted = [...rows].sort((a, b) =>
    String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")),
  );
  for (const row of sorted) map.set(row.document_id, row);
  return map;
}

export function libraryFilesFromSourceRows(input: {
  documents: ReadonlyArray<{
    id: string;
    storage_path: string;
    status: string;
    received_at?: string | null;
  }>;
  extractions: ReadonlyArray<{
    document_id: string;
    doc_type?: string | null;
    created_at?: string | null;
  }>;
  proposals: ReadonlyArray<{
    document_id: string;
    status: string;
    doc_type?: string | null;
    issued_on?: string | null;
    created_at?: string | null;
  }>;
}): LibraryFile[] {
  const extractions = latestByDocument(input.extractions);
  const proposals = latestByDocument(input.proposals);
  return input.documents.map((document) => {
    const extraction = extractions.get(document.id) ?? null;
    const proposal = proposals.get(document.id) ?? null;
    const docType = proposal?.doc_type || extraction?.doc_type || null;
    const needsReview = sourceDocumentNeedsReview({
      status: document.status,
      docType,
      proposalStatus: proposal?.status ?? null,
    });
    return classifyLibraryFile({
      id: `source:${document.id}`,
      name: fileNameFromPath(document.storage_path),
      at: document.received_at,
      documentType: docType,
      periodLabel: proposal?.issued_on ?? null,
      fromClient: true,
      needsReview,
      statusLabel: sourceStatusLabel({
        status: document.status,
        proposalStatus: proposal?.status ?? null,
        needsReview,
      }),
      origin: "source",
      uploadId: null,
    });
  });
}
