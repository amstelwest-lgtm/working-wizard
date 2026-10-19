import { Sparkline } from "@/components/sparkline";
import { healthBandLabel, scoreTier, type HealthTier } from "@/lib/ratios";
import { AddPastPeriodLink } from "@/components/add-past-period-link";
import { DigCue } from "@/components/health-drill-cue";
import { evidenceForPillar, pillarIsWeak } from "@/lib/workflow-coach";

interface SectionCard {
  id: string;
  label: string;
  health: number;
  series: number[];
  /** Capped pillar band from computeOverallHealth. Falls back to the score table. */
  status?: HealthTier;
}

interface SimplifiedRatiosProps {
  sections: SectionCard[];
  onAddPastPeriod?: () => void;
  /** Weak pillar → the evidence page that explains it. */
  onOpenEvidence?: (pillarId: string) => void;
  /** Open this pillar's real driver ratios in the health score drill. */
  onOpenPillar?: (pillarId: string) => void;
  /** Same floor line as the Health ring. Cash only. */
  cashFloorCue?: string | null;
  /** Shown in place of a band when the pillar has no score. */
  unscoredLabel?: string | null;
  /** Opens the Financial Manager. The rest of the card still drills. */
  onCashFloor?: () => void;
}

function statusLabel(health: number, status?: HealthTier, unscoredLabel?: string | null): string {
  if (unscoredLabel) return unscoredLabel;
  if (!isFinite(health)) return "No data";
  return healthBandLabel(status ?? scoreTier(health));
}

function statusColor(health: number, status?: HealthTier): string {
  if (!isFinite(health)) return "rgb(100 116 139)";
  const tier = status ?? scoreTier(health);
  if (tier === "healthy") return "#16845B";
  if (tier === "at_risk") return "#B7791F";
  return "#C43D4B";
}

function trendDir(series: number[]): "up" | "down" | "flat" {
  if (series.length < 2) return "flat";
  const delta = series[series.length - 1] - series[0];
  if (delta > 0.001) return "up";
  if (delta < -0.001) return "down";
  return "flat";
}

export function SimplifiedRatios({
  sections,
  onAddPastPeriod,
  onOpenEvidence,
  onOpenPillar,
  cashFloorCue = null,
  onCashFloor,
}: SimplifiedRatiosProps) {
  return (
    <div className="grid grid-cols-2 gap-3 p-1" id="coach-pillars">
      {sections.map((card) => {
        const color = statusColor(card.health, card.status);
        const trend = trendDir(card.series);
        const displayHealth = card.unscoredLabel
          ? "—"
          : isFinite(card.health)
            ? `${Math.round(card.health)}`
            : "—";
        const evidence =
          onOpenEvidence && pillarIsWeak(card.health) ? evidenceForPillar(card.id) : null;
        const trendSlot =
          card.series.length >= 2 ? (
            <Sparkline data={card.series} trend={trend} width={110} height={36} />
          ) : (
            <div className="mt-1.5 flex h-9 items-center text-[10px] text-slate-500">
              {onAddPastPeriod ? (
                <AddPastPeriodLink onOpen={onAddPastPeriod} className="text-[10px] font-medium text-[#0B5FFF] underline decoration-[#0B5FFF]/40 underline-offset-2" />
              ) : (
                "trend builds with snapshots"
              )}
            </div>
          );
        const figure = (
          <>
            <span className="text-[10px] font-bold tracking-[0.12em] text-[#3D5270] dark:text-slate-400">
              {card.label}
            </span>
            <span className="text-[28px] font-bold leading-none text-[#102A43] dark:text-white">
              {displayHealth}
            </span>
            <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.08em] text-[#102A43] dark:text-white">
              <i
                aria-hidden
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: color }}
              />
              {statusLabel(card.health, card.status, card.unscoredLabel)}
            </span>
            {card.series.length >= 2 ? trendSlot : null}
          </>
        );

        return (
          <div
            key={card.id}
            className="health-summary-card flex min-w-0 flex-col gap-1 rounded-2xl border border-[#DBEAFE] bg-white px-4 pb-3 pt-4 dark:border-[#1e3a5f] dark:bg-[#0b1b2b]"
          >
            {onOpenPillar ? (
              <button
                type="button"
                className="health-summary-open"
                onClick={() => onOpenPillar(card.id)}
                aria-label={`${card.label} score ${displayHealth}. Dig deeper.`}
              >
                {figure}
                {card.id === "cash" && cashFloorCue ? (
                  <span
                    className="health-cash-floor"
                    data-cash-floor-cue="true"
                    role="link"
                    tabIndex={0}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onCashFloor?.();
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      event.stopPropagation();
                      onCashFloor?.();
                    }}
                  >
                    {cashFloorCue}
                  </span>
                ) : null}
                <DigCue id={`pillar-summary-${card.id}`} compact />
              </button>
            ) : (
              figure
            )}
            {card.series.length < 2 ? trendSlot : null}
            {evidence ? (
              <button
                type="button"
                className="pillar-evidence"
                onClick={() => onOpenEvidence?.(card.id)}
              >
                {evidence.label}
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
