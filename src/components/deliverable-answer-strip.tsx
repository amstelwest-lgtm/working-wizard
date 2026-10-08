import type { ReactNode } from "react";
import { ReviewSignoffButton } from "@/components/review-signoff";
import { SignoffStatusChip } from "@/components/signoff-status-chip";
import {
  buildDeliverableInputDefinition,
  type DeliverableInputContext,
  type DeliverableInputId,
} from "@/lib/deliverable-input-config";
import type { ClientReviewSignoff, ReviewScope } from "@/lib/review-signoffs.functions";

/** One line from the configure-inputs lists already on this deliverable. */
export function deliverableDrawerHint(
  id: DeliverableInputId,
  ctx: DeliverableInputContext = {},
): string {
  const def = buildDeliverableInputDefinition(id, ctx);
  const sources = def.sources.length;
  const assumptions = def.assumptions.length;
  return `${sources} source${sources === 1 ? "" : "s"} · ${assumptions} assumption${assumptions === 1 ? "" : "s"}`;
}

export function DeliverableAnswerStrip({
  heading,
  sentence,
  chip,
  scope,
  clientId,
  clientName,
  signoff,
  isStale,
  onSignoffChange,
  canSign = false,
  extraActions = null,
  signoffVerbOnly = false,
}: {
  heading: string;
  sentence: string;
  chip?: string | null;
  scope: ReviewScope;
  clientId?: string;
  clientName?: string;
  signoff: ClientReviewSignoff | null;
  isStale: boolean;
  onSignoffChange?: (next: ClientReviewSignoff | null) => void;
  canSign?: boolean;
  extraActions?: ReactNode;
  /** "Sign off" without the scope name. */
  signoffVerbOnly?: boolean;
}) {
  return (
    <section className="answer-strip" data-answer-strip>
      <div className="answer-strip__lead">
        <h2 className="answer-strip__heading">{heading}</h2>
        {sentence ? <p className="answer-strip__sentence">{sentence}</p> : null}
      </div>
      <div className="answer-strip__actions">
        {canSign && clientId && onSignoffChange ? (
          <ReviewSignoffButton
            hideStatus
            clientId={clientId}
            clientName={clientName}
            scope={scope}
            signoff={signoff}
            isStale={isStale}
            onChange={onSignoffChange}
            verbOnly={signoffVerbOnly}
          />
        ) : null}
        {extraActions}
      </div>
      <div className="answer-strip__meta">
        {chip ? (
          <span className="answer-strip__chip" data-source-chip>
            {chip}
          </span>
        ) : null}
        <SignoffStatusChip clientId={clientId} scope={scope} signoff={signoff} isStale={isStale} />
      </div>
    </section>
  );
}
