import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { KpiTrendline } from "@/components/kpi-trendline";

/**
 * HoloGlobe — Premium 4-pillar orbital business model.
 * Click a pillar → it animates to centre and its drivers orbit it.
 * Click a driver moon → fires onSelect (tab switch + scroll highlight).
 * Click background → toggle auto-rotation pause.
 * Drag → manual rotation.
 * Hover → live hover card with health, benchmark, trendline.
 */

type PillarId = "profit" | "assets" | "financing" | "cash";
type FocusId = "root" | PillarId;
type Format = "x" | "pct" | "days" | "money";

type Driver = { label: string; section: string; tab?: string };

type Pillar = {
  id: PillarId;
  label: string;
  sublabel: string;
  hue: string;
  drivers: Driver[];
  tab: string;
};

export type RatioInfo = {
  friendly: string;
  techName?: string;
  value: number;
  format: Format;
  health: number;
  series?: number[];
  benchmark?: { p25: number; p50: number; p75: number; higher_is_better: boolean } | null;
};

// Champagne gold — all four pillars share the same matte gold aesthetic
const GOLD = "#C9A96A";

const PILLARS: Record<PillarId, Pillar> = {
  profit: {
    id: "profit",
    label: "Profit",
    sublabel: "How we make money",
    hue: GOLD,
    drivers: [
      { label: "Rev Growth",    section: "revenueGrowth" },
      { label: "Rev/Employee",  section: "salesPerEmployee" },
      { label: "Gross Margin",  section: "grossMargin" },
      { label: "Direct Costs",  section: "directCostsRatio" },
      { label: "Opex",          section: "fixedCostRatio" },
      { label: "Interest",      section: "interestBurden" },
      { label: "Tax",           section: "taxBurden" },
    ],
    tab: "dashboard",
  },
  assets: {
    id: "assets",
    label: "Assets",
    sublabel: "What we use to operate",
    hue: GOLD,
    drivers: [
      { label: "Asset Turnover",    section: "assetTurnover" },
      { label: "ROA",               section: "roa" },
      { label: "Inventory Days",    section: "inventoryDays" },
      { label: "Fixed Assets",      section: "fixedCapitalUtilization" },
      { label: "WC Efficiency",     section: "workingCapitalUtilization" },
    ],
    tab: "dashboard",
  },
  financing: {
    id: "financing",
    label: "Financing",
    sublabel: "How we fund the business",
    hue: GOLD,
    drivers: [
      { label: "Equity Cover",      section: "fundingStructure" },
      { label: "Debt/Equity",       section: "debtToEquity" },
      { label: "Debt/Assets",       section: "debtToAssets" },
      { label: "Leverage",          section: "equityMultiplier" },
      { label: "Finance Cost",      section: "interestBurden" },
      { label: "WC Days",           section: "workingCapitalDays" },
    ],
    tab: "dashboard",
  },
  cash: {
    id: "cash",
    label: "Cash",
    sublabel: "What keeps us alive",
    hue: GOLD,
    drivers: [
      { label: "Debtors",           section: "debtorDays" },
      { label: "Creditors",         section: "creditorDays" },
      { label: "Inv. Days",          section: "inventoryDays" },
      { label: "Current Ratio",     section: "currentRatio" },
      { label: "WC Funding",        section: "workingCapitalFunding" },
      { label: "Capex Intensity",   section: "capexIntensity" },
      { label: "Reinvestment",      section: "assetReinvestmentRatio" },
      { label: "Cash Quality",      section: "ocfToEbitda" },
    ],
    tab: "dashboard",
  },
};

const PILLAR_ORDER: PillarId[] = ["profit", "assets", "financing", "cash"];

// Reduced sub-sphere sets for Simplified view.
// Pillar SCORING always uses the full PILLARS[id].drivers list — these are display-only.
const SIMPLIFIED_DRIVERS: Record<PillarId, Driver[]> = {
  profit: [
    { label: "Revenue",     section: "revenueGrowth" },
    { label: "Gross Profit", section: "grossMargin" },
    { label: "Opex",        section: "fixedCostRatio" },
    { label: "Tax",         section: "taxBurden" },
    { label: "Interest",    section: "interestBurden" },
  ],
  assets: [
    { label: "Working Capital", section: "workingCapitalUtilization" },
    { label: "Fixed Assets",    section: "fixedCapitalUtilization" },
    { label: "Inventory",       section: "inventoryDays" },
    { label: "ROA",             section: "roa" },
  ],
  financing: [
    { label: "Finance Cost",    section: "interestBurden" },
    { label: "Working Capital", section: "workingCapitalDays" },
    { label: "Debt/Equity",     section: "debtToEquity" },
  ],
  cash: [
    { label: "Debtors",   section: "debtorDays" },
    { label: "Creditors", section: "creditorDays" },
    { label: "WIP",       section: "inventoryDays" },
  ],
};

type Props = {
  onSelect: (target: { tab: string; section?: string }) => void;
  size?: number;
  ratioLookup?: Record<string, RatioInfo>;
  extras?: { breakevenRevenue?: number; avgHealth?: number; businessName?: string };
  simplified?: boolean;
};

