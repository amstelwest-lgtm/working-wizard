/**
 * CashClassificationWorkspace — Phase 4 accountant classification surface.
 * Drag lines between buckets, merge/split, edit cadence, publish with policy.
 */

import { useMemo, useState } from "react";
import { AlertTriangle, Check, Combine, GripVertical, Scissors, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  CashBucket,
  CashCadence,
  CashForecastDraftLine,
  CashStatementTransaction,
} from "@/lib/cash-from-banks.types";
import {
  BUCKET_LANES,
  confirmAllProposed,
  mergeDraftLines,
  moveLineToBucket,
  reorderDraftLine,
  splitDraftLine,
} from "@/lib/cash-from-banks.workspace";
import {
  existingCashflowIsMeaningful,
  type ExistingCashflow,
  type PublishPolicy,
} from "@/lib/cash-from-banks.publish";
import { useMarketFormat } from "@/contexts/market";

const CADENCE_LABEL: Record<CashCadence, string> = {
  once_off: "Once-off",
  weekly: "Weekly",
  monthly: "Monthly",
  annual: "Annual → monthly",
  split_weeks: "Split weeks",
  split_months: "Split months",
};

export type WorkspacePublishRequest = {
  lines: CashForecastDraftLine[];
  startDate: string;
  openingBalance: number;
  policy: PublishPolicy;
  adoptBankBalances: boolean;
};

type Props = {
  lines: CashForecastDraftLine[];
  onChange: (lines: CashForecastDraftLine[]) => void;
  startDate: string;
  openingBalance: string;
  onStartDateChange: (v: string) => void;
  onOpeningBalanceChange: (v: string) => void;
  transactions?: CashStatementTransaction[];
  warnings?: string[];
  existingCashflow?: ExistingCashflow | null;
  publishing?: boolean;
  onPublish: (req: WorkspacePublishRequest) => void | Promise<void>;
  onBack?: () => void;
};

