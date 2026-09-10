/**
 * Shared Milōn Bot product copy + intent routing.
 * One chat surface; two existing backends (ask-ai numbers, milon-bot brain tools).
 */

export const MILON_BOT_TITLE = "Milōn Bot";
export const MILON_BOT_SUBTITLE = "powered by Claude";

export const MILON_BOT_BLURB_ACCOUNTANT =
  "Your client's numbers and Client Brain, in one chat. Ask anything grounded in what's already on file — health, cash, margins, what's blocking, invite status — and it can draft next steps or an advisory pack for you to review. It won't invent figures, mint invites, or send email.";

export const MILON_BOT_BLURB_OWNER =
  "Your numbers and Client Brain, in one chat. Ask anything grounded in what's already on file — health, cash, margins, what's still outstanding — and it can draft next steps for you to review. It won't invent figures, mint invites, or send email.";

export const MILON_BOT_ACCOUNTANT_CHIPS = [
  "What's the biggest drag on this client's score vs peers?",
  "Where should we focus before the next owner call?",
  "What's still outstanding on the brain, and is the invite redeemed?",
  "Propose next steps from what's on file.",
  "Draft an advisory pack from the brain — don't send it.",
];

export const MILON_BOT_OWNER_CHIPS = [
  "Am I healthy overall, or should I worry?",
  "Where's cash pressure showing up without the raw balances?",
  "Can I afford a hire based on what's on the board?",
  "What's still outstanding that my accountant needs from me?",
  "Propose next steps I can actually take this week.",
];

export type MilonBotIntent = "ask-ai" | "milon-bot";

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

export function deriveMilonBotEndpoint(askAiEndpoint: string | undefined | null): string | null {
  if (!askAiEndpoint) return null;
  const swapped = askAiEndpoint.replace(/\/functions\/v1\/ask-ai\/?$/, "/functions/v1/milon-bot");
  return swapped === askAiEndpoint ? null : swapped;
}
