/**
 * Turns one sent file into model-readable content, on the server only.
 * A password-protected PDF is opened here with the password the client
 * saved — the plaintext password and the document bytes never reach the
 * browser, and nothing is logged.
 */

export const TAX_PACK_PDF_DOCUMENT_MAX_BYTES = 8 * 1024 * 1024;
export const TAX_PACK_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const TAX_PACK_TEXT_MAX_CHARS = 60_000;

export type SendFileContent =
  | { kind: "pdf"; base64: string }
  | { kind: "text"; text: string }
  | { kind: "image"; base64: string; mediaType: "image/jpeg" | "image/png" }
  | { kind: "unreadable"; reason: "password" | "format" | "parse" };

/**
 * A PDF that names /Encrypt in its trailer needs its password. A rare
 * false positive only costs a text-extraction attempt, never a wrong read.
 */
export function pdfLooksEncrypted(bytes: Uint8Array): boolean {
  const needle = "/Encrypt";
  const tail = bytes.subarray(Math.max(0, bytes.length - 4096));
  const haystacks = [tail, bytes.subarray(0, Math.min(bytes.length, 65_536))];
  for (const window of haystacks) {
    let text = "";
    for (const byte of window) text += String.fromCharCode(byte);
    if (text.includes(needle)) return true;
  }
  return false;
}

export function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

async function pdfText(bytes: Uint8Array, password: string | null): Promise<SendFileContent> {
  const { PDFParse, PasswordException } = await import("pdf-parse");
  const parser = new PDFParse({
    data: new Uint8Array(bytes),
    ...(password ? { password } : {}),
  });
  try {
    const result = await parser.getText();
    const text = (result?.text ?? "").trim();
    if (!text) return { kind: "unreadable", reason: "parse" };
    return { kind: "text", text: text.slice(0, TAX_PACK_TEXT_MAX_CHARS) };
  } catch (error) {
    if (error instanceof PasswordException || (error as Error)?.name === "PasswordException") {
      return { kind: "unreadable", reason: "password" };
    }
    return { kind: "unreadable", reason: "parse" };
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

/**
 * PDF: a small open file goes to the model whole; an encrypted file is
 * opened with the saved password and read as text. JPEG and PNG go as
 * images. HEIC cannot be read and becomes a query, never a guess.
 */
export async function extractSendFileContent(input: {
  bytes: Uint8Array;
  mime: string;
  password: string | null;
}): Promise<SendFileContent> {
  if (input.mime === "image/jpeg" || input.mime === "image/png") {
    if (input.bytes.byteLength > TAX_PACK_IMAGE_MAX_BYTES) {
      return { kind: "unreadable", reason: "format" };
    }
    return { kind: "image", base64: bytesToBase64(input.bytes), mediaType: input.mime };
  }
  if (input.mime !== "application/pdf") return { kind: "unreadable", reason: "format" };

  const encrypted = pdfLooksEncrypted(input.bytes);
  if (!encrypted && input.bytes.byteLength <= TAX_PACK_PDF_DOCUMENT_MAX_BYTES) {
    return { kind: "pdf", base64: bytesToBase64(input.bytes) };
  }
  if (encrypted && !input.password) {
    // Try without a password first — the marker can be a false positive.
    const open = await pdfText(input.bytes, null);
    return open;
  }
  return pdfText(input.bytes, input.password);
}
