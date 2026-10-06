/**
 * Advisory drafter prompt. The model sees placeholders; the caller puts the
 * client name back into the draft before it is shown.
 */
import {
  applyRedaction,
  createRedactionSession,
  type IdentifierSubject,
  type RedactionSession,
} from "@/lib/redact-identifiers";

const KIND_INSTRUCTION = {
  client_email:
    "Draft a ready-to-send email from the accountant to the SME owner. Warm but direct. Lead with the single most important thing that changed and what it means for them in plain language (not jargon). Then 2–3 concrete actions, each tied to a real number from the brief. Close with one clear next step. No subject-line label inside the body; provide the subject separately as the first line prefixed with 'SUBJECT: '.",
  meeting_agenda:
    "Draft a tight agenda for this month's advisory meeting. 3–5 items, each a heading plus one line of context grounded in a real number from the brief, ordered by importance. End with a 'Decisions needed from you' section listing what the owner must decide.",
  exec_summary:
    "Write a single paragraph (4–6 sentences) 'state of the business' summary an owner could read in 30 seconds: where the business stands this period, the one thing that improved, the one thing to watch, and the one move to make. Plain language, specific numbers.",
} as const;

export type AdvisoryDraftKind = keyof typeof KIND_INSTRUCTION;

export function buildAdvisoryModelPayload(input: {
  kind: AdvisoryDraftKind;
  steer?: string | null;
  accountantName?: string | null;
  firmName?: string | null;
  tagline?: string | null;
  clientName: string;
  businessType?: string | null;
  operatingContext?: string | null;
  periodLabel: string;
  priorPeriodLabel?: string | null;
  hasPrior: boolean;
  runwayLabel?: string | null;
  movementLines: string[];
  signoffLines: string[];
  partyNames?: Array<string | null | undefined>;
}): { system: string; user: string; session: RedactionSession } {
  const subject: IdentifierSubject = {
    clientName: input.clientName,
    partyNames: [input.firmName, input.accountantName, ...(input.partyNames ?? [])],
  };
  const session = createRedactionSession(subject);
  const voice = [
    input.accountantName ? `Accountant: ${input.accountantName}` : null,
    input.firmName ? `Firm: ${input.firmName}` : null,
    input.tagline ? `Firm tagline / positioning: ${input.tagline}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  const system = `You are drafting an advisory deliverable that will go out under a real accountant's name to their SME client. It must sound like a trusted human advisor, not an AI.

HARD RULES:
- Never invent or estimate a number. Use only the figures in the brief below. If a needed figure is missing, work with what's there rather than guessing.
- Interpret movement with care: a ratio going "up" is not automatically good or bad — reason about what it means for THIS business (a ${input.businessType ?? "general"} SME).
- Respect the business profile below: revenue driver, cash timing, seasonality, stock intensity, customer concentration, debt position, and the owner's stated goal. Lead with what moves that goal, and flag concentration or debt risk when the numbers support it.
- Ground every claim in a specific figure from the brief. No generic filler advice.
- Plain language an owner understands. No accounting jargon without a plain-language gloss.
- Match the accountant's voice and firm positioning if provided.
${voice ? `\nACCOUNTANT VOICE:\n${voice}` : ""}

${KIND_INSTRUCTION[input.kind]}${input.steer ? `\n\nADDITIONAL STEER FROM THE ACCOUNTANT: ${input.steer}` : ""}`;

  const user = `CLIENT: ${input.clientName} (${input.businessType ?? "type not set"})
${input.operatingContext ? `BUSINESS PROFILE: ${input.operatingContext}` : ""}
CURRENT PERIOD: ${input.periodLabel}
${input.hasPrior ? `PRIOR PERIOD: ${input.priorPeriodLabel ?? ""}` : "PRIOR PERIOD: none — this is the first snapshot, so frame as a baseline, not a comparison."}
${input.runwayLabel ? `CASH RUNWAY: ${input.runwayLabel}` : ""}

WHAT MOVED (most significant first):
${input.movementLines.length ? input.movementLines.map((line) => `- ${line}`).join("\n") : "- No material movement to report this period."}

INTERVENTIONS THE ACCOUNTANT HAS SIGNED OFF THIS PERIOD:
${input.signoffLines.length ? input.signoffLines.map((line) => `- ${line}`).join("\n") : "- None recorded yet."}`;

  return {
    system: applyRedaction(system, session),
    user: applyRedaction(user, session),
    session,
  };
}
