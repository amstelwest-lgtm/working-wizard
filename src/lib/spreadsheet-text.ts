/**
 * Turn any spreadsheet the owner is likely to have — Excel (.xlsx/.xls/.xlsm),
 * OpenDocument (.ods) or plain CSV/TSV — into CSV text, one block per sheet.
 * Claude reads text; it cannot open a workbook. Loaded lazily so the ~400 KB
 * SheetJS bundle only ships when someone actually picks a spreadsheet.
 */

export const SPREADSHEET_EXTENSIONS = ["xlsx", "xls", "xlsm", "ods", "fods"] as const;
export const TEXT_EXTENSIONS = ["csv", "tsv", "txt"] as const;

/** Extensions the financial / bank uploaders accept, in one place. */
export const UPLOAD_ACCEPT = ".pdf,.csv,.tsv,.txt,.xlsx,.xls,.xlsm,.ods";
/** Human label to match `UPLOAD_ACCEPT`. */
export const UPLOAD_FORMATS_LABEL = "PDF, Excel, OpenDocument or CSV";

export function fileExtension(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

export function isSpreadsheetFile(file: Pick<File, "name" | "type">): boolean {
  const ext = fileExtension(file.name);
  if ((SPREADSHEET_EXTENSIONS as readonly string[]).includes(ext)) return true;
  return (
    file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    file.type === "application/vnd.ms-excel" ||
    file.type === "application/vnd.oasis.opendocument.spreadsheet"
  );
}

export function isTextFile(file: Pick<File, "name" | "type">): boolean {
  const ext = fileExtension(file.name);
  if ((TEXT_EXTENSIONS as readonly string[]).includes(ext)) return true;
  return file.type === "text/csv" || file.type === "text/plain";
}

export function isPdfFile(file: Pick<File, "name" | "type">): boolean {
  return fileExtension(file.name) === "pdf" || file.type === "application/pdf";
}

/** CSV text for every sheet in a workbook, headed by the sheet name. */
export async function spreadsheetToText(file: File): Promise<string> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const parts: string[] = [];
  for (const name of wb.SheetNames) {
    parts.push(`--- Sheet: ${name} ---`);
    parts.push(XLSX.utils.sheet_to_csv(wb.Sheets[name]));
  }
  return parts.join("\n");
}

/** Text for anything Claude can read as text (spreadsheet → CSV, text as-is). */
export async function fileToText(file: File): Promise<string> {
  return isSpreadsheetFile(file) ? spreadsheetToText(file) : file.text();
}
