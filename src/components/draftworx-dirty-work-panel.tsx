import { useMemo } from "react";
import { ClipboardCheck, Download } from "lucide-react";
import { CollapsibleGoldCard } from "@/components/primitives/collapsible-gold-card";
import { Button } from "@/components/ui/button";
import type { ResolvedMarket } from "@/lib/market/types";
import type { ClientReviewSignoff } from "@/lib/review-signoffs.functions";
import {
  buildWorkingPaperChecklist,
  workingPaperExportFileName,
  workingPaperTrialBalanceCsv,
  workingPaperVendorForMarket,
  type WorkingPaperCheckStatus,
  type WorkingPaperVendor,
} from "@/lib/draftworx-dirty-work";
import { readStatementMeta } from "@/lib/statement-period";

function statusLabel(status: WorkingPaperCheckStatus): string {
  switch (status) {
    case "pass":
      return "Done";
    case "warn":
      return "Review";
    case "fail":
      return "Blocked";
    default:
      return "To do";
  }
}

function statusClass(status: WorkingPaperCheckStatus): string {
  switch (status) {
    case "pass":
      return "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200";
    case "warn":
      return "bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-100";
    case "fail":
      return "bg-rose-100 text-rose-950 dark:bg-rose-950 dark:text-rose-100";
    default:
      return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200";
  }
}

function vendorTitle(vendor: WorkingPaperVendor): string {
  return vendor === "draftworx" ? "Draftworx working papers" : "Caseware working papers";
}

function vendorImportHint(vendor: WorkingPaperVendor): string {
  const product = vendor === "draftworx" ? "Draftworx" : "Caseware";
  return `${product}'s Working Trial Balance import`;
}

export function WorkingPaperDirtyWorkPanel({
  clientId,
  clientName,
  market,
  financials,
  financialsSignoff,
  signoffStale,
  needsTrialBalanceRefresh,
}: {
  clientId: string;
  clientName?: string | null;
  market: ResolvedMarket;
  financials: Record<string, unknown> | null | undefined;
  financialsSignoff?: ClientReviewSignoff | null;
  signoffStale?: boolean;
  needsTrialBalanceRefresh?: boolean;
}) {
  const vendor = workingPaperVendorForMarket(market);
  if (!vendor) return null;

  const checklist = useMemo(
    () =>
      buildWorkingPaperChecklist({
        financials,
        market,
        vendor,
        financialsSignoff,
        signoffStale,
        needsTrialBalanceRefresh,
      }),
    [financials, market, vendor, financialsSignoff, signoffStale, needsTrialBalanceRefresh],
  );

  const openCount = checklist.filter((item) => item.status === "todo" || item.status === "warn").length;
  const meta = readStatementMeta(financials ?? {}, market);
  const product = vendor === "draftworx" ? "Draftworx" : "Caseware";

  const downloadCsv = () => {
    const csv = workingPaperTrialBalanceCsv(financials, clientName ?? "Client", market, vendor);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = workingPaperExportFileName(clientName ?? "client", meta.periodEnd, vendor);
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <CollapsibleGoldCard
      id={`${vendor}-dirty-work-${clientId}`}
      icon={ClipboardCheck}
      title={vendorTitle(vendor)}
      subtitle={
        openCount
          ? `${openCount} item${openCount === 1 ? "" : "s"} before the summary TB is file-ready`
          : `Summary checklist and export for ${product} Excel import`
      }
      defaultOpen={openCount > 0}
      headerRight={
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1.5 text-xs"
          onClick={(event) => {
            event.stopPropagation();
            downloadCsv();
          }}
        >
          <Download className="h-3.5 w-3.5" />
          Export summary TB
        </Button>
      }
    >
      <p className="text-[12px] leading-relaxed text-slate-600 dark:text-slate-300">
        Milōn builds a <strong>summary</strong> trial balance from figures already on this client —
        not your general ledger. Save the CSV, open it in Excel (.xlsx), and map Account Number,
        Account Name, Debit, and Credit in {vendorImportHint(vendor)}.
      </p>
      <ul className="mt-4 space-y-2" aria-label={`${product} working paper checklist`}>
        {checklist.map((item) => (
          <li
            key={item.id}
            className="flex gap-3 rounded-lg border border-slate-200/80 bg-white/70 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/40"
          >
            <span
              className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusClass(item.status)}`}
            >
              {statusLabel(item.status)}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">
                {item.label}
              </span>
              <span className="mt-0.5 block text-[12px] leading-relaxed text-slate-600 dark:text-slate-400">
                {item.detail}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </CollapsibleGoldCard>
  );
}

/** @deprecated Use WorkingPaperDirtyWorkPanel — kept for import stability. */
export const DraftworxDirtyWorkPanel = WorkingPaperDirtyWorkPanel;
