/**
 * Client Home brief. The accountant confirms or opens work.
 * Draft chase uses the shared chase draft and is never sent.
 * Hand to assigns the open action the same way the action plan does.
 */
import { useState } from "react";
import { toast } from "sonner";
import { AssignmentNotes, type AssignmentNoteRow } from "@/components/assignment-notes";
import { HandoffRunStatus } from "@/components/handoff-run-status";
import { ChaseDraftDialog } from "@/components/chase-draft-dialog";
import { HandToMenu } from "@/components/hand-to-menu";
import type { FinancialManagerBrief } from "@/lib/financial-manager-brief";
import { DRAFT_OUT_OF_DATE } from "@/lib/draft-figures";
import { actionPreviewLine } from "@/lib/owner-needs";
import { useMarketFormat } from "@/contexts/market";
import { botPickupCaption, handoffCostStopped, handoffCouldNotFinish } from "@/lib/action-handoff";
import { agentShortName } from "@/lib/milon-team";
import type { AgentKey } from "@/lib/milon-team-feed";
import { latestHandoffResult } from "@/lib/owner-handoff";
import { assignActionToPerson, commitActionHandoff } from "@/lib/owner-handoff-client";
import { actionDisplayTitle } from "@/lib/strategic-moves";
import "./financial-manager-brief.css";

const BUTTON_LABEL = {
  chase: "Draft chase",
  open: "Open",
} as const;

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
};

function HandoffProgress({ item, onRetry }: { item: HomeBriefHandoff; onRetry?: () => void }) {
  const { market } = useMarketFormat();
  const result = latestHandoffResult(item.notes ?? []);
  const agent = item.run?.agent ?? item.agent ?? null;
  const caption =
    handoffCostStopped(result?.text) && agent
      ? handoffCouldNotFinish(agent)
      : botPickupCaption({
          assignee: item.assignee,
          run: item.run,
          result: result?.text,
          resultAt: result?.at,
          market,
        });
  return (
    <>
      <HandoffRunStatus
        run={item.run}
        caption={item.missed || item.error ? null : caption}
        missed={item.missed}
        error={item.error}
        onRetry={onRetry}
      />
      <AssignmentNotes notes={item.notes ?? []} />
    </>
  );
}

function handoffFor(actionTitle: string, handoffs: readonly HomeBriefHandoff[]): HomeBriefHandoff | null {
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
        const result = await commitActionHandoff({
          clientId,
          actionItemId: item.id,
          title: item.title,
          agent,
        });
        if (!result.ok) {
          if (result.comingSoon) setComingSoon((current) => ({ ...current, [agent]: true }));
          toast.error(result.error);
          return;
        }
        toast.success(`Assigned to ${agentShortName(agent)}`);
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

export function FinancialManagerBrief({
  brief,
  clientId,
  handoffs = [],
  audience = "accountant",
  onOpen,
}: {
  brief: FinancialManagerBrief;
  clientId?: string | null;
  handoffs?: readonly HomeBriefHandoff[];
  audience?: "owner" | "accountant";
  onOpen: (tab: "plan" | "cash" | "health" | "profit" | "budget" | "reports") => void;
}) {
  const { money } = useMarketFormat();
  const [chaseOpen, setChaseOpen] = useState(false);
  const since = brief.priorLabel ? `since ${brief.priorLabel}` : "since last month";
  const showing = actionPreviewLine(brief.actions.length, brief.actionCount);

  return (
    <section className="fm-brief" aria-label="Financial Manager brief" data-fm-brief="true">
      <p className="fm-brief-kicker">Financial Manager</p>
      <h2 className="fm-brief-title">What changed {since}</h2>
      {brief.cashFloorLine ? (
        <p className="fm-brief-cash" data-cash-floor-line>
          {brief.cashFloorChip ? (
            <span className="fm-brief-chip" data-cash-floor-chip>
              {brief.cashFloorChip}
            </span>
          ) : null}
          {brief.cashFloorLine}
        </p>
      ) : null}
      {brief.movements.length > 0 ? (
        <ol className="fm-brief-moves">
          {brief.movements.map((row) => (
            <li key={row.key}>
              <span>{row.label}</span>
              <b>
                {row.delta > 0 ? "Up " : "Down "}
                {money(Math.abs(row.delta))}
              </b>
              <small>
                {money(row.current)} from {money(row.prior)}
              </small>
            </li>
          ))}
        </ol>
      ) : (
        <p className="fm-brief-empty">{brief.movementEmpty}</p>
      )}

      <h3>Act on these</h3>
      {showing ? (
        <p className="fm-brief-showing" data-showing-actions="">
          {showing}
        </p>
      ) : null}
      {brief.actions.length > 0 ? (
        <ul className="fm-brief-actions">
          {brief.actions.map((action) => {
            const handoff = action.button === "hand" ? handoffFor(action.title, handoffs) : null;
            return (
              <li key={action.id}>
                <div>
                  <b>{action.title}</b>
                  <span>{action.reason}</span>
                  {handoff ? (
                    <HandoffProgress
                      item={handoff}
                      onRetry={
                        clientId && handoff.agent
                          ? () => {
                              void commitActionHandoff({
                                clientId,
                                actionItemId: handoff.id,
                                title: handoff.title,
                                agent: handoff.agent as AgentKey,
                              });
                            }
                          : undefined
                      }
                    />
                  ) : null}
                </div>
                {action.button === "hand" && clientId && handoff ? (
                  <BriefHandControl clientId={clientId} item={handoff} audience={audience} />
                ) : action.button === "hand" ? null : (
                  <button
                    type="button"
                    className="btn ghost mini"
                    onClick={() => {
                      if (action.button === "chase") setChaseOpen(true);
                      else if (action.tab) onOpen(action.tab);
                    }}
                  >
                    {BUTTON_LABEL[action.button]}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="fm-brief-empty">{brief.actionEmpty}</p>
      )}
      {chaseOpen && brief.chase ? (
        <ChaseDraftDialog draft={brief.chase} onClose={() => setChaseOpen(false)} />
      ) : null}

      <h3>Drafts ready to review</h3>
      {brief.drafts.length > 0 ? (
        <ul className="fm-brief-drafts">
          {brief.drafts.map((draft) => (
            <li key={draft.id} data-draft-stale={draft.refresh ? "true" : undefined}>
              <span>{draft.title}</span>
              {draft.refresh && draft.title !== DRAFT_OUT_OF_DATE ? (
                <span className="fm-brief-refresh">{DRAFT_OUT_OF_DATE}</span>
              ) : null}
              <button type="button" className="btn ghost mini" onClick={() => onOpen("reports")}>
                Open
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="fm-brief-empty">{brief.draftEmpty}</p>
      )}
    </section>
  );
}
