import { useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Loader2,
  TrendingUp,
  Scissors,
  Settings2,
  Users,
  Building2,
  Wallet,
  ShieldAlert,
  AlertTriangle,
} from "lucide-react";
import { getPlaybookSteps } from "@/lib/playbook.functions";
import type { PlaybookStep } from "@/lib/playbook.functions";
import { listInterventionSignoffs, type InterventionSignoff } from "@/lib/intervention.functions";
import {
  InterventionSignoffButton,
  SignoffBadgeReadonly,
} from "@/components/intervention-signoff-button";
import { useMarket } from "@/contexts/market";

// ── Constants ────────────────────────────────────────────────────────────────

const TIMEFRAME_LABELS: Record<string, string> = {
  immediate: "Do now",
  week_1_2: "Wks 1–2",
  month_1: "Month 1",
  month_1_3: "Mo 1–3",
  month_3_6: "Mo 3–6",
  year_1: "Year 1+",
};

const TIMEFRAME_ORDER = ["immediate", "week_1_2", "month_1", "month_1_3", "month_3_6", "year_1"];

const TIER_STYLES: Record<
  string,
  { badge: string; stepDot: string; label: string; border: string }
> = {
  critical: {
    badge: "bg-red-950/80 text-red-200 border border-red-700/80",
    stepDot: "bg-red-600 text-white",
    label: "Critical",
    border: "border-l-red-500",
  },
  at_risk: {
    badge: "bg-amber-950/80 text-amber-200 border border-amber-700/80",
    stepDot: "bg-amber-600 text-white",
    label: "At Risk",
    border: "border-l-amber-500",
  },
  healthy: {
    badge: "bg-emerald-950/80 text-emerald-200 border border-emerald-700/80",
    stepDot: "bg-emerald-600 text-white",
    label: "Healthy",
    border: "border-l-emerald-500",
  },
};

/** High-contrast chips on the dark drawer (avoid yellow-on-amber). */
const EFFORT_STYLES: Record<string, string> = {
  low: "bg-slate-700 text-slate-100",
  medium: "bg-amber-800 text-amber-50",
  high: "bg-red-800 text-red-50",
};

const IMPACT_STYLES: Record<string, string> = {
  low: "bg-slate-700 text-slate-100",
  medium: "bg-blue-800 text-blue-50",
  high: "bg-emerald-800 text-emerald-50",
};

