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

/** Compact peer chart for the rail */
function PositionChart({ percentile }: { percentile: number }) {
  const buckets = 7;
  const active = Math.min(
    buckets - 1,
    Math.max(0, Math.round((percentile / 100) * (buckets - 1))),
  );
  const heightsPx = [18, 26, 34, 42, 36, 28, 20];
  const maxH = 42;

  return (
    <div className="mt-2">
      <div className="relative overflow-hidden rounded-md border border-slate-200 bg-[#eef2f7] px-2 pb-1.5 pt-4 dark:border-white/10 dark:bg-slate-950/50">
        <div className="relative flex items-end justify-between gap-1" style={{ height: maxH }}>
          {heightsPx.map((h, i) => {
            const isActive = i === active;
            const isAvg = i === 3;
            return (
              <div key={i} className="relative flex flex-1 flex-col items-center justify-end" style={{ height: maxH }}>
                {isActive && (
                  <span className="absolute -top-3.5 z-10 rounded bg-emerald-600 px-1 py-px text-[7px] font-bold uppercase tracking-wide text-white">
                    You
                  </span>
                )}
                <div
                  className={`w-full max-w-[22px] rounded-t-[3px] ${
                    isActive
                      ? "bg-emerald-500 ring-1 ring-emerald-200 dark:ring-emerald-500/30"
                      : isAvg
                        ? "bg-slate-500 dark:bg-slate-400"
                        : "bg-slate-400 dark:bg-slate-500"
                  }`}
                  style={{ height: h }}
                />
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-1 flex justify-between text-[8px] font-semibold uppercase tracking-[0.12em] text-slate-500">
        <span>Bottom</span>
        <span>Avg</span>
        <span>Top</span>
      </div>
    </div>
  );
}

function CashSpark({ points }: { points: number[] }) {
  const w = 220;
  const h = 40;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const coords = points.map((p, i) => {
    const x = (i / Math.max(1, points.length - 1)) * w;
    const y = h - ((p - min) / span) * (h - 10) - 6;
    return [x, y] as const;
  });
  const path = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c[0]},${c[1]}`).join(" ");
  const last = coords[coords.length - 1] ?? [0, 0];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-1.5 h-10 w-full" aria-hidden>
      <path d={path} fill="none" stroke="#059669" strokeWidth="2" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="3" fill="#059669" stroke="#fff" strokeWidth="1.25" />
    </svg>
  );
}

function RailCard({
  title,
  children,
  action,
  className = "",
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-slate-200/90 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-white/10 dark:bg-[#0f172a]/55 dark:shadow-none ${className}`}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-800 dark:text-slate-100">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </div>
  );
}

/**
 * Right insight rail — compact cards only.
 * Industry News is intentionally NOT here (full-width band below the grid).
 */
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
  const topChanges = weekChanges.slice(0, 2);

  return (
    <aside className="flex w-full flex-col gap-2.5">
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
        <p className="text-[12px] font-semibold leading-snug text-slate-800 dark:text-slate-100">
          {positionPercentile != null ? (
            <>
              Better than{" "}
              <span className="text-emerald-600 dark:text-emerald-400">
                {Math.round(positionPercentile)}%
              </span>{" "}
              of peers.
            </>
          ) : (
            <>Add financials to see how you compare.</>
          )}
        </p>
        {positionPercentile != null && <PositionChart percentile={positionPercentile} />}
        <button
          type="button"
          onClick={onOpenBenchmarks ?? onOpenMoves}
          className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold text-[#b8860b] hover:text-[#d4a550] dark:text-[#d4a550]"
        >
          Benchmarks <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </RailCard>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-1">
        <RailCard title="This Week">
          <p className="text-[12px] font-semibold text-slate-800 dark:text-slate-100">
            {topChanges.length ? `${weekChanges.length} things changed.` : "No changes yet."}
          </p>
          <div className="mt-1.5 space-y-1">
            {topChanges.map((c) => (
              <div key={c.label} className="flex items-center justify-between text-[11px]">
                <span className="truncate text-slate-500 dark:text-slate-400">{c.label}</span>
                <span className={`ml-2 shrink-0 font-semibold tabular-nums ${sentimentClass(c.sentiment)}`}>
                  {c.value}
                </span>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={onOpenMoves}
            className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold text-[#b8860b] hover:text-[#d4a550] dark:text-[#d4a550]"
          >
            See all <ChevronRight className="h-3.5 w-3.5" />
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
          <p className="-mt-0.5 text-[10px] text-slate-500">90-day outlook</p>
          {cashTrajectory ? (
            <>
              <CashSpark points={cashTrajectory.points} />
              <p className="mt-1 text-sm font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
                {cashTrajectory.projectedValue}
              </p>
            </>
          ) : (
            <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
              Open Cash Forecast to project ahead.
            </p>
          )}
        </RailCard>
      </div>
    </aside>
  );
}
