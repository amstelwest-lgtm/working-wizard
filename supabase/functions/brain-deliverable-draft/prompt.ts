/**
 * Outgoing deliverable-draft prompt. Identifiers are stripped here, before Claude.
 */
import {
  applyRedaction,
  createRedactionSession,
  type IdentifierSubject,
  type RedactionSession,
} from "../_shared/redact-identifiers.ts";

export function buildDeliverableDraftPayload(input: {
  system: string;
  contextLines: string[];
  subject?: IdentifierSubject;
}): { system: string; user: string; session: RedactionSession } {
  const session = createRedactionSession(input.subject);
  const user = `Draft one advisory pack from this client brain. Empty body and empty assumptions when evidence is missing.\n\n${input.contextLines.join("\n")}`;
  return {
    system: applyRedaction(input.system, session),
    user: applyRedaction(user, session),
    session,
  };
}
