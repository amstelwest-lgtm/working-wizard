/**
 * ZA-only Tax Specialist card and filing refusal.
 * The client route loads this with a dynamic import after the geo pack is ZA.
 * A non-ZA page must not static-import it: the greeting names SARS.
 */
import { publicProspectAgent, PROSPECT_TAX_SLUG, type ProspectAgentCopy } from "./prospect-talk.ts";

const card = publicProspectAgent(PROSPECT_TAX_SLUG);

export const TAX_TALK: ProspectAgentCopy & { filingReply: string } = {
  slug: PROSPECT_TAX_SLUG,
  face: "tax_specialist" as const,
  role: card?.role ?? "Tax Specialist",
  greeting:
    "I'm the Milōn Tax Specialist. I prepare a labelled SAMPLE company tax worksheet for an accountant to review and sign off. I do not log into SARS, and I do not file or submit anything.",
  questions: card?.questions ?? [
    "Is this a standard resident company?",
    "When does the year of assessment end?",
  ],
  filingReply:
    "I do not log into SARS and I do not file or submit anything. An accountant reviews and signs off. This page only shows a labelled SAMPLE.",
};

export function taxFilingAsked(message: string): boolean {
  return /sars|e-?filing|log\s*in|sign\s*in|submit (my |a |the )?(return|tax|irp6|itr14)|file (my |a |the )?(tax|return)/i.test(
    message,
  );
}
