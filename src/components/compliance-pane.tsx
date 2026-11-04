import { ClientSubpageFrame } from "@/components/client-subpage";
import { WorkingPaperDirtyWorkPanel } from "@/components/draftworx-dirty-work-panel";
import { EmptyState } from "@/components/primitives/empty-state";
import { TrialBalanceRefreshPrompt } from "@/components/trial-balance-refresh-prompt";
import { complianceDirtyWorkEnabled, workingPaperVendorForMarket } from "@/lib/draftworx-dirty-work";
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
  const enabled = complianceDirtyWorkEnabled(market);
  const vendor = workingPaperVendorForMarket(market);
  const productLabel = vendor === "caseware" ? "Caseware" : "Draftworx";

  return (
    <ClientSubpageFrame id="compliance" eyebrow="Work" title="Compliance">
      {!enabled ? (
        <EmptyState
          id="compliance-unavailable"
          dashed
          title="Compliance tools are not available here yet"
          description="Working-paper helpers are limited to South African (Draftworx) and US (Caseware) client files."
        />
      ) : !hasFigures ? (
        <EmptyState
          id="compliance-no-figures"
          dashed
          title="Import figures first"
          description={`Load a trial balance on Diagnose, then return here for ${productLabel} checklist and summary export.`}
        />
      ) : (
        <>
          {needsTrialBalanceRefresh ? (
            <TrialBalanceRefreshPrompt onImport={onImportTrialBalance} />
          ) : null}
          <WorkingPaperDirtyWorkPanel
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
