/**
 * Solution plays for the Implementation Manager plan.
 * Each play is emitted only when the capability manifest already lists the
 * agent tool or classifier that backs it. The questions and schedules are
 * the accountant-facing copy. This is not a second capability list.
 * Routines are defaults. The accountant can change them later. There is no
 * routine editor here, and nothing in this module sends or files.
 */
import type { ImCapabilityManifest } from "./im-capability-manifest.ts";

export type SolutionPlayBot = "Financial Manager" | "Analyst" | "Advisor" | "Tax Specialist";

export type SolutionPlayCountry = "US" | "ZA" | "UK";

export type SolutionPlay = {
  id: string;
  order: number;
  question: string;
  output: string;
  routine: string;
  clientSees: string;
  bot: SolutionPlayBot;
  /** Real feature module. The play is still omitted when the manifest gate fails. */
  source: string;
  signals: RegExp;
};

export const IM_PLAN_APPROVE =
  "You approve each email before it goes. After 3 clean approvals you can switch on auto-send.";

const TAX_ASK = "It asks the client to send the documents on the list. Nothing is filed.";

const TAX_COPY: Record<SolutionPlayCountry | "none", { output: string; clientSees: string }> = {
  US: {
    output: "Sales-tax prep for accountant review (no filing).",
    clientSees: `A reminder and document list for the IRS and sales tax. ${TAX_ASK}`,
  },
  ZA: {
    output: "Tax deadline reminder and document list for SARS. Nothing is filed.",
    clientSees: `A reminder and document list for VAT201, EMP201, and provisional tax. ${TAX_ASK}`,
  },
  UK: {
    output: "Tax deadline reminder and document list for HMRC. Nothing is filed.",
    clientSees: `A reminder and document list for HMRC. ${TAX_ASK}`,
  },
  none: {
    output: "Tax deadline reminder and document list. Nothing is filed.",
    clientSees: `A reminder and document list. ${TAX_ASK}`,
  },
};

type PlaySeed = Omit<SolutionPlay, "output" | "clientSees"> & {
  output: string;
  clientSees: string;
  present: (manifest: ImCapabilityManifest) => boolean;
};

function hasTool(manifest: ImCapabilityManifest, displayName: string, label: string): boolean {
  return manifest.agents.some(
    (agent) => agent.displayName === displayName && agent.tools.includes(label),
  );
}

function hasStep(manifest: ImCapabilityManifest, stepType: string): boolean {
  return manifest.classifiers.some((row) => row.stepType === stepType);
}

