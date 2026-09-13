import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowRight,
  Loader2,
  MessageSquarePlus,
  Sparkles,
  Wallet,
} from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AddToPlanButton } from "@/components/add-to-plan-button";
import { formatVal } from "@/components/owner-board-ui";
import { COLLAPSIBLE_GOLD_RULE } from "@/components/primitives/collapsible-gold-card";
import { useNotes } from "@/contexts/notes";
import { getPlaybookSteps, type PlaybookStep } from "@/lib/playbook.functions";
import { scoreTier } from "@/lib/ratios";
import type { RatioInputs } from "@/lib/ratios";
import {
  currencyWord,
  fallbackMove,
  ratioBriefingTitle,
  ratioFormulaLine,
  ratioFriendlyName,
  ratioPlaybookKey,
  relatedTabForRatio,
  soWhatInMoney,
  type BriefingFigures,
  type BriefingMarket,
  type RatioBriefingTab,
} from "@/lib/ratio-briefing";
import type { ResolvedMarket } from "@/lib/market";
import { localizeCopy } from "@/lib/market";

export type OwnerRatioBriefingMeta = {
  friendly: string;
  techName: string;
  formula: string;
  hint: string;
  icon: string;
  steps: string[];
};

type ValueFormat = "x" | "pct" | "days" | "money";

type Props = {
  ratioKey: string | null;
  meta: OwnerRatioBriefingMeta | null;
  open: boolean;
  onClose: () => void;
  market: ResolvedMarket;
  figures: BriefingFigures;
  inputs: RatioInputs;
  value: number;
  format: ValueFormat;
  health: number;
  p50?: number | null;
  higherIsBetter?: boolean;
  clientId: string | null;
  canAddToPlan: boolean;
  onGoToPlan: (moveKey: string) => void;
  onSeeTab: (tab: RatioBriefingTab) => void;
};

function MiniHealth({ health }: { health: number }) {
  const w = Number.isFinite(health) ? Math.max(2, Math.min(100, health)) : 0;
  const tone =
    !Number.isFinite(health)
      ? "bg-slate-300"
      : health >= 65
        ? "bg-emerald-500"
        : health >= 40
          ? "bg-amber-400"
          : "bg-rose-500";
  const label = !Number.isFinite(health)
    ? "—"
    : health >= 65
      ? "Healthy"
      : health >= 40
        ? "Watch"
        : "Critical";
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-500">
        <span>{label}</span>
        <span className="tabular-nums">{Number.isFinite(health) ? `${Math.round(health)}` : "—"}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-amber-100/80 dark:bg-slate-800">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${w}%` }} />
      </div>
    </div>
  );
}

