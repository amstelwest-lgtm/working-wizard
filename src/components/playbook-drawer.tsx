import { useState, useEffect, useMemo } from "react";
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
  MessageSquare,
} from "lucide-react";
import { getPlaybookSteps } from "@/lib/playbook.functions";
import type { PlaybookStep } from "@/lib/playbook.functions";
import { listInterventionSignoffs, type InterventionSignoff } from "@/lib/intervention.functions";
import {
  InterventionSignoffButton,
  SignoffBadgeReadonly,
} from "@/components/intervention-signoff-button";
import { useMarket } from "@/contexts/market";
import { useNotes } from "@/contexts/notes";
import { noteBelongsToRatio } from "@/lib/ratio-queries";
import { healthBandLabel } from "@/lib/ratios";

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
    badge: "bg-[#F8D6DA] text-[#8E2430] border border-[#C43D4B]/30 dark:bg-[#3A1820] dark:text-[#FFB4BC]",
    stepDot: "bg-[#8E2430] text-white",
    label: "Critical",
    border: "border-l-[#C43D4B]",
  },
  at_risk: {
    badge: "bg-[#F8E8C8] text-[#8A5A12] border border-[#B7791F]/35 dark:bg-[#3A2E14] dark:text-[#F0D59A]",
    stepDot: "bg-[#8A5A12] text-white",
    label: healthBandLabel("at_risk"),
    border: "border-l-[#B7791F]",
  },
  healthy: {
    badge: "bg-[#D7F3E6] text-[#0E5C40] border border-[#16845B]/30 dark:bg-[#12352A] dark:text-[#7DDEBA]",
    stepDot: "bg-[#0E5C40] text-white",
    label: "Healthy",
    border: "border-l-[#16845B]",
  },
};

/** High-contrast chips on the dark drawer (avoid yellow-on-amber). */
const EFFORT_STYLES: Record<string, string> = {
  low: "bg-[#DBEAFE] text-[#102A43] dark:bg-[#163654] dark:text-[#F4F7FB]",
  medium: "bg-[#F8E8C8] text-[#8A5A12] dark:bg-[#3A2E14] dark:text-[#F0D59A]",
  high: "bg-[#F8D6DA] text-[#8E2430] dark:bg-[#3A1820] dark:text-[#FFB4BC]",
};

const IMPACT_STYLES: Record<string, string> = {
  low: "bg-[#DBEAFE] text-[#102A43] dark:bg-[#163654] dark:text-[#F4F7FB]",
  medium: "bg-[#DBEAFE] text-[#102A43] dark:bg-[#163654] dark:text-[#F4F7FB]",
  high: "bg-[#D7F3E6] text-[#0E5C40] dark:bg-[#12352A] dark:text-[#7DDEBA]",
};

