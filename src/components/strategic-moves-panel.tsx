import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ActionHandoffButtons } from "@/components/action-handoff-buttons";
import { AddToPlanButton, ensureMoveActionItem } from "@/components/add-to-plan-button";
import { ArapAnswerStrip } from "@/components/arap-answer-strip";
import { ReviewInputsDrawer } from "@/components/review-inputs-drawer";
import { handoffComingOnline } from "@/hooks/owner-agent-ui";
import { agentDisplayName, agentShortName } from "@/lib/milon-team";
import type { AgentKey } from "@/lib/milon-team-feed";
import { movesAnswerSentence } from "@/lib/overview-moves-copy";
import { recordHandoffAssignment, requestOwnerHandoff } from "@/lib/owner-handoff-client";
import type { RankedStrategicMove } from "@/lib/strategic-moves";

function MoveHandoff({
  clientId,
  move,
}: {
  clientId: string;
  move: RankedStrategicMove;
}) {
  const [assigned, setAssigned] = useState<string | null>(null);
  const [comingSoon, setComingSoon] = useState<Partial<Record<AgentKey, true>>>({});
  const onHandOff = async (agent: AgentKey) => {
    try {
      const saved = await ensureMoveActionItem({
        clientId,
        moveKey: move.key,
        title: move.title,
        outcomeWhy: move.impactLine || `Improves ${move.ratioName}.`,
      });
      const result = await requestOwnerHandoff({
        clientId,
        actionItemId: saved.id,
        agent,
      });
      if (!result.ok && handoffComingOnline(result.error)) {
        const parked = await recordHandoffAssignment({
          clientId,
          actionItemId: saved.id,
          agent,
        });
        if (!parked.ok) {
          setComingSoon((current) => ({ ...current, [agent]: true }));
          toast.error(parked.error);
          return;
        }
      } else if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const name = agentDisplayName(agent);
      await supabase
        .from("action_items")
        .update({ owner_id: null, owner_name: name, owner_email: null })
        .eq("id", saved.id);
      setAssigned(name);
      toast.success(`Assigned to ${agentShortName(agent)}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Couldn't hand this move off");
    }
  };
  return (
    <ActionHandoffButtons
      ownerName={assigned}
      comingSoon={comingSoon}
      onHandOff={(agent) => void onHandOff(agent)}
    />
  );
}

/**
 * Accountant Moves tab. Same ranked list the Action Plan imports.
 * No review scope, so the strip has no status pill and no source chip.
 */
export function StrategicMovesPanel({
  moves,
  clientId,
  onOpenPlan,
}: {
  moves: RankedStrategicMove[];
  clientId: string;
  onOpenPlan: (moveKey: string) => void;
}) {
  const first = moves[0];
  const assumptions = moves.filter((move) => move.impactLine.trim());
  return (
    <>
      <ArapAnswerStrip
        heading="Moves"
        sentence={movesAnswerSentence(moves)}
        primary={
          first ? (
            <AddToPlanButton
              clientId={clientId}
              moveKey={first.key}
              title={first.title}
              outcomeWhy={first.impactLine || `Improves ${first.ratioName}.`}
              onAssign={onOpenPlan}
              variant="studio"
              tone="strip"
            />
          ) : null
        }
      />
      {assumptions.length > 0 ? (
        <ReviewInputsDrawer hint="Assumptions">
          <ul className="brain-list" style={{ margin: 0 }}>
            {assumptions.map((move) => (
              <li key={move.key} className="brain-row">
                <div>
                  <div className="brain-row-title">{move.title}</div>
                  <p className="sub" style={{ margin: "6px 0 0" }}>
                    {move.impactLine}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </ReviewInputsDrawer>
      ) : null}
      {moves.length > 0 ? (
        <section className="card pad">
          <span className="eyebrow">Strategic Moves</span>
          <ol className="brain-list" style={{ marginTop: 14 }}>
            {moves.map((move, index) => (
              <li key={move.key} className="brain-row">
                <div>
                  <div className="brain-row-title">
                    {index + 1}. {move.title}
                  </div>
                  <div className="brain-row-meta">{move.ratioName}</div>
                </div>
                <div className="brain-row-actions">
                  {index === 0 ? null : (
                    <AddToPlanButton
                      clientId={clientId}
                      moveKey={move.key}
                      title={move.title}
                      outcomeWhy={move.impactLine || `Improves ${move.ratioName}.`}
                      onAssign={onOpenPlan}
                      variant="studio"
                      tone="quiet"
                    />
                  )}
                  <MoveHandoff clientId={clientId} move={move} />
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </>
  );
}
