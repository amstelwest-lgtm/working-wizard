/**
 * Recommendations panel (P0.5 direct-client path).
 *
 * The recommendation object (`proposed_next_steps`) had no UI on either
 * surface: brain-propose wrote rows nobody could see, so an owner-only client
 * could never reach `client_decision` → `action_execution`. This panel closes
 * that gap for both seats:
 *
 *   owner       → Accept / Not now, then "Add to action plan"
 *   accountant  → Approve / Reject, then "Add to action plan"
 *
 * Decisions go through `decideRecommendation`; actions through
 * `createActionFromRecommendation` (RPC, with a pre-migration fallback). The
 * brain is invoked with `invokeBrainPropose`; the edge function picks the
 * audience from `clients.firm_id`, not from anything the browser sends.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Check, Loader2, RefreshCw, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { invokeBrainPropose } from "@/lib/brain-propose-client";
import {
  createActionFromRecommendation,
  decideRecommendation,
  listRecommendations,
} from "@/lib/recommendations.functions";
import {
  STATEMENT_DEPTH_DISCLOSURE,
  expectedImpactLabel,
  isActionable,
  isOpenRecommendation,
  priorityLabel,
  type Recommendation,
} from "@/lib/recommendations";
import { useTrack } from "@/hooks/use-track";

type Props = {
  clientId: string | null;
  audience: "owner" | "accountant";
  /** Figures exist, so the brain has something to propose from. */
  canPropose: boolean;
  /** Fired after any write so hosts can refresh the Next Step card. */
  onChanged?: () => void;
  /** Open the Action Plan tab. */
  onOpenActions?: () => void;
  /** Open the upload flow (empty state before figures). */
  onAddFigures?: () => void;
  className?: string;
};

const COPY = {
  owner: {
    eyebrow: "Recommended moves",
    title: "What MILŌN suggests you do next",
    lede: "Each move comes from your numbers. Accept the ones you'll act on; the rest can wait.",
    propose: "Suggest moves",
    proposing: "Reading your numbers…",
    accept: "Accept",
    reject: "Not now",
    emptyReady: "No moves suggested yet. Ask MILŌN to read your latest numbers.",
    emptyNoFigures: "Upload your statements first — MILŌN suggests moves from real figures only.",
    toActions: "Add to action plan",
    onPlan: "On your action plan",
  },
  accountant: {
    eyebrow: "Recommendations",
    title: "Proposed from the client brain",
    lede: "Approve what you'd put your name to, reject the rest. Approved items become owned, dated actions.",
    propose: "Propose from brain",
    proposing: "Proposing…",
    accept: "Approve",
    reject: "Reject",
    emptyReady: "Nothing proposed yet for this client.",
    emptyNoFigures:
      "Bring the client's figures in first — proposals are grounded in the latest snapshot.",
    toActions: "Add to action plan",
    onPlan: "On the action plan",
  },
} as const;

