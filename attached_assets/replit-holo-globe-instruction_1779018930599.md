# Replit Instruction: Add the Holographic Solar-System Visualization

This instruction adds a premium 3D-feel orbital "business model" globe to the dashboard, and wires every orbiting moon into the Ratios tab (with scroll + highlight). It assumes your Replit app already has:

- A Ratios tab/page where a table can be mounted
- A Today tab/page where the globe can be mounted
- Tailwind CSS available
- React 18+ with TypeScript

No backend changes are required — the visualization is pure presentation, fed by a `ratioLookup` object you build from your existing ratio data.

---

## 1. What you are adding

1. `src/components/kpi-trendline.tsx` — tiny SVG sparkline used by the globe hover card and the ratios table.
2. `src/components/holo-globe.tsx` — the 3D-feel orbital system: 4 pillar planets (Profit, Assets, Financing, Cash) orbit a central "Business Value" planet. Click a pillar → it becomes the center and its drivers orbit it. Click a driver → opens the Ratios tab and scrolls to + highlights the matching row. Hover any planet/moon → premium ink-and-gold hover card with health %, 5-quadrant industry benchmark, and trendline. Click the empty system → pauses rotation (hover still works). Drag the system → rotates manually. Bottom rail shows the 6 key diagnostic ratios (ROE, Break-even, CCC, Net Margin, Gross Margin, Health Score).
3. `src/components/ratios-table.tsx` — ink-and-gold table replacing the old ratios layout. Columns: Ratio·Value / Finance name + Description / Trend sparkline / vs Industry 5-quadrant bar / Financial Health (% + risk). Grouped into 5 sections: **Profit Drivers** (with **Opex** subsection), **Asset Productivity**, **Leverage & Finance**, **Cash Flow**, **People & Systems**. Every row has `data-row-id` so the globe can scroll to it.
4. Wire-up in the Today page and the Ratios page (sample shown below).

---

## 2. Install

No new npm packages needed. Everything is plain React + SVG + Tailwind.

---

## 3. Files to create

### 3.1 `src/components/kpi-trendline.tsx`

```tsx
type Props = {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
};

/** Tiny dependency-free sparkline. Renders nothing if <2 finite points. */
export function KpiTrendline({ values, width = 80, height = 24, className }: Props) {
  const pts = values.filter((n) => isFinite(n));
  if (pts.length < 2) return null;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const range = max - min || 1;
  const stepX = width / (pts.length - 1);
  const path = pts
    .map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * height;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const last = pts[pts.length - 1];
  const first = pts[0];
  const up = last >= first;
  const stroke = up ? "hsl(142 70% 40%)" : "hsl(0 70% 50%)";
  return (
    <svg width={width} height={height} className={className} aria-hidden>
      <path d={path} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function pctDelta(values: number[]): number | null {
  const pts = values.filter((n) => isFinite(n));
  if (pts.length < 2) return null;
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (first === 0) return null;
  return (last - first) / Math.abs(first);
}
```

### 3.2 `src/components/ratios-table.tsx`

