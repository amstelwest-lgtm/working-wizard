/**
 * Owner-facing state for the two agents that may not have a runner yet.
 * A missing runner is a quiet wait. An empty run table stays quiet too.
 */
import type { AgentFindingRow, AgentRunRow } from "@/lib/milon-team-activity";

export type OwnerRunPhase = "queued" | "working" | "found" | "done" | "skipped" | "stalled";

const PHASE_LABEL: Record<OwnerRunPhase, string> = {
  queued: "Queued",
  working: "Working",
  found: "Found",
  done: "Done",
  skipped: "Nothing to do",
  stalled: "Couldn't finish, we're on it",
};

const DRAFT_KINDS = new Set([
  "action_point_draft",
  "data_request_draft",
  "accountant_handoff_draft",
  "next_move_draft",
  "advisory_deliverable_draft",
]);

const ACCOUNTANT_DRAFTS = new Set(["accountant_handoff_draft", "advisory_deliverable_draft"]);

export const DRAFT_NEEDS_OWNER = "Draft, needs your OK";
export const DRAFT_NEEDS_ACCOUNTANT = "needs your accountant's OK";

export function ownerRunPhaseLabel(phase: OwnerRunPhase): string {
  return PHASE_LABEL[phase];
}

/** A failed run stays quiet. No alarm colour. */
export function ownerRunPhaseMuted(phase: OwnerRunPhase): boolean {
  return phase === "stalled";
}

function stamp(value: string | null | undefined): number {
  if (!value) return 0;
  const n = Date.parse(value);
  return Number.isNaN(n) ? 0 : n;
}

/** Latest run for one agent. A cancelled run goes back to idle. */
export function ownerRunPhase(
  run: AgentRunRow | null | undefined,
  findings: readonly AgentFindingRow[] = [],
): OwnerRunPhase | null {
  if (!run) return null;
  if (run.status === "queued") return "queued";
  if (run.status === "running") return "working";
  if (run.status === "skipped") return "skipped";
  if (run.status === "failed" || run.status === "dead") return "stalled";
  if (run.status === "cancelled") return null;
  if (run.status !== "succeeded" && run.status !== "partial") return null;
  const found = findings.some(
    (row) => row.agent === run.agent && stamp(row.created_at) >= stamp(run.queued_at),
  );
  return found ? "found" : "done";
}

/**
 * 409 no_runner and 409 runner_disabled. The client surfaces `missing` as the
 * error string, so both the code and that sentence count.
 */
export function handoffComingOnline(error: string): boolean {
  const text = error.trim();
  if (text === "no_runner" || text === "runner_disabled") return true;
  if (text.startsWith("No runner exists for ")) return true;
  return /is false, so a hand-off will not start it/.test(text);
}

function evidenceRecord(evidence: unknown): Record<string, unknown> {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return {};
  return evidence as Record<string, unknown>;
}

/**
 * A draft finding is an agent_findings row that still needs a person.
 * Nothing here applies it.
 */
export function draftFindingLabel(row: {
  kind?: string | null;
  evidence: unknown;
}): string | null {
  const evidence = evidenceRecord(row.evidence);
  const fromEvidence = typeof evidence.kind === "string" ? evidence.kind : "";
  const kind = (row.kind ?? fromEvidence).trim();
  if (!DRAFT_KINDS.has(kind)) return null;
  if (evidence.draft !== true || evidence.requires_human_approval !== true) return null;
  return ACCOUNTANT_DRAFTS.has(kind) ? DRAFT_NEEDS_ACCOUNTANT : DRAFT_NEEDS_OWNER;
}
