import { useCallback, useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import {
  ArrowLeft,
  ChevronRight,
  TrendingUp,
  Layers,
  Shield,
  Droplet,
  type LucideIcon,
} from "lucide-react";
import { healthBandLabel, scoreTier, type HealthTier } from "@/lib/ratios";
import { DigCue, DigLeaf, HEALTH_DRILL_CUE } from "@/components/health-drill-cue";

/**
 * SphereHero — the morphing 3-level health drill-down.
 *
 * Level 1: one large cobalt sphere (overall Business Health Score) with a
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
  /** No-inventory industries. The score reads N/A instead of a number. */
  na?: boolean;
};

export type SpherePillar = {
  id: "profit" | "assets" | "financing" | "cash";
  label: string;
  /** 0–100 health score; NaN = no data */
  health: number;
  /**
   * Capped pillar band from computeOverallHealth. When set, the label follows
   * this instead of re-scoring the average (an average must not read Healthy
   * when every component ratio is Watch or Critical).
   */
  status?: HealthTier;
  /** Shown instead of a band when the pillar has no confident score. */
  note?: string | null;
  /** Period-over-period change in score, e.g. +8 / -5. Omit to hide. */
  delta?: number;
  /** One-line blurb shown on the pillar card at level 2. */
  blurb?: string;
  drivers: SphereDriver[];
};

/** Caption under the health ring. Same words as the pillar cards, both sides. */
export const HEALTH_RING_CAPTION = HEALTH_DRILL_CUE;

export type SphereHeroProps = {
  /**
   * "orb" keeps the glowing sphere (accountant studio). "ring" is the owner
   * premium pass: a flat score ring with a band pill, key takeaways and
   * pillar cards. Same data, same drill, different level-1 presentation.
   */
  variant?: "orb" | "ring";
  overallHealth: number;
  /**
   * When set, drives overall orb colour/label (critical-pillar demotion)
   * instead of raw score bands. Values match `OverallHealth.displayStatus`.
   */
  displayStatus?: "healthy" | "at_risk" | "critical" | null;
  /**
   * Replaces the overall band word ("Watch") when cash and health share one
   * status, e.g. "Critical: cash below floor". Pillars keep their own band.
   */
  statusLabel?: string | null;
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
  /** The answer strip owns the sentence, so the orb does not repeat it. */
  hideCaption?: boolean;
  /** Denser overview layout — smaller orb, tighter spacing */
  compact?: boolean;
  /**
   * The hero sits on an always-dark surface regardless of theme (the studio's
   * orb card), so text under the orb must be light even in light mode.
   */
  onDark?: boolean;
  /** Owner home: the orb opens Health instead of drilling in place. */
  onOrbOpen?: () => void;
  /** Owner Health: open the money briefing for a drilled-down driver ratio. */
  onDriverClick?: (key: string) => void;
  /** Unresolved owner questions keyed by driver ratio (debtorDays, …). */
  queryCounts?: Record<string, number>;
  /**
   * Open a pillar's drivers from outside the orb (the accountant pillar cards).
   * `token` must change on each request so a later tap still drills after the
   * owner has backed out.
   */
  drillTo?: { token: number; pillarId: SpherePillar["id"] } | null;
  /**
   * Short line under the Cash pillar when cash is below the minimum.
   * The score and the band word stay as they are.
   */
  cashFloorCue?: string | null;
  /** Opens the Financial Manager. The cue is the only control that uses it. */
  onCashFloor?: () => void;
};

// ── Tier helpers (HEALTH_BAND_TABLE via scoreTier) ──────────────────────────

type Tier = "healthy" | "watch" | "critical" | "nodata";

function QueryBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-1 inline-flex items-center rounded-full bg-[#0B5FFF] px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
      {count === 1 ? "1 query" : `${count} queries`}
    </span>
  );
}

function tierOf(h: number, status?: HealthTier | null): Tier {
  if (!isFinite(h)) return "nodata";
  const tier = status ?? scoreTier(h);
  if (tier === "healthy") return "healthy";
  if (tier === "at_risk") return "watch";
  return "critical";
}

