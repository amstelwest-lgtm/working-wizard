/**
 * Accountant client deep links. Old emails, Bot answers, and PDFs still use
 * ?tab=actions (Action Plan) and ?tab=health (Health & Ratios). Rewrite them
 * in the route search parser so the studio never treats them as unknown and
 * falls through to Overview.
 */
const ACCOUNTANT_TAB_ALIASES: Record<string, string> = {
  actions: "plan",
  health: "ratios",
};

export function normalizeAccountantClientTab(tab: string): string {
  return ACCOUNTANT_TAB_ALIASES[tab] ?? tab;
}
