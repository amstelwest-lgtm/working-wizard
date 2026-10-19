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

/** Clock time for a finish line. An unreadable stamp stays off the row. */
export function handoffClock(at: string | null | undefined): string | null {
  if (!at) return null;
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/**
 * Progress line once a queued run exists for this action.
 * A hand-off that has not started a run stays on the assignee label only.
 * A finished run names the time and the result, and does not say "a pass".
 */
export function handoffProgressCaption(
  agent: AgentKey,
  status: string | null | undefined,
  detail?: { at?: string | null; result?: string | null },
): string | null {
  const short = agentShortName(agent);
  if (status === "queued") return `${short} is queued`;
  if (status === "running") return `${short} picked this up`;
  if (status === "succeeded" || status === "partial") {
    const time = handoffClock(detail?.at);
    const head = time ? `${short} finished · ${time}` : `${short} finished`;
    const result = detail?.result?.replace(/\s+/g, " ").trim();
    return result ? `${head} — ${result}` : head;
  }
  return null;
}

/**
 * The queue line belongs to the bot that owns the row.
 * A person assignee drops "Advisor is queued" even if that run is still stored.
 */
export function botPickupCaption(input: {
  assignee?: string | null;
  run?: { agent: AgentKey; status: string; at?: string | null } | null;
  result?: string | null;
  resultAt?: string | null;
}): string | null {
  const assigned = agentKeyFromAssignee(input.assignee);
  if (!input.run || !assigned || assigned !== input.run.agent) return null;
  return handoffProgressCaption(input.run.agent, input.run.status, {
    at: input.resultAt ?? input.run.at,
    result: input.result,
  });
}