export function CashClassificationWorkspace({
  lines,
  onChange,
  startDate,
  openingBalance,
  onStartDateChange,
  onOpeningBalanceChange,
  transactions = [],
  warnings = [],
  existingCashflow = null,
  publishing = false,
  onPublish,
  onBack,
}: Props) {
  const { money: fmt } = useMarketFormat();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dragId, setDragId] = useState<string | null>(null);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [policy, setPolicy] = useState<PublishPolicy>("replace");
  const [adoptBalances, setAdoptBalances] = useState(true);
  const [filter, setFilter] = useState<"all" | "proposed" | "confirmed" | "excluded">("all");

  const needsPolicy = existingCashflowIsMeaningful(existingCashflow);

  const visible = useMemo(() => {
    if (filter === "all") return lines;
    return lines.filter((l) => l.status === filter);
  }, [lines, filter]);

  const byBucket = useMemo(() => {
    const map = new Map<CashBucket, CashForecastDraftLine[]>();
    for (const lane of BUCKET_LANES) map.set(lane.bucket, []);
    for (const line of visible) {
      const list = map.get(line.bucket) ?? [];
      list.push(line);
      map.set(line.bucket, list);
    }
    return map;
  }, [visible]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const updateLine = (id: string, patch: Partial<CashForecastDraftLine>) => {
    onChange(
      lines.map((l) =>
        l.id === id ? { ...l, ...patch, source: l.source === "ai" ? "manual" : l.source } : l,
      ),
    );
  };

  const requestPublish = () => {
    if (needsPolicy) {
      setPolicyOpen(true);
      return;
    }
    void doPublish("replace");
  };

  const doPublish = async (p: PublishPolicy) => {
    setPolicyOpen(false);
    await onPublish({
      lines,
      startDate,
      openingBalance: parseFloat(openingBalance) || 0,
      policy: p,
      adoptBankBalances: adoptBalances,
    });
  };

  const activeCount = lines.filter((l) => l.status !== "excluded").length;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wider text-slate-500">
            Forecast start
          </Label>
          <Input
            type="date"
            value={startDate}
            onChange={(e) => onStartDateChange(e.target.value)}
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wider text-slate-500">
            Opening balance
          </Label>
          <Input
            type="number"
            value={openingBalance}
            onChange={(e) => onOpeningBalanceChange(e.target.value)}
            className="h-8 text-xs"
          />
        </div>
        <div className="rounded-lg border border-amber-900/10 bg-white/70 px-3 py-2 text-[11px] dark:border-slate-800 dark:bg-slate-900/40 sm:col-span-2">
          <div className="font-semibold text-slate-800 dark:text-slate-100">
            {activeCount} active lines · {lines.length - activeCount} excluded ·{" "}
            {transactions.length} source txns
          </div>
          <div className="mt-0.5 text-slate-500">
            Drag lines between buckets. Merge similar rows. Split lumps the AI over-grouped.
          </div>
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-50/80 p-2.5 text-[11px] text-amber-900 dark:bg-amber-500/10 dark:text-amber-100">
          {warnings.map((w, i) => (
            <div key={i} className="flex gap-1.5">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-amber-900/15 p-0.5 text-[11px] dark:border-slate-700">
          {(["all", "proposed", "confirmed", "excluded"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded px-2 py-1 capitalize ${filter === f ? "bg-[#b8860b]/15 font-semibold text-[#8a651b]" : "text-slate-500"}`}
            >
              {f}
            </button>
          ))}
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={selected.size < 2}
          onClick={() => {
            onChange(mergeDraftLines(lines, [...selected]));
            setSelected(new Set());
          }}
        >
          <Combine className="mr-1.5 h-3.5 w-3.5" />
          Merge ({selected.size})
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={selected.size !== 1}
          onClick={() => {
            const id = [...selected][0];
            if (!id) return;
            onChange(splitDraftLine(lines, id));
            setSelected(new Set());
          }}
        >
          <Scissors className="mr-1.5 h-3.5 w-3.5" />
          Split
        </Button>
        <Button size="sm" variant="outline" onClick={() => onChange(confirmAllProposed(lines))}>
          <Check className="mr-1.5 h-3.5 w-3.5" />
          Confirm all proposed
        </Button>
      </div>

      <div className="grid max-h-[52vh] gap-2 overflow-y-auto pr-1 lg:grid-cols-2">
        {BUCKET_LANES.map((lane) => {
          const laneLines = byBucket.get(lane.bucket) ?? [];
          if (filter !== "all" && laneLines.length === 0) return null;
          return (
            <div
              key={lane.bucket}
              className="rounded-xl border border-amber-900/15 bg-white/60 dark:border-slate-800 dark:bg-slate-900/40"
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData("text/line-id") || dragId;
                if (!id) return;
                onChange(moveLineToBucket(lines, id, lane.bucket));
                setDragId(null);
              }}
            >
              <div className="flex items-center justify-between border-b border-amber-900/10 px-2.5 py-1.5 dark:border-slate-800">
                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-600 dark:text-slate-300">
                  {lane.label}
                </span>
                <span className="text-[10px] tabular-nums text-slate-400">{laneLines.length}</span>
              </div>
              <div className="min-h-[44px] space-y-1.5 p-2">
                {laneLines.length === 0 && (
                  <div className="rounded-md border border-dashed border-slate-200 px-2 py-3 text-center text-[10px] text-slate-400 dark:border-slate-700">
                    Drop lines here
                  </div>
                )}
                {laneLines.map((line) => (
                  <div
                    key={line.id}
                    draggable
                    onDragStart={(e) => {
                      setDragId(line.id);
                      e.dataTransfer.setData("text/line-id", line.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const from = e.dataTransfer.getData("text/line-id") || dragId;
                      if (!from) return;
                      if (from === line.id) return;
                      // Same bucket → reorder; different handled by lane drop
                      const fromLine = lines.find((l) => l.id === from);
                      if (fromLine && fromLine.bucket === line.bucket) {
                        onChange(reorderDraftLine(lines, from, line.id));
                      } else if (from) {
                        onChange(moveLineToBucket(lines, from, lane.bucket));
                      }
                      setDragId(null);
                    }}
                    className={`rounded-lg border bg-white p-2 shadow-sm dark:bg-slate-950/60 ${
                      line.status === "excluded"
                        ? "border-slate-200 opacity-50 dark:border-slate-700"
                        : selected.has(line.id)
                          ? "border-[#b8860b] ring-1 ring-[#b8860b]/40"
                          : "border-amber-900/10 dark:border-slate-800"
                    }`}
                  >
                    <div className="flex items-start gap-1.5">
                      <button
                        type="button"
                        className="mt-1 cursor-grab text-slate-400 active:cursor-grabbing"
                        aria-label="Drag line"
                      >
                        <GripVertical className="h-3.5 w-3.5" />
                      </button>
                      <input
                        type="checkbox"
                        checked={selected.has(line.id)}
                        onChange={() => toggleSelect(line.id)}
                        className="mt-1.5"
                        aria-label="Select line"
                      />
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <Input
                          value={line.name}
                          onChange={(e) => updateLine(line.id, { name: e.target.value })}
                          className="h-7 text-xs"
                        />
                        <div className="grid grid-cols-3 gap-1.5">
                          <Select
                            value={line.side}
                            onValueChange={(v) =>
                              updateLine(line.id, { side: v as "inflow" | "outflow" })
                            }
                          >
                            <SelectTrigger className="h-7 text-[10px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="inflow">Inflow</SelectItem>
                              <SelectItem value="outflow">Outflow</SelectItem>
                            </SelectContent>
                          </Select>
                          <Select
                            value={line.cadence}
                            onValueChange={(v) =>
                              updateLine(line.id, { cadence: v as CashCadence })
                            }
                          >
                            <SelectTrigger className="h-7 text-[10px]">
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
                          <Input
                            type="number"
                            value={line.amount}
                            onChange={(e) =>
                              updateLine(line.id, { amount: parseFloat(e.target.value) || 0 })
                            }
                            className="h-7 text-right text-xs"
                          />
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
                          <label className="flex items-center gap-1">
                            Wk
                            <Input
                              type="number"
                              min={1}
                              max={13}
                              value={line.start_week}
                              onChange={(e) =>
                                updateLine(line.id, {
                                  start_week: Math.max(
                                    1,
                                    Math.min(13, parseInt(e.target.value, 10) || 1),
                                  ),
                                })
                              }
                              className="h-6 w-12 text-[10px]"
                            />
                          </label>
                          {(line.cadence === "split_weeks" || line.cadence === "split_months") && (
                            <label className="flex items-center gap-1">
                              Split
                              <Input
                                type="number"
                                min={1}
                                max={13}
                                value={line.split_count}
                                onChange={(e) =>
                                  updateLine(line.id, {
                                    split_count: Math.max(1, parseInt(e.target.value, 10) || 3),
                                  })
                                }
                                className="h-6 w-12 text-[10px]"
                              />
                            </label>
                          )}
                          <span>
                            {line.txn_count} txn{line.txn_count === 1 ? "" : "s"} ·{" "}
                            {Math.round(line.confidence * 100)}% · {line.source}
                          </span>
                          <button
                            type="button"
                            className="ml-auto inline-flex items-center gap-0.5 text-slate-500 hover:text-rose-600"
                            onClick={() =>
                              updateLine(line.id, {
                                status: line.status === "excluded" ? "confirmed" : "excluded",
                              })
                            }
                          >
                            <Trash2 className="h-3 w-3" />
                            {line.status === "excluded" ? "Restore" : "Exclude"}
                          </button>
                          {line.status === "proposed" && (
                            <button
                              type="button"
                              className="text-[#8a651b] hover:underline"
                              onClick={() => updateLine(line.id, { status: "confirmed" })}
                            >
                              Confirm
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {policyOpen && (
        <div className="rounded-xl border border-[#b7872a]/40 bg-[#fff8e8] p-3 dark:bg-[#1a1510]">
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            This client already has a cash forecast
          </div>
          <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-400">
            Choose how to apply the classified bank lines.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setPolicy("replace")}
              className={`rounded-lg border p-3 text-left text-xs ${
                policy === "replace"
                  ? "border-[#b8860b] bg-[#b8860b]/10"
                  : "border-amber-900/15 dark:border-slate-700"
              }`}
            >
              <div className="font-semibold">Replace</div>
              <div className="mt-0.5 text-slate-500">
                Overwrite money-in / money-out lines with this draft.
              </div>
            </button>
            <button
              type="button"
              onClick={() => setPolicy("merge")}
              className={`rounded-lg border p-3 text-left text-xs ${
                policy === "merge"
                  ? "border-[#b8860b] bg-[#b8860b]/10"
                  : "border-amber-900/15 dark:border-slate-700"
              }`}
            >
              <div className="font-semibold">Merge</div>
              <div className="mt-0.5 text-slate-500">
                Keep existing lines and append these bank-seeded ones.
              </div>
            </button>
          </div>
          <label className="mt-3 flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={adoptBalances}
              onChange={(e) => setAdoptBalances(e.target.checked)}
            />
            Also update opening balance &amp; start date from the bank draft
          </label>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setPolicyOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-[#b8860b] text-white hover:bg-[#9a7209]"
              disabled={publishing}
              onClick={() => void doPublish(policy)}
            >
              {publishing
                ? "Publishing…"
                : policy === "merge"
                  ? "Merge & publish"
                  : "Replace & publish"}
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        {onBack ? (
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-slate-500">
            In{" "}
            {fmt(
              lines
                .filter((l) => l.status !== "excluded" && l.side === "inflow")
                .reduce((s, l) => s + l.amount, 0),
            )}
            {" · "}
            Out{" "}
            {fmt(
              lines
                .filter((l) => l.status !== "excluded" && l.side === "outflow")
                .reduce((s, l) => s + l.amount, 0),
            )}
          </span>
          <Button
            disabled={publishing || activeCount === 0 || policyOpen}
            onClick={requestPublish}
            className="bg-[#b8860b] text-white hover:bg-[#9a7209]"
          >
            {publishing ? "Publishing…" : "Publish to Cash Forecast"}
          </Button>
        </div>
      </div>
    </div>
  );
}