function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function fmtVal(v: number, f: Format) {
  if (!isFinite(v)) return "—";
  if (f === "pct") return `${(v * 100).toFixed(1)}%`;
  if (f === "days") return `${v.toFixed(1)}d`;
  if (f === "money") return v >= 1000 ? `R${(v / 1000).toFixed(1)}k` : `R${v.toFixed(0)}`;
  return `${v.toFixed(2)}×`;
}

function tierColor(h: number) {
  if (!isFinite(h)) return { label: "—", color: "#8E96A3" };
  if (h >= 80) return { label: "Healthy", color: "#3BCF8E" };
  if (h >= 60) return { label: "Average", color: "#D7BF8A" };
  if (h >= 35) return { label: "High Risk", color: "#D4845A" };
  return { label: "Danger", color: "#C25C5C" };
}

function bucketIndex(value: number, b: NonNullable<RatioInfo["benchmark"]>): number {
  const { p25, p50, p75, higher_is_better } = b;
  const iqr = Math.max(1e-9, p75 - p25);
  const pos = (value - p25) / iqr;
  let idx: number;
  if (pos < -0.5) idx = 1;
  else if (pos < 0) idx = 2;
  else if (pos < (p50 - p25) / iqr + 0.001) idx = 3;
  else if (pos < 1) idx = 4;
  else idx = 5;
  return higher_is_better ? idx : 6 - idx;
}

// Deterministic gold speckles — generated once at module load
const SPECKLES = (() => {
  const pts: Array<{ x: number; y: number; r: number; op: number }> = [];
  let s = 0xd1e5f7a3;
  const n = () => {
    s ^= s << 13; s ^= s >> 17; s ^= s << 5;
    return (s >>> 0) / 0xffffffff;
  };
  for (let i = 0; i < 180; i++) {
    pts.push({ x: n(), y: n(), r: 0.5 + n() * 1.4, op: 0.60 + n() * 0.38 });
  }
  return pts;
})();

