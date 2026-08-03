import { useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Loader2, TrendingUp, Scissors, Settings2, Users, Building2, Wallet, ShieldAlert, AlertTriangle } from "lucide-react";
import { getPlaybookSteps } from "@/lib/playbook.functions";
import type { PlaybookStep } from "@/lib/playbook.functions";
import { listInterventionSignoffs, type InterventionSignoff } from "@/lib/intervention.functions";
import { InterventionSignoffButton, SignoffBadgeReadonly } from "@/components/intervention-signoff-button";

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

const TIER_STYLES: Record<string, { badge: string; stepDot: string; label: string; border: string }> = {
  critical: {
    badge: "bg-red-950/60 text-red-400 border border-red-800",
    stepDot: "bg-red-700 text-white",
    label: "Critical",
    border: "border-l-red-600",
  },
  at_risk: {
    badge: "bg-amber-950/60 text-amber-400 border border-amber-800",
    stepDot: "bg-amber-700 text-white",
    label: "At Risk",
    border: "border-l-amber-600",
  },
  healthy: {
    badge: "bg-emerald-950/60 text-emerald-400 border border-emerald-800",
    stepDot: "bg-emerald-700 text-white",
    label: "Healthy",
    border: "border-l-emerald-600",
  },
};

const EFFORT_STYLES: Record<string, string> = {
  low: "bg-slate-700/60 text-slate-300",
  medium: "bg-amber-900/40 text-amber-400",
  high: "bg-red-900/40 text-red-400",
};

const IMPACT_STYLES: Record<string, string> = {
  low: "bg-slate-700/60 text-slate-300",
  medium: "bg-blue-900/40 text-blue-400",
  high: "bg-emerald-900/40 text-emerald-400",
};

const CATEGORY_STYLES: Record<string, { cls: string; Icon: React.ComponentType<{ className?: string }> }> = {
  revenue: { cls: "bg-blue-900/40 text-blue-300", Icon: TrendingUp },
  cost: { cls: "bg-amber-900/40 text-amber-300", Icon: Scissors },
  operations: { cls: "bg-purple-900/40 text-purple-300", Icon: Settings2 },
  people: { cls: "bg-indigo-900/40 text-indigo-300", Icon: Users },
  structure: { cls: "bg-slate-700/60 text-slate-300", Icon: Building2 },
  cash: { cls: "bg-teal-900/40 text-teal-300", Icon: Wallet },
  risk: { cls: "bg-red-900/40 text-red-300", Icon: ShieldAlert },
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

  useEffect(() => {
    if (!open || !ratioKey) { setSteps([]); return; }
    setLoading(true);
    setSteps([]);
    getPlaybookSteps({ data: { ratioKey, tier: healthTier } })
      .then(setSteps)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [open, ratioKey, healthTier]);

  useEffect(() => {
    if (!open || !signoffEnabled || !clientId || !ratioKey) {
      setSignoffs({});
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
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl bg-[#0d1117] border-slate-800 text-slate-100 p-0 flex flex-col overflow-hidden"
      >
        {/* Header */}
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-slate-800 flex-shrink-0">
          <div className="flex items-center gap-3">
            <SheetTitle className="text-base font-semibold text-slate-100 leading-tight flex-1">
              {ratioName}
            </SheetTitle>
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${tier.badge}`}>
              {tier.label}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 mt-1">
            <p className="text-xs text-slate-500 font-normal">
              {steps.length > 0
                ? `${steps.length} action steps — ordered by priority and timeframe`
                : loading
                ? "Loading playbook…"
                : "No playbook available for this ratio yet."}
            </p>
            {signoffEnabled && steps.length > 0 && (
              <p className="text-[11px] text-slate-500 font-normal flex-shrink-0">
                {signoffCount} of {steps.length} signed off
              </p>
            )}
          </div>
        </SheetHeader>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-7">
          {loading && (
            <div className="flex items-center justify-center py-16 text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              <span className="text-sm">Loading…</span>
            </div>
          )}

          {!loading && steps.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center text-slate-500 gap-3">
              <AlertTriangle className="h-8 w-8 text-slate-700" />
              <p className="text-sm">No playbook steps found for this ratio and tier.</p>
              <p className="text-xs text-slate-600">Check back after the next data import.</p>
            </div>
          )}

          {!loading && grouped.map(({ timeframe, label, steps: phaseSteps }) => (
            <div key={timeframe}>
              {/* Phase divider */}
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{label}</span>
                <div className="flex-1 border-t border-slate-800" />
              </div>

              <div className="space-y-3">
                {phaseSteps.map((step) => {
                  const cat = CATEGORY_STYLES[step.category] ?? CATEGORY_STYLES.operations;
                  const CatIcon = cat.Icon;
                  return (
                    <div
                      key={step.step_number}
                      className={`rounded-lg border border-slate-800 border-l-2 ${tier.border} bg-slate-900/40 p-4`}
                    >
                      <div className="flex items-start gap-3">
                        {/* Step number */}
                        <span className={`flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold ${tier.stepDot}`}>
                          {step.step_number}
                        </span>

                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-100 leading-snug mb-1.5">
                            {step.step_title}
                          </p>
                          <p className="text-xs text-slate-400 leading-relaxed mb-3">
                            {step.step_description}
                          </p>

                          {/* Tags */}
                          <div className="flex flex-wrap gap-1.5">
                            {/* Effort */}
                            <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${EFFORT_STYLES[step.effort] ?? EFFORT_STYLES.medium}`}>
                              Effort: {step.effort}
                            </span>
                            {/* Impact */}
                            <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${IMPACT_STYLES[step.impact] ?? IMPACT_STYLES.medium}`}>
                              Impact: {step.impact}
                            </span>
                            {/* Category */}
                            <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${cat.cls}`}>
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
                            <SignoffBadgeReadonly signoff={signoffs[step.step_number]} clientName={clientName} />
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
