import { PILLAR_LABELS } from "@/lib/health-score";
import type { FrozenScoreProjection, ScoreProjectionCompare } from "@/lib/score-projection";

/**
 * One-period close-the-loop card: did / we said / what moved / how to read it.
 * Never attributes overall score points to a task.
 */
export function ScoreLoopCard({
  projection,
  compare,
}: {
  projection: FrozenScoreProjection;
  compare: ScoreProjectionCompare;
}) {
  return (
    <div
      id="wizard-score-loop"
      className="rounded-xl border border-[#d4a550]/30 bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-[#d4a550]/20 dark:bg-[#0f172a]/50"
    >
      <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#b8860b] dark:text-[#d4a550]">
        After the figures
      </p>
      <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
        {compare.measured ? "Here’s what we said, and what moved" : "Waiting on the next figures"}
      </p>
      <dl className="mt-3 space-y-2 text-[12px] leading-relaxed text-slate-600 dark:text-slate-300">
        <div>
          <dt className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-500">Did</dt>
          <dd>
            {compare.doneCount} of {compare.plannedCount} planned action
            {compare.plannedCount === 1 ? "" : "s"} marked complete
            {compare.measured ? "" : " — effort, not a score change"}.
          </dd>
        </div>
        <div>
          <dt className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-500">We said</dt>
          <dd>{compare.weSaid}</dd>
        </div>
        <div>
          <dt className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-500">What moved</dt>
          <dd>{compare.whatMoved}</dd>
        </div>
        <div>
          <dt className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-500">How to read it</dt>
          <dd>{compare.read}</dd>
        </div>
      </dl>
      {projection.impactLabel ? (
        <p className="mt-3 text-[11px] text-slate-500">
          Standing estimate for this lever stayed {projection.impactLabel} — we do not add
          those figures together when more than one action is on the plan.
        </p>
      ) : null}
      <p className="mt-2 text-[11px] text-slate-500">
        Watching {PILLAR_LABELS[projection.pillar]}. Ask your accountant to interpret this
        with you before you brief a bank or a partner.
      </p>
    </div>
  );
}
