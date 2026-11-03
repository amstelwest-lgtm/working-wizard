import { ClientSubpageFrame } from "@/components/client-subpage";
import { DraftworxDirtyWorkPanel } from "@/components/draftworx-dirty-work-panel";
import { EmptyState } from "@/components/primitives/empty-state";
import { TrialBalanceRefreshPrompt } from "@/components/trial-balance-refresh-prompt";
import { draftworxDirtyWorkEnabled } from "@/lib/draftworx-dirty-work";
import type { ResolvedMarket } from "@/lib/market/types";
import type { ClientReviewSignoff } from "@/lib/review-signoffs.functions";

export function CompliancePane({
  clientId,
  clientName,
  market,
  financials,
  financialsSignoff,
  signoffStale,
  needsTrialBalanceRefresh,
  hasFigures,
  onImportTrialBalance,
}: {
  clientId: string;
  clientName?: string | null;
  market: ResolvedMarket;
  financials: Record<string, unknown> | null | undefined;
  financialsSignoff: ClientReviewSignoff | null;
  signoffStale: boolean;
  needsTrialBalanceRefresh: boolean;
  hasFigures: boolean;
  onImportTrialBalance: () => void;
}) {
  const enabled = draftworxDirtyWorkEnabled(market);

  return (
    <ClientSubpageFrame id="compliance" eyebrow="Work" title="Compliance">
      {!enabled ? (
        <EmptyState
          id="compliance-unavailable"
          dashed
          title="Compliance tools are not available here yet"
          description="Draftworx working-paper helpers are limited to South African client files."
        />
      ) : !hasFigures ? (
        <EmptyState
          id="compliance-no-figures"
          dashed
          title="Import figures first"
          description="Load a trial balance on Diagnose, then return here for Draftworx checklist and summary export."
        />
      ) : (
        <>
          {needsTrialBalanceRefresh ? (
            <TrialBalanceRefreshPrompt onImport={onImportTrialBalance} />
          ) : null}
          <DraftworxDirtyWorkPanel
            clientId={clientId}
            clientName={clientName}
            market={market}
            financials={financials}
            financialsSignoff={financialsSignoff}
            signoffStale={signoffStale}
            needsTrialBalanceRefresh={needsTrialBalanceRefresh}
          />
        </>
      )}
    </ClientSubpageFrame>
  );
}