function tierFromDisplayStatus(
  status: "healthy" | "at_risk" | "critical" | null | undefined,
  score: number,
): Tier {
  if (!isFinite(score)) return "nodata";
  if (status == null) return tierOf(score);
  if (status === "healthy") return "healthy";
  if (status === "at_risk") return "watch";
  return "critical";
}

const TIER_TEXT: Record<Tier, string> = {
  healthy: "text-emerald-400",
  watch: "text-[#B7791F]",
  critical: "text-rose-400",
  nodata: "text-slate-400",
};

const TIER_LABEL: Record<Tier, string> = {
  healthy: healthBandLabel("healthy"),
  watch: healthBandLabel("at_risk"),
  critical: healthBandLabel("critical"),
  nodata: "No data",
};

const TIER_GLOW: Record<Tier, string> = {
  healthy: "22,132,91",
  watch: "183,121,31",
  critical: "196,61,75",
  nodata: "100,116,139",
};

const ORB_GLOW = "11,95,255";
const PILLAR_GLOW = "37,99,235";

const PILLAR_ICON: Record<SpherePillar["id"], LucideIcon> = {
  profit: TrendingUp,
  assets: Layers,
  financing: Shield,
  cash: Droplet,
};

function fmtScore(h: number): string {
  return isFinite(h) ? String(Math.round(h)) : "—";
}

