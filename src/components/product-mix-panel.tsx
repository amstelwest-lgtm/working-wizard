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
  applyMarginFlags,
  canAdvanceFromNames,
  canAdvanceFromShares,
  canSaveRanking,
  declinedProductMix,
  emptyProductMix,
  hasProductMixAnswer,
  linesFromNames,
  namedProductLines,
  productMixSummary,
  rankProductLines,
  shareBandLabel,
  type ProductMix,
  type ProductMixLine,
} from "@/lib/product-mix";

const TOTAL = 5;

const TITLES = [
  "Do you sell more than one product or service that matters?",
  "Name the lines that matter",
  "Rough share of sales for each",
  "Which has the best margin?",
  "Which is weakest, or needs a look?",
];

const HINTS = [
  "If one line covers the book, we skip this — the Profit tab stays simple.",
  "Up to 5. Skip the long tail — just what you'd discuss in a review.",
  "Bands, not a spreadsheet. Close enough is useful.",
  "Where the contribution is strongest — even if it is not the biggest seller.",
  "The line you would look at first if margin slipped.",
];

const cardBtn =
  "w-full rounded-xl border border-[#d4a550]/25 bg-slate-900/80 p-3 text-left transition hover:border-[#d4a550]/60 hover:bg-[#d4a550]/5";
const cardOn = "border-[#d4a550] bg-[#d4a550]/10";

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

  useEffect(() => {
    if (!open) return;
    setStep(0);
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

  const decline = () => {
    onSave(declinedProductMix());
    onOpenChange(false);
  };

  const commitNames = () => {
    if (!canAdvanceFromNames(nameSlots)) return;
    const lines = linesFromNames(nameSlots, draft.lines);
    setDraft((prev) => ({
      ...prev,
      active: true,
      lines,
      bestLineId: lines.some((l) => l.id === prev.bestLineId) ? prev.bestLineId : undefined,
      worstLineId: lines.some((l) => l.id === prev.worstLineId) ? prev.worstLineId : undefined,
    }));
    goNext();
  };

  const setShare = (id: string, shareBand: ProductMixLine["shareBand"]) => {
    setDraft((prev) => ({
      ...prev,
      lines: prev.lines.map((l) => (l.id === id ? { ...l, shareBand } : l)),
    }));
  };

  const finish = () => {
    if (!canSaveRanking(draft)) return;
    onSave(
      applyMarginFlags({
        ...draft,
        version: 1,
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
            Profitability · product mix
          </p>
          <h3 className="mt-1 text-lg font-semibold text-slate-100">{TITLES[step]}</h3>
          <p className="mt-1 text-sm text-slate-400">{HINTS[step]}</p>
        </div>

        <div className="space-y-2">
          {step === 0 && (
            <>
              <button type="button" className={cardBtn} onClick={goNext}>
                <div className="text-sm font-semibold text-slate-100">Yes — a few lines matter</div>
                <div className="mt-1 text-[11px] text-slate-500">
                  Products, services, or locations you would name in a review
                </div>
              </button>
              <button type="button" className={cardBtn} onClick={decline}>
                <div className="text-sm font-semibold text-slate-100">No — one main line covers it</div>
                <div className="mt-1 text-[11px] text-slate-500">
                  We will leave the Profit tab as it is. You can add this later.
                </div>
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
                className="w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-[#d4a550] focus:outline-none"
              />
            ))}

          {step === 2 &&
            named.map((line) => (
              <div key={line.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                <div className="text-sm font-semibold text-slate-100">{line.name}</div>
                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  {SHARE_BANDS.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      className={`${cardBtn} p-2 ${line.shareBand === b.id ? cardOn : ""}`}
                      onClick={() => setShare(line.id, b.id)}
                    >
                      <div className="text-xs font-semibold text-slate-100">{b.label}</div>
                      <div className="text-[10px] text-slate-500">{b.hint}</div>
                    </button>
                  ))}
                </div>
              </div>
            ))}

          {step === 3 &&
            named.map((line) => (
              <button
                key={line.id}
                type="button"
                className={`${cardBtn} ${draft.bestLineId === line.id ? cardOn : ""}`}
                onClick={() => {
                  setDraft((prev) => ({
                    ...prev,
                    bestLineId: line.id,
                    worstLineId: prev.worstLineId === line.id ? undefined : prev.worstLineId,
                  }));
                  goNext();
                }}
              >
                <div className="text-sm font-semibold text-slate-100">{line.name}</div>
                <div className="mt-1 text-[11px] text-slate-500">{shareBandLabel(line.shareBand)} of sales</div>
              </button>
            ))}

          {step === 4 &&
            named.map((line) => {
              const disabled = line.id === draft.bestLineId;
              return (
                <button
                  key={line.id}
                  type="button"
                  disabled={disabled}
                  className={`${cardBtn} ${draft.worstLineId === line.id ? cardOn : ""} ${disabled ? "opacity-40" : ""}`}
                  onClick={() => {
                    if (disabled) return;
                    setDraft((prev) => ({ ...prev, worstLineId: line.id }));
                  }}
                >
                  <div className="text-sm font-semibold text-slate-100">{line.name}</div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    {disabled ? "Already marked strongest" : shareBandLabel(line.shareBand) + " of sales"}
                  </div>
                </button>
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
                disabled={!canAdvanceFromShares(draft.lines)}
                className="bg-[#d4a550] text-[#0a0e1a] hover:bg-[#c49a45]"
                onClick={goNext}
              >
                Continue
              </Button>
            )}
            {step === 4 && (
              <Button
                size="sm"
                disabled={!canSaveRanking(draft)}
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
    <div className="space-y-2.5">
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
                    Strongest
                  </span>
                )}
                {row.isWorst && (
                  <span
                    className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
                    style={{ color: "#e05c5c", background: "rgba(224,92,92,0.15)" }}
                  >
                    Needs a look
                  </span>
                )}
              </div>
              <span className="shrink-0 text-[10px] text-slate-500">{shareBandLabel(row.shareBand)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full"
                style={{ width: `${row.barPct}%`, background: tone }}
              />
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
                  Optional. A high-level mix — which lines carry sales, which carry margin — without
                  another spreadsheet on this tab.
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
                  Directional bands, not a P&amp;L by SKU. Does not change the waterfall figures.
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
