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
  industryPulse: ReactNode;
};

function sentimentClass(s: "good" | "bad" | "neutral") {
  if (s === "good") return "text-emerald-400";
  if (s === "bad") return "text-rose-400";
  return "text-amber-300";
}

function MiniBars({ percentile }: { percentile: number }) {
  // 7 bars; highlight the user's approximate bucket
  const buckets = 7;
  const active = Math.min(buckets - 1, Math.max(0, Math.round((percentile / 100) * (buckets - 1))));
  return (
    <div className="mt-3 flex h-12 items-end gap-1.5">
      {Array.from({ length: buckets }).map((_, i) => {
        const h = 28 + ((i * 17) % 36);
        const isActive = i === active;
        return (
          <div
            key={i}
            className={`flex-1 rounded-sm transition-all ${
              isActive ? "bg-emerald-400/90 shadow-[0_0_12px_rgba(52,211,153,0.45)]" : "bg-white/10"
            }`}
            style={{ height: `${h}%` }}
          />
        );
      })}
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
          <stop offset="0%" stopColor="rgba(212,165,80,0.25)" />
          <stop offset="100%" stopColor="rgba(52,211,153,0.95)" />
        </linearGradient>
      </defs>
      <path d={path} fill="none" stroke="url(#cashTrail)" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="4" fill="#34d399" />
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
  industryPulse,
}: OverviewRailProps) {
  return (
    <aside className="flex w-full max-w-[340px] flex-col gap-4">
      <div className="flex justify-end">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/8 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-emerald-400">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
          {liveLabel}
        </span>
      </div>

      {industryPulse}

      {/* Your Position */}
      <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">Your Position</p>
        <p className="mt-2 text-[15px] font-semibold leading-snug text-white">
          {positionPercentile != null ? (
            <>
              Better than <span className="text-emerald-400">{Math.round(positionPercentile)}%</span> of similar
              businesses.
            </>
          ) : (
            <>Add financials to see how you compare.</>
          )}
        </p>
        {positionPercentile != null && <MiniBars percentile={positionPercentile} />}
        <button
          type="button"
          onClick={onOpenMoves}
          className="mt-3 flex items-center gap-1 text-[11px] font-semibold text-[#d4a550] hover:text-[#e8c06a]"
        >
          See benchmark details <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* This Week */}
      <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">This Week</p>
        <p className="mt-2 text-[15px] font-semibold text-white">
          {weekChanges.length ? `${weekChanges.length} things changed.` : "No changes tracked yet."}
        </p>
        <div className="mt-3 space-y-1.5">
          {weekChanges.map((c) => (
            <div key={c.label} className="flex items-center justify-between text-[12px]">
              <span className="text-slate-400">{c.label}</span>
              <span className={`font-semibold ${sentimentClass(c.sentiment)}`}>{c.value}</span>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={onOpenMoves}
          className="mt-3 flex items-center gap-1 text-[11px] font-semibold text-[#d4a550] hover:text-[#e8c06a]"
        >
          See all changes <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Cash Trajectory */}
      <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">Cash Trajectory</p>
            <p className="mt-0.5 text-[10px] text-slate-500">90 day forecast</p>
          </div>
          <button
            type="button"
            onClick={onOpenCash}
            className="rounded-full border border-white/10 p-1.5 text-slate-400 transition hover:border-[#d4a550]/40 hover:text-[#d4a550]"
            aria-label="Open cash forecast"
          >
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
        {cashTrajectory ? (
          <>
            <CashSpark points={cashTrajectory.points} />
            <p className="mt-2 text-[12px] text-slate-400">{cashTrajectory.projectedLabel}</p>
            <p className="text-xl font-bold tracking-tight text-emerald-400">{cashTrajectory.projectedValue}</p>
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
