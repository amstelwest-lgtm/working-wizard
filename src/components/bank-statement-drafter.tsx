/**
 * BankStatementDrafter — upload bank statements (PDF/CSV), have AI draft a
 * basic income statement from the transaction activity, review it (with an
 * optional annualised view), then apply the figures to the app's financials.
 *
 * Figures are always SAVED for the actual period the statements cover; the
 * annualised toggle is a view/apply-time option so ratios can be compared on a
 * full-year basis when the statements only cover part of a year.
 */

import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Upload, FileText, X, Sparkles, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  draftFinancialsFromBankStatements,
  type BankDraftStatement,
} from "@/lib/bankStatements.server";

export interface BankDraftApplyPayload {
  /** String figures keyed by the app's Inputs keys (revenue, cogs, ebit, ebt, netIncome, fixedCosts). */
  fields: Record<string, string>;
  annualised: boolean;
  draft: BankDraftStatement;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onApply: (payload: BankDraftApplyPayload) => void;
}

function fmt(n: number, currency: string | null): string {
  return `${currency ?? "R"} ${n.toLocaleString("en-ZA", { maximumFractionDigits: 0 })}`;
}

export function BankStatementDrafter({ open, onClose, onApply }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [drafting, setDrafting] = useState(false);
  const [draft, setDraft] = useState<BankDraftStatement | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [annualise, setAnnualise] = useState(false);
  const [ackWarnings, setAckWarnings] = useState(false);
  const doDraft = useServerFn(draftFinancialsFromBankStatements);

  const reset = () => {
    setFiles([]); setDraft(null); setWarnings([]); setAnnualise(false); setAckWarnings(false);
  };

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
      if (!["pdf", "csv", "txt"].includes(ext)) {
        toast.error(`"${f.name}" is not a PDF or CSV file.`);
        continue;
      }
      if (f.size > 10 * 1024 * 1024) {
        toast.error(`"${f.name}" is larger than 10 MB. Try splitting it or exporting fewer months.`);
        continue;
      }
      if (next.length >= 6) { toast.error("Maximum 6 statement files."); break; }
      if (next.reduce((s, x) => s + x.size, 0) + f.size > 25 * 1024 * 1024) {
        toast.error("Combined files exceed 25 MB. Remove a file or use smaller exports.");
        continue;
      }
      next.push(f);
    }
    setFiles(next);
  };

  const runDraft = async () => {
    setDrafting(true);
    try {
      const payloadFiles = await Promise.all(
        files.map(async (f) => {
          const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
          if (ext === "csv" || ext === "txt") {
            return { fileName: f.name, text: await f.text() };
          }
          const base64 = await new Promise<string>((res, rej) => {
            const reader = new FileReader();
            reader.onload = () => res((reader.result as string).split(",")[1]);
            reader.onerror = () => rej(new Error(`Could not read ${f.name}`));
            reader.readAsDataURL(f);
          });
          return { fileName: f.name, base64 };
        }),
      );
      const result = await doDraft({ data: { files: payloadFiles } });
      setDraft(result.draft);
      setWarnings(result.warnings);
    } catch (e) {
      toast.error(`Drafting failed: ${(e as Error).message}`);
    } finally {
      setDrafting(false);
    }
  };

  // Annualisation factor — only meaningful when we know the months covered.
  const factor =
    annualise && draft?.months_covered && draft.months_covered > 0
      ? 12 / draft.months_covered
      : 1;
  const scale = (n: number) => Math.round(n * factor);

  const apply = () => {
    if (!draft) return;
    const ebit = draft.net_profit + draft.tax_paid + draft.interest_paid;
    const ebt = draft.net_profit + draft.tax_paid;
    onApply({
      fields: {
        revenue: String(scale(draft.revenue)),
        cogs: String(scale(draft.cost_of_sales)),
        ebit: String(scale(ebit)),
        ebt: String(scale(ebt)),
        netIncome: String(scale(draft.net_profit)),
        fixedCosts: String(scale(draft.total_opex)),
      },
      annualised: factor !== 1,
      draft,
    });
    reset();
  };

  const rows: Array<{ label: string; value: number; strong?: boolean; indent?: boolean }> | null =
    draft && [
      { label: "Revenue", value: draft.revenue, strong: true },
      { label: "Cost of sales", value: -draft.cost_of_sales },
      { label: "Gross profit", value: draft.gross_profit, strong: true },
      { label: "Other income", value: draft.other_income },
      ...draft.opex_breakdown.map((l) => ({ label: l.category, value: -l.amount, indent: true })),
      { label: "Total operating expenses", value: -draft.total_opex, strong: true },
      { label: "Interest", value: -draft.interest_paid },
      { label: "Tax", value: -draft.tax_paid },
      { label: "Net profit", value: draft.net_profit, strong: true },
    ];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto border border-amber-900/15 bg-white text-slate-950 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-50">
        <DialogHeader>
          <DialogTitle className="text-[15px] font-semibold uppercase tracking-[0.15em]">
            Draft financials from bank statements
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-600 dark:text-slate-400">
            Upload bank statements (PDF or CSV) and AI will draft a basic income statement from the
            transactions. You review before anything is saved.
          </DialogDescription>
        </DialogHeader>

        {!draft && (
          <>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept=".pdf,.csv,.txt"
              className="hidden"
              onChange={(e) => { addFiles(e.target.files); if (inputRef.current) inputRef.current.value = ""; }}
            />
            <button
              onClick={() => inputRef.current?.click()}
              className="flex w-full flex-col items-center gap-1.5 rounded-lg border border-dashed border-amber-700/40 bg-amber-50/60 p-6 text-center transition-colors hover:border-amber-700/70 hover:bg-amber-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-[#b7872a]/60 dark:hover:bg-slate-800"
            >
              <Upload className="h-5 w-5 text-amber-800 dark:text-slate-300" />
              <span className="text-sm font-medium">Add bank statement files</span>
              <span className="text-xs text-slate-500 dark:text-slate-400">PDF or CSV · up to 6 files (e.g. 3 months of statements)</span>
            </button>
            {files.length > 0 && (
              <ul className="space-y-1">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-md border border-amber-900/10 bg-amber-50/40 px-3 py-1.5 text-xs dark:border-slate-800 dark:bg-slate-900">
                    <FileText className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <button onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}>
                      <X className="h-3.5 w-3.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <Button onClick={runDraft} disabled={files.length === 0 || drafting} className="w-full">
              {drafting
                ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Reading transactions & drafting…</>)
                : (<><Sparkles className="mr-2 h-4 w-4" /> Draft financial statements</>)}
            </Button>
          </>
        )}

        {draft && rows && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-900/10 bg-amber-50/40 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-900">
              <span className="text-slate-600 dark:text-slate-400">
                Period: <strong className="text-slate-900 dark:text-slate-100">{draft.period_start ?? "?"} → {draft.period_end ?? "?"}</strong>
                {draft.months_covered ? ` (~${draft.months_covered} month${draft.months_covered === 1 ? "" : "s"})` : ""}
              </span>
              <span className="flex items-center gap-2">
                <Label htmlFor="annualise-toggle" className="text-xs text-slate-600 dark:text-slate-400">Annualised view (×{(12 / (draft.months_covered || 12)).toFixed(1)})</Label>
                <Switch
                  id="annualise-toggle"
                  checked={annualise}
                  onCheckedChange={setAnnualise}
                  disabled={!draft.months_covered || draft.months_covered <= 0}
                />
              </span>
            </div>

            <table className="w-full text-sm">
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className={r.strong ? "border-t border-amber-900/15 font-semibold dark:border-slate-700" : ""}>
                    <td className={`py-1 ${r.indent ? "pl-5 text-slate-600 dark:text-slate-400" : ""}`}>{r.label}</td>
                    <td className={`py-1 text-right tabular-nums ${r.value < 0 ? "text-red-700 dark:text-red-400" : ""}`}>
                      {fmt(scale(Math.abs(r.value)) * Math.sign(r.value || 1), draft.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {(warnings.length > 0 || draft.excluded_items.length > 0 || draft.notes) && (
              <div className="space-y-1.5 rounded-md border border-amber-700/30 bg-amber-50 p-3 text-xs dark:border-amber-700/40 dark:bg-amber-950/30">
                {warnings.map((w, i) => (
                  <p key={i} className="flex items-start gap-1.5 text-amber-900 dark:text-amber-300">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {w}
                  </p>
                ))}
                {warnings.length > 0 && (
                  <label className="flex items-center gap-2 pt-1 text-amber-900 dark:text-amber-300">
                    <input
                      type="checkbox"
                      checked={ackWarnings}
                      onChange={(e) => setAckWarnings(e.target.checked)}
                      className="h-3.5 w-3.5"
                    />
                    I understand the figures don't fully reconcile and want to apply them anyway.
                  </label>
                )}
                {draft.excluded_items.length > 0 && (
                  <p className="text-slate-700 dark:text-slate-300">
                    <strong>Excluded (not income/expenses):</strong> {draft.excluded_items.join("; ")}
                  </p>
                )}
                {draft.notes && (
                  <p className="text-slate-700 dark:text-slate-300"><strong>AI notes:</strong> {draft.notes}</p>
                )}
              </div>
            )}

            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              This is an AI draft built from bank transactions — it is not a substitute for proper
              accounting records. Your accountant should review it before it's relied on.
            </p>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => { setDraft(null); setWarnings([]); setAnnualise(false); setAckWarnings(false); }}>
                Back
              </Button>
              <Button className="flex-1" onClick={apply} disabled={warnings.length > 0 && !ackWarnings}>
                Apply {annualise && factor !== 1 ? "annualised " : ""}figures
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
