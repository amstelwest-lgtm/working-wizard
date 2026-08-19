/**
 * CashFromBanksDrafter — upload bank statements → Claude extract → Phase 4 workspace → publish.
 */

import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Upload, FileText, X, Sparkles, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { draftCashForecastFromBankStatements } from "@/lib/cash-from-banks.server";
import { buildCashflowPublishPayload, type ExistingCashflow } from "@/lib/cash-from-banks.publish";
import type {
  CashForecastPublishPayload,
  CashFromBanksDraftResult,
} from "@/lib/cash-from-banks.types";
import {
  CashClassificationWorkspace,
  type WorkspacePublishRequest,
} from "@/components/cash-classification-workspace";
import { MovementsTrialBalancePanel } from "@/components/movements-trial-balance-panel";
import { MAX_BANK_FILES } from "@/lib/bank-files";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Existing published cashflow — drives replace/merge policy */
  existingCashflow?: ExistingCashflow | null;
  onPublish: (payload: CashForecastPublishPayload) => void | Promise<void>;
  /** Optional: persist working draft JSON (extract + lines) for resume */
  onSaveDraft?: (draft: CashFromBanksDraftResult) => void | Promise<void>;
  /**
   * Pre-built cash draft from the shared bank onboarding pack.
   * When set, skip the upload step and open the classification workspace.
   */
  initialDraft?: CashFromBanksDraftResult | null;
}

export function CashFromBanksDrafter({
  open,
  onClose,
  existingCashflow = null,
  onPublish,
  onSaveDraft,
  initialDraft = null,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [working, setWorking] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState<CashFromBanksDraftResult | null>(null);
  const [lines, setLines] = useState<CashFromBanksDraftResult["lines"]>([]);
  const [startDate, setStartDate] = useState("");
  const [openingBalance, setOpeningBalance] = useState("0");
  const doDraft = useServerFn(draftCashForecastFromBankStatements);

  const hydrate = (draft: CashFromBanksDraftResult) => {
    setResult(draft);
    setLines(draft.lines);
    setStartDate(draft.startDate);
    setOpeningBalance(String(draft.openingBalance));
  };

  useEffect(() => {
    if (!open) return;
    if (initialDraft) {
      hydrate(initialDraft);
      void onSaveDraft?.(initialDraft);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialDraft]);

  const reset = () => {
    setFiles([]);
    setResult(null);
    setLines([]);
    setStartDate("");
    setOpeningBalance("0");
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
        toast.error(`"${f.name}" is larger than 10 MB.`);
        continue;
      }
      if (next.length >= MAX_BANK_FILES) {
        toast.error(`Maximum ${MAX_BANK_FILES} statement files.`);
        break;
      }
      if (next.reduce((s, x) => s + x.size, 0) + f.size > 40 * 1024 * 1024) {
        toast.error("Combined files exceed 40 MB.");
        continue;
      }
      next.push(f);
    }
    setFiles(next);
  };

  const runDraft = async () => {
    setWorking(true);
    try {
      const payloadFiles = await Promise.all(
        files.map(async (f) => {
          const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
          if (ext === "csv" || ext === "txt") {
            return { fileName: f.name, text: await f.text() };
          }
          const base64 = await new Promise<string>((res, rej) => {
            const reader = new FileReader();
            reader.onload = () => res((reader.result as string).split(",")[1] ?? "");
            reader.onerror = () => rej(new Error(`Could not read ${f.name}`));
            reader.readAsDataURL(f);
          });
          return { fileName: f.name, base64 };
        }),
      );
      const draft = await doDraft({ data: { files: payloadFiles } });
      setResult(draft);
      setLines(draft.lines);
      setStartDate(draft.startDate);
      setOpeningBalance(String(draft.openingBalance));
      await onSaveDraft?.(draft);
    } catch (e) {
      toast.error(`Cash draft failed: ${(e as Error).message}`);
    } finally {
      setWorking(false);
    }
  };

  const handleLinesChange = (next: typeof lines) => {
    setLines(next);
    if (result) {
      const draft = { ...result, lines: next, startDate, openingBalance: parseFloat(openingBalance) || 0 };
      void onSaveDraft?.(draft);
    }
  };

  const publish = async (req: WorkspacePublishRequest) => {
    setPublishing(true);
    try {
      const payload = buildCashflowPublishPayload({
        lines: req.lines,
        startDate: req.startDate,
        openingBalance: req.openingBalance,
        policy: req.policy,
        existing: existingCashflow,
        adoptBankBalances: req.adoptBankBalances,
      });
      await onPublish(payload);
      reset();
    } catch (e) {
      toast.error(`Publish failed: ${(e as Error).message}`);
    } finally {
      setPublishing(false);
    }
  };

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
      <DialogContent className="max-h-[min(92vh,100dvh-1rem)] w-[calc(100vw-1rem)] max-w-5xl overflow-y-auto border border-amber-900/20 bg-[#fffdf8] p-4 text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-50 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold tracking-tight">
            <Wallet className="h-4 w-4 text-[#b8860b]" />
            Cash forecast from bank statements
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500">
            Classify cash movements, set cadence, then publish into the 13-week Cash Forecast.
          </DialogDescription>
        </DialogHeader>

        {!result && (
          <div className="space-y-4">
            <div
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[#b7872a]/40 bg-white/70 px-4 py-8 text-center dark:bg-slate-900/40"
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                addFiles(e.dataTransfer.files);
              }}
            >
              <Upload className="h-6 w-6 text-[#b8860b]" />
              <p className="text-sm font-medium">Drop PDF / CSV bank statements</p>
              <p className="text-[11px] text-slate-500">
                Up to {MAX_BANK_FILES} files · multiple accounts · 40 MB total
              </p>
              <input
                ref={inputRef}
                type="file"
                accept=".pdf,.csv,.txt"
                multiple
                className="hidden"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>

            {files.length > 0 && (
              <ul className="space-y-1.5">
                {files.map((f, i) => (
                  <li
                    key={`${f.name}-${i}`}
                    className="flex items-center gap-2 rounded-md border border-amber-900/10 bg-white/80 px-2.5 py-1.5 text-xs dark:border-slate-800 dark:bg-slate-900/50"
                  >
                    <FileText className="h-3.5 w-3.5 text-[#b8860b]" />
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <button
                      type="button"
                      className="text-slate-400 hover:text-rose-500"
                      onClick={() => setFiles(files.filter((_, x) => x !== i))}
                      aria-label="Remove file"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <Button
              disabled={files.length === 0 || working}
              onClick={runDraft}
              className="w-full bg-[#b8860b] text-white hover:bg-[#9a7209]"
            >
              {working ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Reading statements…
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Build preliminary cash forecast
                </>
              )}
            </Button>
          </div>
        )}

        {result && (
          <div className="space-y-4">
            {result.movements && <MovementsTrialBalancePanel movements={result.movements} />}
            <CashClassificationWorkspace
              lines={lines}
              onChange={handleLinesChange}
              startDate={startDate}
              openingBalance={openingBalance}
              onStartDateChange={setStartDate}
              onOpeningBalanceChange={setOpeningBalance}
              transactions={result.extract.transactions}
              warnings={result.warnings}
              existingCashflow={existingCashflow}
              publishing={publishing}
              onPublish={publish}
              onBack={() => {
                if (initialDraft) {
                  reset();
                  onClose();
                  return;
                }
                setResult(null);
                setLines([]);
              }}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
