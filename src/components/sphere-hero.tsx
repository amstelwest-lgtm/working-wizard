import { useCallback, useRef, useState } from "react";
import { ArrowLeft, ChevronRight, TrendingUp, Layers, Shield, Droplet, type LucideIcon } from "lucide-react";

/**
 * SphereHero — the morphing 3-level health drill-down.
 *
 * Level 1: one large golden sphere (overall Business Health Score) with a
 *          compact 4-stat pillar row beneath it.
 * Level 2: main sphere shrinks to the top; the four pillars morph in as
 *          glowing sphere cards in a 2×2 grid.
 * Level 3: the chosen pillar's sphere takes the stage; its underlying
 *          drivers render as rows with progress bars (end of the drill).
 *
 * All transitions are reversible (back arrows + tapping the shrunken main
 * sphere collapses upward). Every sphere tap plays a synthesized metallic
 * "klink" via the Web Audio API — no audio asset needed.
 *
 * Fully data-driven via props: pass real scores from healthMap /
 * pillarHealths in app.tsx. Non-finite scores render as "—" in neutral grey,
 * consistent with the platform's no-data convention.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type SphereDriver = {
  key: string;
  label: string;
  description?: string;
  /** 0–100 health score; NaN = no data */
  health: number;
};

export type SpherePillar = {
  id: "profit" | "assets" | "financing" | "cash";
  label: string;
  /** 0–100 health score; NaN = no data */
  health: number;
  /** Period-over-period change in score, e.g. +8 / -5. Omit to hide. */
  delta?: number;
  /** One-line blurb shown on the pillar card at level 2. */
  blurb?: string;
  drivers: SphereDriver[];
};

export type SphereHeroProps = {
  overallHealth: number;
  /**
   * When set, drives overall orb colour/label (critical-pillar demotion)
   * instead of raw score bands. Values match `OverallHealth.displayStatus`.
   */
  displayStatus?: "healthy" | "at_risk" | "critical" | null;
  overallDelta?: number;
  pillars: SpherePillar[];
  topPriority?: {
    title: string;
    description: string;
    /** Optional action bullets shown under the next-move headline */
    actions?: string[];
    /** e.g. "+R42k additional cash in next 90 days" */
    impactLabel?: string;
  };
  /** Called when the user taps the Top Priority arrow, if provided. */
  onTopPriority?: () => void;
  /** Optional one-line caption under the score sphere */
  caption?: string;
  /** Denser overview layout — smaller orb, tighter spacing */
  compact?: boolean;
};

// ── Tier helpers (aligned with scoreTier in @/lib/ratios: 65 / 40) ──────────

type Tier = "healthy" | "watch" | "critical" | "nodata";

function tierOf(h: number): Tier {
  if (!isFinite(h)) return "nodata";
  if (h >= 65) return "healthy";
  if (h >= 40) return "watch";
  return "critical";
}

function tierFromDisplayStatus(
  status: "healthy" | "at_risk" | "critical" | null | undefined,
  score: number,
): Tier {
  if (status == null) return tierOf(score);
  if (status === "healthy") return "healthy";
  if (status === "at_risk") return "watch";
  return "critical";
}

const TIER_TEXT: Record<Tier, string> = {
  healthy: "text-emerald-400",
  watch: "text-amber-400",
  critical: "text-rose-400",
  nodata: "text-slate-400",
};

const TIER_LABEL: Record<Tier, string> = {
  healthy: "GOOD",
  watch: "FAIR",
  critical: "NEEDS ATTENTION",
  nodata: "NO DATA",
};

const TIER_GLOW: Record<Tier, string> = {
  healthy: "16,185,129",   // emerald-500
  watch: "245,158,11",     // amber-500
  critical: "244,63,94",   // rose-500
  nodata: "100,116,139",   // slate-500
};

const GOLD = "212,164,53";

const PILLAR_ICON: Record<SpherePillar["id"], LucideIcon> = {
  profit: TrendingUp,
  assets: Layers,
  financing: Shield,
  cash: Droplet,
};

