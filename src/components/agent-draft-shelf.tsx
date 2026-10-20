import { useEffect } from "react";
import { OwnerDraftCard } from "@/components/owner-draft-card";
import { draftFindingLabel } from "@/hooks/owner-agent-ui";
import { isVisibleAgentFinding, type AgentFindingRow } from "@/lib/milon-team-activity";

/**
 * Drafts page list. These are agent_findings, not advisory packs.
 * A hand-off link scrolls to `data-draft`.
 */
export function AgentDraftShelf({
  findings,
  focusId,
  canonicalRatios = null,
  onRefresh,
}: {
  findings: readonly AgentFindingRow[];
  focusId?: string | null;
  canonicalRatios?: Record<string, number> | null;
  onRefresh?: () => void;
}) {
  const rows = findings.filter((row) => {
    if (!isVisibleAgentFinding(row)) return false;
    if (focusId && row.id === focusId) return true;
    return draftFindingLabel(row) != null;
  });
  useEffect(() => {
    const id = focusId?.trim();
    if (!id) return;
    const node = document.querySelector(`[data-draft="${CSS.escape(id)}"]`);
    if (node instanceof HTMLElement) node.scrollIntoView({ block: "center" });
  }, [focusId, rows.length]);
  return (
    <section className="mb-5" id="agent-drafts" data-agent-drafts="true">
      <h3 className="mb-2 text-sm font-semibold text-slate-950">Waiting for a person</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-600" data-agent-drafts-empty>
          Nothing is waiting for a person.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row, index) => (
            <OwnerDraftCard
              key={row.id}
              layout="moves"
              row={row}
              canonicalRatios={canonicalRatios}
              primary={index === 0}
              onRefresh={onRefresh}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
