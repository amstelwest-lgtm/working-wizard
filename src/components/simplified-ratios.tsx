import { Sparkline } from "@/components/sparkline";
import { scoreTier } from "@/lib/ratios";
import { AddPastPeriodLink } from "@/components/add-past-period-link";
import { evidenceForPillar, pillarIsWeak } from "@/lib/workflow-coach";

interface SectionCard {
  id: string;
  label: string;
  health: number;
  series: number[];
}

interface SimplifiedRatiosProps {
  sections: SectionCard[];
  onAddPastPeriod?: () => void;
  /** Weak pillar → the evidence page that explains it. */
  onOpenEvidence?: (pillarId: string) => void;
}

function statusLabel(health: number): string {
  if (!isFinite(health)) return "NO DATA";
  const tier = scoreTier(health);
  if (tier === "healthy") return "HEALTHY";
  if (tier === "at_risk") return "NEEDS WATCH";
  return "HIGH RISK";
}

function statusColor(health: number): string {
  if (!isFinite(health)) return "rgb(100 116 139)";
  const tier = scoreTier(health);
  if (tier === "healthy") return "#4CAF82";
  if (tier === "at_risk") return "#f59e0b";
  return "#e05c5c";
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
}: SimplifiedRatiosProps) {
  return (
    <div className="grid grid-cols-2 gap-3 p-1" id="coach-pillars">
      {sections.map((card) => {
        const color = statusColor(card.health);
        const trend = trendDir(card.series);
        const displayHealth = isFinite(card.health) ? `${Math.round(card.health)}%` : "—";
        const evidence =
          onOpenEvidence && pillarIsWeak(card.health) ? evidenceForPillar(card.id) : null;

        return (
          <div
            key={card.id}
            className="flex flex-col gap-1 rounded-2xl border border-white/8 bg-white/[0.04] px-4 pb-3 pt-4"
          >
            <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
              {card.label}
            </span>
            <span className="text-[28px] font-bold leading-none text-white">
              {displayHealth}
            </span>
            <span
              className="text-[10px] font-semibold uppercase tracking-[0.08em]"
              style={{ color }}
            >
              {statusLabel(card.health)}
            </span>
            {card.series.length >= 2 ? (
              <Sparkline data={card.series} trend={trend} width={110} height={36} />
            ) : (
              <div className="mt-1.5 flex h-9 items-center text-[10px] text-slate-500">
                {onAddPastPeriod ? (
                  <AddPastPeriodLink onOpen={onAddPastPeriod} className="text-[10px] font-medium text-[#d4a550] underline decoration-[#d4a550]/40 underline-offset-2" />
                ) : (
                  "trend builds with snapshots"
                )}
              </div>
            )}
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
