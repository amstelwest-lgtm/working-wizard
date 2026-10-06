/**
 * Text-layer-first choice for PDF and image statement uploads.
 *
 * When the extracted text has enough label/amount rows, the model receives
 * redacted text and the original bytes are not sent. Scans (no text) and
 * low-quality extracts (columns detached, too little structure) keep the
 * original document. Bytes are never rewritten.
 *
 * Deno-safe: no Node APIs. The edge extract-financials function imports this.
 */
import {
  applyRedaction,
  createRedactionSession,
  type IdentifierSubject,
  type RedactionSession,
} from "./redact-identifiers.ts";

export const FINANCIAL_TEXT_MAX_CHARS = 120_000;
export const BANK_TEXT_MAX_CHARS = 400_000;

const MIN_CHARS = 40;
const MIN_PAIRED_LINES = 3;
const MIN_AMOUNTS = 4;

/**
 * Grouped or decimal amounts. Years and bare account-length integers are not
 * amounts: a column of account numbers must not look like a structured statement.
 */
const AMOUNT_RE =
  /\(?-?(?:[$£€]|R(?=\s?\d))\s?\d[\d ,]*(?:\.\d+)?\)?|\(?-?\d{1,3}(?:[ ,]\d{3})+(?:\.\d{1,2})?\)?|\(?-?\d+\.\d{2}\)?/g;

const DATE_RE =
  /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b|\b\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{2,4}\b/i;

export type StatementTextDecision = "text" | "document";
export type StatementTextReason = "good" | "empty" | "low_quality";

export type StatementTextQuality = {
  decision: StatementTextDecision;
  reason: StatementTextReason;
  chars: number;
  lines: number;
  pairedLines: number;
  amounts: number;
  /** Amounts that sit on a line with no label and no date. */
  bareAmounts: number;
  /** Amounts that share a line with a label or a date. */
  pairedAmounts: number;
};

export type StatementDocument = {
  mediaType: string;
  base64: string;
};

export type StatementContentPart =
  | { type: "text"; text: string }
  | {
      type: "document";
      source: { type: "base64"; media_type: string; data: string };
    };

export function isPdfMedia(mediaType: string, fileName?: string | null): boolean {
  const mime = mediaType.toLowerCase();
  return mime === "application/pdf" || (fileName ?? "").toLowerCase().endsWith(".pdf");
}

export function isImageMedia(mediaType: string): boolean {
  return mediaType.toLowerCase().startsWith("image/");
}

export function normalizeStatementText(text: string | null | undefined): string {
  return (text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\f/g, "\n").trim();
}

export function clipStatementText(text: string, maxChars: number): string {
  const normalized = normalizeStatementText(text);
  if (normalized.length <= maxChars) return normalized;
  const slice = normalized.slice(0, maxChars);
  const lastBreak = slice.lastIndexOf("\n");
  return (lastBreak > maxChars * 0.5 ? slice.slice(0, lastBreak) : slice).trim();
}

function amountsInLine(line: string): string[] {
  return line.match(AMOUNT_RE) ?? [];
}

function lineHasLabel(line: string): boolean {
  return /[A-Za-z]{2,}/.test(line);
}

/**
 * Good text keeps labels beside amounts. A column-major extract puts the
 * labels in one block and the figures in another, which is not safe to send
 * in place of the document.
 */
export function assessStatementTextQuality(text: string | null | undefined): StatementTextQuality {
  const normalized = normalizeStatementText(text);
  const rawLines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  let pairedLines = 0;
  let amounts = 0;
  let bareAmounts = 0;
  let pairedAmounts = 0;

  for (const line of rawLines) {
    const found = amountsInLine(line);
    const count = found.length;
    amounts += count;
    const paired = count > 0 && (lineHasLabel(line) || DATE_RE.test(line));
    if (paired) {
      pairedLines += 1;
      pairedAmounts += count;
    } else if (count > 0) {
      bareAmounts += count;
    }
  }

  const stats = {
    chars: normalized.length,
    lines: rawLines.length,
    pairedLines,
    amounts,
    bareAmounts,
    pairedAmounts,
  };

  if (stats.lines === 0 || stats.chars < MIN_CHARS) {
    return { decision: "document", reason: "empty", ...stats };
  }
  const scrambled = stats.bareAmounts >= 4 && stats.bareAmounts > stats.pairedAmounts;
  if (stats.amounts < MIN_AMOUNTS || stats.pairedLines < MIN_PAIRED_LINES || scrambled) {
    return { decision: "document", reason: "low_quality", ...stats };
  }
  return { decision: "text", reason: "good", ...stats };
}

function documentPart(document: StatementDocument): StatementContentPart {
  return {
    type: "document",
    source: {
      type: "base64",
      media_type: document.mediaType,
      data: document.base64,
    },
  };
}

/**
 * One statement file, already extracted. `extractedText` is "" for images and
 * for PDFs whose text layer could not be read.
 */
export function statementModelParts(input: {
  extractedText: string | null | undefined;
  document: StatementDocument;
  fileName?: string | null;
  accountLabel?: string | null;
  instructions?: string;
  layout: "financial" | "bank";
  subject?: IdentifierSubject;
  session?: RedactionSession;
  maxChars?: number;
}): {
  parts: StatementContentPart[];
  session: RedactionSession;
  quality: StatementTextQuality;
  usedTextLayer: boolean;
} {
  const session = input.session ?? createRedactionSession(input.subject);
  const maxChars =
    input.maxChars ?? (input.layout === "bank" ? BANK_TEXT_MAX_CHARS : FINANCIAL_TEXT_MAX_CHARS);
  const clipped = clipStatementText(input.extractedText ?? "", maxChars);
  const quality = assessStatementTextQuality(clipped);
  const fileName =
    input.fileName?.trim() || (input.layout === "bank" ? "statement.pdf" : "statement");
  const label = input.accountLabel?.trim() || "Bank account";

  if (quality.decision === "text") {
    const block =
      input.layout === "bank"
        ? `--- Bank statement file: ${fileName} | account: ${label} ---\n${clipped}`
        : `${input.instructions ?? ""}\n\nFile: ${fileName}\n\nContents:\n${clipped}`;
    return {
      parts: [{ type: "text", text: applyRedaction(block, session) }],
      session,
      quality,
      usedTextLayer: true,
    };
  }

  const caption =
    input.layout === "bank"
      ? `The previous PDF is bank statement file "${fileName}" for account "${label}".`
      : `${input.instructions ?? ""}\n\nFile: ${fileName}`;
  return {
    parts: [documentPart(input.document), { type: "text", text: applyRedaction(caption, session) }],
    session,
    quality,
    usedTextLayer: false,
  };
}
