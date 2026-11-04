/**
 * L1 intercompany flags **stub** for group consolidation preview.
 *
 * Surfaces planned IC review flags from ownership_edges metadata only. Does
 * not read balances, post journals, or change combined totals.
 */

import type { OwnershipEdgeRow } from "@/lib/client-group-client";

export type IntercompanyFlagCandidate = {
  edgeId: string;
  holderClientId: string;
  heldClientId: string;
  ownershipPct: number | null;
  classification: string;
  plannedFlagLabel: string;
};

export type GroupIntercompanyFlagsStub = {
  /** Always empty until real IC flag / reconciliation exists. */
  appliedFlags: readonly [];
  headline: string;
  detail: string;
  notAppliedReasons: readonly string[];
  candidateFlags: readonly IntercompanyFlagCandidate[];
  /** True when at least one in-group ownership edge implies IC review. */
  flagsPlanned: boolean;
};

const NOT_APPLIED_REASONS = [
  "No intercompany account map on file",
  "No IC balance matching",
  "No intercompany flag journals applied",
  "Ownership edges are metadata only — not matched to line items",
] as const;

function plannedFlagLabel(classification: string): string {
  const readable = classification.trim().replace(/_/g, " ") || "related party";
  return `Review intercompany balances (${readable}) — planned`;
}

function edgeInGroup(
  edge: Pick<OwnershipEdgeRow, "holderClientId" | "heldClientId">,
  memberIds: ReadonlySet<string>,
): boolean {
  return memberIds.has(edge.holderClientId) && memberIds.has(edge.heldClientId);
}

export function ownershipEdgesToIntercompanyFlagCandidates(
  edges: readonly Pick<
    OwnershipEdgeRow,
    "id" | "holderClientId" | "heldClientId" | "ownershipPct" | "classification"
  >[],
  memberClientIds: readonly string[],
): IntercompanyFlagCandidate[] {
  const memberIds = new Set(memberClientIds);
  return edges
    .filter((edge) => edgeInGroup(edge, memberIds))
    .map((edge) => ({
      edgeId: edge.id,
      holderClientId: edge.holderClientId,
      heldClientId: edge.heldClientId,
      ownershipPct: edge.ownershipPct,
      classification: edge.classification,
      plannedFlagLabel: plannedFlagLabel(edge.classification),
    }));
}

export type BuildIntercompanyFlagsStubInput = {
  edges: readonly Pick<
    OwnershipEdgeRow,
    "id" | "holderClientId" | "heldClientId" | "ownershipPct" | "classification"
  >[];
  memberClientIds: readonly string[];
};

/**
 * Surface planned IC flags and explicit “not applied” copy. Never mutates figures.
 */
export function buildIntercompanyFlagsStub(
  input: BuildIntercompanyFlagsStubInput,
): GroupIntercompanyFlagsStub {
  const candidateFlags = ownershipEdgesToIntercompanyFlagCandidates(
    input.edges,
    input.memberClientIds,
  );
  const flagsPlanned = candidateFlags.length > 0;

  if (!flagsPlanned) {
    return {
      appliedFlags: [],
      headline: "Intercompany flags: none on file",
      detail:
        "No in-group ownership edges to flag for intercompany review. Combined preview stays a simple sum.",
      notAppliedReasons: NOT_APPLIED_REASONS,
      candidateFlags,
      flagsPlanned: false,
    };
  }

  return {
    appliedFlags: [],
    headline: "Intercompany flags: none applied yet",
    detail:
      "Planned IC review flags below come from ownership metadata only. Combined totals remain a simple sum — no IC journals are applied.",
    notAppliedReasons: NOT_APPLIED_REASONS,
    candidateFlags,
    flagsPlanned: true,
  };
}

export function describeIntercompanyFlagCandidate(
  candidate: IntercompanyFlagCandidate,
  nameById: ReadonlyMap<string, string>,
): string {
  const holder = nameById.get(candidate.holderClientId) ?? "Holder";
  const held = nameById.get(candidate.heldClientId) ?? "Company";
  const pct =
    candidate.ownershipPct != null
      ? ` · ${candidate.ownershipPct}%`
      : " · ownership % not set";
  return `${holder} ↔ ${held}${pct} · ${candidate.plannedFlagLabel}`;
}

/** Locks preview behaviour: IC flags stub must not alter additive combined totals. */
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
