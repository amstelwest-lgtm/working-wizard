import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useFinancialInputs } from "@/contexts/financial-inputs";
import {
  PRODUCT_MIX_MAX_LINES,
  PRODUCT_MIX_VERSION,
  allocatedRevenue,
  applyUnitEconomics,
  canAdvanceFromCosts,
  canAdvanceFromNames,
  canAdvanceFromPrices,
  canAdvanceFromRevenue,
  canSaveUnitMix,
  declinedProductMix,
  emptyProductMix,
  formatMarginPct,
  formatRand,
  hasProductMixAnswer,
  linesFromNames,
  namedProductLines,
  productMixSummary,
  rankProductLines,
  shareContrastLabel,
  unitMarginPct,
  type ProductMix,
} from "@/lib/product-mix";

const TOTAL = 5;

const TITLES = [
  "Do you sell more than one product or service that matters?",
  "Name the lines that matter",
  "Selling price per unit",
  "Direct cost per unit",
  "Of total revenue, how much is from each line",
];

function choiceClass(on: boolean) {
  return on
    ? "w-full rounded-xl border-2 border-[#d4a550] bg-[#d4a550]/25 p-3 text-left text-[#f3e6c4] shadow-[inset_0_0_0_1px_rgba(212,165,80,0.55)]"
    : "w-full rounded-xl border border-slate-600 bg-slate-900/80 p-3 text-left text-slate-200 transition hover:border-[#d4a550]/70 hover:bg-[#d4a550]/10";
}

function MoneyField({
  value,
  onChange,
  placeholder,
}: {
  value: number | undefined;
  onChange: (n: number | undefined) => void;
  placeholder: string;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
        R
      </span>
      <input
        type="number"
        min={0}
        step="0.01"
        value={value == null ? "" : value}
        placeholder={placeholder}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") {
            onChange(undefined);
            return;
          }
          const n = parseFloat(raw);
          onChange(Number.isFinite(n) && n >= 0 ? n : undefined);
        }}
        className="w-full rounded-lg border border-slate-600 bg-slate-900/80 py-2 pl-7 pr-3 text-sm text-slate-100 placeholder:text-slate-600 focus:border-[#d4a550] focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
    </div>
  );
}

function barWidth(pct: number | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return "0%";
  return `${Math.max(0, Math.min(100, pct))}%`;
}