```tsx
import { useEffect, useMemo, useRef } from "react";
import { KpiTrendline } from "@/components/kpi-trendline";

/**
 * Premium ink-and-gold ratios table.
 * Columns: Friendly | Tech / formula + description | Sparkline | 5-quadrant
 * industry bench | Health (% + risk band). Grouped into 5 sections; one
 * section ("Profit Drivers") has an "Opex" subsection. Rows are anchored
 * by id (`data-row-id`) so the globe can scroll-to + briefly highlight.
 */

export type Benchmark = {
  p25: number;
  p50: number;
  p75: number;
  unit: string;
  higher_is_better: boolean;
};

type Format = "x" | "pct" | "days" | "money";

export type RatioRow = {
  id: string;
  friendly: string;
  techName: string;
  description: string;
  value: number;
  format: Format;
  health: number; // 0..100
  series?: number[];
  benchmark?: Benchmark | null;
};

type Section = {
  id: string;
  title: string;
  blurb?: string;
  rows: RatioRow[];
  subsections?: { id: string; title: string; rows: RatioRow[] }[];
};

type Props = {
  sections: Section[];
  /** When set, briefly highlights the row with this id and scrolls it into view. */
  highlightId?: string | null;
};

const GOLD = "#d4a550";
const GOLD_SOFT = "rgba(212,165,80,0.45)";

function tier(h: number) {
  if (!isFinite(h)) return { label: "—", color: "#94a3b8" };
  if (h >= 80) return { label: "Healthy", color: "#34d399" };
  if (h >= 60) return { label: "Average", color: "#fbbf24" };
  if (h >= 35) return { label: "High Risk", color: "#fb923c" };
  return { label: "Danger", color: "#f87171" };
}

function fmt(v: number, f: Format) {
  if (!isFinite(v)) return "—";
  if (f === "pct") return `${(v * 100).toFixed(1)}%`;
  if (f === "days") return `${v.toFixed(1)} d`;
  if (f === "money") return v >= 1000 ? `R${(v / 1000).toFixed(1)}k` : `R${v.toFixed(0)}`;
  return `${v.toFixed(2)}×`;
}

/** Returns 1..5 bucket index for benchmark; 5 = best. */
function bucketIndex(value: number, b: Benchmark): number {
  const { p25, p50, p75, higher_is_better } = b;
  const iqr = Math.max(1e-9, p75 - p25);
  // map value to [0..1] across roughly p25-2*iqr ... p75+2*iqr
  let pos = (value - p25) / iqr; // 0 at p25, 1 at p75
  // bucket boundaries at -0.5, 0, 0.5, 1, 1.5
  let idx: number;
  if (pos < -0.5) idx = 1;
  else if (pos < 0) idx = 2;
  else if (pos < (p50 - p25) / iqr + 0.001) idx = 3;
  else if (pos < 1) idx = 4;
  else idx = 5;
  return higher_is_better ? idx : 6 - idx;
}

function QuadrantBar({ value, b }: { value: number; b?: Benchmark | null }) {
  if (!b || !isFinite(value)) {
    return <span className="text-[10px] uppercase tracking-wider text-[#c9962b]/40">—</span>;
  }
  const idx = bucketIndex(value, b);
  const palette = ["#f87171", "#fb923c", "#fbbf24", "#86efac", "#34d399"];
  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-2.5 gap-0.5">
        {[1, 2, 3, 4, 5].map((i) => {
          const active = i === idx;
          return (
            <div
              key={i}
              className="flex-1 rounded-[1px]"
              style={{
                background: active ? palette[i - 1] : `${palette[i - 1]}26`,
                border: active ? `0.5px solid ${palette[i - 1]}` : "0.5px solid rgba(212,165,80,0.10)",
                boxShadow: active ? `0 0 8px ${palette[i - 1]}66` : "none",
              }}
            />
          );
        })}
      </div>
      <div className="flex justify-between font-mono text-[8px] uppercase tracking-[0.2em] text-[#c9962b]/55">
        <span>Bot</span>
        <span>Med</span>
        <span>Top</span>
      </div>
    </div>
  );
}

function HealthCell({ health }: { health: number }) {
  const t = tier(health);
  const w = isFinite(health) ? Math.max(0, Math.min(100, health)) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[14px] tabular-nums" style={{ color: t.color }}>
          {isFinite(health) ? `${health.toFixed(0)}%` : "—"}
        </span>
        <span
          className="rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.18em]"
          style={{ color: t.color, borderColor: `${t.color}66`, background: `${t.color}14` }}
        >
          {t.label}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-[#0a1020] ring-1 ring-[#b7872a]/20">
        <div className="h-full transition-all duration-500" style={{ width: `${w}%`, background: t.color }} />
      </div>
    </div>
  );
}

function Row({
  row,
  highlight,
  registerRef,
}: {
  row: RatioRow;
  highlight: boolean;
  registerRef: (id: string, el: HTMLTableRowElement | null) => void;
}) {
  const series = useMemo(
    () => [...(row.series ?? []), row.value].filter((n) => isFinite(n)),
    [row.series, row.value],
  );
  const t = tier(row.health);
  return (
    <tr
      ref={(el) => registerRef(row.id, el)}
      data-row-id={row.id}
      className={`group border-b border-[#b7872a]/12 transition-all duration-500 ${
        highlight ? "ring-2 ring-[#f7d98a] ring-offset-2 ring-offset-[#03060f]" : ""
      }`}
      style={{
        background: highlight
          ? "linear-gradient(90deg, rgba(247,217,138,0.18), rgba(212,165,80,0.06))"
          : "transparent",
      }}
    >
      {/* Friendly + value */}
      <td className="px-3 py-3 align-top">
        <div className="flex flex-col gap-0.5">
          <span className="text-[13px] font-semibold tracking-tight text-[#f1e6c8]">
            {row.friendly}
          </span>
          <span className="font-mono text-[16px] tabular-nums" style={{ color: t.color }}>
            {fmt(row.value, row.format)}
          </span>
        </div>
      </td>

      {/* Tech name + description */}
      <td className="px-3 py-3 align-top">
        <div className="flex flex-col gap-1">
          <span
            className="text-[10px] uppercase tracking-[0.22em] text-[#d4a550]/85"
            style={{ fontFamily: "ui-monospace, SF Mono, Menlo, monospace" }}
          >
            {row.techName}
          </span>
          <span className="text-[11px] leading-relaxed text-[#f1e6c8]/65">{row.description}</span>
        </div>
      </td>

      {/* Sparkline */}
      <td className="px-3 py-3 align-middle">
        {series.length >= 2 ? (
          <KpiTrendline values={series} width={86} height={26} />
        ) : (
          <span className="text-[10px] uppercase tracking-wider text-[#c9962b]/40">
            Builds with snapshots
          </span>
        )}
      </td>

      {/* Industry bench */}
      <td className="w-[160px] px-3 py-3 align-middle">
        <QuadrantBar value={row.value} b={row.benchmark ?? null} />
      </td>

      {/* Health */}
      <td className="w-[150px] px-3 py-3 align-middle">
        <HealthCell health={row.health} />
      </td>
    </tr>
  );
}

export function RatiosTable({ sections, highlightId }: Props) {
  const refs = useRef<Map<string, HTMLTableRowElement>>(new Map());
  const registerRef = (id: string, el: HTMLTableRowElement | null) => {
    if (el) refs.current.set(id, el);
    else refs.current.delete(id);
  };

  useEffect(() => {
    if (!highlightId) return;
    const el = refs.current.get(highlightId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlightId]);

  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-[#b7872a]/25 p-5 shadow-[0_30px_80px_-30px_rgba(3,6,15,0.9),inset_0_1px_0_rgba(247,217,138,0.08)]"
      style={{
        background:
          "radial-gradient(120% 80% at 50% 0%, #0b1428 0%, #060a18 55%, #03060f 100%)",
      }}
    >
      {/* grain */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.05] mix-blend-overlay"
        style={{
          backgroundImage: "radial-gradient(rgba(255,255,255,0.6) 1px, transparent 1px)",
          backgroundSize: "3px 3px",
        }}
      />

      <div className="relative space-y-7">
        {sections.map((s) => (
          <section key={s.id} id={`section-${s.id}`}>
            <div className="mb-3 flex items-center gap-3">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: GOLD, boxShadow: `0 0 10px ${GOLD}` }}
              />
              <h3
                className="text-[11px] uppercase tracking-[0.32em] text-[#f7d98a]"
                style={{ fontFamily: "ui-monospace, SF Mono, Menlo, monospace" }}
              >
                {s.title}
              </h3>
              <span className="h-px flex-1" style={{ background: `linear-gradient(90deg, ${GOLD_SOFT}, transparent)` }} />
            </div>
            {s.blurb && (
              <p className="mb-3 text-[11px] leading-relaxed text-[#f1e6c8]/55">{s.blurb}</p>
            )}

            <TableBlock rows={s.rows} highlightId={highlightId ?? null} registerRef={registerRef} />

            {s.subsections?.map((sub) => (
              <div key={sub.id} className="mt-5 pl-4 border-l border-[#b7872a]/25">
                <div className="mb-2 flex items-center gap-2">
                  <span
                    className="text-[10px] uppercase tracking-[0.28em] text-[#d4a550]/80"
                    style={{ fontFamily: "ui-monospace, SF Mono, Menlo, monospace" }}
                  >
                    └ {sub.title}
                  </span>
                </div>
                <TableBlock
                  rows={sub.rows}
                  highlightId={highlightId ?? null}
                  registerRef={registerRef}
                />
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

function TableBlock({
  rows,
  highlightId,
  registerRef,
}: {
  rows: RatioRow[];
  highlightId: string | null;
  registerRef: (id: string, el: HTMLTableRowElement | null) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-[#b7872a]/15 bg-[#0a1020]/60">
      <table className="w-full text-left">
        <thead>
          <tr
            className="border-b border-[#b7872a]/25 text-[9px] uppercase tracking-[0.24em] text-[#d4a550]/70"
            style={{ fontFamily: "ui-monospace, SF Mono, Menlo, monospace" }}
          >
            <th className="px-3 py-2 font-normal">Ratio · Value</th>
            <th className="px-3 py-2 font-normal">Finance Name · Description</th>
            <th className="px-3 py-2 font-normal">Trend</th>
            <th className="px-3 py-2 font-normal">vs Industry</th>
            <th className="px-3 py-2 font-normal">Financial Health</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Row key={r.id} row={r} highlight={highlightId === r.id} registerRef={registerRef} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

### 3.3 `src/components/holo-globe.tsx`

```tsx
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { KpiTrendline } from "@/components/kpi-trendline";

