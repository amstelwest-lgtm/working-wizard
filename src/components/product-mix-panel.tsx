import { useEffect, useMemo, useState } from "react";
import { Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useFinancialInputs } from "@/contexts/financial-inputs";
import { useMarketFormat } from "@/contexts/market";
import { currencySymbol } from "@/lib/market";
import { CollapsibleGoldCard } from "@/components/primitives/collapsible-gold-card";
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
    ? "w-full rounded-xl border-2 border-[#0B5FFF] bg-[#DBEAFE] p-3 text-left text-[#102A43]"
    : "w-full rounded-xl border border-[#DBEAFE] bg-white p-3 text-left text-[#102A43] transition hover:border-[#2563EB] dark:border-[#1e3a5f] dark:bg-[#102A43] dark:text-[#F4F7FB]";
}

function MoneyField({
  value,
  onChange,
  placeholder,
  symbol,
}: {
  value: number | undefined;
  onChange: (n: number | undefined) => void;
  placeholder: string;
  symbol: string;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
        {symbol}
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
        className="w-full rounded-lg border border-[#DBEAFE] bg-white py-2 pl-7 pr-3 text-sm text-[#102A43] placeholder:text-[#3D5270] focus:border-[#0B5FFF] dark:border-[#1e3a5f] dark:bg-[#102A43] dark:text-[#F4F7FB] focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
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
  const { market, t } = useMarketFormat();
  const symbol = currencySymbol(market);
  const fmt = (n: number | undefined) => formatRand(n, market);
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
  const q5Preview = useMemo(() => applyUnitEconomics(draft, statedTotal), [draft, statedTotal]);
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
      ? `Total revenue on this Profit tab is ${fmt(statedTotal)}. One question — fill in the ${t("currencyWord")} from each line you named.`
      : `Total revenue is not on this Profit tab yet. Enter the ${t("currencyWord")} from each named line — shares will be of the amounts you allocate.`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg border-[#DBEAFE] bg-white text-[#102A43] dark:border-[#1e3a5f] dark:bg-[#102A43] dark:text-[#F4F7FB]">
        <DialogHeader>
          <DialogTitle className="text-[#102A43] dark:text-[#F4F7FB]">Product lines</DialogTitle>
          <DialogDescription className="text-[#3D5270] dark:text-[#C5D4E4]">
            Question {step + 1} of {TOTAL} · optional — skip anytime
          </DialogDescription>
        </DialogHeader>

        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#0B5FFF] dark:text-[#F4F7FB]">
            Profitability · unit economics
          </p>
          <h3 className="mt-1 text-lg font-semibold text-[#102A43] dark:text-[#F4F7FB]">{TITLES[step]}</h3>
          <p className="mt-1 text-sm text-[#3D5270] dark:text-[#C5D4E4]">
            {step === 0 &&
              "If one line covers the book, we skip this — the Profit tab stays simple."}
            {step === 1 && "Up to 5. Skip the long tail — just what you'd discuss in a review."}
            {step === 2 &&
              "What a customer pays for one unit of this line. Rand, typical selling price."}
            {step === 3 &&
              "What it costs you to deliver one unit. Margin is calculated from price minus this."}
            {step === 4 && q5Hint}
          </p>
        </div>

        <div className="space-y-2">
          {step === 0 && (
            <>
              <button
                type="button"
                className={choiceClass(q1 === "yes")}
                onClick={() => setQ1("yes")}
              >
                <div className="text-sm font-semibold">Yes — a few lines matter</div>
                <div className="mt-1 text-[11px] text-[#3D5270] dark:text-[#C5D4E4]">
                  We will take selling price, cost, and {t("currencyWord")} of total revenue for
                  each
                </div>
                {q1 === "yes" && (
                  <div className="mt-2 text-xs font-semibold uppercase tracking-wider text-[#3D5270] dark:text-[#C5D4E4]">
                    Selected
                  </div>
                )}
              </button>
              <button
                type="button"
                className={choiceClass(q1 === "no")}
                onClick={() => setQ1("no")}
              >
                <div className="text-sm font-semibold">No — one main line covers it</div>
                <div className="mt-1 text-[11px] text-[#3D5270] dark:text-[#C5D4E4]">
                  We will leave the Profit tab as it is. You can add this later.
                </div>
                {q1 === "no" && (
                  <div className="mt-2 text-xs font-semibold uppercase tracking-wider text-[#3D5270] dark:text-[#C5D4E4]">
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
                placeholder={
                  i === 0
                    ? "e.g. Retail shop"
                    : i === 1
                      ? "e.g. Wholesale"
                      : `Line ${i + 1} (optional)`
                }
                className="w-full rounded-lg border border-[#DBEAFE] bg-white px-3 py-2 text-sm text-[#102A43] placeholder:text-[#3D5270] focus:border-[#0B5FFF] dark:border-[#1e3a5f] dark:bg-[#102A43] dark:text-[#F4F7FB] focus:outline-none"
              />
            ))}

          {step === 2 &&
            named.map((line) => (
              <div key={line.id} className="rounded-xl border border-[#DBEAFE] bg-white p-3 dark:border-[#1e3a5f] dark:bg-[#0B1B2B]">
                <div className="mb-2 text-sm font-semibold text-[#102A43] dark:text-[#F4F7FB]">{line.name}</div>
                <MoneyField
                  value={line.sellPrice}
                  placeholder="0.00"
                  symbol={symbol}
                  onChange={(n) => patchLine(line.id, { sellPrice: n })}
                />
              </div>
            ))}

          {step === 3 &&
            named.map((line) => {
              const pct = unitMarginPct(line.sellPrice, line.unitCost);
              return (
                <div
                  key={line.id}
                  className="rounded-xl border border-[#DBEAFE] bg-white p-3 dark:border-[#1e3a5f] dark:bg-[#0B1B2B]"
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-[#102A43] dark:text-[#F4F7FB]">{line.name}</div>
                    <div className="text-[11px] text-slate-500">Sells {fmt(line.sellPrice)}</div>
                  </div>
                  <MoneyField
                    value={line.unitCost}
                    placeholder="0.00"
                    symbol={symbol}
                    onChange={(n) => patchLine(line.id, { unitCost: n })}
                  />
                  <div
                    className={`mt-2 text-xs font-semibold ${
                      pct == null
                        ? "text-slate-500"
                        : pct >= 40
                          ? "text-[#0E5C40] dark:text-[#7DDEBA]"
                          : pct >= 20
                            ? "text-[#8A5A12] dark:text-[#F0D59A]"
                            : "text-[#8E2430] dark:text-[#FFB4BC]"
                    }`}
                  >
                    Margin {formatMarginPct(pct)}
                    {pct != null && line.sellPrice != null && line.unitCost != null
                      ? ` · ${fmt(line.sellPrice - line.unitCost)} a unit`
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
                const totalLabel = statedTotal > 0 ? fmt(statedTotal) : "total revenue";
                return (
                  <div
                    key={line.id}
                    className="rounded-xl border border-[#DBEAFE] bg-white p-3 dark:border-[#1e3a5f] dark:bg-[#0B1B2B]"
                  >
                    <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-[#102A43] dark:text-[#F4F7FB]">
                      <span className="text-[#3D5270] dark:text-[#C5D4E4]">______ of</span>
                      <span className="font-semibold text-[#102A43] dark:text-[#F4F7FB]">{totalLabel}</span>
                      <span className="text-[#3D5270] dark:text-[#C5D4E4]">is from</span>
                      <span className="font-semibold text-[#102A43] dark:text-[#F4F7FB]">&quot;{line.name}&quot;</span>
                    </div>
                    <MoneyField
                      value={line.revenueAmount}
                      placeholder="0"
                      symbol={symbol}
                      onChange={(n) => patchLine(line.id, { revenueAmount: n })}
                    />
                    {contrast ? (
                      <div className="mt-2 text-xs font-semibold text-[#102A43] dark:text-[#F4F7FB]">{contrast}</div>
                    ) : (
                      <div className="mt-2 text-[11px] text-slate-500">
                        Sales share and GP share appear once this amount is in.
                      </div>
                    )}
                  </div>
                );
              })}
              <div className="rounded-lg border border-[#DBEAFE] bg-[#F4F8FF] px-3 py-2 text-xs text-[#3D5270] dark:border-[#1e3a5f] dark:bg-[#0B1B2B] dark:text-[#C5D4E4]">
                {statedTotal > 0 ? (
                  leftover >= 0 ? (
                    <>
                      Allocated {fmt(allocated)} of {fmt(statedTotal)}
                      {leftover > 0
                        ? ` · ${fmt(leftover)} unallocated (other — no GP share)`
                        : " · fully allocated"}
                    </>
                  ) : (
                    <>
                      Allocated {fmt(allocated)} of {fmt(statedTotal)} · over by {fmt(-leftover)}
                    </>
                  )
                ) : (
                  <>Allocated {fmt(allocated)} across named lines</>
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-slate-800 pt-3">
          {step > 0 ? (
            <Button variant="ghost" size="sm" className="text-[#102A43] dark:text-[#F4F7FB]" onClick={goBack}>
              Back
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="text-[#3D5270] dark:text-[#C5D4E4]"
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
                  className={`h-1.5 w-1.5 rounded-full ${i <= step ? "bg-[#0B5FFF]" : "bg-[#DBEAFE]"}`}
                />
              ))}
            </div>
            {step === 0 && (
              <Button
                size="sm"
                disabled={!q1}
                className="bg-[#0B5FFF] text-white hover:bg-[#2563EB]"
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
                className="bg-[#0B5FFF] text-white hover:bg-[#2563EB]"
                onClick={commitNames}
              >
                Continue
              </Button>
            )}
            {step === 2 && (
              <Button
                size="sm"
                disabled={!canAdvanceFromPrices(draft.lines)}
                className="bg-[#0B5FFF] text-white hover:bg-[#2563EB]"
                onClick={goNext}
              >
                Continue
              </Button>
            )}
            {step === 3 && (
              <Button
                size="sm"
                disabled={!canAdvanceFromCosts(draft.lines)}
                className="bg-[#0B5FFF] text-white hover:bg-[#2563EB]"
                onClick={goNext}
              >
                Continue
              </Button>
            )}
            {step === 4 && (
              <Button
                size="sm"
                disabled={!canAdvanceFromRevenue(draft.lines) || !canSaveUnitMix(draft)}
                className="bg-[#0B5FFF] text-white hover:bg-[#2563EB]"
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
  const { market } = useMarketFormat();
  const fmt = (n: number | undefined) => formatRand(n, market);
  const ranked = rankProductLines(mix);
  if (!ranked.length) return null;
  const stated = mix.totalRevenue ?? 0;
  const allocated = allocatedRevenue(mix.lines);
  const leftover = stated > 0 ? stated - allocated : 0;
  return (
    <div className="space-y-3">
      {ranked.map((row) => {
        const tone = row.isBest ? "#0E5C40" : row.isWorst ? "#8E2430" : "#102A43";
        const contrast = shareContrastLabel(row.revenueSharePct, row.gpSharePct);
        return (
          <div key={row.id}>
            <div className="mb-1 flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-xs font-semibold text-slate-800 dark:text-[#102A43] dark:text-[#F4F7FB]">
                  {row.name}
                </span>
                {row.isBest && (
                  <span
                    className="shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wider"
                    style={{ color: "#0E5C40", background: "rgba(14,92,64,0.12)" }}
                  >
                    Most of GP
                  </span>
                )}
                {row.isWorst && (
                  <span
                    className="shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wider"
                    style={{ color: "#8E2430", background: "rgba(196,61,75,0.12)" }}
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
                <span className="w-10 shrink-0 text-xs uppercase tracking-wider text-slate-500">
                  Sales
                </span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-amber-900/10 dark:bg-slate-800">
                  <div
                    className="h-full rounded-full bg-[#38BDF8]"
                    style={{ width: barWidth(row.revenueSharePct) }}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-10 shrink-0 text-xs uppercase tracking-wider text-slate-500">
                  GP
                </span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-amber-900/10 dark:bg-slate-800">
                  <div
                    className="h-full rounded-full"
                    style={{ width: barWidth(row.gpSharePct), background: tone }}
                  />
                </div>
              </div>
            </div>
            <div className="mt-1 text-[10px] text-slate-500 dark:text-[#C5D4E4]">
              {fmt(row.revenueAmount)}
              {stated > 0 ? ` of ${fmt(stated)}` : ""}
              {" · "}
              {fmt(row.sellPrice)} sell · {fmt(row.unitCost)} cost ·{" "}
              {formatMarginPct(row.marginPct)} margin
            </div>
          </div>
        );
      })}
      {stated > 0 && leftover > 0 && (
        <p className="text-[10px] text-slate-500 dark:text-[#C5D4E4]">
          {fmt(leftover)} of {fmt(stated)} unallocated — other (no GP share)
        </p>
      )}
    </div>
  );
}

export function ProductMixPanel({
  totalRevenue = 0,
  incentive,
}: {
  totalRevenue?: number;
  /** Shown under the title so accountants know why the five questions matter. */
  incentive?: string;
}) {
  const { productMix, saveProductMix } = useFinancialInputs();
  const { t } = useMarketFormat();
  const [funnelOpen, setFunnelOpen] = useState(false);
  const answered = hasProductMixAnswer(productMix);
  const summary = useMemo(() => productMixSummary(productMix), [productMix]);

  return (
    <>
      <div className="print:hidden">
        <CollapsibleGoldCard
          icon={Layers}
          title="Product lines"
          subtitle={incentive ?? summary}
          defaultOpen={Boolean(incentive)}
          headerRight={
          !answered ? (
            <Button
              size="sm"
              className="h-7 bg-[#0B5FFF] px-2.5 text-[11px] text-white hover:bg-[#2563EB]"
              onClick={() => setFunnelOpen(true)}
            >
              5 questions
            </Button>
          ) : (
            <button
              type="button"
              className="text-xs font-medium text-[#0B5FFF] hover:underline dark:text-[#F4F7FB]"
              onClick={() => setFunnelOpen(true)}
            >
              Update
            </button>
          )
        }
      >
        {!answered && (
          <div className="flex flex-col items-start gap-2">
            {/* The incentive already shows as the card subtitle; repeating it here printed the same sentence twice. */}
            <p className="text-xs text-slate-600 dark:text-[#C5D4E4]">
              Optional. Of the stated total revenue, how much is from each line — then sales share
              vs GP share. Does not change the waterfall.
            </p>
            <Button
              size="sm"
              className="bg-[#0B5FFF] text-white hover:bg-[#2563EB]"
              onClick={() => setFunnelOpen(true)}
            >
              Break down by product line
            </Button>
          </div>
        )}
        {answered && !productMix.active && (
          <p className="text-xs text-slate-600 dark:text-[#C5D4E4]">
            Marked as a single-line business. Update the breakdown if that changes.
          </p>
        )}
        {answered && productMix.active && (
          <>
            <MixBars mix={productMix} />
            <p className="mt-3 text-[10px] text-slate-500 dark:text-[#C5D4E4]">
              Sales share is {t("currencyWord")} of stated total revenue. GP share uses that amount ×
              unit margin. A high-margin line can be a small slice of sales and most of the profit.
              Does not change the waterfall figures.
            </p>
          </>
        )}
        </CollapsibleGoldCard>
      </div>

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
