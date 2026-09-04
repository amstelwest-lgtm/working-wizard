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
  SHARE_BANDS,
  applyUnitEconomics,
  canAdvanceFromCosts,
  canAdvanceFromNames,
  canAdvanceFromPrices,
  canAdvanceFromShares,
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
  shareBandLabel,
  unitMarginPct,
  type ProductMix,
} from "@/lib/product-mix";

const TOTAL = 5;

const TITLES = [
  "Do you sell more than one product or service that matters?",
  "Name the lines that matter",
  "Selling price per unit",
  "Direct cost per unit",
  "Rough share of sales for each",
];

const HINTS = [
  "If one line covers the book, we skip this — the Profit tab stays simple.",
  "Up to 5. Skip the long tail — just what you'd discuss in a review.",
  "What a customer pays for one unit of this line. Rand, typical selling price.",
  "What it costs you to deliver one unit. Margin is calculated from price minus this.",
  "Bands, not a spreadsheet. Ranking uses the unit margins you just entered.",
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

function ProductMixFunnel({
  open,
  onOpenChange,
  initial,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: ProductMix;
  onSave: (mix: ProductMix) => void;
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
      applyUnitEconomics({
        ...draft,
        version: 2,
        active: true,
        confirmedAt: new Date().toISOString(),
      }),
    );
    onOpenChange(false);
  };

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
          <p className="mt-1 text-sm text-slate-400">{HINTS[step]}</p>
        </div>

        <div className="space-y-2">
          {step === 0 && (
            <>
              <button type="button" className={choiceClass(q1 === "yes")} onClick={() => setQ1("yes")}>
                <div className="text-sm font-semibold">Yes — a few lines matter</div>
                <div className="mt-1 text-[11px] text-slate-400">
                  We will take selling price and cost per unit for each
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

          {step === 4 &&
            named.map((line) => {
              const pct = unitMarginPct(line.sellPrice, line.unitCost);
              return (
                <div key={line.id} className="rounded-xl border border-slate-700 bg-slate-900/60 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-slate-100">{line.name}</div>
                    <div className="text-[11px] font-semibold text-[#d4a550]">{formatMarginPct(pct)} margin</div>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {SHARE_BANDS.map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        className={`${choiceClass(line.shareBand === b.id)} p-2`}
                        onClick={() => patchLine(line.id, { shareBand: b.id })}
                      >
                        <div className="text-xs font-semibold">{b.label}</div>
                        <div className="text-[10px] text-slate-400">{b.hint}</div>
                        {line.shareBand === b.id && (
                          <div className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-[#d4a550]">
                            Selected
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
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
                disabled={!canSaveUnitMix(draft)}
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
  return (
    <div className="space-y-3">
      {ranked.map((row) => {
        const tone = row.isBest ? "#4caf82" : row.isWorst ? "#e05c5c" : "#d4a550";
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
                    Best margin
                  </span>
                )}
                {row.isWorst && (
                  <span
                    className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
                    style={{ color: "#e05c5c", background: "rgba(224,92,92,0.15)" }}
                  >
                    Weakest
                  </span>
                )}
              </div>
              <span className="shrink-0 text-xs font-semibold" style={{ color: tone }}>
                {formatMarginPct(row.marginPct)}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full"
                style={{ width: `${row.barPct}%`, background: tone }}
              />
            </div>
            <div className="mt-1 text-[10px] text-slate-500">
              {formatRand(row.sellPrice)} sell · {formatRand(row.unitCost)} cost
              {row.shareBand ? ` · ${shareBandLabel(row.shareBand)} of sales` : ""}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ProductMixPanel() {
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
                  Optional. Selling price and cost per unit — margin is calculated. Does not change
                  the waterfall.
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
                  Margin = (selling price − unit cost) ÷ selling price. Does not change the waterfall
                  figures.
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
      />
    </>
  );
}