const PRIORITY_CLASS: Record<Recommendation["priority"], string> = {
  critical: "border-rose-400/50 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  high: "border-[#b7872a]/45 bg-[#d4a550]/15 text-[#7a5a0e] dark:text-[#f1d28b]",
  medium:
    "border-slate-300/70 bg-slate-500/10 text-slate-600 dark:border-white/15 dark:text-slate-300",
  low: "border-slate-300/50 bg-transparent text-slate-500 dark:border-white/10 dark:text-slate-400",
};

export function RecommendationsPanel({
  clientId,
  audience,
  canPropose,
  onChanged,
  onOpenActions,
  onAddFigures,
  className,
}: Props) {
  const copy = COPY[audience];
  const track = useTrack();
  const list = useServerFn(listRecommendations);
  const decide = useServerFn(decideRecommendation);
  const toAction = useServerFn(createActionFromRecommendation);

  const [rows, setRows] = useState<Recommendation[]>([]);
  const [migrated, setMigrated] = useState(true);
  const [loading, setLoading] = useState(Boolean(clientId));
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [proposing, setProposing] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!clientId) return;
    const mine = ++seq.current;
    setError(null);
    try {
      const res = await list({ data: { clientId } });
      if (mine !== seq.current) return;
      setRows(res.recommendations);
      setMigrated(res.migrated);
    } catch (err: unknown) {
      if (mine !== seq.current) return;
      setError(err instanceof Error ? err.message : "Could not load recommendations.");
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [clientId, list]);

  useEffect(() => {
    if (!clientId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void load();
  }, [clientId, load]);

  const open = useMemo(() => rows.filter(isOpenRecommendation), [rows]);
  const approved = useMemo(() => rows.filter(isActionable), [rows]);

  const afterWrite = async () => {
    await load();
    onChanged?.();
  };

  const handleDecide = async (rec: Recommendation, decision: "approve" | "reject") => {
    if (!clientId || busyId) return;
    setBusyId(rec.id);
    try {
      await decide({ data: { clientId, recommendationId: rec.id, decision } });
      track("recommendation_decided", { clientId, audience, decision, recommendationId: rec.id });
      toast.success(
        decision === "approve"
          ? audience === "owner"
            ? "Accepted — now put it on your action plan"
            : "Approved"
          : audience === "owner"
            ? "Parked. MILŌN won't nag you about this one."
            : "Rejected",
      );
      await afterWrite();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Could not save that decision.");
    } finally {
      setBusyId(null);
    }
  };

  const handleToAction = async (rec: Recommendation) => {
    if (!clientId || busyId) return;
    setBusyId(rec.id);
    try {
      const res = await toAction({ data: { clientId, recommendationId: rec.id } });
      if (!res.ok) {
        toast.message("Action tracking isn't enabled on this workspace yet.");
        return;
      }
      track("recommendation_actioned", {
        clientId,
        audience,
        recommendationId: rec.id,
        via: res.via,
      });
      toast.success("Added to the action plan");
      await afterWrite();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Could not create the action.");
    } finally {
      setBusyId(null);
    }
  };

  const handlePropose = async () => {
    if (!clientId || proposing) return;
    setProposing(true);
    try {
      const res = await invokeBrainPropose(clientId);
      track("recommendations_proposed", {
        clientId,
        audience,
        inserted: res.stepsInserted,
        dropped: res.stepsDropped ?? 0,
        skipped: res.skippedReason ?? null,
      });
      if (res.stepsInserted > 0) {
        toast.success(
          `${res.stepsInserted} new ${res.stepsInserted === 1 ? "move" : "moves"} suggested`,
        );
      } else if (res.skippedReason === "ai_not_configured") {
        toast.message("The AI drafter isn't configured on this workspace yet.");
      } else if (res.skippedReason === "empty_context") {
        toast.message("Not enough context yet — add figures or answer a few questions first.");
      } else if ((res.stepsDropped ?? 0) > 0) {
        toast.message(
          "MILŌN drafted moves that claimed more detail than your statements support, so it held them back. Add an aged debtors report or connect accounting for deeper suggestions.",
        );
      } else {
        toast.message("Nothing new to suggest right now — the open moves already cover it.");
      }
      await afterWrite();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Could not suggest moves.");
    } finally {
      setProposing(false);
    }
  };

  if (!clientId) return null;

  const shell = [
    "rounded-2xl border border-[#b7872a]/25 bg-white/70 p-4 shadow-sm dark:border-[#d4a550]/20 dark:bg-white/[0.035]",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={shell} id="recommendations-panel" data-audience={audience}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="block text-[9.5px] font-bold uppercase tracking-[0.22em] text-[#9a7014] dark:text-[#e1b85e]">
            {copy.eyebrow}
          </span>
          <h3 className="mt-0.5 text-[16px] font-bold leading-tight text-slate-900 dark:text-[#f4e7c2]">
            {copy.title}
          </h3>
          <p className="mt-1 max-w-[62ch] text-[12px] leading-relaxed text-slate-600 dark:text-slate-300/80">
            {copy.lede}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {loading && rows.length > 0 ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#b7872a]" aria-hidden />
          ) : null}
          <button
            type="button"
            onClick={() => void handlePropose()}
            disabled={proposing || !canPropose}
            title={canPropose ? undefined : copy.emptyNoFigures}
            className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-b from-[#f3d98a] via-[#d4a550] to-[#b7872a] px-3 py-1.5 text-[12.5px] font-bold text-[#1b1300] shadow-[0_4px_14px_rgba(183,135,42,0.28)] disabled:opacity-50"
            data-propose
          >
            {proposing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
            )}
            {proposing ? copy.proposing : copy.propose}
          </button>
        </div>
      </div>

      {error ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-rose-300/50 bg-rose-500/5 px-3 py-2 text-[12px] text-rose-700 dark:text-rose-300">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1 font-semibold"
          >
            <RefreshCw className="h-3 w-3" aria-hidden /> Retry
          </button>
        </div>
      ) : loading && rows.length === 0 ? (
        <div className="space-y-2" aria-busy="true">
          <div className="h-14 animate-pulse rounded-lg bg-[#b7872a]/10" />
          <div className="h-14 animate-pulse rounded-lg bg-[#b7872a]/10" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#b7872a]/30 px-4 py-5 text-center">
          <p className="text-[12.5px] text-slate-600 dark:text-slate-300/80">
            {canPropose ? copy.emptyReady : copy.emptyNoFigures}
          </p>
          {!canPropose && onAddFigures ? (
            <button
              type="button"
              onClick={onAddFigures}
              className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[#8a6a14] underline-offset-2 hover:underline dark:text-[#e1b85e]"
            >
              Add figures <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : null}
        </div>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((rec) => {
            const isOpen = isOpenRecommendation(rec);
            const actionable = isActionable(rec);
            const linked = Boolean(rec.linked_action_item_id);
            const impact = expectedImpactLabel(rec);
            const busy = busyId === rec.id;
            return (
              <li
                key={rec.id}
                data-status={rec.status}
                className="rounded-xl border border-[#b7872a]/20 bg-white/60 p-3 dark:border-white/10 dark:bg-white/[0.03]"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {migrated ? (
                        <span
                          className={`rounded-full border px-2 py-[1px] text-[9.5px] font-bold uppercase tracking-[0.12em] ${PRIORITY_CLASS[rec.priority]}`}
                        >
                          {priorityLabel(rec.priority)}
                        </span>
                      ) : null}
                      {actionable ? (
                        <span className="rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2 py-[1px] text-[9.5px] font-bold uppercase tracking-[0.12em] text-emerald-700 dark:text-emerald-300">
                          {audience === "owner" ? "Accepted" : "Approved"}
                        </span>
                      ) : null}
                      {impact ? (
                        <span className="text-[11px] font-semibold text-[#7a5a0e] dark:text-[#f1d28b]">
                          {impact}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-[14px] font-semibold leading-snug text-slate-900 dark:text-[#f4e7c2]">
                      {rec.title}
                    </p>
                    {rec.problem ? (
                      <p className="mt-0.5 text-[12px] leading-relaxed text-slate-700 dark:text-slate-200/85">
                        {rec.problem}
                      </p>
                    ) : null}
                    {rec.rationale ? (
                      <p className="mt-0.5 text-[12px] leading-relaxed text-slate-600 dark:text-slate-300/75">
                        {rec.rationale}
                      </p>
                    ) : null}
                    {rec.data_depth === "statement" ? (
                      <p className="mt-1.5 text-[10.5px] leading-snug text-slate-500 dark:text-slate-400/80">
                        {STATEMENT_DEPTH_DISCLOSURE}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    {isOpen ? (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleDecide(rec, "approve")}
                          className="inline-flex items-center gap-1 rounded-lg bg-gradient-to-b from-[#f3d98a] via-[#d4a550] to-[#b7872a] px-2.5 py-1.5 text-[12px] font-bold text-[#1b1300] disabled:opacity-50"
                          data-decide="approve"
                        >
                          {busy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                          ) : (
                            <Check className="h-3.5 w-3.5" aria-hidden />
                          )}
                          {copy.accept}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleDecide(rec, "reject")}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-300/70 px-2.5 py-1.5 text-[12px] font-semibold text-slate-600 disabled:opacity-50 dark:border-white/15 dark:text-slate-300"
                          data-decide="reject"
                        >
                          <X className="h-3.5 w-3.5" aria-hidden />
                          {copy.reject}
                        </button>
                      </>
                    ) : actionable && !linked ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleToAction(rec)}
                        className="inline-flex items-center gap-1 rounded-lg bg-gradient-to-b from-[#f3d98a] via-[#d4a550] to-[#b7872a] px-2.5 py-1.5 text-[12px] font-bold text-[#1b1300] disabled:opacity-50"
                        data-to-action
                      >
                        {busy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                        ) : (
                          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                        )}
                        {copy.toActions}
                      </button>
                    ) : actionable && linked ? (
                      <button
                        type="button"
                        onClick={onOpenActions}
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-400/40 px-2.5 py-1.5 text-[12px] font-semibold text-emerald-700 dark:text-emerald-300"
                      >
                        <Check className="h-3.5 w-3.5" aria-hidden />
                        {copy.onPlan}
                      </button>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {open.length === 0 &&
      approved.length > 0 &&
      approved.every((r) => r.linked_action_item_id) ? (
        <p className="mt-3 text-[11.5px] text-slate-500 dark:text-slate-400">
          Everything accepted is on the action plan.{" "}
          {onOpenActions ? (
            <button
              type="button"
              onClick={onOpenActions}
              className="font-semibold text-[#8a6a14] underline-offset-2 hover:underline dark:text-[#e1b85e]"
            >
              Open it
            </button>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}
