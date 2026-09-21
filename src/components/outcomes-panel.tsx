/**
 * Outcomes panel (P2.1) — "did the money move?"
 *
 * One story line per approved recommendation: measured automatically from
 * snapshots where the statements can answer, or with a one-field prompt where
 * they cannot. Also shows the per-metric delivery history that calibrates the
 * next round. Renders nothing until there is at least one approved
 * recommendation. Never navigates.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, Loader2, Target } from "lucide-react";
import { toast } from "sonner";
import { useTrack } from "@/hooks/use-track";
import { fmtDelta, isAutoMeasurable, METRIC_READERS } from "@/lib/outcomes";
import { getOutcomesOverview, measureOutcomes } from "@/lib/outcomes.functions";
import { impactMetricLabel, type OutcomeVerdict, type Recommendation } from "@/lib/recommendations";
import { recordRecommendationOutcome } from "@/lib/recommendations.functions";
import type { OutcomesOverview } from "@/lib/outcomes.functions";

type Props = {
  clientId: string | null;
  audience: "owner" | "accountant";
  onChanged?: () => void;
  refreshKey?: string | number;
  className?: string;
};

const VERDICT_CLASS: Record<OutcomeVerdict, string> = {
  exceeded: "border-emerald-400/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  on_target: "border-emerald-400/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  partial: "border-[#b7872a]/45 bg-[#d4a550]/15 text-[#7a5a0e] dark:text-[#f1d28b]",
  missed: "border-rose-400/50 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  worsened: "border-rose-400/50 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  unmeasured:
    "border-slate-300/70 bg-slate-500/10 text-slate-600 dark:border-white/15 dark:text-slate-300",
};

export function OutcomesPanel({ clientId, audience, onChanged, refreshKey, className }: Props) {
  const track = useTrack();
  const fetchOverview = useServerFn(getOutcomesOverview);
  const measure = useServerFn(measureOutcomes);
  const record = useServerFn(recordRecommendationOutcome);

  const [data, setData] = useState<OutcomesOverview | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!clientId) return;
    const mine = ++seq.current;
    try {
      // Measure first so fresh snapshots are reflected in what we show.
      await measure({ data: { clientId } }).catch(() => null);
      const res = await fetchOverview({ data: { clientId } });
      if (mine !== seq.current) return;
      setData(res);
    } catch {
      if (mine !== seq.current) return;
      setData(null);
    } finally {
      if (mine === seq.current) setLoaded(true);
    }
  }, [clientId, fetchOverview, measure]);

  useEffect(() => {
    if (!clientId) return;
    void load();
    // refreshKey is intentionally a dependency: hosts bump it after writes.
  }, [clientId, refreshKey, load]);

  const submit = async (rec: Recommendation) => {
    if (!clientId || busy) return;
    const n = Number(amount.replace(/[,\s]/g, ""));
    if (!Number.isFinite(n)) {
      toast.message("Enter a number (negative if it went the wrong way).");
      return;
    }
    setBusy(true);
    try {
      await record({
        data: {
          clientId,
          recommendationId: rec.id,
          metric: rec.expected_impact_metric ?? "other",
          actualAmount: n,
          expectedAmount: rec.expected_impact_amount ?? undefined,
          method: "manual",
          notes: note.trim() || undefined,
        },
      });
      track("outcome_recorded", {
        clientId,
        audience,
        metric: rec.expected_impact_metric,
        method: "manual",
      });
      toast.success("Result recorded");
      setRecordingId(null);
      setAmount("");
      setNote("");
      await load();
      onChanged?.();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Could not record the result.");
    } finally {
      setBusy(false);
    }
  };

  if (!clientId || !loaded || !data || !data.migrated) return null;
  if (data.stories.length === 0) return null;

  const measured = data.stories.filter((s) => s.verdict !== "unmeasured").length;
  const shell = [
    "rounded-2xl border border-[#b7872a]/25 bg-white/70 p-4 shadow-sm dark:border-[#d4a550]/20 dark:bg-white/[0.035]",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={shell} id="outcomes" data-audience={audience} data-measured={measured}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="block text-[9.5px] font-bold uppercase tracking-[0.22em] text-[#9a7014] dark:text-[#e1b85e]">
            Did the money move?
          </span>
          <h3 className="mt-0.5 text-[15px] font-bold leading-tight text-slate-900 dark:text-[#f4e7c2]">
            {measured === 0
              ? "Results arrive with the next figures"
              : `${measured} of ${data.stories.length} recommendation${data.stories.length === 1 ? "" : "s"} measured`}
          </h3>
          <p className="mt-1 max-w-[64ch] text-[12px] leading-relaxed text-slate-600 dark:text-slate-300/80">
            Each accepted move is checked against what actually happened in the statements. Where
            the statements can't tell, MILŌN asks for one number.
          </p>
        </div>
      </div>

      <ul className="space-y-2">
        {data.stories.map((s) => {
          const rec = data.recommendations.find((r) => r.id === s.recommendationId);
          const needsManual =
            s.verdict === "unmeasured" && rec && !isAutoMeasurable(rec.expected_impact_metric);
          const isRecording = recordingId === s.recommendationId;
          const unit = rec?.expected_impact_metric
            ? METRIC_READERS[rec.expected_impact_metric]?.unit
            : undefined;
          return (
            <li
              key={s.recommendationId}
              data-verdict={s.verdict}
              className="rounded-xl border border-[#b7872a]/20 bg-white/60 p-3 dark:border-white/10 dark:bg-white/[0.03]"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <span
                    className={`rounded-full border px-2 py-[1px] text-[9.5px] font-bold uppercase tracking-[0.12em] ${VERDICT_CLASS[s.verdict]}`}
                  >
                    {s.verdictLabel}
                  </span>
                  <p className="mt-1 text-[13px] leading-relaxed text-slate-800 dark:text-slate-100/90">
                    {s.sentence}
                  </p>
                </div>
                {needsManual && !isRecording ? (
                  <button
                    type="button"
                    onClick={() => setRecordingId(s.recommendationId)}
                    className="inline-flex items-center gap-1 rounded-lg border border-[#b7872a]/40 px-2.5 py-1.5 text-[12px] font-semibold text-[#7a5a0e] dark:text-[#f1d28b]"
                    data-record-outcome
                  >
                    <Target className="h-3.5 w-3.5" aria-hidden /> Record result
                  </button>
                ) : null}
              </div>
              {isRecording && rec ? (
                <form
                  className="mt-2 flex flex-wrap items-end gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submit(rec);
                  }}
                >
                  <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                    Actual {impactMetricLabel(rec.expected_impact_metric ?? "other").toLowerCase()}{" "}
                    impact
                    {rec.expected_impact_amount !== null && rec.expected_impact_metric ? (
                      <span className="font-normal text-slate-500">
                        expected {fmtDelta(rec.expected_impact_amount, unit ?? "money")}
                      </span>
                    ) : null}
                    <input
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      inputMode="decimal"
                      placeholder="e.g. 32000 or -5000"
                      className="w-40 rounded-md border border-slate-300/70 bg-white px-2 py-1.5 text-[12.5px] font-normal text-slate-900 dark:border-white/15 dark:bg-transparent dark:text-slate-100"
                    />
                  </label>
                  <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                    What happened (optional)
                    <input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      maxLength={1000}
                      className="rounded-md border border-slate-300/70 bg-white px-2 py-1.5 text-[12.5px] font-normal text-slate-900 dark:border-white/15 dark:bg-transparent dark:text-slate-100"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-b from-[#f3d98a] via-[#d4a550] to-[#b7872a] px-3 py-1.5 text-[12px] font-bold text-[#1b1300] disabled:opacity-50"
                  >
                    {busy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Check className="h-3.5 w-3.5" aria-hidden />
                    )}
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setRecordingId(null)}
                    className="text-[12px] font-semibold text-slate-500"
                  >
                    Cancel
                  </button>
                </form>
              ) : null}
            </li>
          );
        })}
      </ul>

      {data.delivery.length > 0 ? (
        <p
          className="mt-3 text-[11.5px] leading-relaxed text-slate-500 dark:text-slate-400"
          data-delivery
        >
          History MILŌN now uses when it proposes moves:{" "}
          {data.delivery
            .map(
              (d) =>
                `${impactMetricLabel(d.metric).toLowerCase()} recommendations delivered ${Math.round(d.deliveryRatio * 100)}% of expected (${d.measured} measured)`,
            )
            .join("; ")}
          .
        </p>
      ) : null}
    </section>
  );
}
