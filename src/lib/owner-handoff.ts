/**
 * Owner hand-off rules. The edge function and the analyst runner share these.
 * Nothing here talks to the database.
 */
import {
  agentCopyStatus,
  evidenceMetrics,
  moneyMarketFromClient,
  polishAgentCopy,
  severityWithFloor,
  type AgentKey,
  type MoneyMarket,
} from "./agent-bus.ts";
import { agentDisplayNameFromKey } from "./milon-team-names.ts";

export const HANDOFF_TRIGGER = "on_demand";
export const ANALYST_RUNNER = "agent-analyst";

export const AGENT_RUNNERS = {
  analyst: "agent-analyst",
  financial_manager: "agent-financial-manager",
  advisor: "agent-advisor",
} as const satisfies Record<AgentKey, string>;

export type HandoffDecision =
  | { ok: true; agent: AgentKey; runner: string; displayName: string; settingKey: string }
  | { ok: false; error: "unknown_agent"; missing: string };

/** Analyst keeps the original dispatch flag. The other two have their own rows. */
export function runnerSettingKey(agent: AgentKey): string {
  if (agent === "financial_manager") return "financial_manager_enabled";
  if (agent === "advisor") return "advisor_enabled";
  return "enabled";
}

export function handoffDecision(agent: string): HandoffDecision {
  if (agent !== "analyst" && agent !== "financial_manager" && agent !== "advisor") {
    return { ok: false, error: "unknown_agent", missing: "That is not one of the three bots." };
  }
  const displayName = agentDisplayNameFromKey(agent);
  if (!displayName) return { ok: false, error: "unknown_agent", missing: "That is not one of the three bots." };
  return {
    ok: true,
    agent,
    runner: AGENT_RUNNERS[agent],
    displayName,
    settingKey: runnerSettingKey(agent),
  };
}

/** Same switch as agent-dispatch. A hand-off does not start a run while this is off. */
export function runnerEnabled(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "string") return value === "true";
  return false;
}

export function callerMayHandOff(input: {
  userId: string;
  ownerUserId: string | null;
  isWorkspaceMember: boolean;
}): boolean {
  if (!input.userId) return false;
  return input.userId === input.ownerUserId || input.isWorkspaceMember;
}

export function handoffInputs(actionItemId: string): string {
  return `action_item:${actionItemId}`;
}

/** Newest hand-off note. A later sentence after the name stays out of the assignee label. */
export function handoffAssigneeName(note: string | null | undefined): string | null {
  if (!note?.startsWith("Handed to ")) return null;
  const rest = note.slice("Handed to ".length).trim();
  const name = rest.split(/[.\n]/)[0]?.trim() ?? "";
  return name || null;
}

export function handoffRequestNote(displayName: string): string {
  return `Handed to ${displayName}.`;
}

/** The draft a finished hand-off may leave for a person. The action title is the label. */
export function handoffDraftTitle(actionTitle: string): string {
  const title = actionTitle.replace(/\s+/g, " ").trim();
  if (!title) return "Hand-off draft";
  return `Hand-off: ${title}`.slice(0, 200);
}

/**
 * A second hand-off of the same action must not add another draft.
 * An existing draft already titled with the action is the same work.
 */
export function handoffDraftIsDuplicate(actionTitle: string, existingTitles: readonly string[]): boolean {
  const action = actionTitle.replace(/\s+/g, " ").trim().toLowerCase();
  if (!action) return true;
  const labelled = handoffDraftTitle(actionTitle).toLowerCase();
  return existingTitles.some((row) => {
    const key = row.replace(/\s+/g, " ").trim().toLowerCase();
    return key === action || key === labelled;
  });
}

export function handoffResultNote(
  displayName: string,
  summary: string,
  market?: MoneyMarket,
  figures?: Record<string, number>,
): string {
  const polished = polishAgentCopy({ text: summary, role: "summary", market, figures });
  const extra = polished.ok ? ` ${polished.text}` : "";
  return `Handed to ${displayName}.${extra}`.slice(0, 500);
}

export function handoffFinding(input: {
  summary: string;
  figures: Record<string, number> | null;
  periodLabel: string | null;
  snapshotId: string | null;
  market?: MoneyMarket;
}): { title: string; detail: string; severity: string; evidence: Record<string, unknown> } | null {
  const figures: Record<string, number> = {};
  for (const [key, value] of Object.entries(input.figures ?? {})) {
    if (typeof value === "number" && Number.isFinite(value)) figures[key] = value;
  }
  if (Object.keys(figures).length === 0) return null;
  const market = input.market ?? moneyMarketFromClient(null);
  const polished = polishAgentCopy({
    text: input.summary,
    role: "summary",
    figures,
    market,
  });
  if (!polished.ok) return null;
  const metrics = evidenceMetrics(figures, input.periodLabel, market);
  const severity = severityWithFloor("info", metrics);
  return {
    title: polished.text.slice(0, 200),
    detail: polished.text.slice(0, 2000),
    severity,
    evidence: {
      figures,
      period_label: input.periodLabel,
      snapshot_id: input.snapshotId,
      metrics,
      status: agentCopyStatus(severity),
    },
  };
}