/**
 * HoloGlobe — Premium 4-pillar orbital business model.
 * - Click a pillar planet → it animates to the centre and its drivers orbit it.
 * - Click a driver moon → opens the related ratio section.
 * - Click the empty system / background → toggles auto-rotation pause.
 * - Hover any planet/moon → live mini-card with Health · Benchmark · Trendline.
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

const PILLARS: Record<PillarId, Pillar> = {
  profit: {
    id: "profit", label: "Profit", sublabel: "How we make money", hue: "#86efac",
    drivers: [
      { label: "Revenue", section: "grossMargin" },
      { label: "Direct Costs", section: "grossMargin" },
      { label: "Opex", section: "opexRatio" },
      { label: "Interest", section: "interestBurden" },
      { label: "Tax", section: "taxBurden" },
    ],
    tab: "dashboard",
  },
  assets: {
    id: "assets", label: "Assets", sublabel: "What we use to operate", hue: "#fbbf24",
    drivers: [
      { label: "Fixed Asset Util.", section: "fixedAssetUtil" },
      { label: "Working Cap. Util.", section: "wcUtil" },
    ],
    tab: "dashboard",
  },
  financing: {
    id: "financing", label: "Financing", sublabel: "How we fund the business", hue: "#c084fc",
    drivers: [
      { label: "Loan × Interest", section: "debtServiceCover" },
      { label: "WC × Factoring", section: "factoringCost" },
      { label: "Leverage", section: "equityMultiplier" },
      { label: "Funding Structure", section: "fundingStructure" },
    ],
    tab: "dashboard",
  },
  cash: {
    id: "cash", label: "Cash", sublabel: "What keeps us alive", hue: "#7dd3fc",
    drivers: [
      { label: "Debtors", section: "debtorDays" },
      { label: "Creditors", section: "creditorDays" },
      { label: "WIP", section: "inventoryDays" },
      { label: "Capex", section: "capexIntensity" },
      { label: "Funding Structure", section: "fundingStructure" },
    ],
    tab: "dashboard",
  },
};

const PILLAR_ORDER: PillarId[] = ["profit", "assets", "financing", "cash"];

const DIAGNOSTICS: Array<{ k: string; v: string }> = [
  { k: "ROE", v: "18.4%" },
  { k: "Break-even", v: "€312k" },
  { k: "CCC", v: "47d" },
  { k: "Net Margin", v: "11.2%" },
  { k: "Gross Margin", v: "38.6%" },
  { k: "Health", v: "A−" },
];

type Props = {
  onSelect: (target: { tab: string; section?: string }) => void;
  size?: number;
  /** Map ratio section id → live info for hover cards. */
  ratioLookup?: Record<string, RatioInfo>;
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
  if (!isFinite(h)) return { label: "—", color: "#94a3b8" };
  if (h >= 80) return { label: "Healthy", color: "#34d399" };
  if (h >= 60) return { label: "Average", color: "#fbbf24" };
  if (h >= 35) return { label: "High Risk", color: "#fb923c" };
  return { label: "Danger", color: "#f87171" };
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

