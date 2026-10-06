/**
 * Node text-layer extract for PDF statement uploads.
 * Images have no text layer and stay on the document path.
 * Same unpdf major as the edge function (esm.sh/unpdf@0.12.1).
 */
import { extractText, getDocumentProxy } from "unpdf";
import {
  isImageMedia,
  isPdfMedia,
  statementModelParts,
  type StatementContentPart,
  type StatementTextQuality,
} from "./statement-text-layer.ts";
import type { IdentifierSubject, RedactionSession } from "./redact-identifiers.ts";

function base64ToBytes(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, "base64"));
}

/** Text layer of a PDF. Empty string when the file is not a readable text PDF. */
export async function extractPdfTextLayer(base64: string): Promise<string> {
  const bytes = base64ToBytes(base64);
  if (bytes.byteLength === 0 || bytes.byteLength > 20 * 1024 * 1024) return "";
  const pdf = await getDocumentProxy(bytes);
  try {
    // mergePages replaces every newline with a space, which detaches statement rows.
    const { text } = await extractText(pdf, { mergePages: false });
    return Array.isArray(text) ? text.join("\n") : String(text ?? "");
  } finally {
    await pdf.destroy();
  }
}

export async function loadStatementText(input: {
  base64: string;
  mediaType: string;
  fileName?: string | null;
}): Promise<string> {
  if (isImageMedia(input.mediaType)) return "";
  if (!isPdfMedia(input.mediaType, input.fileName)) return "";
  try {
    return await extractPdfTextLayer(input.base64);
  } catch {
    return "";
  }
}

export async function prepareStatementContent(input: {
  base64: string;
  mediaType: string;
  fileName?: string | null;
  accountLabel?: string | null;
  instructions?: string;
  layout: "financial" | "bank";
  subject?: IdentifierSubject;
  session?: RedactionSession;
}): Promise<{
  parts: StatementContentPart[];
  session: RedactionSession;
  quality: StatementTextQuality;
  usedTextLayer: boolean;
  extractedText: string;
}> {
  const extractedText = await loadStatementText({
    base64: input.base64,
    mediaType: input.mediaType,
    fileName: input.fileName,
  });
  return {
    ...statementModelParts({
      extractedText,
      document: { mediaType: input.mediaType, base64: input.base64 },
      fileName: input.fileName,
      accountLabel: input.accountLabel,
      instructions: input.instructions,
      layout: input.layout,
      subject: input.subject,
      session: input.session,
    }),
    extractedText,
  };
}
