/**
 * Browser-tab title for an open agent.
 * The brand alone is the title until a shell is on screen, and again
 * after that shell goes away, so Tax Specialist never stays behind.
 */
export const AGENT_TITLE_BRAND = "Milōn";

const AGENT_TITLE_NAMES = ["Financial Manager", "Analyst", "Advisor", "Tax Specialist"] as const;

const AGENT_TITLE_MARK = ` — ${AGENT_TITLE_BRAND}`;

export function agentDocumentTitle(agentShortName: string | null | undefined): string {
  const name = (agentShortName ?? "").replace(/\s+/g, " ").trim();
  if (!name) return AGENT_TITLE_BRAND;
  return `${name}${AGENT_TITLE_MARK}`;
}

/** True only for the four agent shells. "Clients — Milōn" is a page title, not an agent. */
export function isAgentDocumentTitle(title: string): boolean {
  if (!title.endsWith(AGENT_TITLE_MARK)) return false;
  const name = title.slice(0, -AGENT_TITLE_MARK.length);
  return (AGENT_TITLE_NAMES as readonly string[]).includes(name);
}

/**
 * Title to put back when the agent shell unmounts.
 * A leftover agent title is not a page to return to.
 */
export function agentTitleBaseline(currentTitle: string): string {
  const current = currentTitle.trim();
  if (!current || isAgentDocumentTitle(current)) return AGENT_TITLE_BRAND;
  return currentTitle;
}

/** Leave the tab alone when another route already replaced the agent title. */
export function titleAfterAgentLeaves(
  activeTitle: string,
  currentTitle: string,
  baseline: string,
): string {
  return currentTitle === activeTitle ? baseline : currentTitle;
}
