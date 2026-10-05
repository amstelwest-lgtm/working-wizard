/**
 * Shared presentational helpers for the owner board ratio cards / health bars.
 * Extracted from app.tsx to keep the route file focused on state + layout.
 */

import { formatMoneyCompact, ZA_MARKET, type MoneyMarket } from "@/lib/market";
import { healthBandLabel, scoreTier } from "@/lib/ratios";

export function pct(x: number) {
  if (!isFinite(x)) return "—";
  return `${(x * 100).toFixed(2)}%`;
}

export function formatVal(
  v: number,
  f: "x" | "pct" | "days" | "money",
  market: MoneyMarket = ZA_MARKET,
) {
  if (!isFinite(v)) return "—";
  if (f === "pct") return pct(v);
  if (f === "days") return `${v.toFixed(1)} d`;
  if (f === "money") return formatMoneyCompact(v, market);
  return `${v.toFixed(3)}×`;
}

export function clampN(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}

export function tierColor(h: number) {
  if (!isFinite(h))
    return { bar: "bg-slate-500", text: "text-slate-300", border: "border-slate-600", glow: "" };
  const tier = scoreTier(h);
  if (tier === "healthy")
    return {
      bar: "bg-gradient-to-r from-emerald-500 to-emerald-400",
      text: "text-emerald-300",
      border: "border-emerald-500/50",
      glow: "shadow-[0_0_20px_-5px_rgb(16,185,129,0.6)]",
    };
  if (tier === "at_risk")
    return {
      bar: "bg-gradient-to-r from-yellow-500 to-yellow-400",
      text: "text-yellow-300",
      border: "border-yellow-500/50",
      glow: "shadow-[0_0_20px_-5px_rgb(234,179,8,0.5)]",
    };
  return {
    bar: "bg-gradient-to-r from-red-600 to-red-500",
    text: "text-red-300",
    border: "border-red-500/50",
    glow: "shadow-[0_0_20px_-5px_rgb(239,68,68,0.6)]",
  };
}

/** Same words as Overview and Health: Healthy / Watch / Critical. */
export function tierLabel(h: number) {
  if (!isFinite(h)) return "—";
  return healthBandLabel(scoreTier(h));
}

export function HealthBar({ health }: { health: number }) {
  const t = tierColor(health);
  const w = clampN(health, 0, 100);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider">
        <span className={t.text}>{tierLabel(health)}</span>
        <span className={`tabular-nums ${t.text}`}>
          {isFinite(health) ? `${health.toFixed(0)}%` : "—"}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full border border-slate-700 bg-slate-950">
        <div className={`h-full ${t.bar} transition-all duration-500`} style={{ width: `${w}%` }} />
      </div>
    </div>
  );
}
