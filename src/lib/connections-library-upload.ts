/**
 * Connections → Client library upload.
 *
 * File rules only. The panel reuses `extractFinancialsFromPDF` (Claude Sonnet
 * 5.5, the same call as the statement uploader) and `archiveUploads` (the
 * client-documents bucket the Client library already lists).
 */

import { fileExtension, isPdfFile } from "@/lib/spreadsheet-text";

export const LIBRARY_UPLOAD_ACCEPT = ".pdf,.csv,.xlsx,.xls,.xlsm";

export const LIBRARY_DOCUMENT_TYPES = [
  { id: "financial_statement", label: "Financial statement" },
  { id: "management_accounts", label: "Management accounts" },
  { id: "bank_statement", label: "Bank statement" },
  { id: "aged", label: "Aged debtors and creditors" },
  { id: "budget", label: "Budget" },
  { id: "tax", label: "Tax document" },
  { id: "other", label: "Other" },
] as const;

export type LibraryDocumentTypeId = (typeof LIBRARY_DOCUMENT_TYPES)[number]["id"];

const EXCEL_EXT = new Set(["xlsx", "xls", "xlsm"]);
const EXCEL_MIME = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.ms-excel.sheet.macroenabled.12",
]);

export type LibraryFileKind = "pdf" | "csv" | "excel";

/** PDF, CSV, or Excel. OpenDocument and plain text stay on the statement uploader. */
export function libraryFileKind(file: { name: string; type?: string }): LibraryFileKind | null {
  if (isPdfFile(file)) return "pdf";
  const ext = fileExtension(file.name);
  const type = (file.type ?? "").toLowerCase();
  if (ext === "csv" || type === "text/csv") return "csv";
  if (EXCEL_EXT.has(ext) || EXCEL_MIME.has(type)) return "excel";
  return null;
}

export function libraryTypeLabel(typeId: string): string | null {
  return LIBRARY_DOCUMENT_TYPES.find((row) => row.id === typeId)?.label ?? null;
}

/**
 * The label stored on the library row. Other needs the accountant's words.
 * A blank label on a named type falls back to that type.
 */
export function libraryUploadLabel(typeId: string, custom: string): string | null {
  const fallback = libraryTypeLabel(typeId);
  if (!fallback) return null;
  const typed = custom.trim().replace(/\s+/g, " ");
  if (typeId === "other") return typed ? typed.slice(0, 80) : null;
  return (typed || fallback).slice(0, 80);
}

/** One line for the library row after Sonnet has read the file. */
export function libraryProcessingSummary(input: {
  entityName?: string | null;
  periodEnd?: string | null;
  notes?: string | null;
}): string {
  const notes = (input.notes ?? "").replace(/\s+/g, " ").trim();
  const head = [input.entityName?.trim(), input.periodEnd?.trim()].filter(Boolean).join(" · ");
  const text = [head, notes].filter(Boolean).join(". ");
  const clipped = text.slice(0, 400).trim();
  return clipped || "Read and saved to Client library.";
}

/**
 * A statement-quality miss still belongs in the library (the accountant named
 * the file). A missing key, a signed-out session, or a rate limit does not.
 */
export function librarySaveAfterReadError(message: string): boolean {
  return !/not configured|not signed in|unauthorised|unauthorized|rate limit/i.test(message);
}
