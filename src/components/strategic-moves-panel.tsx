import { AddToPlanButton } from "@/components/add-to-plan-button";
import type { RankedStrategicMove } from "@/lib/strategic-moves";

/**
 * Accountant Moves tab. Same ranked list the Action Plan imports and labels
 * “From strategic moves”.
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
  return (
    <section className="card pad">
      <span className="eyebrow">Strategic Moves</span>
      <p className="brain-purpose">
        Ranked from the ratios already on this file. Action Plan items marked From strategic moves
        come from this list. Add one when it is the next thing to chase.
      </p>
      {moves.length === 0 ? (
        <p className="sub" style={{ margin: 0 }}>
          No moves yet. Add figures on Overview and this list fills from the ratios.
        </p>
      ) : (
        <ol className="brain-list" style={{ marginTop: 14 }}>
          {moves.map((move, index) => (
            <li key={move.key} className="brain-row">
              <div>
                <div className="brain-row-title">
                  {index + 1}. {move.title}
                </div>
                <div className="brain-row-meta">
                  {move.ratioName}
                  {Number.isFinite(move.health) ? ` · health ${move.health.toFixed(0)}%` : ""}
                </div>
                {index < 3 && move.impactLine ? (
                  <p className="sub" style={{ margin: "6px 0 0" }}>
                    {move.impactLine}
                  </p>
                ) : null}
              </div>
              <div className="brain-row-actions">
                <AddToPlanButton
                  clientId={clientId}
                  moveKey={move.key}
                  title={move.title}
                  outcomeWhy={move.impactLine || `Improves ${move.ratioName}.`}
                  onAssign={onOpenPlan}
                  variant="studio"
                />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