const PLAY_SEEDS: readonly PlaySeed[] = [
  {
    id: "monthly-client-update",
    order: 1,
    question: "How do your clients find out what you did this month?",
    output: "Drafted email covering what was done, what was found, and next steps",
    routine: "Every month, after the close",
    clientSees: "A short email with 3 next steps. It asks the client to confirm those steps.",
    bot: "Advisor",
    source: "src/lib/agent-advisor.ts",
    signals: /\b(client updates?|monthly updates?|what (?:you|we) did|next steps|find out what)\b/i,
    present: (manifest) => hasTool(manifest, "Advisor", "Draft"),
  },
  {
    id: "document-collection",
    order: 2,
    question: "How do you get the documents you are still waiting on?",
    output: "Emailed link, checklist, and uploads",
    routine: "When a document is still missing",
    clientSees:
      "A link with a checklist that ticks off as files arrive. It asks the client to upload what is missing.",
    bot: "Financial Manager",
    source: "src/lib/client-agent-send.functions.ts",
    signals: /\b(invoices?|bank statements?|pdfs?|uploads?|attachments?|checklists?|send an agent|documents?)\b/i,
    present: (manifest) => hasTool(manifest, "Financial Manager", "Client sends"),
  },
  {
    id: "diagnose",
    order: 3,
    question: "What should this client fix first?",
    output: "Health check and DuPont diagnosis",
    routine: "When the month's books are in",
    clientSees: "The 3 things to fix first. It asks the client which one they will take.",
    bot: "Analyst",
    source: "src/lib/dupont-diagnosis.ts",
    signals: /\b(diagnos\w*|health check|dupont|fix first)\b/i,
    present: (manifest) => hasTool(manifest, "Analyst", "Health"),
  },
  {
    id: "management-pack",
    order: 4,
    question: "What do you hand the client at month end?",
    output: "Advisory PDF pack",
    routine: "Every month, after the close",
    clientSees: "A signed-off PDF. It asks the client to read it.",
    bot: "Analyst",
    source: "src/lib/advisory-pack-pdf.ts",
    signals:
      /\b(management packs?|month-?end|bookkeeping|books|management reports?|client reporting|sign-?off|signs off|who signs|signs the pack)\b/i,
    present: (manifest) =>
      hasTool(manifest, "Analyst", "Management report") && hasStep(manifest, "client_reporting"),
  },
  {
    id: "cash-flow",
    order: 5,
    question: "Will cash run short in the next 13 weeks?",
    output: "13-week cash forecast with a red-week warning",
    routine: "Every week",
    clientSees:
      "A warning if cash is short within 13 weeks. It asks the client to look at the short weeks.",
    bot: "Financial Manager",
    source: "src/lib/agent-financial-manager.ts",
    signals: /\b(13-?weeks?|cash)\b/i,
    present: (manifest) =>
      hasTool(manifest, "Financial Manager", "13-week cash") && hasStep(manifest, "cash_forecast"),
  },
  {
    id: "profit-waterfall",
    order: 6,
    question: "Where did the profit go?",
    output: "Profit bridge",
    routine: "Every month, after the close",
    clientSees: "Where profit went, step by step. It asks the client to confirm the story.",
    bot: "Analyst",
    source: "src/lib/profit-bridge-steps.ts",
    signals: /\b(profit bridge|waterfall|profit)\b/i,
    present: (manifest) =>
      hasTool(manifest, "Analyst", "Statements") && hasStep(manifest, "client_reporting"),
  },
  {
    id: "budget",
    order: 7,
    question: "Which lines are over budget?",
    output: "Budget versus actual drift",
    routine: "Every month, when the actuals land",
    clientSees: "Over-budget lines with one comment each. It asks the client to answer each comment.",
    bot: "Analyst",
    source: "src/lib/budget.variance.ts",
    signals: /\b(budgets?|over-?budget|variances?)\b/i,
    present: (manifest) =>
      hasTool(manifest, "Analyst", "Variance") && hasStep(manifest, "budget_variance"),
  },
  {
    id: "action-plan",
    order: 8,
    question: "Who is doing what, and by when?",
    output: "Action plan items and a PDF",
    routine: "Every month, with the client update",
    clientSees: "A to-do list with owners and dates. It asks the client to accept the owners and dates.",
    bot: "Advisor",
    source: "src/lib/action-plan-pdf.ts",
    signals: /\b(action plans?|to-?dos?|owners and dates)\b/i,
    present: (manifest) => hasTool(manifest, "Advisor", "Draft"),
  },
  {
    id: "tax-deadlines",
    order: 9,
    question: "Which tax dates are coming up?",
    output: TAX_COPY.none.output,
    routine: "When a tax date is inside 5 business days",
    clientSees: TAX_COPY.none.clientSees,
    bot: "Tax Specialist",
    source: "src/lib/im-routine-tax-deadlines.ts",
    signals:
      /\b(vat201|emp201|provisional|irp6|itr14|sars|hmrc|irs|sales-?tax|tax prep|vat returns?|tax returns?)\b|\bfile\b[^.]{0,48}\breturn\b|\breturn\b[^.]{0,48}\b(hmrc|sars|irs)\b/i,
    present: (manifest) =>
      hasTool(manifest, "Tax Specialist", "Tax drafts") && manifest.financeDeadlineSignals instanceof RegExp,
  },
];

/** Plays whose backing tool or classifier is on this manifest, in catalogue order. */
export function solutionPlays(manifest: ImCapabilityManifest): SolutionPlay[] {
  return PLAY_SEEDS.filter((seed) => seed.present(manifest)).map((seed) => ({
    id: seed.id,
    order: seed.order,
    question: seed.question,
    output: seed.output,
    routine: seed.routine,
    clientSees: seed.clientSees,
    bot: seed.bot,
    source: seed.source,
    signals: seed.signals,
  }));
}

export function playMarketCopy(
  play: SolutionPlay,
  country?: SolutionPlayCountry | null,
): { output: string; clientSees: string } {
  if (play.id !== "tax-deadlines") return { output: play.output, clientSees: play.clientSees };
  if (country === "US" || country === "ZA" || country === "UK") return TAX_COPY[country];
  return TAX_COPY.none;
}

export const SOLUTION_PLAY_IDS: readonly string[] = PLAY_SEEDS.map((seed) => seed.id);

export const DEFAULT_LEAD_PLAY_IDS = [
  "monthly-client-update",
  "document-collection",
  "cash-flow",
  "diagnose",
  "management-pack",
  "profit-waterfall",
  "budget",
  "action-plan",
  "tax-deadlines",
] as const;
