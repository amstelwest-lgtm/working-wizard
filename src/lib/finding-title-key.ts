/**
 * Dedupe key for an agent finding title: lowercase, digits removed, spaces
 * collapsed. "Gross margin is 42%." and "Gross margin is 40%." share a key.
 * No imports: the agent_findings writers in supabase/functions use it too,
 * and the supersede migration mirrors it in SQL.
 */
export function findingTitleKey(title: string): string {
  return title.toLowerCase().replace(/[0-9]/g, "").replace(/\s+/g, " ").trim();
}

export const ACTION_POINT_DRAFT_KIND = "action_point_draft";
export const HANDOFF_DRAFT_KIND = "accountant_handoff_draft";

const PAIRED_DRAFT_KINDS = new Set([ACTION_POINT_DRAFT_KIND, HANDOFF_DRAFT_KIND]);

export function findingKindOf(kind: unknown): string {
  return typeof kind === "string" ? kind.trim() : "";
}

/**
 * Same title is one open finding. An action point and a hand-off do not
 * replace each other, except a hand-off replaces the twin action point.
 * Other kinds still share a title, so a re-run that only changed a figure
 * still points the older row at the new one.
 */
export function findingsShareSupersedeKey(keepKind: unknown, rowKind: unknown): boolean {
  const keep = findingKindOf(keepKind);
  const row = findingKindOf(rowKind);
  if (PAIRED_DRAFT_KINDS.has(keep) || PAIRED_DRAFT_KINDS.has(row)) {
    if (keep === HANDOFF_DRAFT_KIND && row === ACTION_POINT_DRAFT_KIND) return true;
    return keep === row;
  }
  return true;
}

/** Display key. The paired drafts stay in their own lane until the hand-off wins. */
export function dedupeFindingGroupKey(row: { agent: string; title: string; kind?: string | null }): string {
  const kind = findingKindOf(row.kind);
  const title = findingTitleKey(row.title);
  if (kind === ACTION_POINT_DRAFT_KIND || kind === HANDOFF_DRAFT_KIND) {
    return `${row.agent}:${kind}:${title}`;
  }
  return `${row.agent}:${title}`;
}
