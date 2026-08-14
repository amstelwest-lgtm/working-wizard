/**
 * Shared helpers for encoding bank statement files for Claude server fns.
 */

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

export async function encodeBankFileSlots(slots: BankFileSlot[]): Promise<BankFilePayload[]> {
  return Promise.all(
    slots.map(async ({ file, accountLabel }) => {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      if (ext === "csv" || ext === "txt") {
        return {
          fileName: file.name,
          accountLabel: accountLabel.trim() || "Bank account",
          text: await file.text(),
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
