/**
 * Budget variance panel — month-true BvA + PDF actuals ingest.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FileUp, Loader2, Scale, Trash2 } from "lucide-react";
import { CollapsibleGoldCard } from "@/components/primitives/collapsible-gold-card";
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
import { pdfTransport, unstage, type PdfTransport } from "@/lib/staged-upload-browser";
import { UploadQualityDisclaimer } from "@/components/upload-quality-disclaimer";
import { ScrollableTable } from "@/components/primitives/scrollable-table";
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

export function BudgetVariancePanel({
  clientId,
  doc,
  role = "owner",
}: {
  clientId?: string;
  doc: BudgetDocument;
  role?: "owner" | "accountant";
}) {
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
    let staged: PdfTransport | null = null;
    try {
      staged = await pdfTransport(file);
      const extraction = (await doExtractPdf({
        data: {
          files: [{ ...staged, fileName: file.name }],
          market: selectionPayload(selection),
        },
      })) as MergedExtractionResult;
      openReviewFromExtraction(extraction, file.name);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "PDF extraction failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
      await unstage([staged?.storagePath]);
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
      <CollapsibleGoldCard
        id="wizard-budget-variance"
        icon={Scale}
        title="Budget vs actuals"
        subtitle={
          role === "accountant"
            ? "The monthly scorecard against the plan above. Save this client first, then upload each month’s management accounts when they exist."
            : "Compare the plan to what actually happened each month. Save this business first to upload a P&L."
        }
        defaultOpen={false}
      >
        <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          Link or save a client to upload monthly actuals. Until then there is nothing to compare —
          this section stays empty on purpose.
        </p>
      </CollapsibleGoldCard>
    );
  }

  const imported = rows.length;
  const accountantEmpty =
    "The monthly scorecard against the plan above. Closed until you have a month’s management accounts to upload — until then there is nothing to compare, and that is expected.";
  const accountantLoaded = `${imported} month${imported === 1 ? "" : "s"} of management accounts on file. Open to see where the plan is off.`;

  return (
    <CollapsibleGoldCard
      id="wizard-budget-variance"
      icon={Scale}
      title="Budget vs actuals"
      subtitle={
        role === "accountant"
          ? imported
            ? accountantLoaded
            : accountantEmpty
          : imported
            ? `${imported} month${imported === 1 ? "" : "s"} compared to the plan. Open to see the gap.`
            : "Upload a month’s P&L when you have it — this is how the plan is checked, not how it is built."
      }
      defaultOpen={false}
      headerRight={
        <span className="hidden rounded-full border border-amber-900/15 bg-white/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500 sm:inline dark:border-slate-700 dark:bg-slate-900/60">
          {imported ? `${imported} imported` : "No actuals yet"}
        </span>
      }
    >
      <div className="space-y-4">
        {role === "accountant" && (
          <div className="rounded-xl border border-amber-900/15 bg-white/55 px-4 py-3 text-sm leading-relaxed text-slate-700 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-200">
            <p>
              <strong className="font-semibold text-slate-900 dark:text-slate-50">
                What you do here:
              </strong>{" "}
              after the year plan is set, upload each month’s management-accounts PDF (the P&amp;L).
              We extract revenue, cost of goods and overheads; you confirm the figures.
            </p>
            <p className="mt-2">
              <strong className="font-semibold text-slate-900 dark:text-slate-50">
                What you get:
              </strong>{" "}
              a variance table — where the plan is off, by how much, and whether that is good or bad
              — so you can challenge the owner or revise the budget. This is not the annual
              financials upload, and it is not “seed from financials”. Those set the starting plan.
              This is the month-by-month check once the year is running.
            </p>
          </div>
        )}
        {role === "owner" && !focusActual && (
          <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            This is the scorecard for the plan above. Upload a month’s P&amp;L PDF when you have it.
            Until a file is in, there is nothing to compare — that is normal.
          </p>
        )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {market.copyPack === "us"
              ? "Upload a PDF P&L — QuickBooks later. Xero is also on the list."
              : "Upload a PDF P&L — QuickBooks / Xero later."}
          </h3>
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
            disabled={uploading || migrationRequired}
            onClick={() => fileRef.current?.click()}
            className="gap-1.5 border-[#d4a550]/40 bg-[#d4a550] text-xs text-[#0a0e1a] hover:bg-[#c49a45]"
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
        <div className="rounded-lg border border-dashed border-amber-900/20 bg-white/40 px-3 py-4 text-sm leading-relaxed text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
          {role === "accountant" ? (
            <>
              No management accounts for{" "}
              <strong className="text-slate-900 dark:text-slate-100">
                {formatMonthLabel(focusMonth, market)}
              </strong>{" "}
              yet. That is normal until the month has been closed. When the PDF is ready, upload it
              here — the outcome is a line-by-line gap vs the budget you just built, not a second
              place to type the year plan.
            </>
          ) : (
            <>
              No actuals for <strong>{formatMonthLabel(focusMonth, market)}</strong> yet. Upload that
              month’s management accounts PDF to generate variance.
            </>
          )}
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
          <ScrollableTable cardRows className="rounded-lg border border-slate-100 dark:border-slate-800">
            <table className="milon-data-table w-full min-w-[520px] text-xs text-[#0f172a] dark:text-slate-100">
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
                    <td data-label="Budget" className="px-2 py-1.5 text-right tabular-nums">
                      {money(l.budget)}
                    </td>
                    <td data-label="Actual" className="px-2 py-1.5 text-right tabular-nums">
                      {money(l.actual)}
                    </td>
                    <td
                      data-label="Δ"
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
                    <td data-label="Δ%" className="px-2 py-1.5 text-right tabular-nums text-slate-500">
                      {formatVariancePct(l.deltaPct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollableTable>
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
    </CollapsibleGoldCard>
  );
}
