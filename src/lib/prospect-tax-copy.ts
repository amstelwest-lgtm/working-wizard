/**
 * Server-side filing refusal for /talk/tax-specialist.
 * The public card lives in prospect-talk.ts so the index and the page
 * share one greeting. This module is not a client route import.
 */
import { publicProspectAgent, PROSPECT_TAX_SLUG } from "./prospect-talk.ts";

const card = publicProspectAgent(PROSPECT_TAX_SLUG);

export const TAX_TALK = {
  slug: PROSPECT_TAX_SLUG,
  face: "tax_specialist" as const,
  role: card?.role ?? "Tax Specialist",
  greeting: card?.greeting ?? "",
  questions: card?.questions ?? [],
  filingReply:
    "I do not log into SARS and I do not file or submit anything. An accountant reviews and signs off. This page only shows a labelled SAMPLE.",
};

export function taxFilingAsked(message: string): boolean {
  return /sars|e-?filing|log\s*in|sign\s*in|submit (my |a |the )?(return|tax|irp6|itr14)|file (my |a |the )?(tax|return)/i.test(
    message,
  );
}
