/**
 * CashFromBanksDrafter — Phases 1–3 vertical slice
 * Upload bank statements → Claude txn extract → pattern draft → preview → publish to cashflow.
 */

import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Loader2,
  Upload,
  FileText,
  X,
  Sparkles,
  AlertTriangle,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { draftCashForecastFromBankStatements } from "@/lib/cash-from-banks.server";
import { buildCashflowPublishPayload } from "@/lib/cash-from-banks.publish";
import type {
  CashCadence,
  CashForecastDraftLine,
  CashForecastPublishPayload,
  CashFromBanksDraftResult,
} from "@/lib/cash-from-banks.types";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called with the cashflow JSON ready to persist on clients.cashflow */
  onPublish: (payload: CashForecastPublishPayload) => void | Promise<void>;
}

const CADENCE_LABEL: Record<CashCadence, string> = {
  once_off: "Once-off",
  weekly: "Weekly",
  monthly: "Monthly",
  annual: "Annual (→ monthly)",
  split_weeks: "Split weeks",
  split_months: "Split months",
};

function fmt(n: number): string {
  return `R ${n.toLocaleString("en-ZA", { maximumFractionDigits: 0 })}`;
}

export function CashFromBanksDrafter({ open, onClose, onPublish }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [working, setWorking] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState<CashFromBanksDraftResult | null>(null);
  const [lines, setLines] = useState<CashForecastDraftLine[]>([]);
  const [startDate, setStartDate] = useState("");
  const [openingBalance, setOpeningBalance] = useState("0");
  const doDraft = useServerFn(draftCashForecastFromBankStatements);

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
      if (next.length >= 6) {
        toast.error("Maximum 6 statement files.");
        break;
      }
      if (next.reduce((s, x) => s + x.size, 0) + f.size > 25 * 1024 * 1024) {
        toast.error("Combined files exceed 25 MB.");
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
    } catch (e) {
      toast.error(`Cash draft failed: ${(e as Error).message}`);
    } finally {
      setWorking(false);
    }
  };

  const updateLine = (id: string, patch: Partial<CashForecastDraftLine>) => {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

  const publish = async () => {
    setPublishing(true);
    try {
      const payload = buildCashflowPublishPayload({
        lines,
        startDate,
        openingBalance: parseFloat(openingBalance) || 0,
      });
      await onPublish(payload);
      reset();
    } catch (e) {
      toast.error(`Publish failed: ${(e as Error).message}`);
    } finally {
      setPublishing(false);
    }
  };

  const activeCount = lines.filter((l) => l.status !== "excluded").length;
  const excludedCount = lines.length - activeCount;

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
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto border border-amber-900/20 bg-[#fffdf8] text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-50">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold tracking-tight">
            <Wallet className="h-4 w-4 text-[#b8860b]" />
            Cash forecast from bank statements
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500">
            Claude reads your statements, groups repeating cash movements, and builds a
            preliminary 13-week forecast you can publish to the Cash Forecast tab.
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
              <p className="text-[11px] text-slate-500">Up to 6 files · 25 MB total</p>
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
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wider text-slate-500">
                  Forecast start
                </Label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wider text-slate-500">
                  Opening bank balance
                </Label>
                <Input
                  type="number"
                  value={openingBalance}
                  onChange={(e) => setOpeningBalance(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <div className="rounded-lg border border-amber-900/10 bg-white/70 px-3 py-2 text-[11px] dark:border-slate-800 dark:bg-slate-900/40">
                <div className="text-slate-500">Detected</div>
                <div className="mt-0.5 font-semibold">
                  {result.extract.transactions.length} txns · {activeCount} lines · {excludedCount}{" "}
                  excluded
                </div>
                {result.extract.period_start && result.extract.period_end && (
                  <div className="mt-0.5 text-slate-500">
                    {result.extract.period_start} → {result.extract.period_end}
                  </div>
                )}
              </div>
            </div>

            {result.warnings.length > 0 && (
              <div className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-50/80 p-2.5 text-[11px] text-amber-900 dark:bg-amber-500/10 dark:text-amber-100">
                {result.warnings.map((w, i) => (
                  <div key={i} className="flex gap-1.5">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="overflow-hidden rounded-xl border border-amber-900/15 dark:border-slate-800">
              <div className="grid grid-cols-[1fr_90px_120px_88px] gap-2 border-b border-amber-900/10 bg-amber-50/50 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-900/60">
                <span>Line</span>
                <span>Side</span>
                <span>Cadence</span>
                <span className="text-right">Amount</span>
              </div>
              <div className="max-h-[42vh] divide-y divide-amber-900/10 overflow-y-auto dark:divide-slate-800">
                {lines.map((line) => (
                  <div
                    key={line.id}
                    className={`grid grid-cols-[1fr_90px_120px_88px] items-center gap-2 px-2.5 py-2 text-xs ${
                      line.status === "excluded" ? "opacity-45" : ""
                    }`}
                  >
                    <div className="min-w-0">
                      <Input
                        value={line.name}
                        onChange={(e) => updateLine(line.id, { name: e.target.value })}
                        className="h-7 text-xs"
                      />
                      <div className="mt-0.5 truncate text-[10px] text-slate-500">
                        {line.bucket} · {line.txn_count} txn
                        {line.txn_count === 1 ? "" : "s"} ·{" "}
                        {Math.round(line.confidence * 100)}% conf
                      </div>
                    </div>
                    <Select
                      value={line.side}
                      onValueChange={(v) =>
                        updateLine(line.id, { side: v as "inflow" | "outflow" })
                      }
                    >
                      <SelectTrigger className="h-7 text-[11px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="inflow">In</SelectItem>
                        <SelectItem value="outflow">Out</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select
                      value={line.cadence}
                      onValueChange={(v) =>
                        updateLine(line.id, { cadence: v as CashCadence })
                      }
                    >
                      <SelectTrigger className="h-7 text-[11px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(CADENCE_LABEL) as CashCadence[]).map((c) => (
                          <SelectItem key={c} value={c}>
                            {CADENCE_LABEL[c]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="space-y-1">
                      <Input
                        type="number"
                        value={line.amount}
                        onChange={(e) =>
                          updateLine(line.id, { amount: parseFloat(e.target.value) || 0 })
                        }
                        className="h-7 text-right text-xs"
                      />
                      <button
                        type="button"
                        className="w-full text-[10px] text-slate-500 underline-offset-2 hover:underline"
                        onClick={() =>
                          updateLine(line.id, {
                            status: line.status === "excluded" ? "proposed" : "excluded",
                          })
                        }
                      >
                        {line.status === "excluded" ? "Include" : "Exclude"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setResult(null);
                  setLines([]);
                }}
              >
                Back
              </Button>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-500">
                  Active inflows{" "}
                  {fmt(
                    lines
                      .filter((l) => l.status !== "excluded" && l.side === "inflow")
                      .reduce((s, l) => s + l.amount, 0),
                  )}
                </span>
                <Button
                  disabled={publishing || activeCount === 0}
                  onClick={publish}
                  className="bg-[#b8860b] text-white hover:bg-[#9a7209]"
                >
                  {publishing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Publishing…
                    </>
                  ) : (
                    "Publish to Cash Forecast"
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
