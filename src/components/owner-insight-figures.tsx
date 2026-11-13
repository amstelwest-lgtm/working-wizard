import { useEffect, type ReactNode } from "react";
import { OverviewRail } from "@/components/overview-rail";
import {
  computeCashTrajectory,
  computeHealthBand,
  computeNextMoveImpactLabel,
  computeOverviewCaption,
  computePositionPercentile,
  computeWeekChanges,
} from "@/lib/overview-insights";
import type { HealthTier } from "@/lib/ratios";

export type OwnerInsightCopy = {
  caption?: string;
  impact?: string;
};

/**
 * Overview math stays in its own chunk. The scored rail reserves its box
 * until this module commits.
 */
export function OwnerInsightFigures({
  showScoredBoard,
  avgHealth,
  cashHealth,
  profitHealth,
  revenueGrowth,
  grossMarginRatio,
  displayStatus,
  revenue,
  operatingCashflow,
  currentAssets,
  currentLiabilities,
  topKey,
  receivables,
  currency,
  onCopy,
  onOpenCash,
  onOpenMoves,
  onOpenBenchmarks,
  industryPulse,
}: {
  showScoredBoard: boolean;
  avgHealth: number;
  cashHealth: number | null;
  profitHealth: number | null;
  revenueGrowth: number | null;
  grossMarginRatio: number | null;
  displayStatus: HealthTier;
  revenue: number | null;
  operatingCashflow: number | null;
  currentAssets: number | null;
  currentLiabilities: number | null;
  topKey?: string;
  receivables: number | null;
  currency: string;
  onCopy: (copy: OwnerInsightCopy) => void;
  onOpenCash: () => void;
  onOpenMoves: () => void;
  onOpenBenchmarks: () => void;
  industryPulse: ReactNode;
}) {
  const cash = cashHealth ?? Number.NaN;
  const profit = profitHealth ?? Number.NaN;
  const caption = computeOverviewCaption({
    hasRealFinancials: showScoredBoard,
    avgHealth,
    cashHealth: cash,
    displayStatus,
  });
  const impact = computeNextMoveImpactLabel({
    topKey,
    revenue: revenue ?? Number.NaN,
    receivables: receivables ?? Number.NaN,
    currency,
  });
  useEffect(() => {
    onCopy({ caption, impact });
  }, [caption, impact, onCopy]);

  const healthBand =
    showScoredBoard && Number.isFinite(avgHealth) ? computeHealthBand(avgHealth) : null;
  return (
    <OverviewRail
      healthBand={healthBand}
      positionPercentile={computePositionPercentile(showScoredBoard, avgHealth)}
      weekChanges={computeWeekChanges({
        revenueGrowth: revenueGrowth ?? Number.NaN,
        cashHealth: cash,
        profitHealth: profit,
        grossMarginRatio: grossMarginRatio ?? Number.NaN,
      })}
      cashTrajectory={computeCashTrajectory({
        hasRealFinancials: showScoredBoard,
        revenue: revenue ?? Number.NaN,
        operatingCashflow: operatingCashflow ?? Number.NaN,
        currentAssets: currentAssets ?? Number.NaN,
        currentLiabilities: currentLiabilities ?? Number.NaN,
      })}
      onOpenCash={onOpenCash}
      onOpenMoves={onOpenMoves}
      onOpenBenchmarks={onOpenBenchmarks}
      industryPulse={industryPulse}
    />
  );
}
