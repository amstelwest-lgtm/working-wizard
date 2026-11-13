import type { ReactNode } from "react";
import { DeliverableAnswerStrip } from "@/components/deliverable-answer-strip";
import { computeOverviewCaption, healthAnswerSentence } from "@/lib/overview-insights";
import type { HealthTier } from "@/lib/ratios";
import type { ClientReviewSignoff, ReviewScope } from "@/lib/review-signoffs.functions";

/** Health sentence and its strip. The overview-insights chunk loads with this panel. */
export function HealthScoreAnswer({
  hasFigures,
  avgHealth,
  cashHealth,
  displayStatus,
  bandLabel,
  pillars,
  includeScore,
  chip,
  scope,
  clientId,
  clientName,
  signoff,
  isStale,
  onSignoffChange,
  signoffKnown,
  extraActions,
}: {
  hasFigures: boolean;
  avgHealth: number;
  cashHealth: number;
  displayStatus?: HealthTier;
  bandLabel: string;
  pillars: { label: string; score: number; status?: HealthTier | null }[];
  includeScore: boolean;
  chip?: string | null;
  scope: ReviewScope;
  clientId: string;
  clientName?: string;
  signoff: ClientReviewSignoff | null;
  isStale: boolean;
  onSignoffChange?: (next: ClientReviewSignoff | null) => void;
  signoffKnown: boolean;
  extraActions?: ReactNode;
}) {
  const caption = computeOverviewCaption({
    hasRealFinancials: hasFigures,
    avgHealth,
    cashHealth,
    displayStatus,
  });
  const sentence = healthAnswerSentence({
    caption,
    score: Number.isFinite(avgHealth) ? avgHealth : null,
    bandLabel,
    pillars,
    includeScore,
  });
  return (
    <DeliverableAnswerStrip
      heading="Health score"
      sentence={sentence}
      chip={chip}
      scope={scope}
      clientId={clientId}
      clientName={clientName}
      signoff={signoff}
      isStale={isStale}
      onSignoffChange={onSignoffChange}
      signoffKnown={signoffKnown}
      canSign
      extraActions={extraActions}
    />
  );
}
