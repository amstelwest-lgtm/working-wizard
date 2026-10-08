/**
 * Tab-head sign-off for Advisory. One gold button, and it approves the
 * current pack version. The sentence is the pack's own line. A leftover
 * page stamp is quoted as a mismatch, never as SIGNED next to a draft pack.
 */
import { Check, Loader2 } from "lucide-react";
import { SIGNOFF_GOLD_BTN } from "@/components/review-signoff";
import { useMarketFormat } from "@/contexts/market";
import { ADVISORY_PACK_STALE_NOTE } from "@/lib/advisory-pack";
import { advisoryLegacyMismatchLine, type AdvisorySignoffAction } from "@/lib/advisory-signoff";

export function AdvisoryTabSignoff({
  action,
  pageSignoff,
  hideLine = false,
}: {
  action: AdvisorySignoffAction | null;
  pageSignoff?: {
    signed_off_by_name: string;
    firm_name: string | null;
    signed_off_at: string;
  } | null;
  /** The strip sentence already carries the sign-off line. */
  hideLine?: boolean;
}) {
  const { market } = useMarketFormat();
  if (!action) return null;
  const { state } = action;
  const approved = state.status === "signed" || state.status === "signed_stale";
  const mismatch = approved
    ? null
    : advisoryLegacyMismatchLine({
        status: state.status,
        version: state.version,
        pageSignedAt: pageSignoff?.signed_off_at,
        pageSignedBy: pageSignoff?.signed_off_by_name,
        pageFirmName: pageSignoff?.firm_name,
        market,
      });

  return (
    <div
      className="flex max-w-sm flex-col items-end gap-2"
      data-advisory-signoff={state.status}
      data-advisory-version={state.version ?? ""}
    >
      {!hideLine && approved && action.line ? (
        <p
          className="text-right text-[12px] font-semibold leading-snug text-[#3d2e00] dark:text-[#f4e7c2]"
          data-signoff-line
        >
          {action.line}
        </p>
      ) : null}
      {mismatch ? (
        <p
          className="text-right text-[12px] font-semibold leading-snug text-amber-800 dark:text-amber-200"
          data-advisory-mismatch
        >
          {mismatch}
        </p>
      ) : null}
      {action.canSignOff ? (
        <button
          type="button"
          onClick={() => {
            if (action.blocked || action.busy) return;
            action.signOff();
          }}
          disabled={action.busy || action.blocked}
          title={action.blocked ? ADVISORY_PACK_STALE_NOTE : undefined}
          className={`${SIGNOFF_GOLD_BTN} disabled:cursor-not-allowed disabled:opacity-40`}
          data-approve
          data-signoff-blocked={action.blocked ? "true" : "false"}
        >
          {action.busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
          Sign off v{state.version}
        </button>
      ) : null}
    </div>
  );
}
