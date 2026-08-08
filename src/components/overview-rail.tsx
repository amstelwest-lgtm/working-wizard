import type { ReactNode } from "react";
import { ArrowRight, ChevronRight } from "lucide-react";

export type OverviewRailProps = {
  liveLabel: string;
  industry?: string | null;
  positionPercentile: number | null;
  weekChanges: Array<{
    label: string;
    value: string;
    sentiment: "good" | "bad" | "neutral";
  }>;
  cashTrajectory: {
    points: number[];
    projectedLabel: string;
    projectedValue: string;
  } | null;
  onOpenCash?: () => void;
  onOpenMoves?: () => void;
  /** Opens benchmark / complex ratios view — not Next Moves */
  onOpenBenchmarks?: () => void;
  industryPulse: ReactNode;
};

function sentimentClass(s: "good" | "bad" | "neutral") {
  if (s === "good") return "text-emerald-600 dark:text-emerald-400";
  if (s === "bad") return "text-rose-600 dark:text-rose-400";
  return "text-amber-600 dark:text-amber-300";
}

/** Distribution chart: peer cohort bars + "you" marker */
function PositionChart({ percentile }: { percentile: number }) {
  const buckets = 7;
  const active = Math.min(
    buckets - 1,
    Math.max(0, Math.round((percentile / 100) * (buckets - 1))),
  );
  // Bell-ish cohort shape so the chart reads as a distribution
  const heights = [34, 52, 70, 88, 74, 50, 36];

  return (
    <div className="mt-3">
      <div className="relative flex h-20 items-end gap-1.5 rounded-xl bg-slate-100/80 px-2 pb-2 pt-3 dark:bg-white/[0.04]">
        {heights.map((h, i) => {
          const isActive = i === active;
          return (
            <div key={i} className="relative flex flex-1 flex-col items-center justify-end" style={{ height: "100%" }}>
              {isActive && (
                <span className="absolute -top-0.5 rounded bg-emerald-500 px-1 py-[1px] text-[8px] font-bold uppercase tracking-wide text-white shadow">
                  You
                </span>
              )}
              <div
                className={`w-full rounded-t-sm transition-all ${
                  isActive
                    ? "bg-emerald-500 shadow-[0_0_14px_rgba(16,185,129,0.45)]"
                    : "bg-slate-300 dark:bg-white/15"
                }`}
                style={{ height: `${h}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-400">
        <span>Bottom</span>
        <span>Average</span>
        <span>Top</span>
      </div>
    </div>
  );
}

function CashSpark({ points }: { points: number[] }) {
  const w = 260;
  const h = 72;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const coords = points.map((p, i) => {
    const x = (i / Math.max(1, points.length - 1)) * w;
    const y = h - ((p - min) / span) * (h - 12) - 6;
    return `${x},${y}`;
  });
  const path = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c}`).join(" ");
  const last = coords[coords.length - 1]?.split(",") ?? ["0", "0"];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-2 h-[72px] w-full" aria-hidden>
      <defs>
        <linearGradient id="cashTrail" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(212,165,80,0.35)" />
          <stop offset="100%" stopColor="rgba(16,185,129,0.95)" />
        </linearGradient>
      </defs>
      <path d={path} fill="none" stroke="url(#cashTrail)" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="4" fill="#10b981" />
    </svg>
  );
}

export function OverviewRail({
  liveLabel,
  positionPercentile,
  weekChanges,
  cashTrajectory,
  onOpenCash,
  onOpenMoves,
  onOpenBenchmarks,
  industryPulse,
}: OverviewRailProps) {
  return (
    <aside className="flex w-full max-w-[340px] flex-col gap-4">
      <div className="flex justify-end">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-400">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
          {liveLabel}
        </span>
      </div>

      {industryPulse}

      {/* Your Position */}
      <div className="rounded-2xl border border-slate-200 bg-white/70 p-4 dark:border-white/8 dark:bg-white/[0.03]">
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
          Your Position
        </p>
        <p className="mt-2 text-[15px] font-semibold leading-snug text-slate-900 dark:text-white">
          {positionPercentile != null ? (
            <>
              Better than{" "}
              <span className="text-emerald-600 dark:text-emerald-400">
                {Math.round(positionPercentile)}%
              </span>{" "}
              of similar businesses.
            </>
          ) : (
            <>Add financials to see how you compare.</>
          )}
        </p>
        {positionPercentile != null && <PositionChart percentile={positionPercentile} />}
        <button
          type="button"
          onClick={onOpenBenchmarks ?? onOpenMoves}
          className="mt-3 flex items-center gap-1 text-[11px] font-semibold text-[#b8860b] hover:text-[#d4a550] dark:text-[#d4a550]"
        >
          See benchmark details <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* This Week */}
      <div className="rounded-2xl border border-slate-200 bg-white/70 p-4 dark:border-white/8 dark:bg-white/[0.03]">
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
          This Week
        </p>
        <p className="mt-2 text-[15px] font-semibold text-slate-900 dark:text-white">
          {weekChanges.length ? `${weekChanges.length} things changed.` : "No changes tracked yet."}
        </p>
        <div className="mt-3 space-y-1.5">
          {weekChanges.map((c) => (
            <div key={c.label} className="flex items-center justify-between text-[12px]">
              <span className="text-slate-500 dark:text-slate-400">{c.label}</span>
              <span className={`font-semibold ${sentimentClass(c.sentiment)}`}>{c.value}</span>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={onOpenMoves}
          className="mt-3 flex items-center gap-1 text-[11px] font-semibold text-[#b8860b] hover:text-[#d4a550] dark:text-[#d4a550]"
        >
          See all changes <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Cash Trajectory */}
      <div className="rounded-2xl border border-slate-200 bg-white/70 p-4 dark:border-white/8 dark:bg-white/[0.03]">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
              Cash Trajectory
            </p>
            <p className="mt-0.5 text-[10px] text-slate-500">90 day forecast</p>
          </div>
          <button
            type="button"
            onClick={onOpenCash}
            className="rounded-full border border-slate-200 p-1.5 text-slate-500 transition hover:border-[#d4a550]/40 hover:text-[#d4a550] dark:border-white/10 dark:text-slate-400"
            aria-label="Open cash forecast"
          >
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
        {cashTrajectory ? (
          <>
            <CashSpark points={cashTrajectory.points} />
            <p className="mt-2 text-[12px] text-slate-500 dark:text-slate-400">
              {cashTrajectory.projectedLabel}
            </p>
            <p className="text-xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
              {cashTrajectory.projectedValue}
            </p>
          </>
        ) : (
          <p className="mt-3 text-[12px] leading-relaxed text-slate-500">
            Open Cash Forecast to project the next 90 days.
          </p>
        )}
      </div>
    </aside>
  );
}
