import { ArrowUpRight, BookOpen, Check, Layers3, Target } from "lucide-react";
import { AddToPlanButton } from "@/components/add-to-plan-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { tierColor } from "@/components/owner-board-ui";

export type NextStep<K extends string = string> = {
  key: K;
  title: string;
  ratioName: string;
  icon: string;
  cynefin: "Clear" | "Complicated" | "Complex" | "Chaotic";
  eisenhower: "Do" | "Decide" | "Delegate" | "Delete";
  impact: number;
  impactLine: string;
  health: number;
  score: number;
};

function Insight({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-[#b7872a]/15 bg-white/70 p-3 dark:bg-[#0c1320]">
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
        <span className="text-[#b7872a]">{icon}</span>
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold text-[#172033] dark:text-slate-100">{value}</div>
      <div className="text-[10px] text-slate-500">{detail}</div>
    </div>
  );
}

function NextStepRow<K extends string>({
  step,
  rank,
  highlighted,
  simplified,
  isDone,
  onToggleDone,
  onOpenSop,
  clientId,
  clientName,
  isOwner = true,
  onGoToPlan,
}: {
  step: NextStep<K>;
  rank: number;
  highlighted?: boolean;
  simplified: boolean;
  isDone: boolean;
  onToggleDone: () => void;
  onOpenSop: () => void;
  clientId?: string | null;
  clientName?: string;
  isOwner?: boolean;
  onGoToPlan?: (moveKey: string) => void;
}) {
  const t = tierColor(step.health);
  const cynefinColor: Record<NextStep["cynefin"], string> = {
    Clear: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    Complicated: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    Complex: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
    Chaotic: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
  };
  const eisenhowerColor: Record<NextStep["eisenhower"], string> = {
    Do: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
    Decide: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    Delegate: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    Delete: "border-slate-500/30 bg-slate-500/10 text-slate-600 dark:text-slate-300",
  };
  return (
    <div
      className={`relative rounded-lg border p-4 transition-colors ${
        isDone
          ? "border-emerald-500/25 bg-emerald-500/[0.04] opacity-65"
          : highlighted
            ? "border-[#b7872a]/35 bg-[#fffdf7] dark:bg-[#171c29]"
            : "border-slate-200 bg-white hover:border-[#b7872a]/30 dark:border-slate-700/70 dark:bg-[#111827]/60"
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border font-mono text-xs font-bold ${
            highlighted
              ? "border-[#b7872a] bg-[#b7872a]/10 text-[#8a651b] dark:text-[#e5be72]"
              : "border-slate-300 bg-slate-50 text-slate-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-400"
          }`}
        >
          {rank}
        </div>
        <button onClick={onOpenSop} className="min-w-0 flex-1 cursor-pointer text-left">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`text-sm font-semibold ${
                isDone ? "text-slate-400 line-through" : "text-[#172033] dark:text-slate-100"
              }`}
            >
              {step.title}
            </span>
            {!simplified && (
              <span className="rounded border border-[#b7872a]/30 bg-[#b7872a]/5 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#9d741d] dark:text-[#d5aa58]">
                <BookOpen className="mr-1 inline h-3 w-3" />
                SOP
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] uppercase tracking-wider text-slate-500">Lever: {step.ratioName}</p>
          {!simplified && highlighted && !isDone && (
            <p className="mt-2 rounded-md border border-[#b7872a]/20 bg-[#b7872a]/5 p-2 text-xs italic text-slate-700 dark:text-slate-200">
              {step.impactLine}
            </p>
          )}
          {!simplified && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              <span
                className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${eisenhowerColor[step.eisenhower]}`}
              >
                Eisenhower · {step.eisenhower}
              </span>
              <span
                className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${cynefinColor[step.cynefin]}`}
              >
                Cynefin · {step.cynefin}
              </span>
              <span className="rounded border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-200">
                Pareto Impact · {step.impact}/10
              </span>
              <span
                className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${t.border} ${t.text}`}
              >
                Health · {isFinite(step.health) ? `${step.health.toFixed(0)}%` : "—"}
              </span>
            </div>
          )}
        </button>
        <div className="flex shrink-0 flex-col items-stretch gap-1.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleDone();
            }}
            className={`flex flex-col items-center gap-1 rounded-md border-2 px-3 py-2 text-[10px] font-bold uppercase tracking-wider transition-all ${
              isDone
                ? "border-emerald-500 bg-emerald-500/20 text-emerald-200"
                : "border-slate-300 bg-white text-slate-500 hover:border-[#b7872a] hover:text-[#9d741d] dark:border-slate-600 dark:bg-slate-900 dark:text-slate-400"
            }`}
            aria-label="Mark step done"
          >
            <span className="text-lg leading-none">{isDone ? <Check className="h-4 w-4" /> : "—"}</span>
            <span>{isDone ? "Done" : "Mark"}</span>
          </button>
          {clientId && !isDone && isOwner && (
            <AddToPlanButton
              clientId={clientId}
              moveKey={step.key}
              title={step.title}
              outcomeWhy={step.impactLine || `Improves ${step.ratioName}.`}
              onAssign={(k) => onGoToPlan?.(k)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export function NextStepsPanel<K extends string>({
  steps,
  simplified,
  done,
  onToggleDone,
  onOpenSop,
  clientId,
  clientName,
  isOwner = true,
  onGoToPlan,
}: {
  steps: NextStep<K>[];
  simplified: boolean;
  done: Set<K>;
  onToggleDone: (k: K) => void;
  onOpenSop: (k: K) => void;
  clientId?: string | null;
  clientName?: string;
  isOwner?: boolean;
  onGoToPlan?: (moveKey: string) => void;
}) {
  const completed = steps.filter((s) => done.has(s.key)).length;
  const open = steps.length - completed;
  const avgHealth = steps
    .filter((s) => Number.isFinite(s.health))
    .reduce((a, s, _, arr) => a + s.health / arr.length, 0);
  const highestImpact = steps.filter((s) => !done.has(s.key)).sort((a, b) => b.impact - a.impact)[0];
  return (
    <div className="space-y-5">
      <Card className="overflow-hidden border-[#b7872a]/25 bg-white shadow-[0_12px_40px_rgba(15,23,42,.06)] dark:bg-[#111827]/80 dark:shadow-none">
        <CardHeader className="border-b border-[#b7872a]/15 bg-[#fbf8f1] pb-5 dark:bg-[#151b28]">
          <div className="flex flex-wrap items-end justify-between gap-5">
            <div>
              <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.24em] text-[#9d741d] dark:text-[#d5aa58]">
                <Target className="h-3.5 w-3.5" /> Advisory queue
              </div>
              <CardTitle className="font-display text-2xl text-[#172033] dark:text-[#f6f1e7]">
                {simplified ? "Your next best moves" : "Operating priorities"}
              </CardTitle>
              <CardDescription className="mt-1 max-w-2xl text-[#667085] dark:text-slate-400">
                {simplified
                  ? "A short list for the week ahead. Start at the top and keep the momentum."
                  : "A decision-grade view of the levers most likely to improve financial health."}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-[#b7872a]/30 bg-[#b7872a]/10 px-3 py-1.5 text-xs font-semibold text-[#8a651b] dark:text-[#e5be72]">
                <Check className="mr-1 inline h-3.5 w-3.5" />
                {completed} of {steps.length} complete
              </span>
            </div>
          </div>
          {!simplified && (
            <div className="mt-5 grid gap-2 sm:grid-cols-3">
              <Insight label="Open moves" value={`${open}`} detail="still to ship" icon={<Layers3 />} />
              <Insight
                label="Average health"
                value={Number.isFinite(avgHealth) ? `${avgHealth.toFixed(0)}%` : "—"}
                detail="across available levers"
                icon={<Target />}
              />
              <Insight
                label="Lead with"
                value={highestImpact ? `Impact ${highestImpact.impact}/10` : "All clear"}
                detail={highestImpact?.ratioName ?? "moves completed"}
                icon={<ArrowUpRight />}
              />
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-2 p-4 sm:p-5">
          {steps.map((s, i) => (
            <NextStepRow
              key={s.key}
              step={s}
              rank={i + 1}
              simplified={simplified}
              highlighted={!simplified && i < 3}
              isDone={done.has(s.key)}
              onToggleDone={() => onToggleDone(s.key)}
              onOpenSop={() => onOpenSop(s.key)}
              clientId={clientId}
              clientName={clientName}
              isOwner={isOwner}
              onGoToPlan={onGoToPlan}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