export function HoloGlobe({ onSelect, size = 520, ratioLookup }: Props) {
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

  // Pointer handlers on background: drag to rotate, click (no drag) to pause.
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
      // Background click → toggle pause.
      setPaused((p) => !p);
    }
  };

  const satellites = useMemo(() => {
    if (focus === "root") {
      return PILLAR_ORDER.map((id, i) => ({
        id,
        label: PILLARS[id].label,
        sublabel: PILLARS[id].sublabel,
        hue: PILLARS[id].hue,
        angle: (i / PILLAR_ORDER.length) * Math.PI * 2,
        clickable: true,
        pillarId: id as PillarId,
      }));
    }
    const drivers = PILLARS[focus].drivers;
    return drivers.map((d, i) => ({
      id: `${focus}-${d.label}`,
      label: d.label,
      sublabel: "",
      hue: PILLARS[focus].hue,
      angle: (i / drivers.length) * Math.PI * 2,
      clickable: true,
      driverOf: focus as PillarId,
      driverSection: d.section,
      driverTab: d.tab ?? PILLARS[focus].tab,
    }));
  }, [focus]);

  const e = easeInOut(progress);

  const central = focus === "root"
    ? { label: "Business Value", sublabel: "Sustainable · Profitable · Cash Generative · Resilient", hue: "#7dd3fc" }
    : { label: PILLARS[focus].label, sublabel: PILLARS[focus].sublabel, hue: PILLARS[focus].hue };

  const transCentral = pending
    ? { label: PILLARS[pending].label, sublabel: PILLARS[pending].sublabel, hue: PILLARS[pending].hue }
    : null;

  // ---- Hover info resolution ----
  // For driver moons → look up via section id.
  // For pillar planets → average children's health, no benchmark.
  const hoverInfo: { x: number; y: number; info: HoverInfo } | null = useMemo(() => {
    if (!hover) return null;
    const projAngle = (s: { angle: number }) => s.angle + spin;
    const sat = satellites.find((s) => s.id === hover);
    if (!sat) return null;
    const a = projAngle(sat);
    const x = cx + Math.cos(a) * rOrbit;
    const y = cy + Math.sin(a) * rOrbit * tilt;
    if ("driverSection" in sat && sat.driverSection) {
      const r = ratioLookup?.[sat.driverSection];
      if (r) {
        return {
          x, y,
          info: {
            kind: "ratio",
            title: sat.label,
            r,
          },
        };
      }
      return { x, y, info: { kind: "missing", title: sat.label } };
    }
    if ("pillarId" in sat && sat.pillarId) {
      const drivers = PILLARS[sat.pillarId].drivers;
      const healths = drivers
        .map((d) => ratioLookup?.[d.section]?.health)
        .filter((h): h is number => typeof h === "number" && isFinite(h));
      const avg = healths.length ? healths.reduce((a, b) => a + b, 0) / healths.length : NaN;
      return {
        x, y,
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
  }, [hover, satellites, spin, cx, cy, rOrbit, tilt, ratioLookup]);

  return (
    <div className="relative mx-auto select-none" style={{ width: size }}>
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
        style={{
          width: size * 1.05,
          height: size * 1.05,
          background:
            "radial-gradient(circle at 50% 50%, rgba(183,135,42,0.22), rgba(42,91,215,0.10) 38%, transparent 72%)",
        }}
      />

      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ touchAction: "none", cursor: dragging ? "grabbing" : "grab", display: "block" }}
      >
        <defs>
          <radialGradient id="hg-sphere" cx="32%" cy="28%" r="78%">
            <stop offset="0%" stopColor="#1b2742" />
            <stop offset="35%" stopColor="#0f1730" />
            <stop offset="78%" stopColor="#070b1a" />
            <stop offset="100%" stopColor="#03060f" />
          </radialGradient>
          <radialGradient id="hg-spec" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.45)" />
            <stop offset="55%" stopColor="rgba(255,255,255,0.06)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </radialGradient>
          <radialGradient id="hg-rim" cx="50%" cy="50%" r="50%">
            <stop offset="78%" stopColor="rgba(125,170,255,0)" />
            <stop offset="93%" stopColor="rgba(125,170,255,0.18)" />
            <stop offset="100%" stopColor="rgba(125,170,255,0)" />
          </radialGradient>
          {PILLAR_ORDER.map((pid) => (
            <radialGradient key={`grad-${pid}`} id={`hg-p-${pid}`} cx="32%" cy="28%" r="78%">
              <stop offset="0%" stopColor={PILLARS[pid].hue} stopOpacity={0.9} />
              <stop offset="40%" stopColor={PILLARS[pid].hue} stopOpacity={0.35} />
              <stop offset="100%" stopColor="#03060f" />
            </radialGradient>
          ))}
          <filter id="hg-glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="hg-soft" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.2" />
          </filter>
        </defs>

        <ellipse cx={cx} cy={cy} rx={rOrbit} ry={rOrbit * tilt} fill="none"
          stroke="rgba(183,135,42,0.28)" strokeWidth={0.8} strokeDasharray="2 4" />
        <ellipse cx={cx} cy={cy} rx={rOrbit * 0.7} ry={rOrbit * 0.7 * tilt} fill="none"
          stroke="rgba(180,200,240,0.08)" strokeWidth={0.5} />
        <ellipse cx={cx} cy={cy} rx={rOrbit * 1.15} ry={rOrbit * 1.15 * tilt} fill="none"
          stroke="rgba(180,200,240,0.08)" strokeWidth={0.5} />

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

          const baseR = focus === "root" ? size * 0.13 : size * 0.16;
          const pendingSat = pending ? projected.find((p) => p.id === pending) : null;
          const rootR = baseR;

          return (
            <>
              {projected.filter((p) => p.z < 0).map((p) =>
                renderSatellite(p, pending, e, satOpacity, hover, setHover, startFocus, onSelect))}

              {renderCentral({
                cx, cy, r: rootR, label: central.label, sublabel: central.sublabel,
                hue: central.hue, opacity: pending ? 1 - e : 1, isRoot: focus === "root",
                onBack: focus !== "root" ? resetFocus : undefined,
              })}

              {pendingSat && transCentral && (() => {
                const tx = pendingSat.x + (cx - pendingSat.x) * e;
                const ty = pendingSat.y + (cy - pendingSat.y) * e;
                const startR = size * 0.045;
                const endR = size * 0.16;
                const tr = startR + (endR - startR) * e;
                return renderCentral({
                  cx: tx, cy: ty, r: tr, label: transCentral.label,
                  sublabel: transCentral.sublabel, hue: transCentral.hue,
                  opacity: e, isRoot: false,
                });
              })()}

              {projected.filter((p) => p.z >= 0).map((p) =>
                renderSatellite(p, pending, e, satOpacity, hover, setHover, startFocus, onSelect))}
            </>
          );
        })()}

        {(["tl", "tr", "bl", "br"] as const).map((c) => (
          <g key={c}>
            <path d={cornerPath(c, size)} fill="none" stroke="rgba(183,135,42,0.55)" strokeWidth={1} />
          </g>
        ))}

        {/* Hover tooltip — rendered last so it sits above everything. */}
        {hoverInfo && (
          <HoverCard
            x={hoverInfo.x}
            y={hoverInfo.y}
            size={size}
            info={hoverInfo.info}
          />
        )}
      </svg>

      {/* Bottom diagnostic ratios rail */}
      <div
        className="mt-3 rounded-md border border-[#b7872a]/25 bg-[#0a1020]/80 px-3 py-2.5"
        style={{ fontFamily: "ui-monospace, SF Mono, Menlo, monospace" }}
      >
        <div className="mb-1.5 flex items-center justify-between text-[9px] uppercase tracking-[0.28em] text-[#d4a550]/70">
          <span>Key Diagnostic Ratios</span>
          <div className="flex items-center gap-2">
            <span
              className="rounded border px-1.5 py-0.5 text-[9px]"
              style={{
                color: paused ? "#f7d98a" : "rgba(212,165,80,0.5)",
                borderColor: paused ? "rgba(247,217,138,0.6)" : "rgba(183,135,42,0.3)",
                background: paused ? "rgba(247,217,138,0.10)" : "transparent",
              }}
            >
              {paused ? "Paused" : "Live"}
            </span>
            {focus !== "root" && (
              <button
                onClick={resetFocus}
                className="rounded border border-[#b7872a]/40 px-2 py-0.5 text-[9px] tracking-[0.2em] text-[#f1e6c8] hover:bg-[#b7872a]/20"
              >
                ← Overview
              </button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {DIAGNOSTICS.map((d) => (
            <div key={d.k} className="flex flex-col">
              <span className="text-[9px] uppercase tracking-[0.18em] text-[#d4a550]/60">{d.k}</span>
              <span className="mt-0.5 text-[12px] tracking-[0.04em] text-[#f7d98a]">{d.v}</span>
            </div>
          ))}
        </div>
      </div>

      <div
        className="pointer-events-none mt-1 text-center text-[9px] uppercase tracking-[0.32em]"
        style={{ color: "rgba(212,165,80,0.55)", fontFamily: "ui-monospace, SF Mono, Menlo, monospace" }}
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
  const r = (p.clickable ? 18 : 9) * scale;
  const isHover = hover === p.id;
  const op = baseOpacity * (p.z < 0 ? 0.55 : 1);
  const isPillar = !!p.pillarId;
  const fill = isPillar ? `url(#hg-p-${p.id})` : p.hue;

  return (
    <g key={p.id} opacity={op}>
      <line x1={p.x} y1={p.y} x2={p.x} y2={p.y - r - 6} stroke="rgba(212,165,80,0.4)" strokeWidth={0.6} />
      <circle cx={p.x} cy={p.y} r={r * 1.7} fill={p.hue} opacity={isHover ? 0.22 : 0.10} filter="url(#hg-glow)" />
      <circle
        cx={p.x} cy={p.y} r={r}
        fill={fill}
        stroke={isHover ? "#f7d98a" : `${p.hue}aa`}
        strokeWidth={isHover ? 1.4 : 0.8}
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
      <ellipse cx={p.x - r * 0.3} cy={p.y - r * 0.35} rx={r * 0.55} ry={r * 0.35}
        fill="url(#hg-spec)" opacity={0.7} pointerEvents="none" />
      <g pointerEvents="none">
        <text x={p.x} y={p.y - r - 12} textAnchor="middle"
          fontSize={p.clickable ? 10 : 8.5}
          fontFamily="ui-monospace, 'SF Mono', Menlo, monospace"
          fill="#f1e6c8" style={{ letterSpacing: "0.18em", fontWeight: 600 }}>
          {p.label.toUpperCase()}
        </text>
        {p.sublabel && p.z >= 0 && (
          <text x={p.x} y={p.y + r + 14} textAnchor="middle" fontSize={7.5}
            fontFamily="ui-monospace, 'SF Mono', Menlo, monospace"
            fill="rgba(241,230,200,0.6)" style={{ letterSpacing: "0.12em" }}>
            {p.sublabel.toUpperCase()}
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
  const { cx, cy, r, label, sublabel, hue, opacity, isRoot } = opts;
  return (
    <g opacity={opacity}>
      <circle cx={cx} cy={cy} r={r * 1.6} fill={hue} opacity={0.10} filter="url(#hg-glow)" />
      <circle cx={cx} cy={cy} r={r * 1.18} fill="url(#hg-rim)" />
      <circle cx={cx} cy={cy} r={r} fill="url(#hg-sphere)" />
      <circle cx={cx} cy={cy} r={r} fill={hue} opacity={0.18} />
      <ellipse cx={cx} cy={cy} rx={r} ry={r * 0.35} fill="none" stroke="rgba(183,135,42,0.35)" strokeWidth={0.7} />
      <ellipse cx={cx} cy={cy} rx={r * 0.6} ry={r * 0.94} fill="none" stroke="rgba(180,200,240,0.18)" strokeWidth={0.5} />
      <ellipse cx={cx - r * 0.35} cy={cy - r * 0.4} rx={r * 0.55} ry={r * 0.4}
        fill="url(#hg-spec)" opacity={0.75} pointerEvents="none" />
      <circle cx={cx + r * 0.3} cy={cy + r * 0.3} r={r * 0.95} fill="rgba(0,0,0,0.30)" filter="url(#hg-soft)" pointerEvents="none" />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(212,165,80,0.5)" strokeWidth={0.9} />
      <g pointerEvents="none">
        <text x={cx} y={cy - 2} textAnchor="middle" fontSize={isRoot ? 11 : 12}
          fontFamily="ui-monospace, 'SF Mono', Menlo, monospace"
          fill="#f7d98a" style={{ letterSpacing: "0.22em", fontWeight: 700 }}>
          {label.toUpperCase()}
        </text>
        {sublabel && r > 35 && (
          <foreignObject x={cx - r * 0.85} y={cy + 4} width={r * 1.7} height={r * 0.6}>
            <div style={{
              fontFamily: "ui-monospace, SF Mono, Menlo, monospace",
              fontSize: 7.5, lineHeight: 1.35, textAlign: "center",
              color: "rgba(241,230,200,0.7)", letterSpacing: "0.1em", textTransform: "uppercase",
            }}>
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

function HoverCard({ x, y, size, info }: { x: number; y: number; size: number; info: HoverInfo }) {
  const W = 210;
  const H = info.kind === "ratio" ? 138 : 86;
  // Prefer right side; flip if it would overflow.
  const pad = 10;
  let tx = x + 24;
  let ty = y - H / 2;
  if (tx + W > size - pad) tx = x - 24 - W;
  if (ty < pad) ty = pad;
  if (ty + H > size - pad) ty = size - pad - H;

  return (
    <foreignObject x={tx} y={ty} width={W} height={H} style={{ pointerEvents: "none" }}>
      <div
        style={{
          width: W, height: H,
          borderRadius: 10,
          border: "1px solid rgba(183,135,42,0.5)",
          background: "linear-gradient(180deg, rgba(11,20,40,0.96), rgba(3,6,15,0.96))",
          boxShadow: "0 18px 50px -18px rgba(0,0,0,0.95), 0 0 0 1px rgba(247,217,138,0.06) inset",
          padding: "8px 10px",
          fontFamily: "ui-monospace, SF Mono, Menlo, monospace",
          color: "#f1e6c8",
          backdropFilter: "blur(6px)",
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
        <Header title={info.title} />
        <div style={{ marginTop: 8, fontSize: 10, color: "rgba(241,230,200,0.55)", letterSpacing: "0.05em" }}>
          No ratio yet — add inputs to compute.
        </div>
      </>
    );
  }
  if (info.kind === "pillar") {
    const t = tierColor(info.health);
    return (
      <>
        <Header title={info.title} sub={`${info.count} drivers`} />
        <div style={{ marginTop: 8 }}>
          <Row k="AGGREGATE HEALTH" />
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 2 }}>
            <span style={{ fontSize: 18, color: t.color, fontVariantNumeric: "tabular-nums" }}>
              {isFinite(info.health) ? `${info.health.toFixed(0)}%` : "—"}
            </span>
            <span style={pill(t.color)}>{t.label}</span>
          </div>
          <Bar value={info.health} color={t.color} />
        </div>
      </>
    );
  }
  const { r } = info;
  const t = tierColor(r.health);
  return (
    <>
      <Header title={info.title} sub={r.techName} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 4 }}>
        <span style={{ fontSize: 16, color: t.color, fontVariantNumeric: "tabular-nums" }}>
          {fmtVal(r.value, r.format)}
        </span>
        <span style={pill(t.color)}>{isFinite(r.health) ? `${r.health.toFixed(0)}%` : "—"} · {t.label}</span>
      </div>
      <Bar value={r.health} color={t.color} />
      <div style={{ marginTop: 6 }}>
        <Row k="VS INDUSTRY" />
        <MiniBench value={r.value} b={r.benchmark} />
      </div>
      <div style={{ marginTop: 6, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Row k="TREND" />
        <div style={{ marginLeft: 8 }}>
          {(() => {
            const series = [...(r.series ?? []), r.value].filter((n) => isFinite(n));
            return series.length >= 2
              ? <KpiTrendline values={series} width={110} height={20} />
              : <span style={{ fontSize: 9, color: "rgba(212,165,80,0.55)" }}>builds with snapshots</span>;
          })()}
        </div>
      </div>
    </>
  );
}

function Header({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", borderBottom: "1px solid rgba(183,135,42,0.25)", paddingBottom: 4 }}>
      <span style={{ fontSize: 11, color: "#f7d98a", letterSpacing: "0.18em", fontWeight: 700, textTransform: "uppercase" }}>
        {title}
      </span>
      {sub && (
        <span style={{ fontSize: 8.5, color: "rgba(212,165,80,0.7)", letterSpacing: "0.16em", textTransform: "uppercase" }}>
          {sub}
        </span>
      )}
    </div>
  );
}

function Row({ k }: { k: string }) {
  return (
    <span style={{ fontSize: 8.5, color: "rgba(212,165,80,0.7)", letterSpacing: "0.2em" }}>{k}</span>
  );
}

function pill(color: string): React.CSSProperties {
  return {
    fontSize: 8.5,
    border: `1px solid ${color}66`,
    background: `${color}1a`,
    color,
    padding: "1px 5px",
    borderRadius: 3,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
  };
}

function Bar({ value, color }: { value: number; color: string }) {
  const w = isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  return (
    <div style={{
      marginTop: 4, height: 4, borderRadius: 99, overflow: "hidden",
      background: "#0a1020", boxShadow: "inset 0 0 0 1px rgba(183,135,42,0.2)",
    }}>
      <div style={{ width: `${w}%`, height: "100%", background: color, transition: "width 400ms ease" }} />
    </div>
  );
}

function MiniBench({ value, b }: { value: number; b?: RatioInfo["benchmark"] }) {
  if (!b || !isFinite(value)) {
    return <div style={{ fontSize: 9, color: "rgba(212,165,80,0.45)", marginTop: 2 }}>—</div>;
  }
  const idx = bucketIndex(value, b);
  const palette = ["#f87171", "#fb923c", "#fbbf24", "#86efac", "#34d399"];
  return (
    <div style={{ display: "flex", gap: 2, marginTop: 4, height: 6 }}>
      {[1, 2, 3, 4, 5].map((i) => {
        const active = i === idx;
        return (
          <div key={i} style={{
            flex: 1, borderRadius: 1,
            background: active ? palette[i - 1] : `${palette[i - 1]}26`,
            border: active ? `0.5px solid ${palette[i - 1]}` : "0.5px solid rgba(212,165,80,0.10)",
            boxShadow: active ? `0 0 6px ${palette[i - 1]}66` : "none",
          }} />
        );
      })}
    </div>
  );
}
```

---

## 4. Wire-up

### 4.1 Build the `ratioLookup` once on the page that owns the data

The globe needs a flat map of `sectionId → RatioInfo`. The `sectionId` strings must match the `section` values in `PILLARS` inside `holo-globe.tsx` AND the `id` values of rows in `ratios-table.tsx`.

```ts
// e.g. in src/routes/index.tsx (or wherever your dashboard state lives)
import type { RatioInfo } from "@/components/holo-globe";

// Build from your already-computed ratios:
const ratioLookup: Record<string, RatioInfo> = {};
ratiosSections.forEach((sec) => {
  const all = [...sec.rows, ...(sec.subsections?.flatMap((s) => s.rows) ?? [])];
  all.forEach((r) => {
    ratioLookup[r.id] = {
      friendly: r.friendly,
      techName: r.techName,
      value: r.value,
      format: r.format,
      health: r.health,
      series: r.series,
      benchmark: r.benchmark ?? null,
    };
  });
});
```

The driver→section mapping the globe ships with:

| Pillar | Driver | section id (must exist as a row in your table) |
|---|---|---|
| Profit | Revenue | `grossMargin` |
| Profit | Direct Costs | `grossMargin` |
| Profit | Opex | `opexRatio` |
| Profit | Interest | `interestBurden` |
| Profit | Tax | `taxBurden` |
| Assets | Fixed Asset Util. | `fixedAssetUtil` |
| Assets | Working Cap. Util. | `wcUtil` |
| Financing | Loan × Interest | `debtServiceCover` |
| Financing | WC × Factoring | `factoringCost` |
| Financing | Leverage | `equityMultiplier` |
| Financing | Funding Structure | `fundingStructure` |
| Cash | Debtors | `debtorDays` |
| Cash | Creditors | `creditorDays` |
| Cash | WIP | `inventoryDays` |
| Cash | Capex | `capexIntensity` |
| Cash | Funding Structure | `fundingStructure` |

If a driver doesn't have a real ratio yet, create a placeholder row in the table with the matching `id` (even if `value = NaN`). The hover card will show "No ratio yet — add inputs to compute." until then.

### 4.2 Mount the globe (Today tab)

```tsx
import { HoloGlobe } from "@/components/holo-globe";

<HoloGlobe
  size={520}
  ratioLookup={ratioLookup}
  onSelect={({ tab, section }) => {
    setActiveTab(tab);                 // e.g. "ratios"
    if (section) setHighlightId(section);
  }}
/>
```

### 4.3 Mount the table (Ratios tab) with a highlight that fades

```tsx
import { RatiosTable } from "@/components/ratios-table";

const [highlightId, setHighlightId] = useState<string | null>(null);

useEffect(() => {
  if (!highlightId) return;
  const t = setTimeout(() => setHighlightId(null), 2800);
  return () => clearTimeout(t);
}, [highlightId]);

<RatiosTable sections={ratiosSections} highlightId={highlightId} />
```

### 4.4 Switching tabs from the globe

When `onSelect` fires with `tab: "ratios"` (or your tab id) and a `section`, your tab controller should:
1. switch to the Ratios tab
2. pass `highlightId={section}` to `<RatiosTable>`

The table already scrolls the matching `data-row-id` into view and flashes a gold ring for ~2.8s.

---

## 5. Section structure for the Ratios table

```ts
const ratiosSections = [
  {
    id: "profit",
    title: "Profit Drivers",
    rows: [
      { id: "grossMargin", friendly: "Gross Margin", techName: "Gross Profit / Revenue", description: "...", value: 0.386, format: "pct", health: 72, series: [...], benchmark: { p25: 0.28, p50: 0.36, p75: 0.45, unit: "pct", higher_is_better: true } },
      { id: "interestBurden", friendly: "Interest Burden", ... },
      { id: "taxBurden", friendly: "Tax Burden", ... },
    ],
    subsections: [
      { id: "opex", title: "Opex", rows: [
        { id: "opexRatio", friendly: "Opex Ratio", ... },
      ]},
    ],
  },
  { id: "assets", title: "Asset Productivity", rows: [
    { id: "fixedAssetUtil", ... },
    { id: "wcUtil", ... },
  ]},
  { id: "leverage", title: "Leverage & Finance", rows: [
    { id: "debtServiceCover", ... },
    { id: "factoringCost", ... },
    { id: "equityMultiplier", ... },
    { id: "fundingStructure", ... },
  ]},
  { id: "cash", title: "Cash Flow", rows: [
    { id: "debtorDays", ... },
    { id: "creditorDays", ... },
    { id: "inventoryDays", ... },
    { id: "capexIntensity", ... },
  ]},
  { id: "people", title: "People & Systems", rows: [ /* your people metrics */ ]},
];
```

Every `id` here that matches a driver in the table above becomes clickable from the globe.

---

## 6. Bottom diagnostics rail

The 6 mini metrics at the bottom of the globe (ROE, Break-even, CCC, Net Margin, Gross Margin, Health) currently come from a hardcoded `DIAGNOSTICS` array near the top of `holo-globe.tsx`. Replace those strings with values from your dashboard state — either by passing them as a prop or by computing them inside the file and reading from your store.

---

## 7. Interaction summary

| Gesture | Result |
|---|---|
| Click a pillar planet | Pillar zooms to center; its drivers orbit it. Center planet shows a "← Overview" button. |
| Click a driver moon | Switches to Ratios tab, scrolls to that row, flashes gold for 2.8s. |
| Click empty system | Toggles auto-rotation pause. Status pill in bottom rail flips Live / Paused. |
| Drag the system | Manual rotation, even when paused. |
| Hover a planet/moon | Premium hover card with health %, risk tier, 5-quadrant industry benchmark, trendline. |

---

## 8. Style notes

Pure ink-and-gold: deep radial backgrounds (`#0b1428 → #03060f`), gold accent `#b7872a / #d4a550 / #f7d98a`, monospaced SF Mono / Menlo for HUD-style labels, foreignObject SVG for crisp hover cards with backdrop blur. No external font dependency required.

---

That's the whole drop-in. After the three files are added and the two mount points wired, the globe and table are linked end-to-end.