const CATEGORY_STYLES: Record<
  string,
  { cls: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  revenue: { cls: "bg-[#DBEAFE] text-[#102A43] dark:bg-[#163654] dark:text-[#F4F7FB]", Icon: TrendingUp },
  cost: { cls: "bg-[#F8E8C8] text-[#8A5A12] dark:bg-[#3A2E14] dark:text-[#F0D59A]", Icon: Scissors },
  operations: { cls: "bg-[#DBEAFE] text-[#102A43] dark:bg-[#163654] dark:text-[#F4F7FB]", Icon: Settings2 },
  people: { cls: "bg-[#DBEAFE] text-[#102A43] dark:bg-[#163654] dark:text-[#F4F7FB]", Icon: Users },
  structure: { cls: "bg-[#DBEAFE] text-[#102A43] dark:bg-[#163654] dark:text-[#F4F7FB]", Icon: Building2 },
  cash: { cls: "bg-[#D7F3E6] text-[#0E5C40] dark:bg-[#12352A] dark:text-[#7DDEBA]", Icon: Wallet },
  risk: { cls: "bg-[#F8D6DA] text-[#8E2430] dark:bg-[#3A1820] dark:text-[#FFB4BC]", Icon: ShieldAlert },
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
  /** Formula + mini actuals so the drawer is useful even without a JSON pack. */
  formula?: string | null;
  actualLine?: string | null;
  fallbackSteps?: string[];
  /** Weak ratio → the evidence deliverable (cash, profitability, budget). */
  evidence?: { label: string; onOpen: () => void } | null;
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
  formula = null,
  actualLine = null,
  fallbackSteps = [],
  evidence = null,
}: PlaybookDrawerProps) {
  const [steps, setSteps] = useState<PlaybookStep[]>([]);
  const [loading, setLoading] = useState(false);
  const [signoffs, setSignoffs] = useState<Record<number, InterventionSignoff>>({});
  const loadSignoffs = useServerFn(listInterventionSignoffs);
  const signoffEnabled = Boolean(clientId && ratioKey);
  const { selection } = useMarket();
  const { notes, replyToNote, resolveNote, focusNoteId } = useNotes();
  const ratioQueries = useMemo(
    () =>
      ratioKey
        ? notes.filter((n) => !n.resolved && noteBelongsToRatio(n.ratioKey, ratioKey))
        : [],
    [notes, ratioKey],
  );
  const [replyDraft, setReplyDraft] = useState("");
  const [replyingId, setReplyingId] = useState<string | null>(null);

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
            <SheetContent
        side="right"
        className="flex w-full flex-col overflow-hidden border-[#DBEAFE] bg-white p-0 text-[#102A43] sm:max-w-2xl dark:border-[#1e3a5f] dark:bg-[#0B1B2B] dark:text-[#F4F7FB] [&_[data-slot=sheet-close]]:text-[#3D5270] dark:[&_[data-slot=sheet-close]]:text-[#C5D4E4]"
      >
        {/* Header */}
        <SheetHeader className="flex-shrink-0 space-y-0 border-b border-[#DBEAFE] dark:border-[#1e3a5f] px-6 pb-4 pt-6 text-left">
          <div className="flex items-center gap-3">
            <SheetTitle className="text-[#102A43] dark:text-[#F4F7FB] flex-1 text-left text-base font-semibold leading-tight">
              {ratioName}
            </SheetTitle>
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${tier.badge}`}
            >
              {tier.label}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="text-xs font-normal text-[#3D5270] dark:text-[#C5D4E4]">
              {steps.length > 0
                ? `${steps.length} action steps — ordered by priority and timeframe`
                : loading
                  ? "Loading playbook…"
                  : fallbackSteps.length > 0
                    ? "Working notes for this ratio — a full playbook pack is not published yet."
                    : "No playbook available for this ratio yet."}
            </p>
            {signoffEnabled && steps.length > 0 && (
              <p className="flex-shrink-0 text-[11px] font-normal text-[#3D5270] dark:text-[#C5D4E4]">
                {signoffCount} of {steps.length} signed off
              </p>
            )}
          </div>
          {evidence ? (
            <button type="button" className="pillar-evidence mt-3" onClick={evidence.onOpen}>
              {evidence.label}
            </button>
          ) : null}
        </SheetHeader>

        {/* Body */}
        <div className="flex-1 space-y-7 overflow-y-auto px-6 py-5">
          {(formula || actualLine) && (
            <div className="rounded-lg border border-[#DBEAFE] dark:border-[#1e3a5f] bg-[#F4F8FF] dark:bg-[#102A43] p-4">
              {formula && (
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#3D5270] dark:text-[#C5D4E4]">
                  {formula}
                </p>
              )}
              {actualLine && (
                <p className="mt-1.5 font-mono text-sm text-[#102A43] dark:text-[#F4F7FB]">{actualLine}</p>
              )}
            </div>
          )}

          {ratioQueries.length > 0 && (
            <div data-ratio-queries>
              <div className="mb-3 flex items-center gap-2">
                <MessageSquare className="h-3.5 w-3.5 text-[#0B5FFF]" />
                <span className="text-xs font-bold uppercase tracking-widest text-[#0B5FFF]">
                  Queries from client management
                </span>
                <div className="flex-1 border-t border-[#0B5FFF]/30" />
              </div>
              <ul className="space-y-2">
                {ratioQueries.map((q) => (
                  <li
                    key={q.id}
                    className={`rounded-lg border p-3 ${
                      focusNoteId === q.id
                        ? "border-[#0B5FFF] bg-[#0B5FFF]/10"
                        : "border-[#DBEAFE] dark:border-[#1e3a5f] bg-[#F4F8FF] dark:bg-[#102A43]"
                    }`}
                  >
                    <p className="text-[11px] font-semibold text-[#3D5270] dark:text-[#C5D4E4]">{q.author}</p>
                    <p className="mt-1 text-sm leading-relaxed text-[#102A43] dark:text-[#F4F7FB]">{q.text}</p>
                    {q.replies.length > 0 && (
                      <ul className="mt-2 space-y-1 border-t border-[#DBEAFE] dark:border-[#1e3a5f] pt-2">
                        {q.replies.map((r) => (
                          <li key={r.id} className="text-[12px] text-[#3D5270] dark:text-[#C5D4E4]">
                            <span className="font-semibold text-[#102A43] dark:text-[#C5D4E4]">{r.author}</span> {r.text}
                          </li>
                        ))}
                      </ul>
                    )}
                    {isAccountant ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {replyingId === q.id ? (
                          <form
                            className="flex w-full gap-2"
                            onSubmit={(e) => {
                              e.preventDefault();
                              const text = replyDraft.trim();
                              if (!text) return;
                              void replyToNote(q.id, text).then(() => {
                                setReplyDraft("");
                                setReplyingId(null);
                              });
                            }}
                          >
                            <input
                              value={replyDraft}
                              onChange={(e) => setReplyDraft(e.target.value)}
                              placeholder="Reply…"
                              className="min-w-0 flex-1 rounded-md border border-[#DBEAFE] dark:border-[#1e3a5f] bg-white dark:bg-[#0B1B2B] px-2 py-1 text-[12px] text-[#102A43] dark:text-[#F4F7FB]"
                            />
                            <button
                              type="submit"
                              className="rounded-md bg-[#0B5FFF] px-2 py-1 text-[11px] font-semibold text-white"
                            >
                              Send
                            </button>
                          </form>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setReplyingId(q.id);
                              setReplyDraft("");
                            }}
                            className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-[#0B5FFF] hover:bg-[#2563EB]/10"
                          >
                            Reply
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void resolveNote(q.id)}
                          className="rounded-full px-2 py-0.5 text-[11px] font-medium text-[#3D5270] dark:text-[#C5D4E4] hover:text-[#102A43] dark:text-[#C5D4E4]"
                        >
                          Resolve
                        </button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {loading && (
            <div className="flex items-center justify-center py-16 text-[#3D5270] dark:text-[#C5D4E4]">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              <span className="text-sm">Loading…</span>
            </div>
          )}

          {!loading && steps.length === 0 && fallbackSteps.length > 0 && (
            <div>
              <div className="mb-3 flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-widest text-[#3D5270] dark:text-[#C5D4E4]">
                  What to check
                </span>
                <div className="flex-1 border-t border-[#DBEAFE] dark:border-[#1e3a5f]" />
              </div>
              <ol className="space-y-2">
                {fallbackSteps.map((step, i) => (
                  <li
                    key={step}
                    className={`rounded-lg border border-[#DBEAFE] dark:border-[#1e3a5f] border-l-2 ${tier.border} bg-[#F4F8FF] dark:bg-[#102A43] p-3 text-sm leading-relaxed text-[#102A43] dark:text-[#C5D4E4]`}
                  >
                    <span className="mr-2 font-semibold text-[#3D5270] dark:text-[#C5D4E4]">{i + 1}.</span>
                    {step}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {!loading && steps.length === 0 && fallbackSteps.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center text-[#3D5270] dark:text-[#C5D4E4]">
              <AlertTriangle className="h-8 w-8 text-[#102A43] dark:text-[#F4F7FB]0" />
              <p className="text-sm text-[#3D5270] dark:text-[#C5D4E4]">
                No playbook steps found for this ratio and tier.
              </p>
              <p className="text-xs text-[#102A43] dark:text-[#F4F7FB]0">Check back after the next data import.</p>
            </div>
          )}

          {!loading &&
            grouped.map(({ timeframe, label, steps: phaseSteps }) => (
              <div key={timeframe}>
                {/* Phase divider */}
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-widest text-[#3D5270] dark:text-[#C5D4E4]">
                    {label}
                  </span>
                  <div className="flex-1 border-t border-[#DBEAFE] dark:border-[#1e3a5f]" />
                </div>

                <div className="space-y-3">
                  {phaseSteps.map((step) => {
                    const cat = CATEGORY_STYLES[step.category] ?? CATEGORY_STYLES.operations;
                    const CatIcon = cat.Icon;
                    return (
                      <div
                        key={step.step_number}
                        className={`rounded-lg border border-[#DBEAFE] dark:border-[#1e3a5f] border-l-2 ${tier.border} bg-[#F4F8FF] dark:bg-[#102A43] p-4`}
                      >
                        <div className="flex items-start gap-3">
                          {/* Step number */}
                          <span
                            className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${tier.stepDot}`}
                          >
                            {step.step_number}
                          </span>

                          <div className="min-w-0 flex-1">
                            <p className="mb-1.5 text-sm font-semibold leading-snug text-[#102A43] dark:text-[#F4F7FB]">
                              {step.step_title}
                            </p>
                            <p className="mb-3 text-xs leading-relaxed text-[#3D5270] dark:text-[#C5D4E4]">
                              {step.step_description}
                            </p>

                            {/* Tags */}
                            <div className="flex flex-wrap gap-1.5">
                              <span
                                className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${EFFORT_STYLES[step.effort] ?? EFFORT_STYLES.medium}`}
                              >
                                Effort: {step.effort}
                              </span>
                              <span
                                className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${IMPACT_STYLES[step.impact] ?? IMPACT_STYLES.medium}`}
                              >
                                Impact: {step.impact}
                              </span>
                              <span
                                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${cat.cls}`}
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
