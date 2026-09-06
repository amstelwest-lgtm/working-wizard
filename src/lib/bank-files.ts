/**
 * Shared helpers for encoding bank statement files for Claude server fns.
 */

import { fileToText, isPdfFile, isSpreadsheetFile, isTextFile } from "@/lib/spreadsheet-text";

export type BankFilePayload = {
  fileName: string;
  accountLabel?: string;
  base64?: string;
  text?: string;
};

export type BankFileSlot = {
  file: File;
  /** User-facing bank account name, e.g. "Cheque — FNB" */
  accountLabel: string;
};

export const MAX_BANK_FILES = 12;
export const MAX_BANK_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_BANK_TOTAL_BYTES = 40 * 1024 * 1024;

/** Accept list for bank statement pickers: PDF plus any text/spreadsheet export. */
export const BANK_FILE_ACCEPT = ".pdf,.csv,.tsv,.txt,.xlsx,.xls,.xlsm,.ods";

/** Null when the file is usable; otherwise a user-facing reason. */
export function rejectBankFile(file: Pick<File, "name" | "type">): string | null {
  if (isPdfFile(file) || isTextFile(file) || isSpreadsheetFile(file)) return null;
  return `"${file.name}" is not a PDF, CSV or spreadsheet (Excel / OpenDocument) file.`;
}

export async function encodeBankFileSlots(slots: BankFileSlot[]): Promise<BankFilePayload[]> {
  return Promise.all(
    slots.map(async ({ file, accountLabel }) => {
      // Spreadsheet exports become CSV text per sheet — Claude reads text, not workbooks.
      if (isTextFile(file) || isSpreadsheetFile(file)) {
        return {
          fileName: file.name,
          accountLabel: accountLabel.trim() || "Bank account",
          text: await fileToText(file),
        };
      }
      const base64 = await new Promise<string>((res, rej) => {
        const reader = new FileReader();
        reader.onload = () => res(((reader.result as string).split(",")[1] ?? "") as string);
        reader.onerror = () => rej(new Error(`Could not read ${file.name}`));
        reader.readAsDataURL(file);
      });
      return {
        fileName: file.name,
        accountLabel: accountLabel.trim() || "Bank account",
        base64,
      };
    }),
  );
}

export const bankFilesZodShape = {
  fileName: true,
  accountLabel: true,
  base64: true,
  text: true,
} as const;
