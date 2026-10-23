/**
 * Turns one sent file into model-readable content, on the server only.
 * A password-protected PDF is opened here with the password the client
 * saved — the plaintext password and the document bytes never reach the
 * browser, and nothing is logged.
 *
 * Text is always preferred over shipping the PDF itself: a multi-file
 * send must not become one huge base64 payload. A PDF goes whole only
 * when it has no text layer (a scan) and is small; anything bigger is
 * left out and becomes a query the accountant sees.
 */
import { pdfLooksEncrypted } from "@/lib/pdf-password";

export { pdfLooksEncrypted };

export const TAX_PACK_PDF_DOCUMENT_MAX_BYTES = 3 * 1024 * 1024;
export const TAX_PACK_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const TAX_PACK_TEXT_MAX_CHARS = 60_000;

export type SendFileContent =
  | { kind: "pdf"; base64: string }
  | { kind: "text"; text: string }
  | { kind: "image"; base64: string; mediaType: "image/jpeg" | "image/png" }
  | { kind: "unreadable"; reason: "password" | "format" | "parse" | "oversized" };

export function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function isPasswordError(error: unknown): boolean {
  const named = error as { name?: string; message?: string } | null;
  return named?.name === "PasswordException" || /password/i.test(named?.message ?? "");
}

/** Never throws: a broken parser or a bad file is an unreadable result. */
async function pdfText(bytes: Uint8Array, password: string | null): Promise<SendFileContent> {
  let parser: { getText: () => Promise<{ text?: string }>; destroy: () => Promise<void> } | null =
    null;
  try {
    const { PDFParse } = await import("pdf-parse");
    parser = new PDFParse({
      data: new Uint8Array(bytes),
      ...(password ? { password } : {}),
    });
    const result = await parser.getText();
    const text = (result?.text ?? "").trim();
    if (!text) return { kind: "unreadable", reason: "parse" };
    return { kind: "text", text: text.slice(0, TAX_PACK_TEXT_MAX_CHARS) };
  } catch (error) {
    if (isPasswordError(error)) return { kind: "unreadable", reason: "password" };
    return { kind: "unreadable", reason: "parse" };
  } finally {
    await parser?.destroy().catch(() => undefined);
  }
}

/**
 * PDF: text first, with the saved password when the file is sealed. A PDF
 * with no text layer goes whole only when small; a bigger one is left out
 * as oversized. JPEG and PNG go as images. HEIC becomes a query, never a
 * guess.
 */
export async function extractSendFileContent(input: {
  bytes: Uint8Array;
  mime: string;
  password: string | null;
}): Promise<SendFileContent> {
  if (input.mime === "image/jpeg" || input.mime === "image/png") {
    if (input.bytes.byteLength > TAX_PACK_IMAGE_MAX_BYTES) {
      return { kind: "unreadable", reason: "oversized" };
    }
    return { kind: "image", base64: bytesToBase64(input.bytes), mediaType: input.mime };
  }
  if (input.mime !== "application/pdf") return { kind: "unreadable", reason: "format" };

  const text = await pdfText(input.bytes, input.password);
  if (text.kind === "text") return text;
  if (text.kind === "unreadable" && text.reason === "password") {
    // The marker can be a false positive the other way too: only report a
    // password problem when the bytes actually look sealed.
    return pdfLooksEncrypted(input.bytes) ? text : { kind: "unreadable", reason: "parse" };
  }
  // No text layer (a scan) or the parser is unavailable. Ship the PDF
  // whole only when it is open and small.
  if (pdfLooksEncrypted(input.bytes)) {
    return { kind: "unreadable", reason: input.password ? "parse" : "password" };
  }
  if (input.bytes.byteLength > TAX_PACK_PDF_DOCUMENT_MAX_BYTES) {
    return { kind: "unreadable", reason: "oversized" };
  }
  return { kind: "pdf", base64: bytesToBase64(input.bytes) };
}
