/**
 * One read state for every agent card. Owner Home and the accountant
 * client file both use it. An unresolved read is loading. The 8s deadline
 * is an error. Empty copy belongs to a read that has already settled.
 * The evidence predicate stays with the open honest-empty change.
 */

export type AgentCardPhase = "loading" | "empty" | "ready" | "error";

export const AGENT_CARD_CHECKING = "Checking…";
export const AGENT_CARD_LOAD_ERROR = "Couldn't load this client. Refresh to try again.";

export function agentCardPhase(input: {
  pending: boolean;
  timedOut: boolean;
  /** True only after the read settled with nothing to show. */
  empty?: boolean;
}): AgentCardPhase {
  if (input.pending && input.timedOut) return "error";
  if (input.pending) return "loading";
  if (input.empty) return "empty";
  return "ready";
}

/** Loading and error replace the settled lines. Empty and ready keep them. */
export function agentCardLines(
  phase: AgentCardPhase,
  settled: readonly string[],
): readonly string[] {
  if (phase === "loading") return [AGENT_CARD_CHECKING];
  if (phase === "error") return [AGENT_CARD_LOAD_ERROR];
  return settled;
}