function fmtScore(h: number): string {
  return isFinite(h) ? String(Math.round(h)) : "—";
}

// ── Metallic "klink" — synthesized, no asset ────────────────────────────────
// Two inharmonic high partials with fast exponential decay + a whisper of
// filtered noise reads as metal-on-metal. Context is created lazily on the
// first tap (required: browsers only allow audio after a user gesture).

let audioCtx: AudioContext | null = null;

function playKlink() {
  try {
    if (!audioCtx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      audioCtx = new Ctx();
    }
    if (audioCtx.state === "suspended") void audioCtx.resume();
    const now = audioCtx.currentTime;
    const out = audioCtx.createGain();
    out.gain.setValueAtTime(0.16, now);
    out.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    out.connect(audioCtx.destination);

    // Inharmonic partials → metallic character
    for (const [freq, gain, decay] of [
      [2483, 1.0, 0.16],
      [3729, 0.6, 0.12],
      [5211, 0.35, 0.08],
    ] as const) {
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now);
      g.gain.setValueAtTime(gain, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + decay);
      osc.connect(g).connect(out);
      osc.start(now);
      osc.stop(now + decay + 0.02);
    }

    // Tiny high-passed noise transient for the strike
    const len = Math.floor(audioCtx.sampleRate * 0.03);
    const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const noise = audioCtx.createBufferSource();
    noise.buffer = buf;
    const hp = audioCtx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 4000;
    const ng = audioCtx.createGain();
    ng.gain.setValueAtTime(0.25, now);
    ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);
    noise.connect(hp).connect(ng).connect(out);
    noise.start(now);
  } catch {
    // Audio is a garnish — never let it break the UI.
  }
}

// ── Sphere primitive ────────────────────────────────────────────────────────

