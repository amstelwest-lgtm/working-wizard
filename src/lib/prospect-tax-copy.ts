/**
 * Tax Specialist copy for /talk/tax-specialist.
 * Loaded by the client only after a ZA market check. The edge function
 * imports it too. A non-ZA visitor never receives this module from the route.
 */
export const TAX_TALK = {
  slug: "tax-specialist" as const,
  face: "tax_specialist" as const,
  role: "Tax Specialist",
  greeting:
    "I'm the Milōn Tax Specialist. I prepare a labelled SAMPLE company tax worksheet an accountant can check. I do not log into SARS, and I do not file anything.",
  questions: ["Is this a standard resident company?", "When does the year of assessment end?"],
  filingReply:
    "I do not log into SARS and I do not file anything. An accountant files. This page only shows a labelled SAMPLE.",
};

export function taxFilingAsked(message: string): boolean {
  return /sars|e-?filing|log\s*in|sign\s*in|file (my |a |the )?(tax|return)/i.test(message);
}