const CATEGORY_STYLES: Record<
  string,
  { cls: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  revenue: { cls: "bg-blue-900/70 text-blue-100", Icon: TrendingUp },
  cost: { cls: "bg-amber-900/70 text-amber-100", Icon: Scissors },
  operations: { cls: "bg-purple-900/70 text-purple-100", Icon: Settings2 },
  people: { cls: "bg-indigo-900/70 text-indigo-100", Icon: Users },
  structure: { cls: "bg-slate-700 text-slate-100", Icon: Building2 },
  cash: { cls: "bg-teal-900/70 text-teal-100", Icon: Wallet },
  risk: { cls: "bg-red-900/70 text-red-100", Icon: ShieldAlert },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function groupByTimeframe(steps: PlaybookStep[]) {
  const groups: Record<string, PlaybookStep[]> = {};
  for (const s of steps) {
    if (!groups[s.timeframe]) groups[s.timeframe] = [];
    groups[s.timeframe].push(s);
  }
  return TIMEFRAME_ORDER.filter((tf) => groups[tf]).map((tf) => ({
    timeframe: tf,
    label: TIMEFRAME_LABELS[tf] ?? tf,
    steps: groups[tf],
  }));
}

// ── Component ────────────────────────────────────────────────────────────────

interface PlaybookDrawerProps {
  ratioKey: string | null;
  ratioName: string;
  healthTier: "critical" | "at_risk" | "healthy";
  open: boolean;
  onClose: () => void;
  /** When provided + isAccountant, enables per-step sign-off UI for this client. */
  clientId?: string | null;
  clientName?: string;
  isAccountant?: boolean;
}

export function PlaybookDrawer({
  ratioKey,
  ratioName,
  healthTier,
  open,
  onClose,
  clientId = null,
  clientName,
  isAccountant = false,
}: PlaybookDrawerProps) {
  const [steps, setSteps] = useState<PlaybookStep[]>([]);
  const [loading, setLoading] = useState(false);
  const [signoffs, setSignoffs] = useState<Record<number, InterventionSignoff>>({});
  const loadSignoffs = useServerFn(listInterventionSignoffs);
  const signoffEnabled = Boolean(clientId && ratioKey);
  const { selection } = useMarket();

  useEffect(() => {
    if (!open || !ratioKey) {
      setSteps((s) => (s.length ? [] : s));
      return;
    }
    setLoading(true);
    setSteps([]);
    getPlaybookSteps({
      data: {
        ratioKey,
        tier: healthTier,
        country: selection.country,
        regionCode: selection.regionCode,
      },
    })
      .then(setSteps)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [open, ratioKey, healthTier, selection]);

  useEffect(() => {
    if (!open || !signoffEnabled || !clientId || !ratioKey) {
      setSignoffs((s) => (Object.keys(s).length ? {} : s));
      return;
    }
    let cancelled = false;
    loadSignoffs({ data: { clientId, ratioKey } })
      .then(({ signoffs: rows }) => {
        if (cancelled) return;
        const map: Record<number, InterventionSignoff> = {};
        for (const r of rows) map[r.step_number] = r;
        setSignoffs(map);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Failed to load signoffs:", err);
        setSignoffs({});
      });
    return () => {
      cancelled = true;
    };
  }, [open, signoffEnabled, clientId, ratioKey, loadSignoffs]);

  const signoffCount = Object.keys(signoffs).length;

  const tier = TIER_STYLES[healthTier] ?? TIER_STYLES.at_risk;
  const grouped = groupByTimeframe(steps);

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      {/*
        Force a dark surface regardless of page theme. SheetTitle defaults to
        text-foreground (near-black in light mode) which was invisible on this drawer.
      */}
      <SheetContent
        side="right"
        className="dark flex w-full flex-col overflow-hidden border-slate-700 bg-[#0d1117] p-0 text-slate-100 sm:max-w-2xl [color-scheme:dark] [&_[data-slot=sheet-close]]:text-slate-300 [&_button.absolute]:text-slate-300 [&_button.absolute]:hover:text-white"
      >
        {/* Header */}
        <SheetHeader className="flex-shrink-0 space-y-0 border-b border-slate-700 px-6 pb-4 pt-6 text-left">
          <div className="flex items-center gap-3">
            <SheetTitle className="!text-slate-50 flex-1 text-left text-base font-semibold leading-tight">
              {ratioName}
            </SheetTitle>
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${tier.badge}`}
            >
              {tier.label}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="text-xs font-normal text-slate-400">
              {steps.length > 0
                ? `${steps.length} action steps — ordered by priority and timeframe`
                : loading
                  ? "Loading playbook…"
                  : "No playbook available for this ratio yet."}
            </p>
            {signoffEnabled && steps.length > 0 && (
              <p className="flex-shrink-0 text-[11px] font-normal text-slate-400">
                {signoffCount} of {steps.length} signed off
              </p>
            )}
          </div>
        </SheetHeader>

        {/* Body */}
        <div className="flex-1 space-y-7 overflow-y-auto px-6 py-5">
          {loading && (
            <div className="flex items-center justify-center py-16 text-slate-400">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              <span className="text-sm">Loading…</span>
            </div>
          )}

          {!loading && steps.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center text-slate-400">
              <AlertTriangle className="h-8 w-8 text-slate-500" />
              <p className="text-sm text-slate-300">
                No playbook steps found for this ratio and tier.
              </p>
              <p className="text-xs text-slate-500">Check back after the next data import.</p>
            </div>
          )}

          {!loading &&
            grouped.map(({ timeframe, label, steps: phaseSteps }) => (
              <div key={timeframe}>
                {/* Phase divider */}
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    {label}
                  </span>
                  <div className="flex-1 border-t border-slate-700" />
                </div>

                <div className="space-y-3">
                  {phaseSteps.map((step) => {
                    const cat = CATEGORY_STYLES[step.category] ?? CATEGORY_STYLES.operations;
                    const CatIcon = cat.Icon;
                    return (
                      <div
                        key={step.step_number}
                        className={`rounded-lg border border-slate-700 border-l-2 ${tier.border} bg-slate-900/80 p-4`}
                      >
                        <div className="flex items-start gap-3">
                          {/* Step number */}
                          <span
                            className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${tier.stepDot}`}
                          >
                            {step.step_number}
                          </span>

                          <div className="min-w-0 flex-1">
                            <p className="mb-1.5 text-sm font-semibold leading-snug text-slate-50">
                              {step.step_title}
                            </p>
                            <p className="mb-3 text-xs leading-relaxed text-slate-300">
                              {step.step_description}
                            </p>

                            {/* Tags */}
                            <div className="flex flex-wrap gap-1.5">
                              <span
                                className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${EFFORT_STYLES[step.effort] ?? EFFORT_STYLES.medium}`}
                              >
                                Effort: {step.effort}
                              </span>
                              <span
                                className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${IMPACT_STYLES[step.impact] ?? IMPACT_STYLES.medium}`}
                              >
                                Impact: {step.impact}
                              </span>
                              <span
                                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${cat.cls}`}
                              >
                                <CatIcon className="h-2.5 w-2.5" />
                                {step.category}
                              </span>
                            </div>

                            {/* Sign-off (accountant view only) */}
                            {signoffEnabled && clientId && ratioKey && isAccountant && (
                              <InterventionSignoffButton
                                clientId={clientId}
                                clientName={clientName}
                                ratioKey={ratioKey}
                                stepNumber={step.step_number}
                                signoff={signoffs[step.step_number] ?? null}
                                onChange={(next) => {
                                  setSignoffs((prev) => {
                                    const copy = { ...prev };
                                    if (next) copy[step.step_number] = next;
                                    else delete copy[step.step_number];
                                    return copy;
                                  });
                                }}
                              />
                            )}

                            {/* Sign-off (SME read-only view) */}
                            {signoffEnabled && !isAccountant && signoffs[step.step_number] && (
                              <SignoffBadgeReadonly
                                signoff={signoffs[step.step_number]}
                                clientName={clientName}
                              />
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
