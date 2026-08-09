import type { ReactNode } from "react";
import { ArrowRight, ChevronRight } from "lucide-react";

export type OverviewRailProps = {
  liveLabel?: string;
  showLiveBadge?: boolean;
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
  const heights = [38, 55, 72, 92, 78, 54, 40];

  return (
    <div className="mt-2.5">
      <div className="relative flex h-[88px] items-end gap-1.5 rounded-lg border border-slate-100 bg-slate-50/90 px-2.5 pb-2 pt-5 dark:border-white/5 dark:bg-white/[0.03]">
        {heights.map((h, i) => {
          const isActive = i === active;
          return (
            <div
              key={i}
              className="relative flex flex-1 flex-col items-center justify-end"
              style={{ height: "100%" }}
            >
              {isActive && (
                <span className="absolute -top-1 z-10 rounded-sm bg-emerald-600 px-1.5 py-px text-[8px] font-bold uppercase tracking-wide text-white shadow-sm">
                  You
                </span>
              )}
              <div
                className={`w-full max-w-[28px] rounded-t-[3px] transition-all ${
                  isActive
                    ? "bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.4)]"
                    : "bg-slate-300/90 dark:bg-white/18"
                }`}
                style={{ height: `${h}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-400">
        <span>Bottom quartile</span>
        <span>Avg</span>
        <span>Top quartile</span>
      </div>
    </div>
  );
}

function CashSpark({ points }: { points: number[] }) {
  const w = 260;
  const h = 64;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const coords = points.map((p, i) => {
    const x = (i / Math.max(1, points.length - 1)) * w;
    const y = h - ((p - min) / span) * (h - 14) - 8;
    return [x, y] as const;
  });
  const path = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c[0]},${c[1]}`).join(" ");
  const area = `${path} L${w},${h} L0,${h} Z`;
  const last = coords[coords.length - 1] ?? [0, 0];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-2 h-16 w-full" aria-hidden>
      <defs>
        <linearGradient id="cashTrail" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(184,134,11,0.55)" />
          <stop offset="100%" stopColor="rgba(16,185,129,0.95)" />
        </linearGradient>
        <linearGradient id="cashFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(16,185,129,0.18)" />
          <stop offset="100%" stopColor="rgba(16,185,129,0)" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#cashFill)" />
      <path d={path} fill="none" stroke="url(#cashTrail)" strokeWidth="2.25" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="3.5" fill="#059669" stroke="#fff" strokeWidth="1.5" />
    </svg>
  );
}

function RailCard({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200/90 bg-white p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-white/10 dark:bg-[#0f172a]/55 dark:shadow-none">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-800 dark:text-slate-100">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </div>
  );
}

export function OverviewRail({
  liveLabel,
  showLiveBadge = false,
  positionPercentile,
  weekChanges,
  cashTrajectory,
  onOpenCash,
  onOpenMoves,
  onOpenBenchmarks,
  industryPulse,
}: OverviewRailProps) {
  return (
    <aside className="flex w-full flex-col gap-3">
      {showLiveBadge && liveLabel && (
        <div className="flex justify-end">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
            {liveLabel}
          </span>
        </div>
      )}

      {industryPulse}

      <RailCard title="Your Position">
        <p className="text-[13px] font-semibold leading-snug text-slate-800 dark:text-slate-100">
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
          className="mt-2.5 flex items-center gap-1 text-[11px] font-semibold text-[#b8860b] hover:text-[#d4a550] dark:text-[#d4a550]"
        >
          See benchmark details <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </RailCard>

      <RailCard title="This Week">
        <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">
          {weekChanges.length ? `${weekChanges.length} things changed.` : "No changes tracked yet."}
        </p>
        <div className="mt-2 space-y-1">
          {weekChanges.map((c) => (
            <div key={c.label} className="flex items-center justify-between text-[12px]">
              <span className="text-slate-500 dark:text-slate-400">{c.label}</span>
              <span className={`font-semibold tabular-nums ${sentimentClass(c.sentiment)}`}>
                {c.value}
              </span>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={onOpenMoves}
          className="mt-2.5 flex items-center gap-1 text-[11px] font-semibold text-[#b8860b] hover:text-[#d4a550] dark:text-[#d4a550]"
        >
          See all changes <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </RailCard>

      <RailCard
        title="Cash Trajectory"
        action={
          <button
            type="button"
            onClick={onOpenCash}
            className="rounded-full border border-slate-200 p-1 text-slate-500 transition hover:border-[#d4a550]/40 hover:text-[#d4a550] dark:border-white/10 dark:text-slate-400"
            aria-label="Open cash forecast"
          >
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        }
      >
        <p className="-mt-1 text-[10px] text-slate-500">90-day forecast</p>
        {cashTrajectory ? (
          <>
            <CashSpark points={cashTrajectory.points} />
            <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              {cashTrajectory.projectedLabel}
            </p>
            <p className="text-lg font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
              {cashTrajectory.projectedValue}
            </p>
          </>
        ) : (
          <p className="mt-2 text-[12px] leading-relaxed text-slate-500">
            Open Cash Forecast to project the next 90 days.
          </p>
        )}
      </RailCard>
    </aside>
  );
}
