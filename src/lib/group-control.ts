/**
 * Ownership / control **stub** for group consolidation preview.
 *
 * Reads ownership_edges metadata only. Does not choose consolidation method,
 * apply equity method, or change which companies enter the combined preview.
 */

import type { OwnershipEdgeRow } from "@/lib/client-group-client";

export type ControlOwnershipCandidate = {
  edgeId: string;
  holderClientId: string;
  heldClientId: string;
  ownershipPct: number | null;
  classification: string;
  plannedControlLabel: string;
};

export type GroupControlStub = {
  /** Always empty until real control / consolidation rules exist. */
  appliedControl: readonly [];
  headline: string;
  detail: string;
  notAppliedReasons: readonly string[];
  candidateEdges: readonly ControlOwnershipCandidate[];
  /** True when at least one ownership edge is on file. */
  controlPlanned: boolean;
};

const NOT_APPLIED_REASONS = [
  "ownership_pct not used for consolidation method",
  "classification not applied to company inclusion",
  "No equity-method adjustments",
  "No control test beyond ownership metadata",
] as const;

function plannedControlLabel(
  classification: string,
  ownershipPct: number | null,
): string {
  const normalized = classification.trim().toLowerCase();
  if (normalized === "associate") {
    return "Associate — equity method (planned)";
  }
  if (normalized === "joint_venture") {
    return "Joint venture — proportionate / equity (planned)";
  }
  if (normalized === "subsidiary") {
    if (ownershipPct === 100) {
      return "Wholly owned subsidiary — full consolidation (planned)";
    }
    if (ownershipPct != null && ownershipPct >= 50) {
      return "Controlling interest (≥50%) — full consolidation (planned)";
    }
    if (ownershipPct != null && ownershipPct < 50) {
      return "Below 50% on file — control not implied by % alone (planned)";
    }
    return "Subsidiary — consolidation method pending ownership % on file (planned)";
  }
  const readable = classification.replace(/_/g, " ");
  return `${readable} — consolidation method not applied (planned)`;
}

export function ownershipEdgesToControlCandidates(
  edges: readonly Pick<
    OwnershipEdgeRow,
    "id" | "holderClientId" | "heldClientId" | "ownershipPct" | "classification"
  >[],
): ControlOwnershipCandidate[] {
  return edges.map((edge) => ({
    edgeId: edge.id,
    holderClientId: edge.holderClientId,
    heldClientId: edge.heldClientId,
    ownershipPct: edge.ownershipPct,
    classification: edge.classification,
    plannedControlLabel: plannedControlLabel(edge.classification, edge.ownershipPct),
  }));
}

/**
 * Surface planned control / consolidation method copy from metadata. Never mutates figures.
 */
export function buildControlStub(
  edges: readonly Pick<
    OwnershipEdgeRow,
    "id" | "holderClientId" | "heldClientId" | "ownershipPct" | "classification"
  >[],
): GroupControlStub {
  const candidateEdges = ownershipEdgesToControlCandidates(edges);
  const controlPlanned = candidateEdges.length > 0;

  if (!controlPlanned) {
    return {
      appliedControl: [],
      headline: "Ownership / control: not on file",
      detail:
        "No ownership edges recorded. Combined preview stays a simple sum — control and consolidation method are not applied yet.",
      notAppliedReasons: NOT_APPLIED_REASONS,
      candidateEdges,
      controlPlanned: false,
    };
  }

  return {
    appliedControl: [],
    headline: "Ownership / control: none applied yet",
    detail:
      "Planned treatment below comes from ownership metadata only. Every company still enters combined totals as a simple sum.",
    notAppliedReasons: NOT_APPLIED_REASONS,
    candidateEdges,
    controlPlanned: true,
  };
}

export function describeControlOwnershipCandidate(
  candidate: ControlOwnershipCandidate,
  nameById: ReadonlyMap<string, string>,
): string {
  const holder = nameById.get(candidate.holderClientId) ?? "Holder";
  const held = nameById.get(candidate.heldClientId) ?? "Company";
  const pct =
    candidate.ownershipPct != null
      ? ` · ${candidate.ownershipPct}%`
      : " · ownership % not set";
  return `${holder} → ${held}${pct} · ${candidate.plannedControlLabel}`;
}

/** Locks preview behaviour: control stub must not alter additive combined totals. */
export function combinedFiguresUnchanged(
  before: Readonly<Record<string, string>>,
  after: Readonly<Record<string, string>>,
): boolean {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if ((before[key] ?? "") !== (after[key] ?? "")) return false;
  }
  return true;
}
