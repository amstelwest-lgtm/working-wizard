/**
 * UploadFinancials — Drop a financial statement (PDF, Excel, OpenDocument or
 * CSV) → Claude extracts → human reviews and corrects → confirm import.
 *
 * Styled with MILŌN's dark/gold design system (Tailwind).
 */

import { useMemo, useRef, useState, type DragEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Upload, Loader2, AlertTriangle, CheckCircle2, FileText, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { extractFinancialsFromPDF } from "@/lib/extractFinancials.server";
import type { ExtractionResult, Money } from "@/lib/financialSchema";
import type { ValidationIssue } from "@/lib/validateFinancials";
import { UPLOAD_QUALITY_DISCLAIMER, preflightUploadFile } from "@/lib/upload-quality";
import { UploadQualityDisclaimer } from "@/components/upload-quality-disclaimer";
import { useMarketFormat } from "@/contexts/market";
import { selectionPayload } from "@/lib/market";
import {
  UPLOAD_ACCEPT,
  UPLOAD_FORMATS_LABEL,
  fileToText,
  isPdfFile,
  isSpreadsheetFile,
  isTextFile,
} from "@/lib/spreadsheet-text";
import { pdfTransport, unstage, type PdfTransport } from "@/lib/staged-upload-browser";

// ─── helpers ─────────────────────────────────────────────────────────────────

function fmt(v: Money, formatNumber: (n: number) => string) {
  if (v === null || v === undefined) return "—";
  return formatNumber(v);
}

// ─── sub-components ───────────────────────────────────────────────────────────

function Row({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Money;
  onChange: (v: Money) => void;
}) {
  return (
    <div className="flex items-center gap-3 py-1.5 border-b border-white/5 last:border-0">
      <Label className="flex-1 text-xs text-muted-foreground">{label}</Label>
      <Input
        type="number"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className="w-44 h-7 text-right text-sm bg-black/30 border-white/10 font-mono"
      />
    </div>
  );
}

function IssueList({ issues }: { issues: ValidationIssue[] }) {
  const { number } = useMarketFormat();
  if (!issues.length) return null;
  return (
    <div className="space-y-1.5 mt-3">
      {issues.map((i) => (
        <div
          key={i.check}
          className={`flex items-start gap-2 rounded-md px-3 py-2 text-xs ${
            i.severity === "error"
              ? "bg-red-950/40 border border-red-800/50 text-red-300"
              : "bg-amber-950/40 border border-amber-700/40 text-amber-300"
          }`}
        >
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>{i.message}</span>
          {i.difference !== null && (
            <span className="ml-auto font-mono shrink-0">Δ {fmt(i.difference, number)}</span>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export type UploadFinancialsProps = {
  onConfirm?: (result: ExtractionResult) => void;
};

export function UploadFinancials({ onConfirm }: UploadFinancialsProps) {
  const { number, selection } = useMarketFormat();
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "review">("idle");
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [autoSafe, setAutoSafe] = useState(false);
  const [acceptedQuality, setAcceptedQuality] = useState(false);

  const extract = useServerFn(extractFinancialsFromPDF);

  async function handleFile(file: File) {
    const pdf = isPdfFile(file);
    if (!pdf && !isSpreadsheetFile(file) && !isTextFile(file)) {
      toast.error(`Please upload a ${UPLOAD_FORMATS_LABEL} file.`);
      return;
    }
    if (pdf) {
      const pre = preflightUploadFile(file);
      if (pre) {
        toast.error(pre);
        return;
      }
    } else if (file.size === 0) {
      toast.error("That file is empty. Please upload the actual statement.");
      return;
    }
    setStatus("loading");
    let staged: PdfTransport | null = null;
    try {
      const market = selectionPayload(selection);
      if (pdf) staged = await pdfTransport(file);
      const res = staged
        ? await extract({
            data: { storagePath: staged.storagePath, pdfBase64: staged.base64, market },
          })
        : await extract({ data: { text: await fileToText(file), fileName: file.name, market } });
      setResult(res.data);
      setIssues(res.issues);
      setAutoSafe(res.autoImportSafe);
      setStatus("review");
    } catch (e) {
      toast.error((e as Error).message ?? "Extraction failed.");
      setStatus("idle");
    } finally {
      // The server deletes the staged object once it has read it; this only
      // matters if the request never reached the server.
      await unstage([staged?.storagePath]);
    }
  }

  function reset() {
    setStatus("idle");
    setResult(null);
    setIssues([]);
    setAutoSafe(false);
    setAcceptedQuality(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  // Live balance check
  const liveBalance = useMemo(() => {
    if (!result) return null;
    const bs = result.current_period.figures.balance_sheet;
    const eq = bs.equity.total;
    const liab = bs.total_liabilities;
    const assets = bs.total_assets;
    if (eq == null || liab == null || assets == null) return null;
    return Math.round((eq + liab - assets) * 100) / 100;
  }, [
    result?.current_period.figures.balance_sheet.equity.total,
    result?.current_period.figures.balance_sheet.total_liabilities,
    result?.current_period.figures.balance_sheet.total_assets,
  ]);

  function onDrop(e: DragEvent<HTMLButtonElement>) {
    e.preventDefault();
    if (status === "loading") return;
    const f = e.dataTransfer.files?.[0];
    if (f) void handleFile(f);
  }

  // ── idle / loading ──────────────────────────────────────────────────────────
  if (status !== "review") {
    return (
      <div className="space-y-4">
        <button
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          disabled={status === "loading"}
          className={`w-full flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-12 transition-colors
            ${
              status === "loading"
                ? "border-amber-500/30 cursor-default"
                : "border-white/10 hover:border-amber-500/50 cursor-pointer"
            }`}
        >
          {status === "loading" ? (
            <>
              <Loader2 className="h-8 w-8 text-amber-500 animate-spin" />
              <p className="text-sm text-muted-foreground">Sending to Claude…</p>
              <p className="text-xs text-muted-foreground/60">This takes 10–30 seconds</p>
            </>
          ) : (
            <>
              <div className="h-12 w-12 rounded-full bg-amber-500/10 flex items-center justify-center">
                <Upload className="h-6 w-6 text-amber-500" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium">Drop a financial statement</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Income statement + balance sheet — {UPLOAD_FORMATS_LABEL}, up to 32 MB
                </p>
                <p className="text-[11px] text-muted-foreground/80 mt-2 max-w-sm mx-auto">
                  {UPLOAD_QUALITY_DISCLAIMER}
                </p>
              </div>
            </>
          )}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={UPLOAD_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
      </div>
    );
  }

  // ── review ──────────────────────────────────────────────────────────────────
  if (!result) return null;
  const is = result.current_period.figures.income_statement;
  const bs = result.current_period.figures.balance_sheet;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-amber-500" />
            <span className="font-semibold">{result.entity_name ?? "Extracted statement"}</span>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {result.currency && (
              <Badge variant="outline" className="text-xs">
                {result.currency}
              </Badge>
            )}
            {result.units && (
              <Badge variant="outline" className="text-xs">
                in {result.units}
              </Badge>
            )}
            {result.statement_basis && (
              <Badge variant="outline" className="text-xs capitalize">
                {result.statement_basis.replace(/_/g, " ")}
              </Badge>
            )}
            {result.current_period.period_end && (
              <Badge variant="outline" className="text-xs">
                Period end: {result.current_period.period_end}
              </Badge>
            )}
          </div>
        </div>
        <div
          className={`flex items-center gap-1.5 text-xs font-medium rounded-full px-3 py-1 ${
            autoSafe
              ? "bg-emerald-950/50 border border-emerald-700/50 text-emerald-400"
              : "bg-red-950/50 border border-red-800/50 text-red-400"
          }`}
        >
          {autoSafe ? (
            <>
              <CheckCircle2 className="h-3.5 w-3.5" /> Arithmetic checks passed
            </>
          ) : (
            <>
              <AlertTriangle className="h-3.5 w-3.5" /> Review required before import
            </>
          )}
        </div>
      </div>

      {/* Validation issues */}
      <IssueList issues={issues} />

      {/* Live balance indicator */}
      {liveBalance !== null && Math.abs(liveBalance) > 1 && (
        <div className="text-xs text-amber-400 flex items-center gap-1.5">
          <AlertTriangle className="h-3 w-3" />
          Balance sheet is out by {fmt(liveBalance, number)} — adjust figures below before
          confirming.
        </div>
      )}

      {/* Extraction note */}
      {result.extraction_notes && (
        <div className="rounded-md bg-amber-950/30 border border-amber-700/30 px-3 py-2 text-xs text-amber-300">
          <span className="font-semibold">Note from Claude:</span> {result.extraction_notes}
        </div>
      )}

      {/* Editable figures */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Income statement */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Income statement
          </p>
          <div className="rounded-lg bg-black/20 border border-white/5 px-3 py-1">
            <Row
              label="Revenue"
              value={is.revenue}
              onChange={(v) => {
                is.revenue = v;
                setResult({ ...result });
              }}
            />
            <Row
              label="Cost of sales"
              value={is.cost_of_sales}
              onChange={(v) => {
                is.cost_of_sales = v;
                setResult({ ...result });
              }}
            />
            <Row
              label="Gross profit"
              value={is.gross_profit}
              onChange={(v) => {
                is.gross_profit = v;
                setResult({ ...result });
              }}
            />
            <Row
              label="Operating expenses"
              value={is.operating_expenses}
              onChange={(v) => {
                is.operating_expenses = v;
                setResult({ ...result });
              }}
            />
            <Row
              label="Operating profit"
              value={is.operating_profit}
              onChange={(v) => {
                is.operating_profit = v;
                setResult({ ...result });
              }}
            />
            <Row
              label="Finance costs"
              value={is.finance_costs}
              onChange={(v) => {
                is.finance_costs = v;
                setResult({ ...result });
              }}
            />
            <Row
              label="Profit before tax"
              value={is.profit_before_tax}
              onChange={(v) => {
                is.profit_before_tax = v;
                setResult({ ...result });
              }}
            />
            <Row
              label="Income tax"
              value={is.income_tax}
              onChange={(v) => {
                is.income_tax = v;
                setResult({ ...result });
              }}
            />
            <Row
              label="Profit after tax"
              value={is.profit_after_tax}
              onChange={(v) => {
                is.profit_after_tax = v;
                setResult({ ...result });
              }}
            />
          </div>
        </div>

        {/* Balance sheet */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Balance sheet
          </p>
          <div className="rounded-lg bg-black/20 border border-white/5 px-3 py-1">
            <Row
              label="Total non-current assets"
              value={bs.non_current_assets.total}
              onChange={(v) => {
                bs.non_current_assets.total = v;
                setResult({ ...result });
              }}
            />
            <Row
              label="Inventories"
              value={bs.current_assets.inventories}
              onChange={(v) => {
                bs.current_assets.inventories = v;
                setResult({ ...result });
              }}
            />
            <Row
              label="Trade receivables"
              value={bs.current_assets.trade_and_other_receivables}
              onChange={(v) => {
                bs.current_assets.trade_and_other_receivables = v;
                setResult({ ...result });
              }}
            />
            <Row
              label="Cash & equivalents"
              value={bs.current_assets.cash_and_cash_equivalents}
              onChange={(v) => {
                bs.current_assets.cash_and_cash_equivalents = v;
                setResult({ ...result });
              }}
            />
            <Row
              label="Total current assets"
              value={bs.current_assets.total}
              onChange={(v) => {
                bs.current_assets.total = v;
                setResult({ ...result });
              }}
            />
            <Row
              label="Total assets"
              value={bs.total_assets}
              onChange={(v) => {
                bs.total_assets = v;
                setResult({ ...result });
              }}
            />
            <Row
              label="Total equity"
              value={bs.equity.total}
              onChange={(v) => {
                bs.equity.total = v;
                setResult({ ...result });
              }}
            />
            <Row
              label="Trade payables"
              value={bs.current_liabilities.trade_and_other_payables}
              onChange={(v) => {
                bs.current_liabilities.trade_and_other_payables = v;
                setResult({ ...result });
              }}
            />
            <Row
              label="Total current liabilities"
              value={bs.current_liabilities.total}
              onChange={(v) => {
                bs.current_liabilities.total = v;
                setResult({ ...result });
              }}
            />
            <Row
              label="Total non-current liabilities"
              value={bs.non_current_liabilities.total}
              onChange={(v) => {
                bs.non_current_liabilities.total = v;
                setResult({ ...result });
              }}
            />
            <Row
              label="Total liabilities"
              value={bs.total_liabilities}
              onChange={(v) => {
                bs.total_liabilities = v;
                setResult({ ...result });
              }}
            />
          </div>
        </div>
      </div>

      {/* Cash flow (if present) */}
      {result.current_period.figures.cash_flow && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Cash flow statement
          </p>
          <div className="rounded-lg bg-black/20 border border-white/5 px-3 py-1 max-w-sm">
            {(() => {
              const cf = result.current_period.figures.cash_flow!;
              return (
                <>
                  <Row
                    label="Operating activities"
                    value={cf.cash_from_operating}
                    onChange={(v) => {
                      cf.cash_from_operating = v;
                      setResult({ ...result });
                    }}
                  />
                  <Row
                    label="Investing activities"
                    value={cf.cash_from_investing}
                    onChange={(v) => {
                      cf.cash_from_investing = v;
                      setResult({ ...result });
                    }}
                  />
                  <Row
                    label="Financing activities"
                    value={cf.cash_from_financing}
                    onChange={(v) => {
                      cf.cash_from_financing = v;
                      setResult({ ...result });
                    }}
                  />
                  <Row
                    label="Net change in cash"
                    value={cf.net_change_in_cash}
                    onChange={(v) => {
                      cf.net_change_in_cash = v;
                      setResult({ ...result });
                    }}
                  />
                  <Row
                    label="Closing cash"
                    value={cf.cash_at_end}
                    onChange={(v) => {
                      cf.cash_at_end = v;
                      setResult({ ...result });
                    }}
                  />
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Actions */}
      <UploadQualityDisclaimer accepted={acceptedQuality} onChange={setAcceptedQuality} />
      <div className="flex items-center gap-3 pt-2">
        <Button
          onClick={() => {
            onConfirm?.(result);
            toast.success("Financials imported successfully.");
          }}
          disabled={!acceptedQuality}
          className="bg-amber-500 hover:bg-amber-400 text-black font-semibold disabled:opacity-50"
        >
          <CheckCircle2 className="h-4 w-4 mr-1.5" />
          Confirm &amp; import
        </Button>
        <Button variant="outline" size="sm" onClick={reset}>
          <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
          Upload different file
        </Button>
      </div>
    </div>
  );
}
