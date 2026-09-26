/**
 * Export the Budget & variance PDF from the client Budget tab.
 * Same react-pdf report the Reports studio downloads.
 */

import { useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { useAccountantProfile } from "@/contexts/accountant-profile";
import { useAuth } from "@/hooks/use-auth";
import { useMarket } from "@/contexts/market";
import type { BudgetDocument } from "@/lib/budget.types";
import { buildBudgetPdfModel, type BudgetPdfActual } from "@/lib/budget-pdf";
import { listBudgetMonthActuals } from "@/lib/budget-actuals.functions";
import type { ClientReviewSignoff } from "@/lib/review-signoffs.functions";
import { computeIsStale } from "@/components/review-signoff";
import { stampFromSignoff } from "@/lib/review-signoff-stamp";
import {
  hashFigures,
  latestSnapshotId,
  recordDelivery,
  warnIfDeliveryFailed,
  warnIfPdfArchiveFailed,
} from "@/lib/advisory-deliveries";

export function BudgetPdfExportButton({
  doc,
  clientId,
  clientName,
  signoff,
  budgetUpdatedAt,
}: {
  doc: BudgetDocument;
  clientId?: string;
  clientName?: string;
  signoff?: ClientReviewSignoff | null;
  budgetUpdatedAt?: string | null;
}) {
  const { market } = useMarket();
  const { profile, firmId } = useAccountantProfile();
  const { user } = useAuth();
  const listActuals = useServerFn(listBudgetMonthActuals);
  const [exporting, setExporting] = useState(false);

  const exportPDF = async () => {
    setExporting(true);
    try {
      let actuals: BudgetPdfActual[] = [];
      if (clientId) {
        try {
          const res = await listActuals({ data: { clientId, fyStart: doc.fyStart } });
          actuals = (res.actuals ?? []).map((row) => ({
            month: row.month,
            status: row.status,
            totals: row.totals,
          }));
        } catch (e) {
          console.warn("budget pdf actuals:", e);
        }
      }

      const model = buildBudgetPdfModel(doc, actuals, market);
      const stale = computeIsStale(signoff ?? null, budgetUpdatedAt ?? doc.updatedAt);
      const stamp = stampFromSignoff(signoff, stale);
      const [{ pdf }, { BudgetVariancePDF }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("@/reports/budget-variance"),
      ]);

      const name = clientName?.trim() || "Client";
      const blob = await pdf(
        BudgetVariancePDF({
          smeData: { name, period: model.periodLabel },
          model,
          accountantProfile: profile,
          isDemo: false,
          draft: !stamp,
          reviewSignoff: stamp,
          market,
        }) as Parameters<typeof pdf>[0],
      ).toBlob();

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name.replace(/\s+/g, "_")}_BudgetVariance.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);

      if (user && clientId) {
        const snapId = await latestSnapshotId(clientId);
        const logged = await recordDelivery({
          clientId,
          firmId,
          channel: "pdf_download",
          kind: "report_pdf",
          reportKey: "budget",
          snapshotId: snapId,
          figuresHash: hashFigures({
            fyStart: doc.fyStart,
            scenario: doc.activeScenario,
            revenue: model.summary[0]?.budget ?? null,
            hasActuals: model.hasActuals,
          }),
          periodLabel: model.periodLabel,
          createdBy: user.id,
          pdfBlob: blob,
        });
        warnIfDeliveryFailed(logged.error);
        warnIfPdfArchiveFailed(logged.pdfError);
      }
      toast.success("Budget & variance PDF downloaded.");
    } catch (err) {
      toast.error(`PDF export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <Button
      id="budget-export-pdf"
      type="button"
      size="sm"
      variant="outline"
      className="h-7 gap-1.5 border-[#d4a550]/40 bg-[#d4a550]/10 px-2.5 text-[10px] text-[#b8860b] hover:bg-[#d4a550]/20 dark:text-[#d4a550]"
      disabled={exporting}
      onClick={() => void exportPDF()}
    >
      <Download className="h-3 w-3" /> {exporting ? "Preparing…" : "Export PDF"}
    </Button>
  );
}
