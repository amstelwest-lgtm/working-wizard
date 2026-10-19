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

/** A queued or running hand-off that has not moved for this long offers Retry. */
export const HANDOFF_SLOW_AFTER_MS = 3 * 60 * 1000;

/** Stored when a run stops so it does not spend another model call. Not shown raw. */
export const HANDOFF_COST_STOP = "Stopped before another model call so the run stays within its cost ceiling.";

export function handoffCostStopped(text: string | null | undefined): boolean {
  return (text ?? "").includes(HANDOFF_COST_STOP);
}

/** Friendly line for a cost-ceiling stop. Retry sits beside it on the row. */
export function handoffCouldNotFinish(agent: AgentKey): string {
  return `${agentShortName(agent)} couldn't finish this one`;
}

function costStopLine(note: string): string | null {
  if (!handoffCostStopped(note)) return null;
  for (const agent of AGENT_KEYS) {
    const short = agentShortName(agent);
    if (note.includes(`${short} finished`) || note.startsWith(short)) return handoffCouldNotFinish(agent);
  }
  return "Couldn't finish this one";
}

/** True once a queued or running hand-off has been sitting longer than the usual wait. */
export function handoffIsSlow(
  status: string | null | undefined,
  at: string | null | undefined,
  now = Date.now(),
): boolean {
  if (status !== "queued" && status !== "running") return false;
  if (!at) return false;
  const stamp = Date.parse(at);
  if (Number.isNaN(stamp)) return false;
  return now - stamp > HANDOFF_SLOW_AFTER_MS;
}

/**
 * One note, with who wrote it and when.
 * "Assigned to theo · by amstel.west · 8:31 PM"
 */
export function formatAssignmentNote(row: {
  note: string;
  at?: string | null;
  actorLabel?: string | null;
  actorType?: string | null;
}): string {
  const stripped = row.note.trim().replace(/\.+$/u, "");
  const friendly = costStopLine(row.note);
  const body = friendly ?? stripped;
  const handed = stripped.startsWith("Handed to ");
  const actorNamesBot = agentKeyFromAssignee(row.actorLabel) != null;
  const hideAuthor = handed && (actorNamesBot || row.actorType === "system");
  const actor = hideAuthor ? "" : (row.actorLabel?.trim() ?? "");
  const time = handoffClock(row.at);
  const tail = [actor ? `by ${actor}` : "", time ?? ""].filter(Boolean).join(" · ");
  return tail ? `${body} · ${tail}` : body;
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
    const result = detail?.result?.replace(/\s+/g, " ").trim();
    if (handoffCostStopped(result)) return handoffCouldNotFinish(agent);
    const time = handoffClock(detail?.at);
    const head = time ? `${short} finished · ${time}` : `${short} finished`;
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
