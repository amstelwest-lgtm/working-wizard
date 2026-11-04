/**
 * Org and agent mission policy — single source for prompts and aligned copy.
 */

/** Authoritative org mission. */
export const MILON_ORG_MISSION =
  "Build the system that efficiently streamlines a team of financial bots to create sellable work for accountants by automatically producing valuable output and insights for client businesses from numbers already prepared by accountants.";

/** Short agent mission for system prompts and in-app purpose lines. */
export const MILON_AGENT_MISSION =
  "Create sellable work for accountants by automatically producing valuable output and insights for client businesses.";

/** Optional one-liner where the larger vision fits. */
export const MILON_VISION_TAGLINE =
  "The platform for accountants to manage financial bots for their clients — an AI finance team.";

/** Landing / about hero — aligned with MILON_ORG_MISSION, readable in marketing. */
export const MILON_ORG_MISSION_LANDING =
  "Milōn streamlines a team of financial bots so accountants get sellable work — valuable output and insights for client businesses from the numbers the firm already prepared.";

/** Homepage “finance function” bridge — vision + control, without rewriting the section. */
export const FINANCE_FUNCTION_PURPOSE =
  "Milōn is the platform for accountants to manage financial bots for their clients — an AI finance team that creates sellable work from prepared client numbers, while the accountant stays in control of the advice.";

/** Owner and accountant practice home — same lede for parity. */
export const MILON_HOME_LEDE =
  "Three agents turn the numbers on file into output and insights your accountant can sell — ask them anything, any time.";

/** ZA home when the tax specialist card is shown (three named agents + tax). */
export const MILON_HOME_LEDE_ZA =
  "Your agents turn the numbers on file into output and insights your accountant can sell — ask them anything, any time.";

/** Appended to ask-ai, milon-bot, and agent-runner chats via product facts. */
export function milonMissionPromptBlock(): string {
  return [
    "MILŌN MISSION",
    MILON_AGENT_MISSION,
    "Use figures the accountant's firm already prepared. Do not invent output that is not grounded in those numbers or in tool results.",
  ].join("\n");
}
