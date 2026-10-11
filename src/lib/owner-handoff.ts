/**
 * Owner hand-off rules. The edge function and the analyst runner share these.
 * Nothing here talks to the database.
 */
import type { AgentKey } from "./agent-bus.ts";
import { agentDisplayNameFromKey } from "./milon-team-names.ts";

export const HANDOFF_TRIGGER = "on_demand";
export const ANALYST_RUNNER = "agent-analyst";

const MISSING_RUNNER: Record<Exclude<AgentKey, "analyst">, string> = {
  financial_manager:
    "No runner exists for financial_manager. supabase/functions has agent-analyst only; there is no function that leases a financial_manager run.",
  advisor:
    "No runner exists for advisor. supabase/functions has agent-analyst only; there is no function that leases an advisor run.",
};

export type HandoffDecision =
  | { ok: true; agent: "analyst"; runner: typeof ANALYST_RUNNER; displayName: string }
  | { ok: false; error: "unknown_agent" | "no_runner"; missing: string };

export function handoffDecision(agent: string): HandoffDecision {
  if (agent === "analyst") {
    const displayName = agentDisplayNameFromKey(agent);
    if (!displayName) return { ok: false, error: "unknown_agent", missing: "That is not one of the three bots." };
    return { ok: true, agent: "analyst", runner: ANALYST_RUNNER, displayName };
  }
  if (agent === "financial_manager" || agent === "advisor") {
    return { ok: false, error: "no_runner", missing: MISSING_RUNNER[agent] };
  }
  return { ok: false, error: "unknown_agent", missing: "That is not one of the three bots." };
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

export function handoffResultNote(displayName: string, summary: string): string {
  const clean = summary.replace(/\s+/g, " ").trim();
  const extra = clean ? ` ${clean}` : "";
  return `Handed to ${displayName}.${extra}`.slice(0, 500);
}

export function handoffFinding(input: {
  summary: string;
  figures: Record<string, number> | null;
  periodLabel: string | null;
  snapshotId: string | null;
}): { title: string; detail: string; evidence: Record<string, unknown> } | null {
  const figures: Record<string, number> = {};
  for (const [key, value] of Object.entries(input.figures ?? {})) {
    if (typeof value === "number" && Number.isFinite(value)) figures[key] = value;
  }
  if (Object.keys(figures).length === 0) return null;
  const summary = input.summary.replace(/\s+/g, " ").trim();
  const title = (summary || "Hand-off result").slice(0, 200);
  return {
    title,
    detail: (summary || title).slice(0, 2000),
    evidence: {
      figures,
      period_label: input.periodLabel,
      snapshot_id: input.snapshotId,
    },
  };
}
