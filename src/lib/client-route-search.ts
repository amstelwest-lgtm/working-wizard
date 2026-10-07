/**
 * Accountant client deep links. Old emails, Bot answers, and PDFs still use
 * ?tab=actions (Action Plan) and ?tab=health (Health & Ratios). Rewrite them
 * in the route search parser so the studio never treats them as unknown and
 * falls through to Overview.
 */
const ACCOUNTANT_TAB_ALIASES: Record<string, string> = {
  actions: "plan",
  action: "plan",
  "action-plan": "plan",
  tasks: "plan",
  health: "ratios",
  pillars: "ratios",
  today: "ratios",
  "today-complex": "ratios",
  data: "summary",
  brain: "summary",
  "client-brain": "summary",
  waterfall: "profit",
  profitability: "profit",
  forecast: "cash",
  "cash-forecast": "cash",
  bot: "ask",
  "milon-bot": "ask",
  report: "reports",
  "strategic-moves": "moves",
};

export function normalizeAccountantClientTab(tab: string): string {
  return ACCOUNTANT_TAB_ALIASES[tab] ?? tab;
}

/**
 * Search to write when the accountant opens a studio tab.
 * Reports (and every other rail tab) must replace `tab` so a refresh
 * restores that tab instead of whatever was in the URL before the click.
 * Coach crumbs and an Action Plan filter do not stick to other tabs.
 */
export function accountantClientTabSearch<T extends object>(prev: T, tab: string): T {
  const normalized = normalizeAccountantClientTab(tab);
  const next = { ...prev, tab: normalized } as T & Record<string, unknown>;
  delete next.coach;
  delete next.why;
  delete next.focus;
  if (normalized !== "plan") delete next.filter;
  return next as T;
}
