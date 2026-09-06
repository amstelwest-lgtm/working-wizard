/**
 * BankStatementDrafter — one upload pack (multi-account) drafts:
 *  1) profitability / P&L figures (waterfall + budget seed)
 *  2) cash extract + movements trial balance + balance check
 * Same files feed every board — no second bank upload for cash.
 */

import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Upload, FileText, X, Sparkles, AlertTriangle, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  draftFinancialsFromBankStatements,
  type BankDraftStatement,
} from "@/lib/bankStatements.server";
import { draftCashForecastFromBankStatements } from "@/lib/cash-from-banks.server";
import type { CashFromBanksDraftResult } from "@/lib/cash-from-banks.types";
import {
  BANK_FILE_ACCEPT,
  encodeBankFileSlots,
  rejectBankFile,
  MAX_BANK_FILES,
  MAX_BANK_FILE_BYTES,
  MAX_BANK_TOTAL_BYTES,
  type BankFilePayload,
  type BankFileSlot,
} from "@/lib/bank-files";
import { transportPaths, unstage } from "@/lib/staged-upload.client";
import { useMarketFormat } from "@/contexts/market";
import { selectionPayload } from "@/lib/market";
import { PERIOD_MONTHS_KEY } from "@/lib/ratios";
import { MovementsTrialBalancePanel } from "@/components/movements-trial-balance-panel";

