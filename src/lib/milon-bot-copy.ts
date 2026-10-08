/**
 * Shared Milōn Bot product copy + intent routing.
 * One chat surface; two existing backends (ask-ai numbers, milon-bot brain tools).
 */

export const MILON_BOT_TITLE = "Milōn Bot";
export const MILON_BOT_SUBTITLE = "Grounded in this client's file";

export const MILON_BOT_BLURB_ACCOUNTANT =
  "Your client's numbers and Client Brain, in one chat. Ask anything grounded in what's already on file — health, cash, margins, what's blocking, invite status — and it can draft next steps or an advisory pack for you to review. Start a job with \"Objective:\" and Milonbot will investigate, act only where MILŌN allows, and stop when it needs you. It won't invent figures, mint invites, or send email.";

export const MILON_BOT_BLURB_OWNER =
  "Your numbers and Client Brain, in one chat. Ask anything grounded in what's already on file — health, cash, margins, what's still outstanding — and it can draft next steps for you to review. Start a job with \"Objective:\" and Milonbot will investigate, act only where MILŌN allows, and stop when it needs you. It won't invent figures, mint invites, or send email.";

export const MILON_BOT_ACCOUNTANT_CHIPS = [
  "What's the biggest drag on this client's score vs peers?",
  "Where should we focus before the next owner call?",
  "What's still outstanding on the brain, and is the invite redeemed?",
  "Propose next steps from what's on file.",
  "Draft an advisory pack from the brain — don't send it.",
  "Objective: find the cash pressure and what still needs a human decision.",
];

export const MILON_BOT_OWNER_CHIPS = [
  "Am I healthy overall, or should I worry?",
  "Where's cash pressure showing up without the raw balances?",
  "Can I afford a hire based on what's on the board?",
  "What's still outstanding that my accountant needs from me?",
  "Propose next steps I can actually take this week.",
  "Objective: see whether an approved move can become a task this week.",
];

export type MilonBotIntent = "ask-ai" | "milon-bot";

/** The team desk owns this node. The chat widget must not replace its children. */
export function teamDeskOwnsMount(container: { dataset?: { teamDesk?: string } } | null | undefined): boolean {
  return container?.dataset?.teamDesk === "1";
}

/**
 * Route a free-text question to the numbers copilot (ask-ai) or Client Brain
 * tools (milon-bot). Default is ask-ai so health / cash / hire questions stay
 * on the disclosure-tier board path.
 */
export function routeMilonIntent(question: string): MilonBotIntent {
  const q = question.toLowerCase().replace(/\s+/g, " ").trim();
  if (!q) return "ask-ai";

  if (
    /\binvite\b/.test(q) ||
    /\bredeem/.test(q) ||
    /\bblocker/.test(q) ||
    /\boutstanding\b/.test(q) ||
    /\bon (the )?brain\b/.test(q) ||
    /\bfrom (the )?brain\b/.test(q) ||
    /\bpropose next steps\b/.test(q) ||
    /\bdraft (an )?(advisory|deliverable|pack)\b/.test(q) ||
    /\badvisory pack\b/.test(q) ||
    /\baccountant needs from me\b/.test(q) ||
    /\bdon'?t send\b/.test(q) ||
    (/\bon file\b/.test(q) && /\b(propose|draft|outstanding|brain)\b/.test(q))
  ) {
    return "milon-bot";
  }
  return "ask-ai";
}

/**
 * "Objective: …" starts an agent run. A bare question stays on the chat path.
 * The body must be long enough to be a real job, not a stray prefix.
 */
export type PersistedCreateIntent = {
  draft: boolean;
  actions: boolean;
  pdf: boolean;
};

/** Button label. The click sends DRAFT_ADVISORY_PACK_COMMAND through the create path. */
export const DRAFT_ADVISORY_PACK_LABEL = "Draft the Advisory Pack";

/** Unambiguous imperative. Question wording must not be substituted for this. */
export const DRAFT_ADVISORY_PACK_COMMAND = "Draft the advisory pack now";

/**
 * A question asks. It must never be treated as an instruction to write.
 * "Which deliverable should I prepare first?" is a question even with "prepare".
 */
export function isQuestionPrompt(question: string): boolean {
  const q = question.toLowerCase().replace(/\s+/g, " ").trim();
  if (!q) return false;
  if (/\?\s*$/.test(q)) return true;
  if (/^(what|which|who|why|how|when|where|whose)\b/.test(q)) return true;
  if (/^(should|can|could|would|do|does|did|is|are|am|will)\b/.test(q)) return true;
  if (/\bshould i\b/.test(q)) return true;
  return false;
}

/**
 * Read question about which deliverable to prepare. The reply recommends;
 * the Draft button is the write.
 */
export function isDeliverableRecommendationQuestion(question: string): boolean {
  const q = question.toLowerCase().replace(/\s+/g, " ").trim();
  if (!isQuestionPrompt(q)) return false;
  return /\b(deliverable|advisory pack|pack)\b/.test(q);
}

/**
 * Questions that must write a draft and/or Action Plan rows, not only chat.
 * "create an advisory deliverable / action plan PDF" is the product case.
 * A question ("which deliverable should I prepare?") never writes, even when
 * it contains a create verb and the word deliverable.
 */
export function persistedCreateIntent(question: string): PersistedCreateIntent | null {
  const q = question.toLowerCase().replace(/\s+/g, " ").trim();
  if (!q) return null;
  if (isQuestionPrompt(q)) return null;
  if (/\b(don'?t|do not|never)\s+(create|draft|generate|build|write|make|prepare|produce)\b/.test(q)) {
    return null;
  }
  const verb = /\b(create|draft|generate|build|write|make|prepare|produce)\b/.test(q);
  if (!verb) return null;
  const pdf = /\bpdf\b/.test(q);
  const draft = pdf || /\b(advisory|deliverable|pack)\b/.test(q);
  const actions = /\b(action plan|actions|tasks)\b/.test(q);
  if (!draft && !actions) return null;
  return { draft, actions, pdf };
}

export function parseAgentObjective(question: string): string | null {
  const match = question.match(/^\s*objective\s*:\s*(.+)$/i);
  if (!match) return null;
  const body = match[1].replace(/\s+/g, " ").trim();
  return body.length >= 8 ? body.slice(0, 500) : null;
}

export function deriveMilonBotEndpoint(askAiEndpoint: string | undefined | null): string | null {
  if (!askAiEndpoint) return null;
  const swapped = askAiEndpoint.replace(/\/functions\/v1\/ask-ai\/?$/, "/functions/v1/milon-bot");
  return swapped === askAiEndpoint ? null : swapped;
}