function ProductMixFunnel({
  open,
  onOpenChange,
  initial,
  onSave,
  totalRevenue,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: ProductMix;
  onSave: (mix: ProductMix) => void;
  totalRevenue: number;
}) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<ProductMix>(emptyProductMix);
  const [nameSlots, setNameSlots] = useState<string[]>(() => Array(PRODUCT_MIX_MAX_LINES).fill(""));
  const [q1, setQ1] = useState<"yes" | "no" | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setQ1(null);
    setDraft(initial.active ? initial : emptyProductMix());
    const slots = Array(PRODUCT_MIX_MAX_LINES).fill("") as string[];
    initial.lines.forEach((l, i) => {
      if (i < PRODUCT_MIX_MAX_LINES) slots[i] = l.name;
    });
    setNameSlots(slots);
    // Reset only when the dialog opens — not when parent mix identity changes mid-funnel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const named = namedProductLines(draft);
  const statedTotal = totalRevenue > 0 ? totalRevenue : 0;
  const q5Preview = useMemo(
    () => applyUnitEconomics(draft, statedTotal),
    [draft, statedTotal],
  );
  const allocated = allocatedRevenue(draft.lines);
  const leftover = statedTotal > 0 ? statedTotal - allocated : 0;

  const goNext = () => setStep((s) => Math.min(TOTAL - 1, s + 1));
  const goBack = () => setStep((s) => Math.max(0, s - 1));

  const patchLine = (id: string, patch: Partial<ProductMix["lines"][number]>) => {
    setDraft((prev) => ({
      ...prev,
      lines: prev.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    }));
  };

  const commitNames = () => {
    if (!canAdvanceFromNames(nameSlots)) return;
    const lines = linesFromNames(nameSlots, draft.lines);
    setDraft((prev) => ({
      ...prev,
      active: true,
      lines,
    }));
    goNext();
  };

  const finish = () => {
    if (!canSaveUnitMix(draft)) return;
    onSave(
      applyUnitEconomics(
        {
          ...draft,
          version: PRODUCT_MIX_VERSION,
          active: true,
          confirmedAt: new Date().toISOString(),
        },
        statedTotal,
      ),
    );
    onOpenChange(false);
  };

  const q5Hint =
    statedTotal > 0
      ? `Total revenue on this Profit tab is ${formatRand(statedTotal)}. One question — fill in the rand from each line you named.`
      : "Total revenue is not on this Profit tab yet. Enter the rand from each named line — shares will be of the amounts you allocate.";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg border-slate-800 bg-slate-950 text-slate-200">
        <DialogHeader>
          <DialogTitle className="text-slate-100">Product lines</DialogTitle>
          <DialogDescription className="text-slate-500">
            Question {step + 1} of {TOTAL} · optional — skip anytime
          </DialogDescription>
        </DialogHeader>

        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#d4a550]">
            Profitability · unit economics
          </p>
          <h3 className="mt-1 text-lg font-semibold text-slate-100">{TITLES[step]}</h3>
          <p className="mt-1 text-sm text-slate-400">
            {step === 0 && "If one line covers the book, we skip this — the Profit tab stays simple."}
            {step === 1 && "Up to 5. Skip the long tail — just what you'd discuss in a review."}
            {step === 2 && "What a customer pays for one unit of this line. Rand, typical selling price."}
            {step === 3 && "What it costs you to deliver one unit. Margin is calculated from price minus this."}
            {step === 4 && q5Hint}
          </p>
        </div>

        <div className="space-y-2">
          {step === 0 && (
            <>
              <button type="button" className={choiceClass(q1 === "yes")} onClick={() => setQ1("yes")}>
                <div className="text-sm font-semibold">Yes — a few lines matter</div>
                <div className="mt-1 text-[11px] text-slate-400">
                  We will take selling price, cost, and rand of total revenue for each
                </div>
                {q1 === "yes" && (
                  <div className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-[#d4a550]">
                    Selected
                  </div>
                )}
              </button>
              <button type="button" className={choiceClass(q1 === "no")} onClick={() => setQ1("no")}>
                <div className="text-sm font-semibold">No — one main line covers it</div>
                <div className="mt-1 text-[11px] text-slate-400">
                  We will leave the Profit tab as it is. You can add this later.
                </div>
                {q1 === "no" && (
                  <div className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-[#d4a550]">
                    Selected
                  </div>
                )}
              </button>
            </>
          )}

          {step === 1 &&
            nameSlots.map((value, i) => (
              <input
                key={i}
                value={value}
                onChange={(e) =>
                  setNameSlots((prev) => {
                    const next = [...prev];
                    next[i] = e.target.value;
                    return next;
                  })
                }
                placeholder={i === 0 ? "e.g. Retail shop" : i === 1 ? "e.g. Wholesale" : `Line ${i + 1} (optional)`}
                className="w-full rounded-lg border border-slate-600 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-[#d4a550] focus:outline-none"
              />
            ))}

          {step === 2 &&
            named.map((line) => (
              <div key={line.id} className="rounded-xl border border-slate-700 bg-slate-900/60 p-3">
                <div className="mb-2 text-sm font-semibold text-slate-100">{line.name}</div>
                <MoneyField
                  value={line.sellPrice}
                  placeholder="0.00"
                  onChange={(n) => patchLine(line.id, { sellPrice: n })}
                />
              </div>
            ))}

          {step === 3 &&
            named.map((line) => {
              const pct = unitMarginPct(line.sellPrice, line.unitCost);
              return (
                <div key={line.id} className="rounded-xl border border-slate-700 bg-slate-900/60 p-3">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-slate-100">{line.name}</div>
                    <div className="text-[11px] text-slate-500">Sells {formatRand(line.sellPrice)}</div>
                  </div>
                  <MoneyField
                    value={line.unitCost}
                    placeholder="0.00"
                    onChange={(n) => patchLine(line.id, { unitCost: n })}
                  />
                  <div
                    className={`mt-2 text-xs font-semibold ${
                      pct == null ? "text-slate-500" : pct >= 40 ? "text-emerald-400" : pct >= 20 ? "text-[#d4a550]" : "text-red-400"
                    }`}
                  >
                    Margin {formatMarginPct(pct)}
                    {pct != null && line.sellPrice != null && line.unitCost != null
                      ? ` · ${formatRand(line.sellPrice - line.unitCost)} a unit`
                      : ""}
                  </div>
                </div>
              );
            })}

          {step === 4 && (
            <>
              {named.map((line) => {
                const preview = q5Preview.lines.find((l) => l.id === line.id);
                const contrast = shareContrastLabel(preview?.revenueSharePct, preview?.gpSharePct);
                const totalLabel = statedTotal > 0 ? formatRand(statedTotal) : "total revenue";
                return (
                  <div key={line.id} className="rounded-xl border border-slate-700 bg-slate-900/60 p-3">
                    <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-slate-200">
                      <span className="text-slate-400">______ of</span>
                      <span className="font-semibold text-slate-100">{totalLabel}</span>
                      <span className="text-slate-400">is from</span>
                      <span className="font-semibold text-slate-100">&quot;{line.name}&quot;</span>
                    </div>
                    <MoneyField
                      value={line.revenueAmount}
                      placeholder="0"
                      onChange={(n) => patchLine(line.id, { revenueAmount: n })}
                    />
                    {contrast ? (
                      <div className="mt-2 text-xs font-semibold text-[#d4a550]">{contrast}</div>
                    ) : (
                      <div className="mt-2 text-[11px] text-slate-500">
                        Sales share and GP share appear once this amount is in.
                      </div>
                    )}
                  </div>
                );
              })}
              <div className="rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-2 text-[11px] text-slate-400">
                {statedTotal > 0 ? (
                  leftover >= 0 ? (
                    <>
                      Allocated {formatRand(allocated)} of {formatRand(statedTotal)}
                      {leftover > 0
                        ? ` · ${formatRand(leftover)} unallocated (other — no GP share)`
                        : " · fully allocated"}
                    </>
                  ) : (
                    <>
                      Allocated {formatRand(allocated)} of {formatRand(statedTotal)} · over by{" "}
                      {formatRand(-leftover)}
                    </>
                  )
                ) : (
                  <>Allocated {formatRand(allocated)} across named lines</>
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-slate-800 pt-3">
          {step > 0 ? (
            <Button variant="ghost" size="sm" className="text-slate-300" onClick={goBack}>
              Back
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="text-slate-400"
              onClick={() => onOpenChange(false)}
            >
              Not now
            </Button>
          )}
          <div className="ml-auto flex items-center gap-3">
            <div className="flex gap-1">
              {Array.from({ length: TOTAL }).map((_, i) => (
                <span
                  key={i}
                  className={`h-1.5 w-1.5 rounded-full ${i <= step ? "bg-[#d4a550]" : "bg-slate-700"}`}
                />
              ))}
            </div>
            {step === 0 && (
              <Button
                size="sm"
                disabled={!q1}
                className="bg-[#d4a550] text-[#0a0e1a] hover:bg-[#c49a45]"
                onClick={() => {
                  if (q1 === "no") {
                    onSave(declinedProductMix());
                    onOpenChange(false);
                    return;
                  }
                  goNext();
                }}
              >
                Continue
              </Button>
            )}
            {step === 1 && (
              <Button
                size="sm"
                disabled={!canAdvanceFromNames(nameSlots)}
                className="bg-[#d4a550] text-[#0a0e1a] hover:bg-[#c49a45]"
                onClick={commitNames}
              >
                Continue
              </Button>
            )}
            {step === 2 && (
              <Button
                size="sm"
                disabled={!canAdvanceFromPrices(draft.lines)}
                className="bg-[#d4a550] text-[#0a0e1a] hover:bg-[#c49a45]"
                onClick={goNext}
              >
                Continue
              </Button>
            )}
            {step === 3 && (
              <Button
                size="sm"
                disabled={!canAdvanceFromCosts(draft.lines)}
                className="bg-[#d4a550] text-[#0a0e1a] hover:bg-[#c49a45]"
                onClick={goNext}
              >
                Continue
              </Button>
            )}
            {step === 4 && (
              <Button
                size="sm"
                disabled={!canAdvanceFromRevenue(draft.lines) || !canSaveUnitMix(draft)}
                className="bg-[#d4a550] text-[#0a0e1a] hover:bg-[#c49a45]"
                onClick={finish}
              >
                Save breakdown
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MixBars({ mix }: { mix: ProductMix }) {
  const ranked = rankProductLines(mix);
  if (!ranked.length) return null;
  const stated = mix.totalRevenue ?? 0;
  const allocated = allocatedRevenue(mix.lines);
  const leftover = stated > 0 ? stated - allocated : 0;
  return (
    <div className="space-y-3">
      {ranked.map((row) => {
        const tone = row.isBest ? "#4caf82" : row.isWorst ? "#e05c5c" : "#d4a550";
        const contrast = shareContrastLabel(row.revenueSharePct, row.gpSharePct);
        return (
          <div key={row.id}>
            <div className="mb-1 flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-xs font-semibold text-slate-200">{row.name}</span>
                {row.isBest && (
                  <span
                    className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
                    style={{ color: "#4caf82", background: "rgba(76,175,130,0.15)" }}
                  >
                    Most of GP
                  </span>
                )}
                {row.isWorst && (
                  <span
                    className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
                    style={{ color: "#e05c5c", background: "rgba(224,92,92,0.15)" }}
                  >
                    Least of GP
                  </span>
                )}
              </div>
              <span className="shrink-0 text-xs font-semibold" style={{ color: tone }}>
                {contrast || formatMarginPct(row.marginPct)}
              </span>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="w-10 shrink-0 text-[9px] uppercase tracking-wider text-slate-500">Sales</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-[#d4a550]"
                    style={{ width: barWidth(row.revenueSharePct) }}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-10 shrink-0 text-[9px] uppercase tracking-wider text-slate-500">GP</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
                  <div className="h-full rounded-full" style={{ width: barWidth(row.gpSharePct), background: tone }} />
                </div>
              </div>
            </div>
            <div className="mt-1 text-[10px] text-slate-500">
              {formatRand(row.revenueAmount)}
              {stated > 0 ? ` of ${formatRand(stated)}` : ""}
              {" · "}
              {formatRand(row.sellPrice)} sell · {formatRand(row.unitCost)} cost · {formatMarginPct(row.marginPct)}{" "}
              margin
            </div>
          </div>
        );
      })}
      {stated > 0 && leftover > 0 && (
        <p className="text-[10px] text-slate-500">
          {formatRand(leftover)} of {formatRand(stated)} unallocated — other (no GP share)
        </p>
      )}
    </div>
  );
}

export function ProductMixPanel({ totalRevenue = 0 }: { totalRevenue?: number }) {
  const { productMix, saveProductMix } = useFinancialInputs();
  const [open, setOpen] = useState(false);
  const [funnelOpen, setFunnelOpen] = useState(false);
  const answered = hasProductMixAnswer(productMix);
  const summary = useMemo(() => productMixSummary(productMix), [productMix]);

  return (
    <>
      <Card className="border border-slate-800 bg-slate-900/60 shadow-sm print:hidden">
        <CardHeader
          className="cursor-pointer select-none border-b border-slate-800 pb-3"
          onClick={() => setOpen((o) => !o)}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="text-sm font-semibold text-slate-100">Product lines</CardTitle>
              <CardDescription className="mt-0.5 text-xs text-slate-400">{summary}</CardDescription>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {!answered ? (
                <Button
                  size="sm"
                  className="h-7 bg-[#d4a550] px-2.5 text-[11px] text-[#0a0e1a] hover:bg-[#c49a45]"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFunnelOpen(true);
                  }}
                >
                  5 questions
                </Button>
              ) : (
                <button
                  type="button"
                  className="mr-1 text-[11px] font-medium text-[#d4a550] hover:underline"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFunnelOpen(true);
                  }}
                >
                  Update
                </button>
              )}
              <span className="p-1 text-[#d4a550]">
                {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </span>
            </div>
          </div>
        </CardHeader>

        {open && (
          <CardContent className="pb-3 pt-4">
            {!answered && (
              <div className="flex flex-col items-start gap-2">
                <p className="text-xs text-slate-400">
                  Optional. Of the stated total revenue, how much is from each line — then sales
                  share vs GP share. Does not change the waterfall.
                </p>
                <Button
                  size="sm"
                  className="bg-[#d4a550] text-[#0a0e1a] hover:bg-[#c49a45]"
                  onClick={() => setFunnelOpen(true)}
                >
                  Break down by product line
                </Button>
              </div>
            )}
            {answered && !productMix.active && (
              <p className="text-xs text-slate-400">
                Marked as a single-line business. Update the breakdown if that changes.
              </p>
            )}
            {answered && productMix.active && (
              <>
                <MixBars mix={productMix} />
                <p className="mt-3 text-[10px] text-slate-500">
                  Sales share is rand of stated total revenue. GP share uses that amount × unit
                  margin. A high-margin line can be a small slice of sales and most of the profit.
                  Does not change the waterfall figures.
                </p>
              </>
            )}
          </CardContent>
        )}
      </Card>

      <ProductMixFunnel
        open={funnelOpen}
        onOpenChange={setFunnelOpen}
        initial={productMix}
        onSave={saveProductMix}
        totalRevenue={totalRevenue}
      />
    </>
  );
}
