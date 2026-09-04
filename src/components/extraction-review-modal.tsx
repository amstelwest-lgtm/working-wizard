import { useEffect, useState } from "react";
import type { MergedExtractionResult, MergeConflict } from "@/lib/extraction-types";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { CheckCircle2, HelpCircle, Pencil, ChevronDown, ChevronRight, AlertTriangle, Info } from "lucide-react";
import { UploadQualityDisclaimer } from "@/components/upload-quality-disclaimer";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface MappedInputs {
  revenue?: string;   cogs?: string;     ebit?: string;      ebt?: string;
  netIncome?: string; ebitda?: string;   operatingCashflow?: string;
  totalAssets?: string; equity?: string; receivables?: string;
  inventory?: string; payables?: string; fixedCosts?: string;
  laborCost?: string; employees?: string; cash?: string;
  capex?: string;     depreciation?: string;
}

interface Props {
  result: MergedExtractionResult;
  open: boolean;
  onClose: () => void;
  onConfirm: (inputs: MappedInputs) => void;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmtZAR(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "—";
  return `R ${v.toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function extractionToInputs(r: MergedExtractionResult): MappedInputs {
  const is = r.current_period?.income_statement;
  const bs = r.current_period?.balance_sheet;
  const cfs = r.current_period?.cash_flow_statement;
  const meta = r.document_metadata;
  const n = (v: number | null | undefined) => v != null ? String(v) : undefined;
  return {
    revenue: n(is?.revenue),
    cogs: n(is?.cogs),
    ebit: n(is?.ebit),
    ebt: n(is?.ebt),
    netIncome: n(is?.net_income),
    ebitda: n(is?.ebitda),
    operatingCashflow: n(cfs?.operating_cash_flow),
    totalAssets: n(bs?.total_assets),
    equity: n(bs?.equity),
    receivables: n(bs?.debtors),
    inventory: n(bs?.inventory),
    payables: n(bs?.creditors),
    fixedCosts: n(is?.fixed_costs),
    laborCost: n(is?.labor_cost),
    employees: n(meta?.headcount),
    cash: n(bs?.cash),
    capex: n(cfs?.capex),
    depreciation: n(is?.depreciation),
  };
}

const CONFIDENCE_BADGE: Record<string, string> = {
  high:   "bg-emerald-900/60 text-emerald-400 border-emerald-700",
  medium: "bg-amber-900/60 text-amber-400 border-amber-700",
  low:    "bg-red-900/60 text-red-400 border-red-700",
};

const DOC_TYPE_LABEL: Record<string, string> = {
  bank_statement: "Bank Statement",
  income_statement: "Income Statement",
  balance_sheet: "Balance Sheet",
  management_accounts: "Management Accounts",
  full_annual_financials: "Annual Financial Statements",
  unknown: "Unknown",
};

const FS_TYPE_LABEL: Record<string, string> = {
  audited: "Audited",
  reviewed: "Reviewed",
  compiled: "Compiled",
  management_accounts: "Management Accounts",
  bank_statement: "Bank Statement",
  unknown: "Unknown",
};

// ─── Field row ─────────────────────────────────────────────────────────────────

interface FieldRowProps {
  label: string;
  value: number | null | undefined;
  originalValue?: number | null;
  source?: string;
  isCurrency?: boolean;
  isEditing: boolean;
  onEdit: () => void;
  onChange: (v: string) => void;
  editVal: string;
}

function FieldRow({ label, value, originalValue, source, isCurrency = true, isEditing, onEdit, onChange, editVal }: FieldRowProps) {
  const hasValue = value != null && isFinite(value);
  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-slate-800/60 last:border-0">
      <div className="flex-1 min-w-0">
        <span className="text-xs text-slate-400">{label}</span>
        {originalValue != null && originalValue !== value && (
          <span className="ml-2 text-[10px] text-slate-600">({isCurrency ? fmtZAR(originalValue) : originalValue})</span>
        )}
      </div>
      {source && (
        <span className="text-[9px] text-slate-600 bg-slate-800 rounded px-1 py-0.5">{source}</span>
      )}
      {isEditing ? (
        <Input
          type="number"
          value={editVal}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onEdit}
          className="h-6 w-28 text-xs py-0"
          autoFocus
        />
      ) : (
        <>
          <span className={`text-xs font-mono tabular-nums ${hasValue ? "text-slate-200" : "text-slate-600"}`}>
            {hasValue ? (isCurrency ? fmtZAR(value) : String(value)) : "—"}
          </span>
          {hasValue
            ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
            : <HelpCircle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
          }
          <button onClick={onEdit} className="text-slate-600 hover:text-slate-400">
            <Pencil className="h-3 w-3" />
          </button>
        </>
      )}
    </div>
  );
}

// ─── Collapsible section ───────────────────────────────────────────────────────

function Section({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-slate-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2.5 bg-slate-900/60 hover:bg-slate-800/60 transition-colors"
      >
        <span className="text-xs font-semibold text-slate-300">{title}</span>
        {open ? <ChevronDown className="h-3.5 w-3.5 text-slate-500" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-500" />}
      </button>
      {open && <div className="px-3 py-2 bg-slate-900/20">{children}</div>}
    </div>
  );
}

// ─── Main modal ────────────────────────────────────────────────────────────────

export function ExtractionReviewModal({ result, open, onClose, onConfirm }: Props) {
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [conflicts, setConflicts] = useState<MergeConflict[]>(result.conflicts ?? []);
  const [conflictSelections, setConflictSelections] = useState<Record<string, "1" | "2">>({});
  const [acceptedQuality, setAcceptedQuality] = useState(false);

  useEffect(() => {
    if (open) setAcceptedQuality(false);
  }, [open]);

  const meta = result.document_metadata;
  const is = result.current_period?.income_statement;
  const bs = result.current_period?.balance_sheet;
  const cfs = result.current_period?.cash_flow_statement;
  const dq = result.data_quality;
  const confidence = dq?.overall_confidence ?? "low";

  // Helper: get current (possibly edited) value for a field
  const get = (path: string, raw: number | null | undefined): number | null => {
    if (editValues[path] !== undefined) {
      const n = parseFloat(editValues[path]);
      return isFinite(n) ? n : null;
    }
    return raw ?? null;
  };

  const startEdit = (path: string, raw: number | null | undefined) => {
    setEditValues((prev) => ({ ...prev, [path]: raw != null ? String(raw) : "" }));
    setEditingPath(path);
  };

  const stopEdit = () => setEditingPath(null);

  const fieldRow = (label: string, path: string, raw: number | null | undefined, isCurrency = true) => {
    const value = get(path, raw);
    const src = result.source_map?.[path];
    const source = result.document_count > 1 && src ? src.replace("document_", "Doc ") : undefined;
    return (
      <FieldRow
        key={path}
        label={label}
        value={value}
        source={source}
        isCurrency={isCurrency}
        isEditing={editingPath === path}
        onEdit={() => editingPath === path ? stopEdit() : startEdit(path, raw)}
        onChange={(v) => setEditValues((prev) => ({ ...prev, [path]: v }))}
        editVal={editValues[path] ?? ""}
      />
    );
  };

  // Count null fields in core sections
  const coreFields = [
    is?.revenue, is?.cogs, is?.gross_profit, is?.ebit, is?.ebt, is?.net_income,
    is?.ebitda, is?.labor_cost, is?.fixed_costs,
    bs?.total_assets, bs?.equity, bs?.debtors, bs?.inventory, bs?.creditors,
    cfs?.operating_cash_flow,
  ];
  const nullCount = coreFields.filter((v) => v == null).length;
  const hasNulls = nullCount > 0;
  const unresolvedConflicts = conflicts.filter((c) => !conflictSelections[c.field]);

  const handleConfirm = () => {
    // Build final extraction with edits + conflict resolutions applied
    const finalIS = { ...is };
    const finalBS = { ...bs };
    const finalCFS = { ...cfs };

    for (const [path, val] of Object.entries(editValues)) {
      const n = parseFloat(val);
      const value = isFinite(n) ? n : null;
      const [section, field] = path.split(".");
      if (section === "income_statement") (finalIS as Record<string, unknown>)[field] = value;
      if (section === "balance_sheet") (finalBS as Record<string, unknown>)[field] = value;
      if (section === "cash_flow_statement") (finalCFS as Record<string, unknown>)[field] = value;
    }

    const mapped = extractionToInputs({
      ...result,
      current_period: {
        income_statement: finalIS as typeof is,
        balance_sheet: finalBS as typeof bs,
        cash_flow_statement: finalCFS as typeof cfs,
      },
    });

    onConfirm(mapped);
    onClose();
  };

  const periodLabel = meta?.period_start_date && meta?.period_end_date
    ? `${meta.period_start_date} to ${meta.period_end_date}`
    : meta?.period_end_date
    ? `Year ended ${meta.period_end_date}`
    : meta?.period_months
    ? `${meta.period_months}-month period`
    : "Period unknown";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[min(90vh,100dvh-1rem)] w-[calc(100vw-1rem)] max-w-2xl overflow-y-auto border-slate-800 bg-slate-950 p-4 text-slate-200 sm:p-6">
        <DialogHeader>
          <DialogTitle className="text-slate-100">
            Review Extracted Data
          </DialogTitle>
          <DialogDescription className="text-slate-500">
            Verify the values before populating the ratio form. Click any field to edit.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* ── Header section ── */}
          <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4 space-y-2">
            <div className="flex flex-wrap items-start gap-2">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-100 text-base">{meta?.company_name ?? "Unknown Company"}</p>
                <p className="text-xs text-slate-400 mt-0.5">{periodLabel}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <span className="rounded-full border px-2 py-0.5 text-[10px] font-medium text-slate-400 border-slate-700">
                  {DOC_TYPE_LABEL[meta?.document_type ?? "unknown"]}
                </span>
                <span className="rounded-full border px-2 py-0.5 text-[10px] font-medium text-slate-400 border-slate-700">
                  {FS_TYPE_LABEL[meta?.financial_statement_type ?? "unknown"]}
                </span>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${CONFIDENCE_BADGE[confidence]}`}>
                  {confidence.charAt(0).toUpperCase() + confidence.slice(1)} confidence
                </span>
              </div>
            </div>

