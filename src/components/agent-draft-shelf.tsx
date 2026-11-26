import { useEffect } from "react";
import { AgentSendDraftCard } from "@/components/agent-send-draft-card";
import { OwnerDraftCard } from "@/components/owner-draft-card";
import { draftFindingLabel } from "@/hooks/owner-agent-ui";
import { CLIENT_UPDATE_DRAFT_KIND, clientUpdateSendLocked } from "@/lib/client-update-draft";
import { draftStaysOnClient } from "@/lib/im-setup-hold";
import { isVisibleAgentFinding, type AgentFindingRow } from "@/lib/milon-team-activity";
import type { HealthScoreSnapshot } from "@/lib/health-snapshot";

/**
 * Drafts page list. These are agent_findings, not advisory packs.
 * A hand-off link scrolls to `data-draft`.
 */
export function AgentDraftShelf({
  findings,
  clientId = null,
  focusId,
  canonicalRatios = null,
  health = null,
  onRefresh,
  audience = "accountant",
}: {
  findings: readonly AgentFindingRow[];
  /** When set, a finding for another client is dropped, including a focused draft id. */
  clientId?: string | null;
  focusId?: string | null;
  canonicalRatios?: Record<string, number> | null;
  health?: HealthScoreSnapshot | null;
  onRefresh?: () => void;
  /** Owner shelves never receive the firm seat. */
  audience?: "owner" | "accountant";
}) {
  const rows = findings.filter((row) => {
    if (clientId && !draftStaysOnClient(row.client_id, clientId)) return false;
    if (!isVisibleAgentFinding(row)) return false;
    if (focusId && row.id === focusId) return true;
    if (row.kind === CLIENT_UPDATE_DRAFT_KIND && clientUpdateSendLocked(row.evidence)) return true;
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
          {rows.map((row, index) =>
            row.kind === "agent_send_draft" ? (
              <li key={row.id}>
                <AgentSendDraftCard row={row} onRefresh={onRefresh} />
              </li>
            ) : (
              <OwnerDraftCard
                key={row.id}
                layout="moves"
                row={row}
                canonicalRatios={canonicalRatios}
                health={health}
                primary={index === 0}
                onRefresh={onRefresh}
                decisionSeat={
                  audience === "owner" ? "owner" : row.kind === CLIENT_UPDATE_DRAFT_KIND ? "firm" : "owner"
                }
              />
            ),
          )}
        </ul>
      )}
    </section>
  );
}
