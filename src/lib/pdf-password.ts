/**
 * Spots a password-protected PDF from its bytes, in the browser or on the
 * server. A PDF that names /Encrypt in its trailer needs its password. A
 * rare false positive only costs a prompt or a text-extraction attempt,
 * never a wrong read.
 */

export const PDF_ENCRYPT_HEAD_BYTES = 65_536;
export const PDF_ENCRYPT_TAIL_BYTES = 4_096;

export function pdfWindowsLookEncrypted(windows: readonly Uint8Array[]): boolean {
  const needle = "/Encrypt";
  for (const window of windows) {
    let text = "";
    for (const byte of window) text += String.fromCharCode(byte);
    if (text.includes(needle)) return true;
  }
  return false;
}

export function pdfLooksEncrypted(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, Math.min(bytes.length, PDF_ENCRYPT_HEAD_BYTES));
  const tail = bytes.subarray(Math.max(0, bytes.length - PDF_ENCRYPT_TAIL_BYTES));
  return pdfWindowsLookEncrypted([head, tail]);
}

/** Reads just the head and tail of a picked file — no whole-file read. */
export async function pickedPdfLooksEncrypted(file: {
  size: number;
  slice: (start: number, end?: number) => Blob;
}): Promise<boolean> {
  const head = new Uint8Array(
    await file.slice(0, Math.min(file.size, PDF_ENCRYPT_HEAD_BYTES)).arrayBuffer(),
  );
  const tail = new Uint8Array(
    await file.slice(Math.max(0, file.size - PDF_ENCRYPT_TAIL_BYTES)).arrayBuffer(),
  );
  return pdfWindowsLookEncrypted([head, tail]);
}