            {result.normalisation_applied && result.original_period_months && (
              <div className="flex gap-2 rounded-lg bg-blue-950/40 border border-blue-800 px-3 py-2">
                <Info className="h-4 w-4 text-blue-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-blue-300">
                  This document covers {result.original_period_months} months. Flow statement values have been annualised
                  to 12 months (×{result.annualisation_factor?.toFixed(2)}) for ratio calculation.
                </p>
              </div>
            )}

            {(confidence === "low" || confidence === "medium") && (
              <div className="flex gap-2 rounded-lg bg-amber-950/40 border border-amber-800 px-3 py-2">
                <AlertTriangle className="h-4 w-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-300">
                  Please review all extracted values carefully before proceeding. AI extraction may contain errors on complex or unusual documents.
                </p>
              </div>
            )}

            {hasNulls && (
              <div className="flex gap-2 rounded-lg bg-amber-950/30 border border-amber-900 px-3 py-2">
                <HelpCircle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-400">
                  {nullCount} of {coreFields.length} core fields could not be extracted — please complete them manually.
                </p>
              </div>
            )}
          </div>

          {/* ── Conflicts ── */}
          {conflicts.length > 0 && (
            <div className="rounded-lg border border-red-900 bg-red-950/30 p-3 space-y-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-red-400" />
                <p className="text-xs font-semibold text-red-300">
                  Conflicting values detected in {conflicts.length} field{conflicts.length > 1 ? "s" : ""}. Please resolve each before proceeding.
                </p>
              </div>
              {conflicts.map((c) => (
                <div key={c.field} className="rounded-md bg-slate-900 border border-slate-800 p-2 space-y-1">
                  <p className="text-[10px] font-mono text-slate-500">{c.field}</p>
                  <div className="flex gap-3">
                    {(["1", "2"] as const).map((side) => {
                      const val = side === "1" ? c.value_1 : c.value_2;
                      const src = side === "1" ? c.source_1 : c.source_2;
                      const selected = conflictSelections[c.field] === side;
                      return (
                        <label key={side} className={`flex-1 flex items-center gap-2 rounded-md border px-2 py-1.5 cursor-pointer transition-colors
                          ${selected ? "border-violet-600 bg-violet-950/40" : "border-slate-700 hover:border-slate-600"}`}>
                          <input
                            type="radio"
                            name={`conflict-${c.field}`}
                            checked={selected}
                            onChange={() => setConflictSelections((prev) => ({ ...prev, [c.field]: side }))}
                            className="accent-violet-500"
                          />
                          <div>
                            <p className="text-xs text-slate-200">{fmtZAR(val)}</p>
                            <p className="text-[9px] text-slate-500">{src.replace("document_", "Doc ")}</p>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Data quality ── */}
          {dq && (
            <Section title="Data Quality Flags">
              <table className="w-full text-xs">
                <tbody>
                  {[
                    ["Gross profit reconciles", dq.gross_profit_reconciles],
                    ["Net income reconciles", dq.net_income_reconciles],
                    ["Balance sheet balances", dq.balance_sheet_balances],
                    ["Cash flow reconciles", dq.cash_flow_reconciles],
                  ].map(([label, flag]) => (
                    <tr key={label as string} className="border-b border-slate-800/60 last:border-0">
                      <td className="py-1.5 text-slate-400">{label}</td>
                      <td className="py-1.5 text-right">
                        {flag == null ? <span className="text-slate-600">—</span>
                          : flag ? <span className="text-emerald-400">✓</span>
                          : <span className="text-red-400">✗</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {dq.extraction_notes && (
                <p className="text-[10px] text-slate-500 mt-2 leading-relaxed">{dq.extraction_notes}</p>
              )}
            </Section>
          )}

          {/* ── Income Statement ── */}
          <Section title="Income Statement" defaultOpen>
            {fieldRow("Revenue", "income_statement.revenue", is?.revenue)}
            {fieldRow("COGS", "income_statement.cogs", is?.cogs)}
            {fieldRow("Gross Profit", "income_statement.gross_profit", is?.gross_profit)}
            {fieldRow("Fixed Costs", "income_statement.fixed_costs", is?.fixed_costs)}
            {fieldRow("Labour Cost", "income_statement.labor_cost", is?.labor_cost)}
            {fieldRow("Depreciation", "income_statement.depreciation", is?.depreciation)}
            {fieldRow("EBITDA", "income_statement.ebitda", is?.ebitda)}
            {fieldRow("EBIT", "income_statement.ebit", is?.ebit)}
            {fieldRow("Interest Expense", "income_statement.interest_expense", is?.interest_expense)}
            {fieldRow("EBT (Profit before tax)", "income_statement.ebt", is?.ebt)}
            {fieldRow("Tax", "income_statement.tax", is?.tax)}
            {fieldRow("Net Income (Profit after tax)", "income_statement.net_income", is?.net_income)}
            {fieldRow("Director Remuneration", "income_statement.director_remuneration", is?.director_remuneration)}
          </Section>

          {/* ── Balance Sheet ── */}
          <Section title="Balance Sheet">
            {fieldRow("Total Assets", "balance_sheet.total_assets", bs?.total_assets)}
            {fieldRow("Fixed Assets", "balance_sheet.fixed_assets", bs?.fixed_assets)}
            {fieldRow("Current Assets", "balance_sheet.current_assets", bs?.current_assets)}
            {fieldRow("Inventory / Stock", "balance_sheet.inventory", bs?.inventory)}
            {fieldRow("WIP", "balance_sheet.wip", bs?.wip)}
            {fieldRow("Debtors (AR)", "balance_sheet.debtors", bs?.debtors)}
            {fieldRow("Cash", "balance_sheet.cash", bs?.cash)}
            {fieldRow("Total Liabilities", "balance_sheet.total_liabilities", bs?.total_liabilities)}
            {fieldRow("Current Liabilities", "balance_sheet.current_liabilities", bs?.current_liabilities)}
            {fieldRow("Creditors (AP)", "balance_sheet.creditors", bs?.creditors)}
            {fieldRow("Short-term Debt", "balance_sheet.short_term_debt", bs?.short_term_debt)}
            {fieldRow("Long-term Debt", "balance_sheet.long_term_debt", bs?.long_term_debt)}
            {fieldRow("Equity", "balance_sheet.equity", bs?.equity)}
            {fieldRow("Shareholder Loans (Asset)", "balance_sheet.shareholder_loans_asset", bs?.shareholder_loans_asset)}
            {fieldRow("Shareholder Loans (Liability)", "balance_sheet.shareholder_loans_liability", bs?.shareholder_loans_liability)}
          </Section>

          {/* ── Cash Flow ── */}
          <Section title="Cash Flow Statement">
            {fieldRow("Operating Cash Flow", "cash_flow_statement.operating_cash_flow", cfs?.operating_cash_flow)}
            {fieldRow("Capex", "cash_flow_statement.capex", cfs?.capex)}
            {fieldRow("Investing Cash Flow", "cash_flow_statement.investing_cash_flow", cfs?.investing_cash_flow)}
            {fieldRow("Dividends Paid", "cash_flow_statement.dividends_paid", cfs?.dividends_paid)}
            {fieldRow("Financing Cash Flow", "cash_flow_statement.financing_cash_flow", cfs?.financing_cash_flow)}
            {fieldRow("Net Cash Movement", "cash_flow_statement.net_cash_movement", cfs?.net_cash_movement)}
          </Section>

          {/* ── Top Expenses ── */}
          {result.top_expenses?.length > 0 && (
            <Section title="Top Expenses">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-500">
                    <th className="text-left py-1">#</th>
                    <th className="text-left py-1">Category</th>
                    <th className="text-right py-1">Amount</th>
                    <th className="text-right py-1">% Rev</th>
                  </tr>
                </thead>
                <tbody>
                  {result.top_expenses.map((e) => (
                    <tr key={e.rank} className="border-b border-slate-800/60 last:border-0">
                      <td className="py-1.5 text-slate-500">{e.rank}</td>
                      <td className="py-1.5 text-slate-300">{e.category}</td>
                      <td className="py-1.5 text-right tabular-nums text-slate-200">{fmtZAR(e.amount)}</td>
                      <td className="py-1.5 text-right tabular-nums text-slate-400">
                        {e.percentage_of_revenue != null ? `${e.percentage_of_revenue.toFixed(1)}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          {/* ── Top Income Sources ── */}
          {result.top_income_sources?.length > 0 && (
            <Section title="Income Sources">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-500">
                    <th className="text-left py-1">#</th>
                    <th className="text-left py-1">Description</th>
                    <th className="text-right py-1">Amount</th>
                    <th className="text-right py-1">% Total</th>
                  </tr>
                </thead>
                <tbody>
                  {result.top_income_sources.map((s) => (
                    <tr key={s.rank} className="border-b border-slate-800/60 last:border-0">
                      <td className="py-1.5 text-slate-500">{s.rank}</td>
                      <td className="py-1.5 text-slate-300">{s.description}</td>
                      <td className="py-1.5 text-right tabular-nums text-slate-200">{fmtZAR(s.amount)}</td>
                      <td className="py-1.5 text-right tabular-nums text-slate-400">
                        {s.percentage_of_total != null ? `${s.percentage_of_total.toFixed(1)}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          {/* ── Document metadata ── */}
          {result.document_count > 1 && (
            <Section title={`Documents (${result.document_count})`}>
              <div className="space-y-1">
                {result.file_names.map((name, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[9px] text-slate-400">Doc {i + 1}</span>
                    <span className="text-slate-300 truncate">{name}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* ── Footer actions ── */}
          <UploadQualityDisclaimer
            accepted={acceptedQuality}
            onChange={setAcceptedQuality}
            className="text-slate-400"
          />
          <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-slate-800">
            <Button
              onClick={handleConfirm}
              disabled={unresolvedConflicts.length > 0 || !acceptedQuality}
              className="flex-1 bg-[#b7872a] hover:bg-[#d4a550] text-white font-semibold"
            >
              <CheckCircle2 className="h-4 w-4 mr-1.5" />
              {unresolvedConflicts.length > 0
                ? `Resolve ${unresolvedConflicts.length} conflict${unresolvedConflicts.length > 1 ? "s" : ""} first`
                : "Confirm & import figures"}
            </Button>
            <Button variant="outline" onClick={onClose} className="border-slate-700 text-slate-300 hover:bg-slate-800">
              Upload different file
            </Button>
            <button
              onClick={onClose}
              className="text-xs text-slate-500 hover:text-slate-400 underline px-2"
            >
              Skip — enter manually
            </button>
          </div>

          <p className="text-[10px] text-slate-600 text-center">
            Your document is processed securely. PDFs are never stored on our servers — only extracted values are saved.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