function Sphere({
  score,
  label,
  sublabel,
  delta,
  size,
  glowRgb,
  numberClass,
  onClick,
  icon: Icon,
  scoreClass,
  className,
}: {
  score: number;
  label?: string;
  sublabel?: string;
  delta?: number;
  size: number;
  glowRgb: string;
  numberClass: string;
  onClick?: () => void;
  icon?: LucideIcon;
  scoreClass?: string;
  className?: string;
}) {
  const tier = tierOf(score);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      aria-label={label ? `${label} score ${fmtScore(score)}` : `Score ${fmtScore(score)}`}
      className={`group relative flex shrink-0 select-none flex-col items-center justify-center rounded-full outline-none transition-transform duration-500 ease-out focus-visible:ring-2 focus-visible:ring-amber-400/60 enabled:cursor-pointer enabled:active:scale-95${className ? ` ${className}` : ""}`}
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle at 32% 26%, rgba(255,255,255,0.14), rgba(0,0,0,0) 42%), radial-gradient(circle at 50% 45%, rgba(20,18,10,0.96) 58%, rgba(${glowRgb},0.55) 92%, rgba(${glowRgb},0.9) 100%)`,
        boxShadow: `0 0 ${size * 0.16}px rgba(${glowRgb},0.55), 0 0 ${size * 0.45}px rgba(${glowRgb},0.28), inset 0 0 ${size * 0.22}px rgba(${glowRgb},0.35)`,
      }}
    >
      {/* shine sweep on hover/tap */}
      <span
        className="pointer-events-none absolute inset-0 overflow-hidden rounded-full"
        aria-hidden
      >
        <span className="absolute -left-1/2 top-0 h-full w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-white/25 to-transparent opacity-0 transition-all duration-700 group-hover:left-full group-hover:opacity-100" />
      </span>

      {Icon && <Icon className={`mb-1 h-[12%] w-[12%] min-h-4 min-w-4 ${TIER_TEXT[tier]}`} />}
      {label && (
        <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-200" style={{ fontSize: Math.max(9, size * 0.052) }}>
          {label}
        </span>
      )}
      <span className={`${numberClass} ${scoreClass ?? ""} font-bold leading-none`} style={{ fontSize: size * 0.30 }}>
        {fmtScore(score)}
      </span>
      <span className={`mt-1 flex items-center gap-1 font-semibold tracking-widest ${TIER_TEXT[tier]}`} style={{ fontSize: Math.max(8, size * 0.048) }}>
        {TIER_LABEL[tier]}
        {typeof delta === "number" && delta !== 0 && (
          <span className={delta > 0 ? "text-emerald-400" : "text-rose-400"}>
            {delta > 0 ? "↑" : "↓"} {Math.abs(Math.round(delta))}
          </span>
        )}
      </span>
      {sublabel && (
        <span className="mt-0.5 text-slate-400" style={{ fontSize: Math.max(8, size * 0.042) }}>
          {sublabel}
        </span>
      )}
    </button>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

type Level = 1 | 2 | 3;

export function SphereHero({
  overallHealth,
  displayStatus,
  overallDelta,
  pillars,
  topPriority,
  onTopPriority,
  caption,
  compact = false,
}: SphereHeroProps) {
  const [level, setLevel] = useState<Level>(1);
  const [activePillarId, setActivePillarId] = useState<SpherePillar["id"] | null>(null);
  const liveRef = useRef<HTMLDivElement>(null);

  const activePillar = pillars.find((p) => p.id === activePillarId) ?? null;
  const orbSize = compact ? 196 : 280;

  const go = useCallback((next: Level, pillarId?: SpherePillar["id"]) => {
    playKlink();
    if (pillarId !== undefined) setActivePillarId(pillarId);
    setLevel(next);
  }, []);

  const overallTier = tierFromDisplayStatus(displayStatus, overallHealth);
  const overallGlow = overallTier === "healthy" || overallTier === "watch" ? GOLD : TIER_GLOW[overallTier];

  return (
    <div className={`relative flex w-full flex-col items-center ${compact ? "px-0 pb-0 pt-0" : "px-4 pb-6 pt-2"}`}>
      {/* ambient motes */}
      {!compact && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
          {[12, 28, 55, 71, 88].map((left, i) => (
            <span
              key={i}
              className="absolute h-1 w-1 rounded-full bg-amber-300/50"
              style={{ left: `${left}%`, top: `${(i * 37 + 12) % 85}%`, filter: "blur(0.5px)" }}
            />
          ))}
        </div>
      )}

      {/* back control (levels 2 & 3) */}
      <div className={`mb-2 flex w-full items-center transition-opacity duration-300 ${level > 1 ? "opacity-100" : "pointer-events-none h-0 opacity-0"}`}>
        <button
          type="button"
          onClick={() => go(level === 3 ? 2 : 1)}
          className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm text-slate-600 transition hover:text-amber-700 dark:text-slate-300 dark:hover:text-amber-300"
        >
          <ArrowLeft className="h-4 w-4" />
          {level === 3 ? "Back to pillars" : "Back to overview"}
        </button>
      </div>

      {/* ── LEVEL 1 & 2: main sphere (morphs size) ── */}
      {level < 3 && (
        <>
          <div
            className="transition-all duration-500 ease-out"
            style={{
              transform: level === 2 ? "scale(0.52)" : "scale(1)",
              marginBottom: level === 2 ? -56 : 0,
              marginTop: level === 2 ? -28 : 0,
            }}
          >
            <Sphere
              score={overallHealth}
              label="Business Health Score"
              delta={overallDelta}
              size={orbSize}
              glowRgb={overallGlow}
              numberClass="text-amber-300"
              onClick={() => go(level === 1 ? 2 : 1)}
              className="health-orb"
            />
          </div>

          <p
            className={`${compact ? "mt-2.5" : "mt-4"} max-w-md text-center transition-opacity duration-300 ${
              level === 1 ? "opacity-100" : "opacity-0"
            }`}
          >
            <span className={`block text-slate-600 dark:text-slate-300 ${compact ? "text-[13px] leading-snug" : "text-sm"}`}>
              {caption
                ? caption
                : overallTier === "healthy"
                  ? "Your business is in good shape — keep building momentum."
                  : overallTier === "watch"
                    ? "Your business is stable, but cash conversion is holding you back."
                    : overallTier === "critical"
                      ? "Your business needs urgent attention — start with the priority below."
                      : "Add your first numbers to see your health score."}
            </span>
          </p>
        </>
      )}

      {/* ── LEVEL 1: compact pillar stat row ── */}
      {level === 1 && (
        <div className={`${compact ? "mt-3" : "mt-5"} grid w-full max-w-xl grid-cols-2 gap-2 sm:grid-cols-4`}>
          {pillars.map((p) => {
            const Icon = PILLAR_ICON[p.id];
            const t = tierOf(p.health);
            const delta = typeof p.delta === "number" ? p.delta : null;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => go(2)}
                className={`flex flex-col items-center rounded-xl border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:border-[#d4a550]/55 hover:shadow-[0_4px_14px_rgba(184,134,11,0.12)] dark:border-white/10 dark:bg-[#0f172a]/60 dark:shadow-none dark:hover:bg-[#d4a550]/8 ${
                  compact ? "gap-0.5 px-1 py-2" : "gap-1 px-1 py-3"
                }`}
              >
                <span className={`flex items-center justify-center rounded-full border border-amber-500/30 bg-[#d4a550]/10 ${compact ? "h-7 w-7" : "h-9 w-9"}`}>
                  <Icon className={`${compact ? "h-3.5 w-3.5" : "h-4 w-4"} text-amber-600 dark:text-amber-400`} />
                </span>
                <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                  {p.label}
                </span>
                <span className={`font-bold tabular-nums ${TIER_TEXT[t]} ${compact ? "text-[15px]" : "text-base"}`}>
                  {fmtScore(p.health)}
                </span>
                {delta != null && (
                  <span
                    className={`text-[10px] font-semibold ${
                      delta > 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : delta < 0
                          ? "text-rose-600 dark:text-rose-400"
                          : "text-slate-500"
                    }`}
                  >
                    {delta > 0 ? "↑" : delta < 0 ? "↓" : "→"} {Math.abs(Math.round(delta))} pts
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* ── LEVEL 2: pillar sphere grid ── */}
      {level === 2 && (
        <>
          <p className="mb-3 mt-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-amber-400/90">
            Health by pillar
          </p>
          <div className="grid w-full max-w-md grid-cols-2 gap-3">
            {pillars.map((p, i) => {
              const t = tierOf(p.health);
              return (
                <div
                  key={p.id}
                  className="animate-in fade-in zoom-in-75 flex flex-col items-center rounded-2xl border border-amber-900/15 bg-white/80 p-4 shadow-[0_12px_30px_rgba(121,91,27,0.08)] duration-500 dark:border-slate-800/80 dark:bg-slate-950/40 dark:shadow-none"
                  style={{ animationDelay: `${i * 70}ms`, animationFillMode: "both" }}
                >
                  <Sphere
                    score={p.health}
                    label={p.label}
                    delta={p.delta}
                    size={132}
                    glowRgb={TIER_GLOW[t]}
                    numberClass={TIER_TEXT[t]}
                    icon={PILLAR_ICON[p.id]}
                    onClick={() => go(3, p.id)}
                  />
                  {p.blurb && (
                    <div className="mt-3 flex w-full items-center justify-between gap-1">
                      <p className="text-xs leading-snug text-slate-400">{p.blurb}</p>
                      <ChevronRight className="h-4 w-4 shrink-0 text-amber-500/70" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ── LEVEL 3: pillar focus + driver rows ── */}
      {level === 3 && activePillar && (
        <>
          <div className="animate-in fade-in zoom-in-90 duration-500" style={{ animationFillMode: "both" }}>
            <Sphere
              score={activePillar.health}
              label={activePillar.label}
              delta={activePillar.delta}
              size={210}
              glowRgb={TIER_GLOW[tierOf(activePillar.health)]}
              numberClass={TIER_TEXT[tierOf(activePillar.health)]}
              icon={PILLAR_ICON[activePillar.id]}
              onClick={() => go(2)}
            />
          </div>

          <p className="mb-3 mt-5 text-[11px] font-semibold uppercase tracking-[0.3em] text-amber-400/90">
            {activePillar.label} drivers
          </p>

          <div className="w-full max-w-md space-y-2">
            {activePillar.drivers.map((d, i) => {
              const t = tierOf(d.health);
              const pct = isFinite(d.health) ? Math.max(2, Math.min(100, d.health)) : 0;
              return (
                <div
                  key={d.key}
                  className="animate-in fade-in slide-in-from-bottom-2 rounded-xl border border-amber-900/15 bg-white/85 p-3 shadow-[0_8px_24px_rgba(121,91,27,0.07)] duration-400 dark:border-slate-800/80 dark:bg-slate-950/50 dark:shadow-none"
                  style={{ animationDelay: `${i * 60}ms`, animationFillMode: "both" }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{d.label}</p>
                      {d.description && (
                        <p className="truncate text-xs text-slate-500">{d.description}</p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className={`text-lg font-bold leading-none ${TIER_TEXT[t]}`}>{fmtScore(d.health)}</p>
                      <p className={`text-[9px] font-semibold tracking-widest ${TIER_TEXT[t]}`}>{TIER_LABEL[t]}</p>
                    </div>
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${pct}%`,
                        background: `linear-gradient(90deg, rgba(${TIER_GLOW[t]},0.6), rgba(${TIER_GLOW[t]},1))`,
                        boxShadow: `0 0 8px rgba(${TIER_GLOW[t]},0.7)`,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ── Your Next Move card (levels 1 & 3) ── */}
      {topPriority && level !== 2 && (
        <div
          className={`w-full max-w-xl rounded-xl border border-[#d4a550]/35 bg-gradient-to-br from-amber-50/90 via-white to-white shadow-[0_8px_24px_rgba(121,91,27,0.08)] dark:from-[#d4a550]/12 dark:via-slate-950/60 dark:to-slate-950/40 dark:shadow-none ${
            compact ? "mt-3 p-3.5" : "mt-6 p-4"
          }`}
        >
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#b8860b] dark:text-[#d4a550]">
            Your Next Move
          </p>
          <p className="mt-1.5 text-[15px] font-semibold leading-snug text-slate-900 dark:text-white">
            {topPriority.title}
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
            {topPriority.description}
          </p>
          {topPriority.actions && topPriority.actions.length > 0 && (
            <ul className="mt-2.5 space-y-1">
              {topPriority.actions.slice(0, compact ? 3 : 5).map((a) => (
                <li key={a} className="flex items-start gap-2 text-[12px] text-slate-700 dark:text-slate-300">
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#d4a550]/20 text-[10px] font-bold text-[#b8860b] dark:text-[#d4a550]">
                    ✓
                  </span>
                  <span className="min-w-0 flex-1">{a}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-[#d4a550]/20 pt-2.5">
            <div className="min-w-0">
              <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-500">
                Potential impact
              </p>
              {topPriority.impactLabel ? (
                <p className="mt-0.5 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                  {topPriority.impactLabel}
                </p>
              ) : (
                <p className="mt-0.5 text-xs text-slate-500">Open Next Moves for the full playbook</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                playKlink();
                onTopPriority?.();
              }}
              aria-label="Open next move"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-amber-500/40 bg-[#d4a550]/10 text-amber-600 transition hover:bg-amber-500/20 dark:text-amber-400"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}

      {/* polite live region for screen readers */}
      <div ref={liveRef} aria-live="polite" className="sr-only">
        {level === 1 ? "Overview" : level === 2 ? "Pillar view" : `${activePillar?.label ?? ""} drivers`}
      </div>
    </div>
  );
}
