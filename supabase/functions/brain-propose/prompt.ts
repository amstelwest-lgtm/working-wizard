/**
 * Outgoing brain-propose prompt. Identifiers are stripped here, before Claude.
 */
import {
  applyRedaction,
  createRedactionSession,
  type IdentifierSubject,
  type RedactionSession,
} from "../_shared/redact-identifiers.ts";

export function partyNamesInBrain(summary: unknown): string[] {
  if (!summary || typeof summary !== "object") return [];
  const blob = summary as Record<string, unknown>;
  const names: string[] = [];
  const comps = blob.competitors;
  if (!Array.isArray(comps)) return names;
  for (const item of comps) {
    if (typeof item === "string" && item.trim()) names.push(item.trim());
    else if (item && typeof item === "object") {
      const name = (item as { name?: unknown }).name;
      if (typeof name === "string" && name.trim()) names.push(name.trim());
    }
  }
  return names;
}

export function buildBrainProposePayload(input: {
  system: string;
  contextLines: string[];
  subject?: IdentifierSubject;
}): { system: string; user: string; session: RedactionSession } {
  const session = createRedactionSession(input.subject);
  const user = `Propose next steps from this client brain. Empty arrays when evidence is missing.\n\n${input.contextLines.join("\n")}`;
  return {
    system: applyRedaction(input.system, session),
    user: applyRedaction(user, session),
    session,
  };
}
