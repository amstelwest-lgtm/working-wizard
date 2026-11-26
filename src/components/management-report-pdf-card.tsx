/**
 * The Management Report output. Same card chrome as the other report PDFs:
 * title, client, period, Preview, and Download. The bytes come from the
 * existing pack generator. This is not a second report layout.
 */
import { Download, Eye, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ManagementReportPdfCard({
  clientName,
  period,
  previewing = false,
  downloading = false,
  disabled = false,
  onPreview,
  onDownload,
}: {
  clientName?: string | null;
  period?: string | null;
  previewing?: boolean;
  downloading?: boolean;
  disabled?: boolean;
  onPreview: () => void;
  onDownload: () => void;
}) {
  const client = clientName?.trim() || "";
  const span = period?.trim() || "";
  return (
    <div className="reports-studio mt-4" data-management-report-pdf="">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="report-card flex flex-col" id="report-card-advisory">
          <div className="report-card__rule" />
          <div className="flex-1 p-5 pb-3">
            <h3 className="report-card__title">Advisory Management Report</h3>
            {client ? (
              <p className="mt-1.5 text-[13px] text-[#102A43] dark:text-[#F4F7FB]" data-report-client="">
                {client}
              </p>
            ) : null}
            {span ? (
              <p className="mt-0.5 text-[12px] text-muted-foreground" data-report-period="">
                {span}
              </p>
            ) : null}
          </div>
          <div className="flex gap-2 px-5 pb-5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="flex-1 gap-1.5 border-border bg-transparent text-xs text-foreground hover:bg-muted hover:text-foreground"
              onClick={onPreview}
              disabled={disabled || previewing}
              data-report-preview=""
            >
              {previewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
              Preview
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="flex-1 gap-1.5 border-border bg-transparent text-xs text-foreground hover:bg-muted"
              onClick={onDownload}
              disabled={disabled || downloading}
              data-report-download=""
            >
              {downloading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              Download
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
