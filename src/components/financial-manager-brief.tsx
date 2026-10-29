/**
 * Needs attention on accountant client Home. One row per thing to act on, one button each.
 * Draft chase uses the shared chase draft and is never sent.
 * Hand to assigns the open action the same way the action plan does.
 */
import { useState } from "react";
import { toast } from "sonner";
import type { AssignmentNoteRow } from "@/components/assignment-notes";
import { HandoffRunStatus } from "@/components/handoff-run-status";
import { ChaseDraftDialog } from "@/components/chase-draft-dialog";
import { HandToMenu } from "@/components/hand-to-menu";
import { retryHomeHandoff } from "@/components/client-home/retry-handoff";
import type { FinancialManagerBrief } from "@/lib/financial-manager-brief";
import { ATTENTION_CTA, homeAttentionItems, type AttentionItem } from "@/lib/home-attention";
import type { AgentKey } from "@/lib/milon-team-feed";
import { assignActionToPerson, commitActionHandoff } from "@/lib/owner-handoff-client";
import { actionDisplayTitle } from "@/lib/strategic-moves";
import "./financial-manager-brief.css";
import { assignedToast } from "@/lib/action-handoff";

export type HomeBriefHandoff = {
  id: string;
  title: string;
  assignee?: string | null;
  agent?: AgentKey | null;
  notes?: readonly AssignmentNoteRow[];
  openedAt?: string;
  /** The hand-off note is old and no queued or running run appeared. */
  missed?: boolean;
  /** This click's run. Another action's run does not settle the row. */
  runId?: string;
  error?: string | null;
  run?: { id?: string; agent: AgentKey; status: string; at?: string | null } | null;
  /** Finding saved for this action. Finished and Open draft need this id. */
  draftId?: string | null;
  /** False while findings are still loading. */
  findingsReady?: boolean;
};

type BriefTab = "plan" | "cash" | "health" | "profit" | "budget" | "reports";

function handoffFor(
  actionTitle: string,
  handoffs: readonly HomeBriefHandoff[],
): HomeBriefHandoff | null {
  return (
    handoffs.find((row) => actionDisplayTitle(row.title) === actionTitle) ??
    handoffs.find((row) => row.title.trim() === actionTitle) ??
    null
  );
}

function BriefHandControl({
  clientId,
  item,
  audience,
}: {
  clientId: string;
  item: HomeBriefHandoff;
  audience: "owner" | "accountant";
}) {
  const [comingSoon, setComingSoon] = useState<Partial<Record<AgentKey, true>>>({});
  return (
    <HandToMenu
      clientId={clientId}
      assignee={item.assignee}
      comingSoon={comingSoon}
      audience={audience}
      onAssignAgent={async (agent) => {
        const toastId = toast.success(assignedToast(agent));
        const result = await commitActionHandoff({
          clientId,
          actionItemId: item.id,
          title: item.title,
          agent,
        });
        if (!result.ok) {
          if (result.comingSoon) setComingSoon((current) => ({ ...current, [agent]: true }));
          toast.error(result.error, { id: toastId });
          return;
        }
      }}
      onAssignPerson={async (person) => {
        const result = await assignActionToPerson({
          clientId,
          actionItemId: item.id,
          personId: person.id,
          personName: person.name,
          title: item.title,
        });
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        toast.success(`Assigned to ${person.name}`);
      }}
    />
  );
}

function Cta({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="home-attn__cta" onClick={onClick}>
      {label}
    </button>
  );
}

export function FinancialManagerBrief({
  brief,
  clientId,
  handoffs = [],
  audience = "accountant",
  onOpen,
  onOpenDraft,
  planHeading = null,
  planMore = false,
  reportsLine = null,
  booksMissing = false,
  onBooks,
}: {
  brief: FinancialManagerBrief;
  clientId?: string | null;
  handoffs?: readonly HomeBriefHandoff[];
  audience?: "owner" | "accountant";
  onOpen: (tab: BriefTab) => void;
  onOpenDraft?: (draftId: string) => void;
  /** "5 open, 1 overdue". Its row opens the plan when the list is longer than the brief. */
  planHeading?: string | null;
  planMore?: boolean;
  reportsLine?: string | null;
  booksMissing?: boolean;
  onBooks?: () => void;
}) {
  const [chaseOpen, setChaseOpen] = useState(false);
  const items = homeAttentionItems({ brief, planHeading, planMore, reportsLine, booksMissing });
  const checking = brief.actionEmpty === "Checking the action plan.";

  const control = (item: AttentionItem) => {
    switch (item.kind) {
      case "hand": {
        const handoff = handoffFor(item.title, handoffs);
        if (clientId && handoff)
          return <BriefHandControl clientId={clientId} item={handoff} audience={audience} />;
        return <Cta label="Open action" onClick={() => onOpen("plan")} />;
      }
      case "books":
        return <Cta label={ATTENTION_CTA.books} onClick={() => onBooks?.()} />;
      case "cash":
        return <Cta label={ATTENTION_CTA.cash} onClick={() => onOpen("cash")} />;
      case "chase":
        return brief.chase ? (
          <Cta label={ATTENTION_CTA.chase} onClick={() => setChaseOpen(true)} />
        ) : null;
      case "draft":
        return (
          <Cta
            label={ATTENTION_CTA.draft}
            onClick={() => (onOpenDraft ? onOpenDraft(item.draftId) : onOpen("reports"))}
          />
        );
      case "plan":
        return <Cta label={ATTENTION_CTA.plan} onClick={() => onOpen("plan")} />;
      case "reports":
        return <Cta label={ATTENTION_CTA.reports} onClick={() => onOpen("reports")} />;
    }
  };

  return (
    <section
      className="home-attn"
      aria-label="Needs attention"
      data-fm-brief="true"
      data-home-attention=""
    >
      {items.length > 0 ? (
        <ul className="home-attn__list">
          {items.map((item) => {
            const handoff = item.kind === "hand" ? handoffFor(item.title, handoffs) : null;
            const detail = "detail" in item ? item.detail : null;
            const chip = "chip" in item ? item.chip : null;
            return (
              <li key={item.key} className="home-attn__row" data-attention={item.kind}>
                <div className="home-attn__text">
                  <span className="home-attn__label">{item.label}</span>
                  <span className="home-attn__title">{item.title}</span>
                  {detail ? <span className="home-attn__detail">{detail}</span> : null}
                  {handoff ? (
                    <HandoffRunStatus
                      run={handoff.run}
                      missed={handoff.missed}
                      error={handoff.error}
                      draftId={handoff.draftId}
                      onOpenDraft={onOpenDraft}
                      actionItemId={handoff.id}
                      showTimeline={false}
                      onRetry={
                        clientId && handoff.agent
                          ? () =>
                              retryHomeHandoff({
                                clientId,
                                actionItemId: handoff.id,
                                title: handoff.title,
                                agent: handoff.agent as AgentKey,
                              })
                          : undefined
                      }
                    />
                  ) : null}
                </div>
                {chip ? (
                  <span className="home-attn__chip" data-attention-chip="">
                    {chip}
                  </span>
                ) : null}
                <div className="home-attn__action">{control(item)}</div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="home-attn__empty">
          {checking ? "Checking the action plan." : "Nothing needs you right now."}
        </p>
      )}
      {chaseOpen && brief.chase ? (
        <ChaseDraftDialog draft={brief.chase} onClose={() => setChaseOpen(false)} />
      ) : null}
    </section>
  );
}
