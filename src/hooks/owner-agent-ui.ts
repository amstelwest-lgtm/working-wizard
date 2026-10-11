/**
 * Owner-facing state for the two agents that may not have a runner yet.
 * A missing runner is a quiet wait. An empty run table stays quiet too.
 */
import type { AgentFindingRow, AgentRunRow } from "@/lib/milon-team-activity";

export type OwnerRunPhase = "queued" | "working" | "found" | "done";

const PHASE_LABEL: Record<OwnerRunPhase, string> = {
  queued: "Queued",
  working: "Working",
  found: "Found",
  done: "Done",
};

export function ownerRunPhaseLabel(phase: OwnerRunPhase): string {
  return PHASE_LABEL[phase];
}

function stamp(value: string | null | undefined): number {
  if (!value) return 0;
  const n = Date.parse(value);
  return Number.isNaN(n) ? 0 : n;
}

/** Latest run for one agent. Failed and missing runs stay unset. */
export function ownerRunPhase(
  run: AgentRunRow | null | undefined,
  findings: readonly AgentFindingRow[] = [],
): OwnerRunPhase | null {
  if (!run) return null;
  if (run.status === "queued") return "queued";
  if (run.status === "running") return "working";
  if (run.status !== "succeeded" && run.status !== "partial") return null;
  const found = findings.some(
    (row) => row.agent === run.agent && stamp(row.created_at) >= stamp(run.queued_at),
  );
  return found ? "found" : "done";
}

/** 409 no_runner, including the sentence the hand-off function already returns. */
export function handoffComingOnline(error: string): boolean {
  const text = error.trim();
  return text === "no_runner" || text.startsWith("No runner exists for ");
}
