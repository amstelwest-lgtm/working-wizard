/**
 * Display names for the three bots. src/lib/milon-team.ts is the app API.
 * Edge functions import this file so they do not pull the app alias.
 */
export const AGENT_DISPLAY_NAME = {
  financial_manager: "Milōn Financial Manager",
  analyst: "Milōn Analyst",
  advisor: "Milōn Advisor",
} as const;

export function agentDisplayNameFromKey(agent: string): string | null {
  if (agent === "financial_manager" || agent === "analyst" || agent === "advisor") {
    return AGENT_DISPLAY_NAME[agent];
  }
  return null;
}
