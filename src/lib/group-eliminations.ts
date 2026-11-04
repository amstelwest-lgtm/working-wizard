/**
 * Intercompany eliminations **stub** for group consolidation preview.
 *
 * Lists ownership_edges as planned IC pairs only. Does not read books, post
 * journals, or change combined totals.
 */

import type { OwnershipEdgeRow } from "@/lib/client-group-client";

export type IntercompanyCandidatePair = {
  edgeId: string;
  holderClientId: string;
  heldClientId: string;
  ownershipPct: number | null;
  classification: string;
};

export type GroupEliminationsStub = {
  /** Always empty until real elimination journals exist. */
  appliedEliminations: readonly [];
  headline: string;
  detail: string;
  notAppliedReasons: readonly string[];
  candidatePairs: readonly IntercompanyCandidatePair[];
};

const NOT_APPLIED_REASONS = [
  "No intercompany account map on file",
  "No elimination journal postings",
  "Ownership edges are metadata only — not applied to line items",
] as const;

export function ownershipEdgesToCandidatePairs(
  edges: readonly Pick<
    OwnershipEdgeRow,
    "id" | "holderClientId" | "heldClientId" | "ownershipPct" | "classification"
  >[],
): IntercompanyCandidatePair[] {
  return edges.map((edge) => ({
    edgeId: edge.id,
    holderClientId: edge.holderClientId,
    heldClientId: edge.heldClientId,
    ownershipPct: edge.ownershipPct,
    classification: edge.classification,
  }));
}

/**
 * Surface planned IC pairs and explicit “not applied” copy. Never mutates figures.
 */
export function buildEliminationsStub(
  edges: readonly Pick<
    OwnershipEdgeRow,
    "id" | "holderClientId" | "heldClientId" | "ownershipPct" | "classification"
  >[],
): GroupEliminationsStub {
  const candidatePairs = ownershipEdgesToCandidatePairs(edges);
  return {
    appliedEliminations: [],
    headline: "Eliminations: none applied yet",
    detail:
      candidatePairs.length > 0
        ? "Combined totals are still a simple sum. Pairs below come from ownership metadata only."
        : "Combined totals are still a simple sum. Record ownership edges to preview planned intercompany pairs.",
    notAppliedReasons: NOT_APPLIED_REASONS,
    candidatePairs,
  };
}

export function describeIntercompanyCandidatePair(
  pair: IntercompanyCandidatePair,
  nameById: ReadonlyMap<string, string>,
): string {
  const holder = nameById.get(pair.holderClientId) ?? "Holder";
  const held = nameById.get(pair.heldClientId) ?? "Company";
  const pct = pair.ownershipPct != null ? ` · ${pair.ownershipPct}%` : "";
  return `${holder} → ${held}${pct} · ${pair.classification.replace(/_/g, " ")}`;
}

/** Locks preview behaviour: eliminations stub must not alter additive combined totals. */
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
