/**
 * Text/CSV statement payload for extract-financials.
 * PDFs go through statementModelParts: a good text layer is redacted text,
 * and a scan or low-quality extract keeps the original document bytes.
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
