/**
 * Budget variance panel — month-true BvA + PDF actuals ingest.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FileUp, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { BudgetDocument } from "@/lib/budget.types";
import { preflightUploadFile } from "@/lib/upload-quality";
import { UploadQualityDisclaimer } from "@/components/upload-quality-disclaimer";
import { fyMonths, formatMonthLabel } from "@/lib/budget.months";
import { computeBudgetMonths, fmtBudgetMoney } from "@/lib/budget.compute";
import { useMarket } from "@/contexts/market";
import {
  actualsFromExtraction,
  computeMonthVariance,
  emptyTaxonomyTotals,
  formatVariancePct,
  normalizeTaxonomyTotals,
  type BudgetMonthActualRow,
  type TaxonomyTotals,
} from "@/lib/budget.variance";
import {
  deleteBudgetMonthActual,
  listBudgetMonthActuals,
  upsertBudgetMonthActual,
} from "@/lib/budget-actuals.functions";
import { extractPDFsWithAI } from "@/lib/extract-financials.functions";
import type { MergedExtractionResult } from "@/lib/extraction-types";
import { selectionPayload } from "@/lib/market";

function priorCalendarMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function BudgetVariancePanel({ clientId, doc }: { clientId?: string; doc: BudgetDocument }) {
  const { market, selection } = useMarket();
  const money = (n: number) => fmtBudgetMoney(n, market);
  const months = useMemo(() => fyMonths(doc.fyStart), [doc.fyStart]);
  const budgetResults = useMemo(() => computeBudgetMonths(doc, doc.activeScenario), [doc]);
  const budgetByMonth = useMemo(() => {
    const m = new Map<string, (typeof budgetResults)[0]>();
    for (const r of budgetResults) m.set(r.month, r);
    return m;
  }, [budgetResults]);

  const defaultMonth = useMemo(() => {
    const prior = priorCalendarMonth();
    if (months.includes(prior)) return prior;
    return months[Math.min(months.length - 1, 0)] ?? prior;
  }, [months]);

  const [focusMonth, setFocusMonth] = useState(defaultMonth);
  const [rows, setRows] = useState<BudgetMonthActualRow[]>([]);
  const [migrationRequired, setMigrationRequired] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [draftMonth, setDraftMonth] = useState(defaultMonth);
  const [draftTotals, setDraftTotals] = useState<TaxonomyTotals>(emptyTaxonomyTotals());
  const [draftWarnings, setDraftWarnings] = useState<string[]>([]);
  const [draftConfidence, setDraftConfidence] = useState<number | null>(null);
  const [draftSourceRef, setDraftSourceRef] = useState<string | null>(null);
  const [draftPeriodStart, setDraftPeriodStart] = useState<string | null>(null);
  const [draftPeriodEnd, setDraftPeriodEnd] = useState<string | null>(null);
  const [acceptedQuality, setAcceptedQuality] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const listActuals = useServerFn(listBudgetMonthActuals);
  const upsertActual = useServerFn(upsertBudgetMonthActual);
  const removeActual = useServerFn(deleteBudgetMonthActual);
  const doExtractPdf = useServerFn(extractPDFsWithAI);

  const refresh = useCallback(async () => {
    if (!clientId) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const res = await listActuals({
        data: { clientId, fyStart: doc.fyStart },
      });
      setRows(res.actuals ?? []);
      setMigrationRequired(Boolean(res.migrationRequired));
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Could not load actuals");
    } finally {
      setLoading(false);
    }
  }, [clientId, doc.fyStart, listActuals]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setFocusMonth(defaultMonth);
  }, [defaultMonth]);

  const actualByMonth = useMemo(() => {
    const m = new Map<string, BudgetMonthActualRow>();
    for (const r of rows) m.set(r.month, r);
    return m;
  }, [rows]);

  const focusBudget = budgetByMonth.get(focusMonth);
  const focusActual = actualByMonth.get(focusMonth);
  const report =
    focusBudget && focusActual
      ? computeMonthVariance(focusBudget, focusActual.totals, focusMonth)
      : null;

  const openReviewFromExtraction = (extraction: MergedExtractionResult, fileName: string) => {
    const mapped = actualsFromExtraction(extraction);
    const month = mapped.month && months.includes(mapped.month) ? mapped.month : focusMonth;
    setDraftMonth(month);
    setDraftTotals(mapped.totals);
    setDraftWarnings(mapped.warnings);
    setDraftConfidence(mapped.confidence);
    setDraftSourceRef(fileName);
    setDraftPeriodStart(mapped.periodStart);
    setDraftPeriodEnd(mapped.periodEnd);
    setAcceptedQuality(false);
    setReviewOpen(true);
  };

  const onPickFile = async (file: File) => {
    if (!clientId) {
      toast.error("Save / select a client before uploading actuals");
      return;
    }
    if (migrationRequired) {
      toast.error("Run the budget_month_actuals migration in Supabase first");
      return;
    }
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (ext !== "pdf" && file.type !== "application/pdf") {
      toast.error("Upload a PDF of the month’s management accounts / P&L");
      return;
    }
    const pre = preflightUploadFile(file);
    if (pre) {
      toast.error(pre);
      return;
    }
    setUploading(true);
    try {
      const base64 = await new Promise<string>((res, rej) => {
        const reader = new FileReader();
        reader.onload = () => res((reader.result as string).split(",")[1] ?? "");
        reader.onerror = () => rej(new Error("Could not read file"));
        reader.readAsDataURL(file);
      });
      const extraction = (await doExtractPdf({
        data: {
          files: [{ base64, fileName: file.name }],
          market: selectionPayload(selection),
        },
      })) as MergedExtractionResult;
      openReviewFromExtraction(extraction, file.name);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "PDF extraction failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const saveDraft = async (status: "draft" | "confirmed") => {
    if (!clientId) return;
    try {
      const totals = normalizeTaxonomyTotals(draftTotals);
      const res = await upsertActual({
        data: {
          clientId,
          month: draftMonth,
          source: "pdf",
          sourceRef: draftSourceRef,
          status,
          totals,
          lines: [],
          periodStart: draftPeriodStart,
          periodEnd: draftPeriodEnd,
          confidence: draftConfidence,
          warnings: draftWarnings,
        },
      });
      setRows((prev) => {
        const next = prev.filter((r) => r.month !== res.actual.month);
        next.push(res.actual);
        next.sort((a, b) => a.month.localeCompare(b.month));
        return next;
      });
      setFocusMonth(res.actual.month);
      setReviewOpen(false);
      toast.success(
        status === "confirmed"
          ? `Actuals confirmed for ${formatMonthLabel(res.actual.month, market)}`
          : `Draft actuals saved for ${formatMonthLabel(res.actual.month, market)}`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save actuals");
    }
  };

  const onDelete = async (month: string) => {
    if (!clientId) return;
    try {
      await removeActual({ data: { clientId, month } });
      setRows((prev) => prev.filter((r) => r.month !== month));
      toast.success(`Removed actuals for ${formatMonthLabel(month, market)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete");
    }
  };

  if (!clientId) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-500 dark:border-slate-800">
        Link a client to upload monthly actuals and run budget variance.
      </div>
    );
  }

  return (
    <div
      id="wizard-budget-variance"
      className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#0b1220]/60"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Budget vs actuals
          </h3>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Month-true variance. Upload a PDF P&L now — QuickBooks / Xero later.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onPickFile(f);
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={uploading || migrationRequired}
            onClick={() => fileRef.current?.click()}
            className="gap-1.5"
          >
            {uploading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FileUp className="h-3.5 w-3.5" />
            )}
            {uploading ? "Extracting…" : "Upload month PDF"}
          </Button>
        </div>
      </div>

      {migrationRequired && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          Run migration <code className="font-mono">20260813120000_budget_month_actuals.sql</code>{" "}
          in Supabase to enable monthly actuals.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Label className="text-[10px] uppercase tracking-wider text-slate-400">Month</Label>
        <select
          value={focusMonth}
          onChange={(e) => setFocusMonth(e.target.value)}
          className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900"
        >
          {months.map((m) => {
            const has = actualByMonth.has(m);
            return (
              <option key={m} value={m}>
                {formatMonthLabel(m, market)}
                {has ? " · actuals" : ""}
              </option>
            );
          })}
        </select>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
        {focusActual && (
          <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] uppercase tracking-wider text-slate-500 dark:border-slate-700">
            {focusActual.status} · {focusActual.source}
          </span>
        )}
      </div>

      {!focusActual && (
        <div className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-500 dark:border-slate-700">
          No actuals for <strong>{formatMonthLabel(focusMonth, market)}</strong> yet. Upload that
          month’s management accounts PDF to generate variance.
        </div>
      )}

      {report && (
        <div className="space-y-3">
          <p
            className={`text-sm ${
              report.hasMaterialVariance
                ? "text-amber-800 dark:text-amber-200"
                : "text-slate-600 dark:text-slate-300"
            }`}
          >
            {report.headline}
          </p>
          <div className="overflow-x-auto rounded-lg border border-slate-100 dark:border-slate-800">
            <table className="w-full min-w-[520px] text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[10px] uppercase tracking-wider text-slate-400 dark:border-slate-800">
                  <th className="px-3 py-2">Line</th>
                  <th className="px-2 py-2 text-right">Budget</th>
                  <th className="px-2 py-2 text-right">Actual</th>
                  <th className="px-2 py-2 text-right">Δ</th>
                  <th className="px-2 py-2 text-right">Δ%</th>
                </tr>
              </thead>
              <tbody>
                {report.lines.map((l) => (
                  <tr key={l.key} className="border-b border-slate-50 dark:border-slate-900">
                    <td className="px-3 py-1.5 font-medium text-slate-700 dark:text-slate-200">
                      {l.label}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{money(l.budget)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{money(l.actual)}</td>
                    <td
                      className={`px-2 py-1.5 text-right tabular-nums ${
                        l.signal === "adverse"
                          ? "text-red-600 dark:text-red-400"
                          : l.signal === "favourable"
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-slate-500"
                      }`}
                    >
                      {money(l.delta)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">
                      {formatVariancePct(l.deltaPct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {focusActual && (
            <div className="flex justify-end">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="gap-1 text-red-600 hover:text-red-700"
                onClick={() => void onDelete(focusActual.month)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove month actuals
              </Button>
            </div>
          )}
        </div>
      )}

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Confirm month actuals</DialogTitle>
            <DialogDescription>
              Check the month and totals extracted from{" "}
              {draftSourceRef ? <strong>{draftSourceRef}</strong> : "the PDF"} before saving.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-1">
            {draftWarnings.length > 0 && (
              <ul className="list-disc space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 pl-5 text-xs text-amber-900 dark:text-amber-100">
                {draftWarnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
            <div>
              <Label className="text-xs">Budget month</Label>
              <select
                value={draftMonth}
                onChange={(e) => setDraftMonth(e.target.value)}
                className="mt-1 flex h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900"
              >
                {months.map((m) => (
                  <option key={m} value={m}>
                    {formatMonthLabel(m, market)}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["revenue", "Revenue"],
                  ["cogs", "COGS"],
                  ["overheadsTotal", "Overheads"],
                  ["depreciation", "Depreciation"],
                  ["ebit", "EBIT"],
                ] as const
              ).map(([key, label]) => (
                <div key={key}>
                  <Label className="text-xs">{label}</Label>
                  <Input
                    type="number"
                    className="mt-1 h-9"
                    value={draftTotals[key] || ""}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      setDraftTotals((prev) => {
                        const next = {
                          ...prev,
                          [key]: Number.isFinite(v) ? v : 0,
                        };
                        if (key === "revenue" || key === "cogs") {
                          next.grossProfit = next.revenue - next.cogs;
                        }
                        return next;
                      });
                    }}
                  />
                </div>
              ))}
            </div>
          </div>

          <UploadQualityDisclaimer accepted={acceptedQuality} onChange={setAcceptedQuality} />

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => void saveDraft("draft")}>
              Save draft
            </Button>
            <Button
              type="button"
              disabled={!acceptedQuality}
              onClick={() => void saveDraft("confirmed")}
            >
              Confirm & show variance
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