export function HoloGlobe({ onSelect, size = 520, ratioLookup, extras, simplified }: Props) {
  const cx = size / 2;
  const cy = size / 2;
  const rOrbit = size * 0.34;
  const tilt = 0.42;

  const [focus, setFocus] = useState<FocusId>("root");
  const [pending, setPending] = useState<PillarId | null>(null);
  const [progress, setProgress] = useState(1);
  const [spin, setSpin] = useState(0);
  const [hover, setHover] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [paused, setPaused] = useState(false);
  const dragRef = useRef<{ x: number; y: number; spin: number; moved: boolean } | null>(null);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      if (!dragging && !paused) setSpin((s) => s + dt * 0.00018);
      setProgress((p) => (p >= 1 ? 1 : Math.min(1, p + dt / 700)));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [dragging, paused]);

  useEffect(() => {
    if (progress >= 1 && pending) {
      setFocus(pending);
      setPending(null);
    }
  }, [progress, pending]);

  const startFocus = useCallback((id: PillarId) => {
    setPending(id);
    setProgress(0);
  }, []);

  const resetFocus = useCallback(() => {
    if (focus === "root") return;
    setFocus("root");
    setProgress(1);
  }, [focus]);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDragging(true);
    dragRef.current = { x: e.clientX, y: e.clientY, spin, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    if (Math.hypot(dx, dy) > 4) dragRef.current.moved = true;
    if (dragging) setSpin(dragRef.current.spin + dx * 0.006);
  };
  const onPointerUp = () => {
    const ref = dragRef.current;
    setDragging(false);
    dragRef.current = null;
    if (ref && !ref.moved) {
      setPaused((p) => !p);
    }
  };

  const satellites = useMemo(() => {
    if (focus === "root") {
      return PILLAR_ORDER.map((id, i) => {
        const drivers = PILLARS[id].drivers;
        const healths = drivers
          .map((d) => ratioLookup?.[d.section]?.health)
          .filter((h): h is number => typeof h === "number" && isFinite(h));
        const health = healths.length
          ? healths.reduce((a, b) => a + b, 0) / healths.length
          : NaN;
        return {
          id,
          label: PILLARS[id].label,
          sublabel: PILLARS[id].sublabel,
          hue: PILLARS[id].hue,
          angle: (i / PILLAR_ORDER.length) * Math.PI * 2,
          clickable: true,
          pillarId: id as PillarId,
          health,
        };
      });
    }
    // Display drivers: use simplified set when simplified mode is active.
    // Scoring (above, root view) always uses the full PILLARS list — unaffected.
    const displayDrivers = simplified
      ? SIMPLIFIED_DRIVERS[focus as PillarId]
      : PILLARS[focus].drivers;
    return displayDrivers.map((d, i) => ({
      id: `${focus}-${d.label}`,
      label: d.label,
      sublabel: "",
      hue: PILLARS[focus].hue,
      angle: (i / displayDrivers.length) * Math.PI * 2,
      clickable: true,
      driverOf: focus as PillarId,
      driverSection: d.section,
      driverTab: d.tab ?? PILLARS[focus].tab,
      health: ratioLookup?.[d.section]?.health,
    }));
  }, [focus, ratioLookup, simplified]);

  const e = easeInOut(progress);

  const central =
    focus === "root"
      ? {
          label: extras?.businessName ?? "My Business",
          sublabel: "",
          hue: GOLD,
        }
      : {
          label: PILLARS[focus].label,
          sublabel: PILLARS[focus].sublabel,
          hue: PILLARS[focus].hue,
        };

  const transCentral = pending
    ? {
        label: PILLARS[pending].label,
        sublabel: PILLARS[pending].sublabel,
        hue: PILLARS[pending].hue,
      }
    : null;

  // Auto-show the card for whichever planet is at the front of the orbit (highest z)
  const frontSatId = useMemo(() => {
    if (hover || paused) return null;
    let bestZ = 0.86;
    let bestId: string | null = null;
    for (const s of satellites) {
      const z = Math.sin(s.angle + spin);
      if (z > bestZ) { bestZ = z; bestId = s.id; }
    }
    return bestId;
  }, [satellites, spin, hover, paused]);

  const effectiveHover = hover ?? frontSatId;

  const hoverInfo: { x: number; y: number; info: HoverInfo } | null = useMemo(() => {
    if (!effectiveHover) return null;
    const sat = satellites.find((s) => s.id === effectiveHover);
    if (!sat) return null;
    const a = sat.angle + spin;
    const x = cx + Math.cos(a) * rOrbit;
    const y = cy + Math.sin(a) * rOrbit * tilt;
    if ("driverSection" in sat && sat.driverSection) {
      const r = ratioLookup?.[sat.driverSection];
      if (r) {
        return { x, y, info: { kind: "ratio", title: sat.label, r } };
      }
      return { x, y, info: { kind: "missing", title: sat.label } };
    }
    if ("pillarId" in sat && sat.pillarId) {
      const drivers = PILLARS[sat.pillarId].drivers;
      const healths = drivers
        .map((d) => ratioLookup?.[d.section]?.health)
        .filter((h): h is number => typeof h === "number" && isFinite(h));
      const avg = healths.length
        ? healths.reduce((a, b) => a + b, 0) / healths.length
        : NaN;
      return {
        x,
        y,
        info: {
          kind: "pillar",
          title: sat.label,
          sublabel: PILLARS[sat.pillarId].sublabel,
          health: avg,
          count: drivers.length,
        },
      };
    }
    return null;
  }, [effectiveHover, satellites, spin, cx, cy, rOrbit, tilt, ratioLookup]);

  const diagnostics = useMemo(() => {
    const rl = ratioLookup ?? {};
    const f = (k: string) => {
      const r = rl[k];
      if (!r || !isFinite(r.value)) return "—";
      return fmtVal(r.value, r.format);
    };
    const bev = extras?.breakevenRevenue;
    const bevStr = typeof bev === "number" && isFinite(bev) ? fmtVal(bev, "money") : "—";
    const ah = extras?.avgHealth;
    const healthGrade = (score: number | undefined) => {
      if (typeof score !== "number" || !isFinite(score)) return "—";
      return `${Math.round(score)}%`;
    };
    return [
      { k: "Shareholder Return", v: f("roe") },
      { k: "Net Margin", v: f("netMargin") },
      { k: "Op. Margin", v: f("operatingMargin") },
      { k: "WC Days", v: f("workingCapitalDays") },
      { k: "Break-even", v: bevStr },
      { k: "Fin. Health", v: healthGrade(ah) },
    ];
  }, [ratioLookup, extras]);

  return (
    <div className="relative mx-auto w-full select-none" style={{ maxWidth: size }}>
      {/* Warm ambience behind the canvas */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-full blur-3xl"
        style={{
          background:
            "radial-gradient(circle at 50% 50%, rgba(201,169,106,0.18) 0%, rgba(201,169,106,0.06) 45%, transparent 70%)",
        }}
      />

      <svg
        width="100%"
        viewBox={`0 0 ${size} ${size}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          touchAction: "none",
          cursor: dragging ? "grabbing" : "grab",
          display: "block",
          aspectRatio: "1",
        }}
      >
        <defs>
          {/* Dark matte gradient for the central sphere */}
          <radialGradient id="hg-central" cx="30%" cy="20%" r="82%">
            <stop offset="0%" stopColor="#141C28" />
            <stop offset="55%" stopColor="#080C14" />
            <stop offset="100%" stopColor="#05070B" />
          </radialGradient>
          {/* Vivid gold — bright highlight, warm gold shadows (no brown) */}
          <radialGradient id="hg-sphere" cx="26%" cy="22%" r="72%">
            <stop offset="0%"   stopColor="#FFFBEA" />
            <stop offset="14%"  stopColor="#F7E46A" />
            <stop offset="32%"  stopColor="#E8C030" />
            <stop offset="54%"  stopColor="#C89818" />
            <stop offset="74%"  stopColor="#A87C10" />
            <stop offset="90%"  stopColor="#7A5C08" />
            <stop offset="100%" stopColor="#5A4206" />
          </radialGradient>
          {/* Gold rim light on central sphere edges */}
          <radialGradient id="hg-central-rim" cx="50%" cy="50%" r="50%">
            <stop offset="72%" stopColor="transparent" />
            <stop offset="90%" stopColor="rgba(201,169,106,.30)" />
            <stop offset="100%" stopColor="rgba(201,169,106,.12)" />
          </radialGradient>
          {/* Specular highlight */}
          <radialGradient id="hg-spec" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.38)" />
            <stop offset="48%" stopColor="rgba(255,255,255,0.10)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </radialGradient>
          {/* Soft vignette — gentle edge darkening */}
          <radialGradient id="hg-vignette" cx="50%" cy="50%" r="50%">
            <stop offset="48%" stopColor="transparent" />
            <stop offset="100%" stopColor="rgba(5,7,11,0.42)" />
          </radialGradient>
          {/* Minimal glow — reserved for hover states */}
          <filter id="hg-glow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="3.5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="hg-soft" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.2" />
          </filter>
          {/* Wide diffuse glow for the central sphere ambient halo */}
          <filter id="hg-central-glow" x="-120%" y="-120%" width="340%" height="340%">
            <feGaussianBlur stdDeviation="14" />
          </filter>
        </defs>

        {/* Gold speckles — faint galaxy dust scattered across the canvas */}
        {SPECKLES.map((sp, i) => (
          <circle
            key={`sp${i}`}
            cx={sp.x * size} cy={sp.y * size}
            r={sp.r} fill="#C9A96A" opacity={sp.op}
            pointerEvents="none"
          />
        ))}

        {/* Orbital paths */}
        <ellipse
          cx={cx} cy={cy} rx={rOrbit} ry={rOrbit * tilt}
          fill="none" stroke="rgba(201,169,106,.38)" strokeWidth={1.0}
          strokeDasharray="4 9"
        />
        <ellipse
          cx={cx} cy={cy} rx={rOrbit * 0.72} ry={rOrbit * 0.72 * tilt}
          fill="none" stroke="rgba(201,169,106,.20)" strokeWidth={0.6}
        />
        <ellipse
          cx={cx} cy={cy} rx={rOrbit * 1.18} ry={rOrbit * 1.18 * tilt}
          fill="none" stroke="rgba(201,169,106,.16)" strokeWidth={0.5}
          strokeDasharray="2 14"
        />

        {(() => {
          const satOpacity = pending ? 1 - e : 1;
          const projected = satellites.map((s) => {
            const a = s.angle + spin;
            const x = cx + Math.cos(a) * rOrbit;
            const y = cy + Math.sin(a) * rOrbit * tilt;
            const z = Math.sin(a);
            return { ...s, x, y, z } as SatProjected;
          });
          projected.sort((a, b) => a.z - b.z);

          const baseR = focus === "root" ? size * 0.175 : size * 0.17;
          const pendingSat = pending ? projected.find((p) => p.id === pending) : null;
          const rootR = baseR;

          return (
            <>
              {projected
                .filter((p) => p.z < 0)
                .map((p) =>
                  renderSatellite(
                    p, pending, e, satOpacity, effectiveHover, setHover, startFocus, onSelect,
                  ),
                )}

              {renderCentral({
                cx, cy, r: rootR,
                label: central.label, sublabel: central.sublabel,
                hue: central.hue, opacity: pending ? 1 - e : 1,
                isRoot: focus === "root",
                onBack: focus !== "root" ? resetFocus : undefined,
              })}

              {pendingSat &&
                transCentral &&
                (() => {
                  const tx = pendingSat.x + (cx - pendingSat.x) * e;
                  const ty = pendingSat.y + (cy - pendingSat.y) * e;
                  const startR = size * 0.045;
                  const endR = size * 0.16;
                  const tr = startR + (endR - startR) * e;
                  return renderCentral({
                    cx: tx, cy: ty, r: tr,
                    label: transCentral.label, sublabel: transCentral.sublabel,
                    hue: transCentral.hue, opacity: e, isRoot: false,
                  });
                })()}

              {projected
                .filter((p) => p.z >= 0)
                .map((p) =>
                  renderSatellite(
                    p, pending, e, satOpacity, effectiveHover, setHover, startFocus, onSelect,
                  ),
                )}
            </>
          );
        })()}

        {/* Corner brackets */}
        {(["tl", "tr", "bl", "br"] as const).map((c) => (
          <g key={c}>
            <path
              d={cornerPath(c, size)}
              fill="none"
              stroke="rgba(201,169,106,.55)"
              strokeWidth={1.3}
            />
          </g>
        ))}

        {/* Dark vignette — draws focus to centre */}
        <rect
          x={0} y={0} width={size} height={size}
          fill="url(#hg-vignette)" pointerEvents="none"
        />

        {hoverInfo && (
          <HoverCard x={hoverInfo.x} y={hoverInfo.y} size={size} info={hoverInfo.info} />
        )}
      </svg>

      {/* Bottom diagnostic ratios rail */}
      <div
        className="mt-3 rounded-md px-3 py-2.5"
        style={{
          border: "1px solid rgba(155,122,70,.18)",
          background: "rgba(10,14,20,.88)",
          fontFamily: "ui-monospace, SF Mono, Menlo, monospace",
        }}
      >
        <div
          className="mb-1.5 flex items-center justify-between text-[9px] uppercase tracking-[0.28em]"
          style={{ color: "rgba(155,122,70,.75)" }}
        >
          <span>Key Diagnostic Ratios</span>
          <div className="flex items-center gap-2">
            <span
              className="rounded px-1.5 py-0.5 text-[9px]"
              style={{
                border: `1px solid ${paused ? "rgba(215,191,138,.45)" : "rgba(155,122,70,.22)"}`,
                color: paused ? "#D7BF8A" : "rgba(155,122,70,.55)",
                background: paused ? "rgba(215,191,138,.08)" : "transparent",
              }}
            >
              {paused ? "Paused" : "Live"}
            </span>
            {focus !== "root" && (
              <button
                onClick={resetFocus}
                className="rounded px-2 py-0.5 text-[9px] tracking-[0.2em] transition-colors"
                style={{
                  border: "1px solid rgba(155,122,70,.30)",
                  color: "#C9A96A",
                }}
              >
                ← Overview
              </button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {diagnostics.map((d) => (
            <div key={d.k} className="flex flex-col">
              <span
                className="text-[9px] uppercase tracking-[0.18em]"
                style={{ color: "rgba(142,150,163,.60)" }}
              >
                {d.k}
              </span>
              <span
                className="mt-0.5 text-[12px] tracking-[0.04em]"
                style={{ color: "#D7BF8A" }}
              >
                {d.v}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div
        className="pointer-events-none mt-1 text-center text-[9px] uppercase tracking-[0.32em]"
        style={{
          color: "rgba(100,108,120,.55)",
          fontFamily: "ui-monospace, SF Mono, Menlo, monospace",
        }}
      >
        {focus === "root"
          ? "Tap planet to expand · Click empty to pause · Drag to rotate"
          : "Tap moon to open ratio · Click empty to pause · ← Overview to return"}
      </div>
    </div>
  );
}

// ---------- helpers ----------

function cornerPath(c: "tl" | "tr" | "bl" | "br", size: number) {
  const len = 14;
  const inset = 6;
  switch (c) {
    case "tl": return `M ${inset} ${inset + len} L ${inset} ${inset} L ${inset + len} ${inset}`;
    case "tr": return `M ${size - inset - len} ${inset} L ${size - inset} ${inset} L ${size - inset} ${inset + len}`;
    case "bl": return `M ${inset} ${size - inset - len} L ${inset} ${size - inset} L ${inset + len} ${size - inset}`;
    case "br": return `M ${size - inset - len} ${size - inset} L ${size - inset} ${size - inset} L ${size - inset} ${size - inset - len}`;
  }
}

type SatProjected = {
  id: string;
  label: string;
  sublabel: string;
  hue: string;
  angle: number;
  clickable: boolean;
  pillarId?: PillarId;
  driverOf?: PillarId;
  driverSection?: string;
  driverTab?: string;
  x: number;
  y: number;
  z: number;
  health?: number;
};

function renderSatellite(
  p: SatProjected,
  pending: PillarId | null,
  e: number,
  baseOpacity: number,
  hover: string | null,
  setHover: (s: string | null) => void,
  startFocus: (id: PillarId) => void,
  onSelect: (target: { tab: string; section?: string }) => void,
) {
  const isPending = pending === p.id;
  if (isPending) return null;
  const scale = 0.75 + (p.z + 1) * 0.25;
  const r = (p.clickable ? 46 : 18) * scale;
  const isHover = hover === p.id;
  const op = baseOpacity * (p.z < 0 ? 0.72 : 1);
  const isPillar = !!p.pillarId;
  const health = typeof p.health === "number" && isFinite(p.health) ? p.health : null;
  const healthPct = health !== null ? `${Math.round(health)}%` : null;
  const healthColor = health !== null ? tierColor(health).color : "#8E96A3";
  const healthLabel = health !== null ? tierColor(health).label : null;
  // White halo intensity — ramps up as planet moves to the front of the orbit
  const frontGlow = Math.max(0, (p.z - 0.20) / 0.80);

  return (
    <g key={p.id} opacity={op}>
      {/* White ambient halo — grows as planet comes to front, never gold/brown */}
      {frontGlow > 0.01 && (
        <circle
          cx={p.x} cy={p.y} r={r * 1.75}
          fill="white" opacity={frontGlow * 0.18}
          filter="url(#hg-glow)"
          pointerEvents="none"
        />
      )}

      {/* Hover glow ring */}
      {isHover && (
        <circle
          cx={p.x} cy={p.y} r={r * 1.6}
          fill="white" opacity={0.10}
          filter="url(#hg-glow)"
          pointerEvents="none"
        />
      )}

      {/* Gold planet sphere */}
      <circle
        cx={p.x} cy={p.y} r={r}
        fill="url(#hg-sphere)"
        stroke={isHover ? "rgba(255,255,255,.55)" : "rgba(201,169,106,.50)"}
        strokeWidth={isHover ? 2.0 : 1.2}
        style={{ cursor: p.clickable ? "pointer" : "default" }}
        onPointerDown={(ev) => ev.stopPropagation()}
        onPointerUp={(ev) => ev.stopPropagation()}
        onClick={(ev) => {
          ev.stopPropagation();
          if (!p.clickable) return;
          if (p.driverOf) {
            onSelect({ tab: p.driverTab ?? "dashboard", section: p.driverSection });
          } else if (p.pillarId) {
            startFocus(p.pillarId);
          }
        }}
        onMouseEnter={() => setHover(p.id)}
        onMouseLeave={() => setHover(null)}
      />

      {/* Specular highlight */}
      <ellipse
        cx={p.x - r * 0.27} cy={p.y - r * 0.29}
        rx={r * 0.46} ry={r * 0.29}
        fill="url(#hg-spec)" opacity={0.75} pointerEvents="none"
      />

      {/* ── Labels & health badge above planet ── */}
      <g pointerEvents="none">
        {/* Planet name — large, cream white */}
        <text
          x={p.x} y={p.y - r - 44}
          textAnchor="middle"
          fontSize={p.clickable ? 18 : 13}
          fontFamily="ui-monospace, 'SF Mono', Menlo, monospace"
          fill="#ECE9E2"
          style={{ letterSpacing: "0.18em", fontWeight: 600 }}
        >
          {p.label.toUpperCase()}
        </text>

        {/* Health score badge — scales with planet size */}
        {healthPct && (
          <>
            <text
              x={p.x} y={p.y - r - 24}
              textAnchor="middle"
              fontSize={isPillar ? 14 : 10}
              fontFamily="ui-monospace, 'SF Mono', Menlo, monospace"
              fill={healthColor}
              style={{ fontWeight: 700, letterSpacing: "0.06em" }}
            >
              {healthPct}
            </text>
            {healthLabel && (
              <text
                x={p.x} y={p.y - r - 13}
                textAnchor="middle"
                fontSize={isPillar ? 9 : 7}
                fontFamily="ui-monospace, 'SF Mono', Menlo, monospace"
                fill={healthColor}
                style={{ fontWeight: 500, letterSpacing: "0.14em" }}
                opacity={0.70}
              >
                {healthLabel.toUpperCase()}
              </text>
            )}
            <line
              x1={p.x - (isPillar ? 18 : 12)} y1={p.y - r - 6}
              x2={p.x + (isPillar ? 18 : 12)} y2={p.y - r - 6}
              stroke={healthColor} strokeWidth={isPillar ? 1.0 : 0.7} opacity={0.35}
            />
          </>
        )}

        {/* Connector tick */}
        <line
          x1={p.x} y1={p.y - r} x2={p.x} y2={p.y - r - 4}
          stroke="rgba(201,169,106,.22)" strokeWidth={0.7}
        />

        {/* Sublabel below planet */}
        {p.sublabel && p.z >= 0 && (
          <text
            x={p.x} y={p.y + r + 18}
            textAnchor="middle" fontSize={13}
            fontFamily="ui-monospace, 'SF Mono', Menlo, monospace"
            fill="#8E96A3"
            style={{ letterSpacing: "0.08em" }}
          >
            {p.sublabel}
          </text>
        )}
      </g>
    </g>
  );
}

function renderCentral(opts: {
  cx: number; cy: number; r: number; label: string; sublabel: string;
  hue: string; opacity: number; isRoot: boolean; onBack?: () => void;
}) {
  const { cx, cy, r, label, sublabel, opacity, isRoot } = opts;
  return (
    <g opacity={opacity} key={`central-${label}`}>
      {/* Orbit arcs surrounding the central sphere */}
      <ellipse
        cx={cx} cy={cy} rx={r * 1.44} ry={r * 1.44 * 0.34}
        fill="none" stroke="rgba(201,169,106,.28)" strokeWidth={0.7}
      />
      <ellipse
        cx={cx} cy={cy} rx={r * 1.20} ry={r * 1.20 * 0.34}
        fill="none" stroke="rgba(201,169,106,.18)" strokeWidth={0.55}
        strokeDasharray="3 7"
      />
      <ellipse
        cx={cx} cy={cy} rx={r * 0.68} ry={r * 0.92}
        fill="none" stroke="rgba(201,169,106,.15)" strokeWidth={0.45}
      />

      {/* Ambient golden halo — sits behind the sphere */}
      <circle
        cx={cx} cy={cy} r={r * 1.55}
        fill="#C9A96A" opacity={0.38}
        filter="url(#hg-central-glow)"
        pointerEvents="none"
      />

      {/* Dark matte base sphere */}
      <circle cx={cx} cy={cy} r={r} fill="url(#hg-central)" />

      {/* Gold globe contours — longitude meridians + latitude parallels, clipped to sphere */}
      <defs>
        <clipPath id={`hg-cc-${label.replace(/[^a-z0-9]/gi, "-")}`}>
          <circle cx={cx} cy={cy} r={r - 0.5} />
        </clipPath>
      </defs>
      <g clipPath={`url(#hg-cc-${label.replace(/[^a-z0-9]/gi, "-")})`} pointerEvents="none">
        {/* Prime meridian (vertical centre line) */}
        <line x1={cx} y1={cy - r} x2={cx} y2={cy + r}
          stroke="rgba(201,169,106,.45)" strokeWidth={0.6} />
        {/* ±30° longitude ellipses */}
        <ellipse cx={cx} cy={cy} rx={r * 0.50} ry={r}
          fill="none" stroke="rgba(201,169,106,.32)" strokeWidth={0.55} />
        {/* ±60° longitude ellipses */}
        <ellipse cx={cx} cy={cy} rx={r * 0.87} ry={r}
          fill="none" stroke="rgba(201,169,106,.22)" strokeWidth={0.45} />
        {/* Equator */}
        <ellipse cx={cx} cy={cy} rx={r} ry={r * 0.22}
          fill="none" stroke="rgba(201,169,106,.42)" strokeWidth={0.65} />
        {/* ±30° latitude parallels */}
        <ellipse cx={cx} cy={cy - r * 0.50} rx={r * 0.87} ry={r * 0.87 * 0.22}
          fill="none" stroke="rgba(201,169,106,.28)" strokeWidth={0.50} />
        <ellipse cx={cx} cy={cy + r * 0.50} rx={r * 0.87} ry={r * 0.87 * 0.22}
          fill="none" stroke="rgba(201,169,106,.28)" strokeWidth={0.50} />
        {/* ±60° latitude parallels */}
        <ellipse cx={cx} cy={cy - r * 0.87} rx={r * 0.50} ry={r * 0.50 * 0.22}
          fill="none" stroke="rgba(201,169,106,.18)" strokeWidth={0.38} />
        <ellipse cx={cx} cy={cy + r * 0.87} rx={r * 0.50} ry={r * 0.50 * 0.22}
          fill="none" stroke="rgba(201,169,106,.18)" strokeWidth={0.38} />
      </g>

      {/* Gold edge rim light */}
      <circle cx={cx} cy={cy} r={r} fill="url(#hg-central-rim)" pointerEvents="none" />

      {/* Gold border */}
      <circle
        cx={cx} cy={cy} r={r}
        fill="none"
        stroke="rgba(201,169,106,.65)" strokeWidth={1.4}
      />

      {/* Specular highlight */}
      <ellipse
        cx={cx - r * 0.30} cy={cy - r * 0.36}
        rx={r * 0.48} ry={r * 0.34}
        fill="url(#hg-spec)" opacity={0.72} pointerEvents="none"
      />

      {/* Labels */}
      <g pointerEvents="none">
        <text
          x={cx} y={cy + (isRoot ? 6 : -3)}
          textAnchor="middle"
          fontSize={isRoot ? 17 : 12}
          fontFamily="ui-monospace, 'SF Mono', Menlo, monospace"
          fill="#ECE9E2"
          style={{ letterSpacing: isRoot ? "0.14em" : "0.22em", fontWeight: 700 }}
        >
          {label.toUpperCase()}
        </text>
        {sublabel && r > 35 && (
          <foreignObject x={cx - r * 0.82} y={cy + 5} width={r * 1.64} height={r * 0.60}>
            <div
              style={{
                fontFamily: "ui-monospace, SF Mono, Menlo, monospace",
                fontSize: 7, lineHeight: 1.35, textAlign: "center",
                color: "#646C78",
                letterSpacing: "0.10em", textTransform: "uppercase",
              }}
            >
              {sublabel}
            </div>
          </foreignObject>
        )}
      </g>
    </g>
  );
}

// ---------- hover card ----------

type HoverInfo =
  | { kind: "ratio"; title: string; r: RatioInfo }
  | { kind: "pillar"; title: string; sublabel: string; health: number; count: number }
  | { kind: "missing"; title: string };

function HoverCard({
  x, y, size, info,
}: {
  x: number; y: number; size: number; info: HoverInfo;
}) {
  const W = 220;
  const H = info.kind === "ratio" ? 182 : info.kind === "pillar" ? 112 : 70;
  const pad = 10;
  let tx = x + 24;
  let ty = y - H / 2;
  if (tx + W > size - pad) tx = x - 24 - W;
  if (ty < pad) ty = pad;
  if (ty + H > size - pad) ty = size - pad - H;

  return (
    <foreignObject x={tx} y={ty} width={W} height={H} overflow="visible" style={{ pointerEvents: "none" }}>
      <div
        style={{
          width: W,
          minHeight: H,
          borderRadius: 10,
          border: "1px solid rgba(201,169,106,.20)",
          background: "rgba(10,14,20,.95)",
          boxShadow: "0 18px 50px -18px rgba(0,0,0,.90), 0 0 0 1px rgba(201,169,106,.04) inset",
          padding: "10px 12px",
          fontFamily: "ui-monospace, SF Mono, Menlo, monospace",
          color: "#ECE9E2",
          backdropFilter: "blur(8px)",
          boxSizing: "border-box",
        }}
      >
        <CardBody info={info} />
      </div>
    </foreignObject>
  );
}

function CardBody({ info }: { info: HoverInfo }) {
  if (info.kind === "missing") {
    return (
      <>
        <HoverHeader title={info.title} />
        <div
          style={{
            marginTop: 8, fontSize: 10,
            color: "#646C78", letterSpacing: "0.05em",
          }}
        >
          No ratio yet — add inputs to compute.
        </div>
      </>
    );
  }
  if (info.kind === "pillar") {
    const t = tierColor(info.health);
    return (
      <>
        <HoverHeader title={info.title} sub={`${info.count} drivers`} />
        <div style={{ marginTop: 8 }}>
          <RowLabel k="AGGREGATE HEALTH" />
          <div
            style={{
              display: "flex", alignItems: "baseline",
              justifyContent: "space-between", marginTop: 2,
            }}
          >
            <span
              style={{
                fontSize: 18, color: t.color,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {isFinite(info.health) ? `${info.health.toFixed(0)}%` : "—"}
            </span>
            <span style={pillStyle(t.color)}>{t.label}</span>
          </div>
          <HealthBar value={info.health} color={t.color} />
        </div>
      </>
    );
  }
  const { r } = info;
  const t = tierColor(r.health);
  return (
    <>
      <HoverHeader title={info.title} sub={r.techName} />
      <div
        style={{
          display: "flex", justifyContent: "space-between",
          alignItems: "baseline", marginTop: 4,
        }}
      >
        <span
          style={{
            fontSize: 16, color: t.color,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {fmtVal(r.value, r.format)}
        </span>
        <span style={pillStyle(t.color)}>
          {isFinite(r.health) ? `${r.health.toFixed(0)}%` : "—"} · {t.label}
        </span>
      </div>
      <HealthBar value={r.health} color={t.color} />
      <div style={{ marginTop: 6 }}>
        <RowLabel k="VS INDUSTRY" />
        <MiniBench value={r.value} b={r.benchmark} />
      </div>
      <div
        style={{
          marginTop: 6, display: "flex",
          alignItems: "center", justifyContent: "space-between",
        }}
      >
        <RowLabel k="TREND" />
        <div style={{ marginLeft: 8 }}>
          {(() => {
            const series = [...(r.series ?? []), r.value].filter((n) => isFinite(n));
            return series.length >= 2 ? (
              <KpiTrendline values={series} width={110} height={20} />
            ) : (
              <span style={{ fontSize: 9, color: "#646C78" }}>
                builds with snapshots
              </span>
            );
          })()}
        </div>
      </div>
    </>
  );
}

function HoverHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div
      style={{
        display: "flex", justifyContent: "space-between", alignItems: "baseline",
        borderBottom: "1px solid rgba(201,169,106,.18)", paddingBottom: 4,
      }}
    >
      <span
        style={{
          fontSize: 11, color: "#D7BF8A",
          letterSpacing: "0.18em", fontWeight: 700, textTransform: "uppercase",
        }}
      >
        {title}
      </span>
      {sub && (
        <span
          style={{
            fontSize: 8.5, color: "rgba(155,122,70,.80)",
            letterSpacing: "0.16em", textTransform: "uppercase",
          }}
        >
          {sub}
        </span>
      )}
    </div>
  );
}

function RowLabel({ k }: { k: string }) {
  return (
    <span style={{ fontSize: 8.5, color: "rgba(142,150,163,.65)", letterSpacing: "0.2em" }}>
      {k}
    </span>
  );
}

function pillStyle(color: string): React.CSSProperties {
  return {
    fontSize: 8.5,
    border: `1px solid ${color}55`,
    background: `${color}18`,
    color,
    padding: "1px 5px",
    borderRadius: 3,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
  };
}

function HealthBar({ value, color }: { value: number; color: string }) {
  const w = isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  return (
    <div
      style={{
        marginTop: 4, height: 3, borderRadius: 99, overflow: "hidden",
        background: "#0A0E14",
        boxShadow: "inset 0 0 0 1px rgba(201,169,106,.14)",
      }}
    >
      <div
        style={{
          width: `${w}%`, height: "100%",
          background: color, transition: "width 400ms ease",
        }}
      />
    </div>
  );
}

function MiniBench({
  value,
  b,
}: {
  value: number;
  b?: RatioInfo["benchmark"];
}) {
  if (!b || !isFinite(value)) {
    return (
      <div style={{ fontSize: 9, color: "rgba(142,150,163,.45)", marginTop: 2 }}>—</div>
    );
  }
  const idx = bucketIndex(value, b);
  const palette = ["#C25C5C", "#D4845A", "#D7BF8A", "#6FBFA0", "#3BCF8E"];
  return (
    <div style={{ display: "flex", gap: 2, marginTop: 4, height: 6 }}>
      {[1, 2, 3, 4, 5].map((i) => {
        const active = i === idx;
        return (
          <div
            key={i}
            style={{
              flex: 1,
              borderRadius: 1,
              background: active ? palette[i - 1] : `${palette[i - 1]}22`,
              border: active
                ? `0.5px solid ${palette[i - 1]}`
                : "0.5px solid rgba(201,169,106,.08)",
              boxShadow: active ? `0 0 5px ${palette[i - 1]}55` : "none",
            }}
          />
        );
      })}
    </div>
  );
}