export function OwnerRatioBriefing({
  ratioKey,
  meta,
  open,
  onClose,
  market,
  figures,
  inputs,
  value,
  format,
  health,
  p50,
  higherIsBetter = true,
  clientId,
  canAddToPlan,
  onGoToPlan,
  onSeeTab,
}: Props) {
  const { setPinMode } = useNotes();
  const [steps, setSteps] = useState<PlaybookStep[]>([]);
  const [loading, setLoading] = useState(false);
  const briefingMarket: BriefingMarket = market;
  const playbookKey = ratioKey ? ratioPlaybookKey(ratioKey) : "";
  const tier = scoreTier(health);

  useEffect(() => {
    if (!open || !playbookKey) {
      setSteps((s) => (s.length ? [] : s));
      return;
    }
    let cancelled = false;
    setLoading(true);
    setSteps([]);
    getPlaybookSteps({
      data: {
        ratioKey: playbookKey,
        tier,
        country: market.country,
        regionCode: market.regionCode,
      },
    })
      .then((rows) => {
        if (!cancelled) setSteps(rows);
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, playbookKey, tier, market.country, market.regionCode]);

  const friendly = meta ? ratioFriendlyName(meta.friendly, briefingMarket) : ratioKey ?? "";
  const formula = ratioKey ? ratioFormulaLine(ratioKey, inputs, briefingMarket) : null;
  const soWhat = useMemo(() => {
    if (!ratioKey) return null;
    return soWhatInMoney({
      key: ratioKey,
      value,
      n: figures,
      market: briefingMarket,
      p50,
      higherIsBetter,
    });
  }, [ratioKey, value, figures, briefingMarket, p50, higherIsBetter]);

  const related = ratioKey ? relatedTabForRatio(ratioKey) : null;
  const weekStep =
    steps.find((s) => s.timeframe === "immediate" || s.timeframe === "week_1_2") ?? steps[0] ?? null;
  const fallback = fallbackMove(meta?.steps, briefingMarket);
  const moveTitle = weekStep?.step_title ?? fallback;
  const moveBody = weekStep?.step_description;
  const moveKey = weekStep
    ? `${ratioKey}:playbook:0`
    : ratioKey
      ? `${ratioKey}:playbook:0`
      : "";

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <SheetContent
        side="right"
        className="flex w-full flex-col overflow-hidden border border-amber-900/15 bg-[radial-gradient(circle_at_90%_0%,rgba(212,165,80,0.13),transparent_34%),linear-gradient(135deg,#fffdf8,#f8f5ed)] p-0 shadow-[0_20px_60px_rgba(109,79,22,0.10)] dark:border-slate-800 dark:bg-[radial-gradient(circle_at_90%_0%,rgba(212,165,80,0.12),transparent_34%),linear-gradient(135deg,#111827,#0b1220)] dark:shadow-[0_20px_60px_rgba(0,0,0,0.25)] sm:max-w-lg"
      >
        <div className={COLLAPSIBLE_GOLD_RULE} />
        {ratioKey && meta && (
          <>
            <SheetHeader className="flex-shrink-0 space-y-1 px-6 pb-4 pt-6 text-left">
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#b8860b]">
                {ratioBriefingTitle(briefingMarket)}
              </p>
              <SheetTitle className="flex items-center gap-2 text-[18px] font-semibold text-slate-950 dark:text-slate-50">
                <span className="text-2xl" aria-hidden>
                  {meta.icon}
                </span>
                <span>{friendly}</span>
              </SheetTitle>
              <SheetDescription className="text-[12px] text-slate-500">
                {localizeCopy(meta.techName, briefingMarket)}
                {Number.isFinite(value) ? ` · ${formatVal(value, format, briefingMarket)}` : ""}
              </SheetDescription>
            </SheetHeader>

            <div className="flex-1 space-y-4 overflow-y-auto px-6 pb-8">
              <div className="rounded-xl border border-amber-900/15 bg-white/70 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/40">
                <p className="font-mono text-[11px] font-semibold leading-snug text-slate-700 dark:text-slate-200">
                  {formula?.calculation ?? formula?.formula ?? localizeCopy(meta.formula, briefingMarket)}
                </p>
                {(formula?.hint || meta.hint) && (
                  <p className="mt-1.5 text-[12px] leading-relaxed text-slate-500">
                    {formula?.hint ?? localizeCopy(meta.hint, briefingMarket)}
                  </p>
                )}
                <div className="mt-3">
                  <MiniHealth health={health} />
                </div>
              </div>

              {soWhat && (
                <div className="rounded-xl border border-[#d4a550]/35 bg-gradient-to-br from-amber-50/90 via-white to-white px-4 py-3.5 shadow-[0_8px_24px_rgba(121,91,27,0.08)] dark:from-[#d4a550]/12 dark:via-slate-950/60 dark:to-slate-950/40 dark:shadow-none">
                  <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-[#b8860b] dark:text-[#d4a550]">
                    <Wallet className="h-3.5 w-3.5" />
                    In your {currencyWord(briefingMarket, true)}
                  </p>
                  <p className="mt-2 text-[15px] font-semibold leading-snug text-slate-900 dark:text-white">
                    {soWhat.line}
                  </p>
                  {soWhat.detail && (
                    <p className="mt-1.5 text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
                      {soWhat.detail}
                    </p>
                  )}
                </div>
              )}

              <div className="rounded-xl border border-amber-900/15 bg-white/80 px-4 py-3.5 dark:border-slate-800 dark:bg-slate-950/50">
                <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-[#b8860b]">
                  <Sparkles className="h-3.5 w-3.5" />
                  One move this week
                </p>
                {loading ? (
                  <p className="mt-2 flex items-center gap-2 text-sm text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading your playbook…
                  </p>
                ) : moveTitle ? (
                  <>
                    <p className="mt-2 text-[15px] font-semibold leading-snug text-slate-900 dark:text-slate-50">
                      {moveTitle}
                    </p>
                    {moveBody && (
                      <p className="mt-1.5 text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
                        {moveBody}
                      </p>
                    )}
                    {canAddToPlan && clientId && moveKey && (
                      <div className="mt-3">
                        <AddToPlanButton
                          clientId={clientId}
                          moveKey={moveKey}
                          title={moveTitle}
                          outcomeWhy={`${friendly} · one move this week`}
                          onAssign={(k) => {
                            onClose();
                            onGoToPlan(k);
                          }}
                        />
                      </div>
                    )}
                  </>
                ) : (
                  <p className="mt-2 text-sm text-slate-500">
                    No playbook step on file yet — pin a note for your accountant if you want a next
                    action.
                  </p>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                {related && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onSeeTab(related.tab);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full border border-amber-900/20 bg-white/80 px-3 py-1.5 text-[12px] font-semibold text-slate-800 transition hover:border-[#d4a550]/60 hover:bg-amber-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  >
                    {related.label}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    setPinMode(true);
                    toast.message("Tap the Health page to pin a note for your accountant.");
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full border border-amber-900/20 bg-white/80 px-3 py-1.5 text-[12px] font-semibold text-slate-800 transition hover:border-[#d4a550]/60 hover:bg-amber-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  <MessageSquarePlus className="h-3.5 w-3.5" />
                  Ask your accountant
                </button>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
