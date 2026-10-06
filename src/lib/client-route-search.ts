/**
 * Accountant client deep links. Old emails, Bot answers, and PDFs still use
 * ?tab=actions (Action Plan) and ?tab=health (Health & Ratios). Rewrite them
 * in the route search parser so the studio never treats them as unknown and
 * falls through to Overview.
 *
 * ?tab=summary is the client overview (the first rail item). Client Brain's
 * own address is ?tab=brain — its in-app id stays "summary".
 */
const ACCOUNTANT_TAB_ALIASES: Record<string, string> = {
  actions: "plan",
  health: "ratios",
  summary: "overview",
  brain: "summary",
};

export function normalizeAccountantClientTab(tab: string): string {
  return ACCOUNTANT_TAB_ALIASES[tab] ?? tab;
}

/** Search value written when the studio selects a rail tab. */
export function accountantTabSearchParam(tab: string): string {
  if (tab === "summary") return "brain";
  return tab;
}
