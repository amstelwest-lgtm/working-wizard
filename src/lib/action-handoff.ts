/**
 * Assignment labels for handing an action to one of the three agents.
 * Nothing here talks to the database or starts a run.
 */
import { agentShortName } from "./milon-team.ts";
import { AGENT_DISPLAY_NAME } from "./milon-team-names.ts";
import { AGENT_KEYS, type AgentKey } from "./milon-team-feed.ts";

const POSTER: Record<AgentKey, string> = {
  financial_manager: "/avatars/fm/fm-poster.webp",
  analyst: "/avatars/analyst/analyst-poster.webp",
  advisor: "/avatars/advisor/advisor-poster.webp",
};

/** Newest assignee label that names one of the three bots. */
export function agentKeyFromAssignee(name: string | null | undefined): AgentKey | null {
  const text = (name ?? "").trim();
  if (!text) return null;
  for (const agent of AGENT_KEYS) {
    if (text === AGENT_DISPLAY_NAME[agent] || text === agentShortName(agent)) return agent;
  }
  return null;
}

export function agentPosterSrc(agent: AgentKey): string {
  return POSTER[agent];
}

export function handoffButtonLabel(agent: AgentKey, assigned: boolean): string {
  if (assigned) return `Assigned to ${agentShortName(agent)} ✓`;
  return `Hand to ${AGENT_DISPLAY_NAME[agent]}`;
}

/**
 * Progress line once a queued run exists for this action.
 * A hand-off that has not started a run stays on the assignee label only.
 */
export function handoffProgressCaption(
  agent: AgentKey,
  status: string | null | undefined,
): string | null {
  const short = agentShortName(agent);
  if (status === "queued") return `${short} is queued`;
  if (status === "running") return `${short} picked this up`;
  if (status === "succeeded" || status === "partial") return `${short} finished a pass`;
  return null;
}
