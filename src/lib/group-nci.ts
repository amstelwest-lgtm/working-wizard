/**
 * NCI / ownership **stub** for group consolidation preview.
 *
 * Reads ownership_edges metadata only. Does not allocate minority interest,
 * apply ownership_pct to line items, or change combined totals.
 */

import type { OwnershipEdgeRow } from "@/lib/client-group-client";

export type NciOwnershipCandidate = {
  edgeId: string;
  holderClientId: string;
  heldClientId: string;
  ownershipPct: number | null;
  classification: string;
};

export type GroupNciStub = {
  /** Always empty until real NCI allocation exists. */
  appliedNci: readonly [];
  headline: string;
  detail: string;
  notAppliedReasons: readonly string[];
  candidateHoldings: readonly NciOwnershipCandidate[];
  /** True when at least one edge implies minority interest (pct < 100 or unset). */
  nciPlanned: boolean;
};

const NOT_APPLIED_REASONS = [
  "No NCI allocation",
  "ownership_pct not applied to line items",
  "No minority interest journals",
] as const;

function edgeImpliesNci(ownershipPct: number | null): boolean {
  if (ownershipPct == null) return true;
  return ownershipPct < 100;
}

export function ownershipEdgesToNciCandidates(
  edges: readonly Pick<
    OwnershipEdgeRow,
    "id" | "holderClientId" | "heldClientId" | "ownershipPct" | "classification"
  >[],
): NciOwnershipCandidate[] {
  return edges
    .filter((edge) => edgeImpliesNci(edge.ownershipPct))
    .map((edge) => ({
      edgeId: edge.id,
      holderClientId: edge.holderClientId,
      heldClientId: edge.heldClientId,
      ownershipPct: edge.ownershipPct,
      classification: edge.classification,
    }));
}

/**
 * Surface planned NCI holdings and explicit “not applied” copy. Never mutates figures.
 */
export function buildNciStub(
  edges: readonly Pick<
    OwnershipEdgeRow,
    "id" | "holderClientId" | "heldClientId" | "ownershipPct" | "classification"
  >[],
): GroupNciStub {
  const candidateHoldings = ownershipEdgesToNciCandidates(edges);
  const nciPlanned = candidateHoldings.length > 0;

  if (edges.length === 0) {
    return {
      appliedNci: [],
      headline: "NCI: not needed",
      detail:
        "No ownership edges on file. Combined preview stays a simple sum; non-controlling interest is not in scope yet.",
      notAppliedReasons: NOT_APPLIED_REASONS,
      candidateHoldings,
      nciPlanned: false,
    };
  }

  if (!nciPlanned) {
    return {
      appliedNci: [],
      headline: "NCI: not needed — wholly owned",
      detail:
        "Every ownership edge on file is 100%. Combined totals remain a simple sum with no minority interest to allocate.",
      notAppliedReasons: NOT_APPLIED_REASONS,
      candidateHoldings,
      nciPlanned: false,
    };
  }

  return {
    appliedNci: [],
    headline: "NCI: none applied yet",
    detail:
      "Holdings below come from ownership metadata only. Combined totals are still a simple sum — no NCI share is calculated in preview.",
    notAppliedReasons: NOT_APPLIED_REASONS,
    candidateHoldings,
    nciPlanned: true,
  };
}

export function describeNciOwnershipCandidate(
  candidate: NciOwnershipCandidate,
  nameById: ReadonlyMap<string, string>,
): string {
  const holder = nameById.get(candidate.holderClientId) ?? "Holder";
  const held = nameById.get(candidate.heldClientId) ?? "Company";
  const pct =
    candidate.ownershipPct != null
      ? ` · ${candidate.ownershipPct}% held`
      : " · ownership % not set";
  return `${holder} → ${held}${pct} · ${candidate.classification.replace(/_/g, " ")}`;
}

/** Locks preview behaviour: NCI stub must not alter additive combined totals. */
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
