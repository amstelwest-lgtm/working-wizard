import { AddToPlanButton } from "@/components/add-to-plan-button";
import { MoveHandTo } from "@/components/hand-to-menu";
import { ArapAnswerStrip } from "@/components/arap-answer-strip";
import { ReviewInputsDrawer } from "@/components/review-inputs-drawer";
import { movesAnswerSentence } from "@/lib/overview-moves-copy";
import { moveFactorLabel, type RankedStrategicMove } from "@/lib/strategic-moves";

/**
 * Accountant Moves tab. Same ranked list the Action Plan imports.
 * No review scope, so the strip has no status pill and no source chip.
 */
export function StrategicMovesPanel({
  moves,
  clientId,
  onOpenPlan,
  onOpenDraft,
}: {
  moves: RankedStrategicMove[];
  clientId: string;
  onOpenPlan: (moveKey: string) => void;
  onOpenDraft?: (draftId: string) => void;
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
            <>
              <AddToPlanButton
                clientId={clientId}
                moveKey={first.key}
                title={first.title}
                outcomeWhy={first.impactLine || `Improves ${moveFactorLabel(first)}.`}
                onAssign={onOpenPlan}
                variant="studio"
                tone="strip"
              />
              <MoveHandTo
                clientId={clientId}
                moveKey={first.key}
                title={first.title}
                outcomeWhy={first.impactLine || `Improves ${moveFactorLabel(first)}.`}
                onOpenDraft={onOpenDraft}
              />
            </>
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
                  <div className="brain-row-meta">{moveFactorLabel(move)}</div>
                </div>
                <div className="brain-row-actions">
                  <MoveHandTo
                    clientId={clientId}
                    moveKey={move.key}
                    title={move.title}
                    outcomeWhy={move.impactLine || `Improves ${moveFactorLabel(move)}.`}
                    onOpenDraft={onOpenDraft}
                  />
                  <AddToPlanButton
                    clientId={clientId}
                    moveKey={move.key}
                    title={move.title}
                    outcomeWhy={move.impactLine || `Improves ${moveFactorLabel(move)}.`}
                    onAssign={onOpenPlan}
                    variant="studio"
                    tone="quiet"
                  />
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </>
  );
}
