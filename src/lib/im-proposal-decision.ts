/**
 * Approve or dismiss an Implementation Manager proposal.
 * Approval records the person. It does not create a live row and it does not enqueue.
 */

export const IM_PROPOSAL_KINDS = ["im_takeover_proposal", "im_routine_proposal"] as const;

/** Locked default. The approve screen shows this. It is not a setting. */
export const ROUTINE_RUNS_PER_FIRM_MONTH = 20;

export type ImProposalKind = (typeof IM_PROPOSAL_KINDS)[number];

export function isImProposalKind(kind: string): kind is ImProposalKind {
  return (IM_PROPOSAL_KINDS as readonly string[]).includes(kind);
}

export function capEstimateUsd(perRunUsd: number): number {
  return Math.round(perRunUsd * ROUTINE_RUNS_PER_FIRM_MONTH * 100) / 100;
}

function keepFigures(evidence: Record<string, unknown>): Record<string, unknown> {
  const figures = evidence.figures;
  if (figures && typeof figures === "object" && !Array.isArray(figures) && Object.keys(figures).length > 0) {
    return figures as Record<string, unknown>;
  }
  return { proposal: 1 };
}

/**
 * Status stays unset. The findings check only allows status approved when a
 * live row exists in another table. A proposal is not that row.
 */
export function approveFindingPatch(input: {
  userId: string;
  now: string;
  evidence: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    approved_by: input.userId,
    approved_at: input.now,
    evidence: {
      ...input.evidence,
      figures: keepFigures(input.evidence),
      decision: "approved",
      approverId: input.userId,
    },
  };
}

export function dismissFindingPatch(evidence: Record<string, unknown>): Record<string, unknown> {
  return {
    status: "dismissed",
    dismissed_reason: "Not now",
    evidence: {
      ...evidence,
      figures: keepFigures(evidence),
      decision: "dismissed",
    },
  };
}
