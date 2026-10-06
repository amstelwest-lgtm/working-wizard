/**
 * Text/CSV statement payload for extract-financials.
 * PDF document bytes are not rewritten here — see the document branch in index.ts.
 */
import {
  applyRedaction,
  createRedactionSession,
  type IdentifierSubject,
  type RedactionSession,
} from "../_shared/redact-identifiers.ts";

export function buildTextExtractionPayload(input: {
  instructions: string;
  fileName?: string | null;
  text: string;
  subject?: IdentifierSubject;
}): { text: string; session: RedactionSession } {
  const session = createRedactionSession(input.subject);
  const fileName = applyRedaction(input.fileName?.trim() || "statement", session);
  const instructions = applyRedaction(input.instructions, session);
  const body = applyRedaction(input.text, session);
  return {
    text: `${instructions}\n\nFile: ${fileName}\n\nContents:\n${body}`,
    session,
  };
}

/** Caption that rides alongside a PDF document. The PDF bytes are not redacted. */
export function buildPdfCaption(input: {
  instructions: string;
  fileName?: string | null;
  subject?: IdentifierSubject;
}): { text: string; session: RedactionSession } {
  const session = createRedactionSession(input.subject);
  const fileName = applyRedaction(input.fileName?.trim() || "statement.pdf", session);
  const instructions = applyRedaction(input.instructions, session);
  return { text: `${instructions}\n\nFile: ${fileName}`, session };
}