export interface BankDraftApplyPayload {
  /** String figures keyed by the app's Inputs keys (revenue, cogs, ebit, ebt, netIncome, fixedCosts). */
  fields: Record<string, string>;
  annualised: boolean;
  draft: BankDraftStatement;
  /** Cash draft from the SAME statement pack — skip re-upload. */
  cashDraft?: CashFromBanksDraftResult | null;
  payloadFiles?: BankFilePayload[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  onApply: (payload: BankDraftApplyPayload) => void;
}

function fmt(n: number, currency: string | null, money: (n: number) => string): string {
  if (
    currency &&
    currency !== "R" &&
    currency !== "ZAR" &&
    currency !== "$" &&
    currency !== "USD"
  ) {
    return `${currency} ${n.toLocaleString()}`;
  }
  return money(n);
}

export function BankStatementDrafter({ open, onClose, onApply }: Props) {
  const { money, t, selection } = useMarketFormat();
  const checking = t("checking");
  const inputRef = useRef<HTMLInputElement>(null);
  const [slots, setSlots] = useState<BankFileSlot[]>([]);
  const [drafting, setDrafting] = useState(false);
  const [draftProgress, setDraftProgress] = useState("");
  const [draft, setDraft] = useState<BankDraftStatement | null>(null);
  const [cashDraft, setCashDraft] = useState<CashFromBanksDraftResult | null>(null);
  const [encodedFiles, setEncodedFiles] = useState<BankFilePayload[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [annualise, setAnnualise] = useState(false);
  const [ackWarnings, setAckWarnings] = useState(false);
  const doDraftPnL = useServerFn(draftFinancialsFromBankStatements);
  const doDraftCash = useServerFn(draftCashForecastFromBankStatements);

  const reset = () => {
    setSlots([]);
    setDraft(null);
    setCashDraft(null);
    setEncodedFiles([]);
    setWarnings([]);
    setAnnualise(false);
    setAckWarnings(false);
    setDraftProgress("");
  };

  const addFiles = (list: FileList | null, defaultLabel?: string) => {
    const labelBase = defaultLabel ?? checking;
    if (!list) return;
    const next = [...slots];
    for (const f of Array.from(list)) {
      const reject = rejectBankFile(f);
      if (reject) {
        toast.error(reject);
        continue;
      }
      if (f.size > MAX_BANK_FILE_BYTES) {
        toast.error(`"${f.name}" is larger than 10 MB.`);
        continue;
      }
      if (next.length >= MAX_BANK_FILES) {
        toast.error(`Maximum ${MAX_BANK_FILES} statement files.`);
        break;
      }
      const total = next.reduce((s, x) => s + x.file.size, 0) + f.size;
      if (total > MAX_BANK_TOTAL_BYTES) {
        toast.error("Combined files exceed 40 MB.");
        continue;
      }
      next.push({ file: f, accountLabel: labelBase });
    }
    setSlots(next);
  };

  const runDraft = async () => {
    if (slots.length === 0) return;
    setDrafting(true);
    setDraftProgress("Uploading statements…");
    let payloadFiles: BankFilePayload[] = [];
    try {
      payloadFiles = await encodeBankFileSlots(slots);
      setEncodedFiles(payloadFiles);
      setDraftProgress("Drafting P&L and cash movements from the same pack…");

      // Both drafters read the same staged pack, so neither may delete it;
      // the finally below does, once both have settled.
      const market = selectionPayload(selection);
      const [pnlResult, cashResult] = await Promise.all([
        doDraftPnL({ data: { files: payloadFiles, market, retainStaged: true } }),
        doDraftCash({ data: { files: payloadFiles, market, retainStaged: true } }),
      ]);

      setDraft(pnlResult.draft);
      setCashDraft(cashResult);
      setWarnings([
        ...pnlResult.warnings,
        ...(cashResult.warnings ?? []).filter((w) => !pnlResult.warnings.includes(w)),
      ]);
    } catch (e) {
      toast.error(`Drafting failed: ${(e as Error).message}`);
    } finally {
      setDrafting(false);
      setDraftProgress("");
      await unstage(transportPaths(payloadFiles));
    }
  };

  const factor =
    annualise && draft?.months_covered && draft.months_covered > 0 ? 12 / draft.months_covered : 1;
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
        // Tell the ratio engine what the applied figures cover so a 3-month
        // pack that is not annualised here is still scored as a quarter.
        [PERIOD_MONTHS_KEY]:
          factor !== 1
            ? "12"
            : String(
                draft.months_covered && draft.months_covered > 0
                  ? Math.min(12, Math.max(1, Math.round(draft.months_covered)))
                  : 12,
              ),
      },
      annualised: factor !== 1,
      draft,
      cashDraft,
      payloadFiles: encodedFiles,
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

  const accountLabels = Array.from(
    new Set(slots.map((s) => s.accountLabel.trim()).filter(Boolean)),
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="max-h-[min(90vh,100dvh-1rem)] w-[calc(100vw-1rem)] max-w-3xl overflow-y-auto border border-amber-900/15 bg-white p-4 text-slate-950 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-50 sm:p-6">
        <DialogHeader>
          <DialogTitle className="text-[15px] font-semibold uppercase tracking-[0.15em]">
            Draft board from bank statements
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-600 dark:text-slate-400">
            Upload ~3 months of statements (add every bank account). One pack drafts profitability,
            seeds budget, builds cash forecast, and shows movements in balances — no re-upload.
          </DialogDescription>
        </DialogHeader>

        {!draft && (
          <>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={BANK_FILE_ACCEPT}
              className="hidden"
              onChange={(e) => {
                addFiles(e.target.files, accountLabels[0] || checking);
                if (inputRef.current) inputRef.current.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex w-full flex-col items-center gap-1.5 rounded-lg border border-dashed border-amber-700/40 bg-amber-50/60 p-6 text-center transition-colors hover:border-amber-700/70 hover:bg-amber-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-[#b7872a]/60 dark:hover:bg-slate-800"
            >
              <Upload className="h-5 w-5 text-amber-800 dark:text-slate-300" />
              <span className="text-sm font-medium">Add bank statement files</span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                PDF, CSV or Excel/ODS export · up to {MAX_BANK_FILES} files · multiple accounts OK
              </span>
            </button>

            {slots.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Files & accounts
                </p>
                <ul className="space-y-2">
                  {slots.map((s, i) => (
                    <li
                      key={`${s.file.name}-${i}`}
                      className="flex flex-col gap-1.5 rounded-md border border-amber-900/10 bg-amber-50/40 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:items-center sm:gap-2"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <FileText className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                        <span className="min-w-0 flex-1 truncate">{s.file.name}</span>
                      </div>
                      <Input
                        value={s.accountLabel}
                        onChange={(e) => {
                          const next = [...slots];
                          next[i] = { ...next[i], accountLabel: e.target.value };
                          setSlots(next);
                        }}
                        placeholder="Account name"
                        className="h-8 w-full border-slate-300 bg-white text-xs sm:w-44 dark:border-slate-700 dark:bg-slate-950"
                      />
                      <button
                        type="button"
                        onClick={() => setSlots(slots.filter((_, j) => j !== i))}
                        aria-label={`Remove ${s.file.name}`}
                      >
                        <X className="h-3.5 w-3.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200" />
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-[#b8860b] hover:underline"
                >
                  <Plus className="h-3 w-3" />
                  Add another account / statement
                </button>
              </div>
            )}

            <Button onClick={runDraft} disabled={slots.length === 0 || drafting} className="w-full">
              {drafting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {draftProgress || "Reading transactions…"}
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Draft P&amp;L, budget &amp; cash from this pack
                </>
              )}
            </Button>
          </>
        )}

        {draft && rows && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-900/10 bg-amber-50/40 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-900">
              <span className="text-slate-600 dark:text-slate-400">
                Period:{" "}
                <strong className="text-slate-900 dark:text-slate-100">
                  {draft.period_start ?? "?"} → {draft.period_end ?? "?"}
                </strong>
                {draft.months_covered
                  ? ` (~${draft.months_covered} month${draft.months_covered === 1 ? "" : "s"})`
                  : ""}
                {cashDraft?.extract.accounts && cashDraft.extract.accounts.length > 0 && (
                  <span className="ml-2 text-slate-500">
                    · {cashDraft.extract.accounts.map((a) => a.account_label).join(", ")}
                  </span>
                )}
              </span>
              <span className="flex items-center gap-2">
                <Label
                  htmlFor="annualise-toggle"
                  className="text-xs text-slate-600 dark:text-slate-400"
                >
                  Annualised view (×{(12 / (draft.months_covered || 12)).toFixed(1)})
                </Label>
                <Switch
                  id="annualise-toggle"
                  checked={annualise}
                  onCheckedChange={setAnnualise}
                  disabled={!draft.months_covered || draft.months_covered <= 0}
                />
              </span>
            </div>

            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b8860b]">
                Profitability (feeds waterfall &amp; budget)
              </p>
              <table className="w-full text-sm">
                <tbody>
                  {rows.map((r, i) => (
                    <tr
                      key={i}
                      className={
                        r.strong
                          ? "border-t border-amber-900/15 font-semibold dark:border-slate-700"
                          : ""
                      }
                    >
                      <td
                        className={`py-1 ${r.indent ? "pl-5 text-slate-600 dark:text-slate-400" : ""}`}
                      >
                        {r.label}
                      </td>
                      <td
                        className={`py-1 text-right tabular-nums ${r.value < 0 ? "text-red-700 dark:text-red-400" : ""}`}
                      >
                        {fmt(
                          scale(Math.abs(r.value)) * Math.sign(r.value || 1),
                          draft.currency,
                          money,
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {cashDraft?.movements && <MovementsTrialBalancePanel movements={cashDraft.movements} />}

            {(warnings.length > 0 || draft.excluded_items.length > 0 || draft.notes) && (
              <div className="space-y-1.5 rounded-md border border-amber-700/30 bg-amber-50 p-3 text-xs dark:border-amber-700/40 dark:bg-amber-950/30">
                {warnings.map((w, i) => (
                  <p
                    key={i}
                    className="flex items-start gap-1.5 text-amber-900 dark:text-amber-300"
                  >
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
                    I understand the figures / balance checks need review and want to continue.
                  </label>
                )}
                {draft.excluded_items.length > 0 && (
                  <p className="text-slate-700 dark:text-slate-300">
                    <strong>Excluded (not income/expenses):</strong>{" "}
                    {draft.excluded_items.join("; ")}
                  </p>
                )}
                {draft.notes && (
                  <p className="text-slate-700 dark:text-slate-300">
                    <strong>AI notes:</strong> {draft.notes}
                  </p>
                )}
              </div>
            )}

            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              The quality of the financial information we produce depends on the accuracy of the
              information you upload. Next step uses these same statements for the 13-week cash
              forecast — you will not be asked to upload again.
            </p>

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setDraft(null);
                  setCashDraft(null);
                  setWarnings([]);
                  setAnnualise(false);
                  setAckWarnings(false);
                }}
              >
                Back
              </Button>
              <Button
                className="flex-1"
                onClick={apply}
                disabled={warnings.length > 0 && !ackWarnings}
              >
                Apply &amp; continue to cash forecast
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