function pillarBandLabel(pillar: SpherePillar, tier: Tier): string {
  if (pillar.note && !isFinite(pillar.health)) return pillar.note;
  return TIER_LABEL[tier];
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
  ariaLabel,
  tier: tierProp,
  bandLabel,
  fit = false,
  decorative = false,
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
  ariaLabel?: string;
  /** Overall orb follows displayStatus. Pillars fall back to the score table. */
  tier?: Tier;
  /** Overall status phrase. Pillars leave this unset and keep the band word. */
  bandLabel?: string | null;
  /** Fill the card. A fixed pixel size overflows the pillar card at 390px. */
  fit?: boolean;
  /** Drawn inside another button. Not its own control. */
  decorative?: boolean;
}) {
  const tier = tierProp ?? tierOf(score);
  const scoreSize = fit ? `min(${size * 0.3}px, 28cqw)` : `${size * 0.3}px`;
  const labelSize = fit ? `min(${Math.max(9, size * 0.052)}px, 9cqw)` : `${Math.max(9, size * 0.052)}px`;
  const tierSize = fit ? `min(${Math.max(8, size * 0.048)}px, 8cqw)` : `${Math.max(8, size * 0.048)}px`;
  const classNameJoined = `sphere-orb group relative flex select-none flex-col items-center justify-center rounded-full outline-none transition-transform duration-500 ease-out${decorative ? "" : " focus-visible:ring-2 focus-visible:ring-[#0B5FFF]/70 enabled:cursor-pointer enabled:active:scale-95"}${fit ? " aspect-square w-full min-w-0 max-w-full" : " shrink-0"}${className ? ` ${className}` : ""}`;
  const style = {
    width: fit ? "100%" : size,
    maxWidth: fit ? size : undefined,
    height: fit ? ("auto" as const) : size,
    aspectRatio: fit ? "1 / 1" : undefined,
    containerType: fit ? ("inline-size" as const) : undefined,
    background: `radial-gradient(circle at 32% 26%, rgba(56,189,248,0.35), rgba(0,0,0,0) 42%), radial-gradient(circle at 50% 45%, rgba(16,42,67,0.96) 58%, rgba(${glowRgb},0.55) 92%, rgba(${glowRgb},0.9) 100%)`,
    boxShadow: `0 0 ${size * 0.16}px rgba(${glowRgb},0.55), 0 0 ${size * 0.45}px rgba(${glowRgb},0.28), inset 0 0 ${size * 0.22}px rgba(${glowRgb},0.35)`,
  };
  const body = (
    <>
      {/* shine sweep on hover/tap */}
      <span
        className="pointer-events-none absolute inset-0 overflow-hidden rounded-full"
        aria-hidden
      >
        <span className="absolute -left-1/2 top-0 h-full w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-white/25 to-transparent opacity-0 transition-all duration-700 group-hover:left-full group-hover:opacity-100" />
      </span>

      {Icon && <Icon className={`mb-1 h-[12%] w-[12%] min-h-4 min-w-4 ${TIER_TEXT[tier]}`} />}
      {label && (
        <span className="text-[10px] font-semibold tracking-[0.04em] text-slate-200" style={{ fontSize: labelSize }}>
          {label}
        </span>
      )}
      <span className={`${numberClass} ${scoreClass ?? ""} font-bold leading-none`} style={{ fontSize: scoreSize }}>
        {fmtScore(score)}
      </span>
      <span
        className={`mt-1 flex max-w-[88%] items-center justify-center gap-1 text-center font-semibold leading-tight ${bandLabel ? "tracking-normal" : "tracking-widest"} ${TIER_TEXT[tier]}`}
        style={{ fontSize: bandLabel && bandLabel.length > 14 ? Math.max(8, size * 0.04) : tierSize }}
      >
        {bandLabel?.trim() || TIER_LABEL[tier]}
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
    </>
  );
  if (decorative) {
    return (
      <div aria-hidden className={classNameJoined} style={style}>
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      aria-label={ariaLabel ?? (label ? `${label} score ${fmtScore(score)}` : `Score ${fmtScore(score)}`)}
      className={classNameJoined}
      style={style}
    >
      {body}
    </button>
  );
}

// ── Ring dial (owner premium variant) ───────────────────────────────────────

const RING_STROKE: Record<Tier, string> = {
  healthy: "var(--ok, #16845b)",
  watch: "var(--warn, #b7791f)",
  critical: "var(--risk, #c43d4b)",
  nodata: "#94a3b8",
};

function RingDial({
  score,
  tier,
  delta,
  onClick,
  ariaLabel,
  bandLabel,
}: {
  score: number;
  tier: Tier;
  delta?: number;
  onClick?: () => void;
  ariaLabel: string;
  bandLabel?: string | null;
}) {
  const radius = 84;
  const circumference = 2 * Math.PI * radius;
  const pct = isFinite(score) ? Math.max(0, Math.min(100, score)) / 100 : 0;
  return (
    <button
      type="button"
      className="health-ring"
      data-tier={tier}
      onClick={onClick}
      disabled={!onClick}
      aria-label={ariaLabel}
    >
      <svg viewBox="0 0 200 200" className="health-ring-svg" aria-hidden="true">
        <circle
          cx="100"
          cy="100"
          r={radius}
          className="health-ring-track"
          strokeWidth="13"
          fill="none"
        />
        <circle
          cx="100"
          cy="100"
          r={radius}
          className="health-ring-arc"
          stroke={RING_STROKE[tier]}
          strokeWidth="13"
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${circumference * pct} ${circumference}`}
          transform="rotate(-90 100 100)"
        />
      </svg>
      <span className="health-ring-center">
        <span className="health-ring-label">Business health score</span>
        <span className={`health-ring-score ${TIER_TEXT[tier]}`}>{fmtScore(score)}</span>
        <span className={`health-band is-${tier}`}>
          {bandLabel?.trim() || TIER_LABEL[tier]}
          {typeof delta === "number" && delta !== 0 ? (
            <span className="health-band-delta">
              {delta > 0 ? "↑" : "↓"} {Math.abs(Math.round(delta))}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

function takeawayDirection(tier: Tier): "up" | "flat" | "down" {
  if (tier === "healthy") return "up";
  if (tier === "critical") return "down";
  return "flat";
}

function TakeawayIcon({ direction }: { direction: "up" | "flat" | "down" }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      {direction === "up" ? (
        <path
          d="M8 12V4m0 0L4.5 7.5M8 4l3.5 3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : direction === "down" ? (
        <path
          d="M8 4v8m0 0l3.5-3.5M8 12L4.5 8.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d="M4 8h8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

type Level = 1 | 2 | 3;

function useCompactOrbSize(compact: boolean): number {
  const base = compact ? 196 : 280;
  const [extra, setExtra] = useState(0);
  useEffect(() => {
    if (!compact) return;
    const apply = () => {
      const w = window.innerWidth;
      if (w >= 1800) setExtra(52);
      else if (w >= 1440) setExtra(28);
      else setExtra(0);
    };
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, [compact]);
  return base + extra;
}

export function SphereHero({
  variant = "orb",
  overallHealth,
  displayStatus,
  statusLabel,
  overallDelta,
  pillars,
  topPriority,
  onTopPriority,
  caption,
  hideCaption = false,
  compact = false,
  onDark = false,
  onOrbOpen,
  onDriverClick,
  queryCounts,
  drillTo,
  cashFloorCue = null,
  onCashFloor,
}: SphereHeroProps) {
  const [level, setLevel] = useState<Level>(1);
  const [activePillarId, setActivePillarId] = useState<SpherePillar["id"] | null>(null);
  const liveRef = useRef<HTMLDivElement>(null);
  const reduceMotion = usePrefersReducedMotion();
  const morphMs = reduceMotion ? 0 : 500;
  const drillToken = drillTo?.token ?? 0;
  const drillPillarId = drillTo?.pillarId;

  useEffect(() => {
    if (!drillToken || !drillPillarId) return;
    setActivePillarId(drillPillarId);
    setLevel(3);
  }, [drillToken, drillPillarId]);

  const activePillar = pillars.find((p) => p.id === activePillarId) ?? null;
  const orbSize = useCompactOrbSize(compact);

  const go = useCallback((next: Level, pillarId?: SpherePillar["id"]) => {
    if (!reduceMotion) playKlink();
    if (pillarId !== undefined) setActivePillarId(pillarId);
    setLevel(next);
  }, [reduceMotion]);

  const overallTier = tierFromDisplayStatus(displayStatus, overallHealth);
  const overallGlow = ORB_GLOW;

  const tapCaption = caption === HEALTH_RING_CAPTION;

  return (
    <div
      id="health-score-drill"
      className={`sphere-reduced-motion relative flex w-full flex-col items-center ${compact ? "px-0 pb-0 pt-0" : "px-4 pb-6 pt-2"}`}
    >
      {/* ambient motes */}
      {onDark && !compact && !reduceMotion && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
          {[12, 28, 55, 71, 88].map((left, i) => (
            <span
              key={i}
              className="absolute h-1 w-1 rounded-full bg-sky-300/50"
              style={{ left: `${left}%`, top: `${(i * 37 + 12) % 85}%`, filter: "blur(0.5px)" }}
            />
          ))}
        </div>
      )}

      {/* back control (levels 2 & 3). Color lives in .sphere-drill-back —
          text-slate-* is forced near-black in light mode and disappears on
          the accountant orb plate. */}
      <div
        className={`mb-2 flex w-full items-center ${reduceMotion ? "" : "transition-opacity duration-300"} ${level > 1 ? "opacity-100" : "pointer-events-none h-0 opacity-0"}`}
      >
        <button
          type="button"
          onClick={() => go(level === 3 ? 2 : 1)}
          className={`sphere-drill-back flex items-center gap-2 rounded-lg px-2.5 py-1 text-sm font-medium ${onDark ? "sphere-drill-back--on-dark" : ""}`}
        >
          <ArrowLeft className="h-4 w-4" />
          {level === 3 ? "Back to pillars" : "Back to overview"}
        </button>
      </div>

      {/* ── RING VARIANT LEVEL 1: flat dial, takeaways, pillar cards ── */}
      {variant === "ring" && level === 1 && (
        <div className="health-ring-pane">
          <div className="health-ring-hero">
            <div className="health-ring-stage">
              <RingDial
                score={overallHealth}
                tier={overallTier}
                bandLabel={statusLabel}
                delta={overallDelta}
                onClick={() => (onOrbOpen ? onOrbOpen() : go(2))}
                ariaLabel={`Business Health Score ${fmtScore(overallHealth)}. ${statusLabel?.trim() || caption || "Dig deeper."}`}
              />
              {tapCaption || !caption ? (
                <button
                  type="button"
                  className="sphere-caption"
                  onClick={() => (onOrbOpen ? onOrbOpen() : go(2))}
                >
                  {caption ?? HEALTH_RING_CAPTION}
                </button>
              ) : (
                <p className="sphere-caption" role="note">
                  {caption}
                </p>
              )}
            </div>
            <div className="health-ring-aside">
              <p className="health-kicker">Key takeaways</p>
              <ul className="health-takeaways">
                {pillars.map((p) => {
                  const t = tierOf(p.health, p.status);
                  const direction = takeawayDirection(t);
                  return (
                    <li key={p.id} className={`health-takeaway is-${direction}`}>
                      <span className="health-takeaway-ic" aria-hidden="true">
                        <TakeawayIcon direction={direction} />
                      </span>
                      <span>
                        {p.label}: {pillarBandLabel(p, t)}
                        {isFinite(p.health) ? ` (${fmtScore(p.health)})` : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {onTopPriority ? (
                <button
                  type="button"
                  className="health-ring-cta"
                  onClick={() => {
                    playKlink();
                    onTopPriority();
                  }}
                >
                  View recommended actions
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </div>
          <p className="health-kicker health-pillar-kicker">Health by pillar</p>
          <div className="health-pillar-cards">
            {pillars.map((p) => {
              const Icon = PILLAR_ICON[p.id];
              const t = tierOf(p.health, p.status);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => go(3, p.id)}
                  aria-label={`${p.label} score ${fmtScore(p.health)}. Dig deeper.`}
                  className="health-pillar-cardx"
                  data-tier={t}
                >
                  <span className="health-pillar-top">
                    <span className="health-pillar-ic" aria-hidden="true">
                      <Icon />
                    </span>
                    <span className="health-pillar-name">{p.label}</span>
                    <span className="health-pillar-chev" aria-hidden="true">
                      <ChevronRight />
                    </span>
                  </span>
                  <span className={`health-pillar-figure ${TIER_TEXT[t]}`}>
                    {fmtScore(p.health)}
                  </span>
                  <span className={`health-pillar-band ${TIER_TEXT[t]}`}>
                    {pillarBandLabel(p, t)}
                    {typeof p.delta === "number" && p.delta !== 0 ? (
                      <span className={p.delta > 0 ? "text-emerald-600" : "text-rose-600"}>
                        {" "}
                        {p.delta > 0 ? "↑" : "↓"} {Math.abs(Math.round(p.delta))}
                      </span>
                    ) : null}
                  </span>
                  <DigCue id={`pillar-ring-${p.id}`} compact />
                  {p.id === "cash" && cashFloorCue ? (
                    <span
                      className="health-cash-floor"
                      data-cash-floor-cue="true"
                      role="link"
                      tabIndex={0}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onCashFloor?.();
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        event.stopPropagation();
                        onCashFloor?.();
                      }}
                    >
                      {cashFloorCue}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── LEVEL 1 & 2: main sphere. The owner ring keeps this orb off
          pillar and driver pages; only the top Health view shows the ring. ── */}
      {variant === "orb" && level < 3 && (
        <>
          <div
            className={`flex flex-col items-center ${reduceMotion ? "" : "transition-all duration-500 ease-out"}`}
            style={{
              transform: level === 2 ? "scale(0.52)" : "scale(1)",
              marginBottom: level === 2 ? -56 : 0,
              marginTop: level === 2 ? -28 : 0,
              transitionDuration: reduceMotion ? "0ms" : undefined,
            }}
          >
            <Sphere
              score={overallHealth}
              tier={overallTier}
              bandLabel={statusLabel}
              label="Business Health Score"
              delta={overallDelta}
              size={orbSize}
              glowRgb={overallGlow}
              numberClass={TIER_TEXT[overallTier]}
              onClick={() => (onOrbOpen ? onOrbOpen() : go(level === 1 ? 2 : 1))}
              ariaLabel={
                onOrbOpen
                  ? `${statusLabel?.trim() || caption || HEALTH_DRILL_CUE}. Business Health Score ${fmtScore(overallHealth)}. Dig deeper.`
                  : level === 1
                    ? `Business Health Score ${fmtScore(overallHealth)}${statusLabel?.trim() ? `, ${statusLabel.trim()}` : ""}. Dig deeper.`
                    : `Business Health Score ${fmtScore(overallHealth)}. Back to overview.`
              }
              className="health-orb"
            />
            {level === 1 ? (
              <DigCue
                id="health-overall"
                onClick={() => (onOrbOpen ? onOrbOpen() : go(2))}
                label={`Dig deeper into the business health score, ${fmtScore(overallHealth)}`}
              />
            ) : null}
          </div>

          {hideCaption || (tapCaption && level === 1) ? null : onOrbOpen && level === 1 ? (
            <button type="button" className="sphere-caption" onClick={onOrbOpen}>
              {caption ?? HEALTH_DRILL_CUE}
            </button>
          ) : (
          <p
            className={`${compact ? "mt-2.5" : "mt-4"} max-w-md text-center ${reduceMotion ? "" : "transition-opacity duration-300"} ${
              level === 1 ? "opacity-100" : "opacity-0"
            }`}
          >
            <span
              // styles.css forces every .text-slate-* near-black in light mode
              // with !important, so on a dark card we must not carry that class.
              className={`block ${onDark ? "" : "text-slate-600 dark:text-slate-300"} ${compact ? "text-[13px] leading-snug" : "text-sm"}`}
              style={onDark ? { color: "#cbd5e1" } : undefined}
            >
              {caption
                ? caption
                : overallTier === "healthy"
                  ? `${healthBandLabel("healthy")}. Keep building momentum.`
                  : overallTier === "watch"
                    ? `${healthBandLabel("at_risk")}. Start with the priority below.`
                    : overallTier === "critical"
                      ? `${healthBandLabel("critical")}. Start with the priority below.`
                      : "Add your first numbers to see your health score."}
            </span>
          </p>
          )}
        </>
      )}

      {/* ── LEVEL 1: compact pillar stat row ── */}
      {variant === "orb" && level === 1 && (
        <div className={`${compact ? "mt-3" : "mt-5"} grid w-full max-w-xl grid-cols-2 gap-2 sm:grid-cols-4`}>
          {pillars.map((p) => {
            const Icon = PILLAR_ICON[p.id];
            const t = tierOf(p.health, p.status);
            const delta = typeof p.delta === "number" ? p.delta : null;
            const q = p.drivers.reduce((n, d) => n + (queryCounts?.[d.key] ?? 0), 0);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => go(3, p.id)}
                aria-label={`${p.label} score ${fmtScore(p.health)}. Dig deeper.`}
                className={`health-pillar-tile flex min-w-0 flex-col items-center rounded-xl border border-[#DBEAFE] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:border-[#0B5FFF]/55 hover:shadow-[0_4px_14px_rgba(16,42,67,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0B5FFF]/50 active:translate-y-px dark:border-[#1e3a5f] dark:bg-[#102A43]/80 dark:shadow-none dark:hover:bg-[#163654] ${
                  compact ? "gap-0.5 px-1 py-2" : "gap-1 px-1 py-3"
                }`}
              >
                <span className={`flex items-center justify-center rounded-full border border-[#DBEAFE] bg-[#DBEAFE] ${compact ? "h-7 w-7" : "h-9 w-9"}`}>
                  <Icon className={`${compact ? "h-3.5 w-3.5" : "h-4 w-4"} text-[#0B5FFF]`} />
                </span>
                <span className="text-xs font-semibold tracking-[0.04em] text-slate-500 dark:text-slate-400">
                  {p.label}
                </span>
                <QueryBadge count={q} />
                <span className={`owner-pillar-score font-bold tabular-nums ${TIER_TEXT[t]} ${compact ? "text-[15px]" : "text-base"}`}>
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
                <DigCue id={`pillar-tile-${p.id}`} compact />
                {p.id === "cash" && cashFloorCue ? (
                  <span
                    className="health-cash-floor"
                    data-cash-floor-cue="true"
                    role="link"
                    tabIndex={0}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onCashFloor?.();
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      event.stopPropagation();
                      onCashFloor?.();
                    }}
                  >
                    {cashFloorCue}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}

      {/* ── LEVEL 2: pillar sphere grid ── */}
      {level === 2 && (
        <>
          <p className="mb-3 mt-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-[#102A43] dark:text-[#F4F7FB]">
            Health by pillar
          </p>
          <div className="grid w-full max-w-md grid-cols-2 gap-3">
            {pillars.map((p, i) => {
              const t = tierOf(p.health, p.status);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => go(3, p.id)}
                  aria-label={`${p.label} score ${fmtScore(p.health)}. Dig deeper.`}
                  className={`owner-pillar-card health-pillar-card flex min-w-0 w-full cursor-pointer flex-col items-center overflow-hidden rounded-2xl border border-[#DBEAFE] bg-white p-2 text-center shadow-[0_12px_30px_rgba(16,42,67,0.06)] transition hover:border-[#0B5FFF]/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0B5FFF]/50 active:translate-y-px sm:p-4 dark:border-slate-800/80 dark:bg-slate-950/40 dark:shadow-none${reduceMotion ? "" : " animate-in fade-in zoom-in-75 duration-500"}`}
                  style={reduceMotion ? undefined : { animationDelay: `${i * morphMs / 7}ms`, animationFillMode: "both" }}
                >
                  <Sphere
                    decorative
                    score={p.health}
                    tier={t}
                    label={p.label}
                    bandLabel={p.note && !isFinite(p.health) ? p.note : undefined}
                    delta={p.delta}
                    size={132}
                    fit
                    glowRgb={PILLAR_GLOW}
                    numberClass={TIER_TEXT[t]}
                    icon={PILLAR_ICON[p.id]}
                    className="owner-pillar-orb"
                  />
                  {p.blurb && (
                    <p className="mt-3 w-full text-xs leading-snug text-slate-400">{p.blurb}</p>
                  )}
                  <DigCue id={`pillar-card-${p.id}`} compact />
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* ── LEVEL 3: pillar focus + driver rows ── */}
      {level === 3 && activePillar && (
        <>
          {variant !== "ring" ? (
            <div className="animate-in fade-in zoom-in-90 duration-500" style={{ animationFillMode: "both" }}>
              <Sphere
                score={activePillar.health}
                tier={tierOf(activePillar.health, activePillar.status)}
                label={activePillar.label}
                delta={activePillar.delta}
                size={210}
                glowRgb={ORB_GLOW}
                numberClass={TIER_TEXT[tierOf(activePillar.health, activePillar.status)]}
                icon={PILLAR_ICON[activePillar.id]}
                onClick={() => go(2)}
                ariaLabel={`${activePillar.label} score ${fmtScore(activePillar.health)}. Back to pillars.`}
              />
            </div>
          ) : null}

          <p className="mb-3 mt-5 text-[11px] font-semibold tracking-[0.04em] text-[#102A43] dark:text-[#F4F7FB]">
            {activePillar.label} drivers
          </p>

          <div className="w-full max-w-md space-y-2">
            {activePillar.drivers.length === 0 && (
              <p className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-sm text-slate-400">
                No driver ratios on file for this pillar yet. Add the period figures to see what
                makes up this score.
              </p>
            )}
            {activePillar.drivers.map((d, i) => {
              const t = tierOf(d.health);
              const pct = isFinite(d.health) ? Math.max(2, Math.min(100, d.health)) : 0;
              const clickable = Boolean(onDriverClick);
              const rowClass = `health-driver-row w-full min-w-0 animate-in fade-in slide-in-from-bottom-2 rounded-xl border border-[#DBEAFE] bg-white p-3 text-left shadow-[0_8px_24px_rgba(16,42,67,0.06)] duration-400 dark:border-slate-800/80 dark:bg-slate-950/50 dark:shadow-none ${
                clickable
                  ? "cursor-pointer transition hover:border-[#0B5FFF]/50 hover:bg-[#F4F8FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0B5FFF]/40 active:translate-y-px dark:hover:border-[#2563EB] dark:hover:bg-[#163654]"
                  : ""
              }`;
              const rowStyle = { animationDelay: `${i * 60}ms`, animationFillMode: "both" as const };
              const body = (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                        {d.label}
                        <QueryBadge count={queryCounts?.[d.key] ?? 0} />
                      </p>
                      {d.description && (
                        <p className="truncate text-xs text-slate-500">{d.description}</p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className={`text-lg font-bold leading-none ${TIER_TEXT[t]}`}>
                        {d.na ? "N/A" : fmtScore(d.health)}
                      </p>
                      {d.na ? null : (
                        <p className={`text-xs font-semibold tracking-widest ${TIER_TEXT[t]}`}>{TIER_LABEL[t]}</p>
                      )}
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
                  {clickable ? null : <DigLeaf />}
                </>
              );
              if (clickable) {
                return (
                  <button
                    key={d.key}
                    type="button"
                    onClick={() => onDriverClick?.(d.key)}
                    aria-label={`${d.label} — open money briefing`}
                    className={rowClass}
                    style={rowStyle}
                  >
                    {body}
                  </button>
                );
              }
              return (
                <div key={d.key} className={rowClass} style={rowStyle}>
                  {body}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ── Next moves under the score (levels 1 & 3) ── */}
      {topPriority && level !== 2 && (
        <div
          className={`w-full max-w-xl rounded-xl border border-[#DBEAFE] bg-white shadow-[0_8px_24px_rgba(16,42,67,0.06)] dark:border-[#1e3a5f] dark:bg-[#102A43] dark:shadow-none ${
            compact ? "mt-3 p-3.5" : "mt-6 p-4"
          }`}
        >
          <p className="font-display text-[17px] font-medium leading-snug text-slate-900 dark:text-[#f6f1e7]">
            Your next moves to improve this score
          </p>
          <p className="mt-1.5 text-[14px] font-semibold leading-snug text-slate-800 dark:text-white">
            {topPriority.title}
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
            {topPriority.description}
          </p>
          {topPriority.actions && topPriority.actions.length > 0 && (
            <ul className="mt-2.5 space-y-1">
              {topPriority.actions.slice(0, compact ? 3 : 5).map((a) => (
                <li key={a} className="flex items-start gap-2 text-[12px] text-slate-700 dark:text-slate-300">
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#DBEAFE] text-[11px] font-bold text-[#102A43] dark:bg-[#163654] dark:text-[#F4F7FB]">
                    ✓
                  </span>
                  <span className="min-w-0 flex-1">{a}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 space-y-3 border-t border-[#DBEAFE] dark:border-[#1e3a5f] pt-2.5">
            {topPriority.impactLabel ? (
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                  Potential impact
                </p>
                <p className="mt-0.5 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                  {topPriority.impactLabel}
                </p>
              </div>
            ) : null}
            {onTopPriority ? (
              <button
                type="button"
                onClick={() => {
                  playKlink();
                  onTopPriority();
                }}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-full border-0 bg-[#0B5FFF] px-4 py-2.5 text-[13px] font-semibold text-white shadow-none transition hover:bg-[#2563EB]"
              >
                See all recommended moves
                <ChevronRight className="h-4 w-4" />
              </button>
            ) : null}
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
