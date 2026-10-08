/**
 * The one status line for a deliverable tab. Wording comes from
 * `signoffStatusLine` — this file does not format a second phrase.
 */
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMarketFormat } from "@/contexts/market";
import { formatReviewDateTime } from "@/lib/market/format";
import {
  getDeliverableWorkflow,
  type ClientReviewSignoff,
  type ReviewScope,
} from "@/lib/review-signoffs.functions";
import { isSamplePracticeSignoff } from "@/lib/review-signoff-stamp";
import { signoffScopeLabel, signoffStatusKind, signoffStatusLine } from "@/lib/signoff-status";

export function SignoffStatusChip({
  clientId,
  scope,
  signoff,
  isStale,
  known = true,
}: {
  clientId?: string;
  scope: ReviewScope;
  signoff: ClientReviewSignoff | null;
  isStale: boolean;
  /** False until the sign-off row has loaded. Draft is not the loading state. */
  known?: boolean;
}) {
  const { market } = useMarketFormat();
  const loadWorkflow = useServerFn(getDeliverableWorkflow);
  const [readyForReview, setReadyForReview] = useState(false);
  const shown =
    signoff &&
    !isSamplePracticeSignoff({
      name: signoff.signed_off_by_name,
      firmName: signoff.firm_name,
    })
      ? signoff
      : null;

  useEffect(() => {
    if (!clientId || shown) return;
    let cancelled = false;
    void loadWorkflow({ data: { clientId, scope } })
      .then((workflow) => {
        if (!cancelled) setReadyForReview(workflow?.status === "ready_for_review");
      })
      .catch(() => {
        if (!cancelled) setReadyForReview(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, scope, shown, loadWorkflow]);

  if (!known) {
    return (
      <p
        data-signoff-status
        data-signoff-scope={scope}
        data-signoff-pending="true"
        className="answer-strip__status"
        aria-busy="true"
      />
    );
  }

  const kind = signoffStatusKind({
    hasSignoff: Boolean(shown),
    isStale,
    readyForReview,
  });
  const when = shown?.signed_off_at ? formatReviewDateTime(shown.signed_off_at, market) : "";

  return (
    <p data-signoff-status data-signoff-scope={scope} className="answer-strip__status">
      {signoffStatusLine({
        kind,
        name: shown?.signed_off_by_name,
        date: kind === "signed" && when && when !== "—" ? when : null,
        variant: "short",
        scopeLabel: signoffScopeLabel(scope),
      })}
    </p>
  );
}
