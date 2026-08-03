import { useState, useMemo, useEffect, useRef } from "react";
import type { RatioInfo } from "@/components/holo-globe";

type PillarId = "profit" | "assets" | "financing" | "cash";

const PILLAR_COLORS: Record<PillarId, string> = {
  cash:      "#60b8e0",
  profit:    "#d4af37",
  assets:    "#7ec8a0",
  financing: "#a78bfa",
};

const PILLAR_LABELS: Record<PillarId, string> = {
  cash:      "Cash",
  profit:    "Profit",
  assets:    "Assets",
  financing: "Financing",
};

// Ratios driving each pillar — mirrors PILLARS in holo-globe.tsx exactly
const PILLAR_RATIOS: Record<PillarId, string[]> = {
  profit:    ["revenueGrowth", "salesPerEmployee", "grossMargin", "directCostsRatio", "fixedCostRatio", "interestBurden", "taxBurden"],
  assets:    ["assetTurnover", "roa", "inventoryDays", "fixedCapitalUtilization", "workingCapitalUtilization"],
  financing: ["fundingStructure", "debtToEquity", "debtToAssets", "equityMultiplier", "interestBurden", "workingCapitalDays"],
  cash:      ["debtorDays", "creditorDays", "inventoryDays", "currentRatio", "workingCapitalFunding", "capexIntensity", "assetReinvestmentRatio", "ocfToEbitda"],
};

// Fallback friendly names when ratioLookup isn't available yet
const RATIO_FRIENDLY: Record<string, string> = {
  revenueGrowth:           "Revenue Growth",
  salesPerEmployee:        "Sales per Employee",
  grossMargin:             "Gross Profit Margin",
  directCostsRatio:        "Direct Cost Ratio",
  fixedCostRatio:          "Fixed-Cost Burden",
  interestBurden:          "Debt Drag",
  taxBurden:               "Tax Survival Rate",
  assetTurnover:           "Asset Engine",
  roa:                     "Asset Productivity",
  inventoryDays:           "Stock Sitting Time",
  fixedCapitalUtilization: "Fixed Asset Productivity",
  workingCapitalUtilization:"WC Efficiency",
  fundingStructure:        "Equity Solvency",
  debtToEquity:            "Debt-to-Equity",
  debtToAssets:            "Debt-to-Assets",
  equityMultiplier:        "Leverage Level",
  workingCapitalDays:      "Cash Trapped Days",
  debtorDays:              "Customer Pay Speed",
  creditorDays:            "Supplier Pay Window",
  currentRatio:            "Current Ratio",
  workingCapitalFunding:   "WC Funding Intensity",
  capexIntensity:          "Capex Intensity",
  assetReinvestmentRatio:  "Asset Reinvestment Ratio",
  ocfToEbitda:             "Cash Quality",
};

// Zone SVG paths from the original design — keyed to their tree region
const ZONE_PATHS = {
  profit: `M52,300
    C38,235 55,180 105,165
    C140,135 185,160 210,168
    C235,158 270,140 310,165
    C365,178 388,238 372,300
    C382,345 348,372 298,360
    C255,378 175,378 132,360
    C82,372 46,345 52,300 Z`,
  assets: `M185,355
    C172,420 165,475 178,540
    C183,575 195,600 200,618
    C218,618 232,600 238,575
    C248,520 238,460 235,415
    C233,385 228,365 225,352
    C212,348 196,350 185,355 Z`,
  financing_fill: `M215,612
    C160,635 95,655 55,690
    L375,690
    C330,655 265,635 215,612 Z`,
};

const HIT_PATHS = {
  profit:    "M52,300 C38,235 55,180 105,165 C140,135 185,160 210,168 C235,158 270,140 310,165 C365,178 388,238 372,300 C382,345 348,372 298,360 C255,378 175,378 132,360 C82,372 46,345 52,300 Z",
  assets:    "M178,360 C168,430 162,480 176,545 C181,580 193,602 200,620 C220,620 235,602 240,578 C250,520 240,458 237,412 C235,388 230,368 228,358 C210,352 190,354 178,360 Z",
  financing: "M215,610 C158,634 92,655 50,695 L378,695 C333,655 268,634 215,610 Z",
};

function computePillarScore(pid: PillarId, ratioLookup?: Record<string, RatioInfo>): number {
  const keys = PILLAR_RATIOS[pid];
  const healths = keys
    .map((k) => ratioLookup?.[k]?.health)
    .filter((h): h is number => typeof h === "number" && isFinite(h));
  if (!healths.length) return NaN;
  return Math.round(healths.reduce((a, b) => a + b, 0) / healths.length);
}

function computeTrend(series?: number[]): "up" | "down" | "flat" {
  if (!series || series.length < 2) return "flat";
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last > prev + 0.001) return "up";
  if (last < prev - 0.001) return "down";
  return "flat";
}

function healthColor(h: number): string {
  if (!isFinite(h)) return "#8E96A3";
  if (h >= 75) return "#7ec8a0";
  if (h >= 60) return "#d4af37";
  return "#e0a85a";
}

type MoteConfig = {
  left: string; top: string; width: string; height: string;
  peak: number; sway: string; duration: string; delay: string;
};

function generateMotes(count = 30): MoteConfig[] {
  // Use a seeded pseudo-random for SSR consistency
  let s = 0xdeadbeef;
  const rnd = () => { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return (s >>> 0) / 0xffffffff; };
  return Array.from({ length: count }, () => {
    let x: number, y: number;
    const r = rnd();
    if (r < 0.45)      { x = rnd() * 24; y = rnd() * 100; }
    else if (r < 0.90) { x = 76 + rnd() * 24; y = rnd() * 100; }
    else               { x = 24 + rnd() * 52; y = rnd() * 22; }
    const size = (1.8 + rnd() * 2.4).toFixed(2);
    const peak = 0.45 + rnd() * 0.4;
    const dur = 13 + rnd() * 12;
    const delay = -(rnd() * dur);
    const sway = ((rnd() * 16) - 8).toFixed(2);
    return {
      left: x.toFixed(1) + "%",
      top: y.toFixed(1) + "%",
      width: size + "px",
      height: size + "px",
      peak,
      sway: sway + "px",
      duration: dur.toFixed(1) + "s",
      delay: delay.toFixed(1) + "s",
    };
  });
}

type DrillRatio = { key: string; name: string; score: number; trend: "up" | "down" | "flat" };

type Props = {
  ratioLookup?: Record<string, RatioInfo>;
  onSelect: (target: { tab: string; section?: string }) => void;
  extras?: { avgHealth?: number; businessName?: string };
};

export function TreeHero({ ratioLookup, onSelect, extras }: Props) {
  const [selectedPillar, setSelectedPillar] = useState<PillarId | null>(null);
  const [drillOpen, setDrillOpen] = useState(false);
  const [drillPillar, setDrillPillar] = useState<PillarId | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const motes = useMemo(() => generateMotes(30), []);

  const pillarScores = useMemo((): Record<PillarId, number> => ({
    cash:      computePillarScore("cash",      ratioLookup),
    profit:    computePillarScore("profit",    ratioLookup),
    assets:    computePillarScore("assets",    ratioLookup),
    financing: computePillarScore("financing", ratioLookup),
  }), [ratioLookup]);

  const compositeHealth = useMemo(() => {
    const vals = Object.values(pillarScores).filter((h) => isFinite(h));
    if (!vals.length) return extras?.avgHealth ?? NaN;
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  }, [pillarScores, extras?.avgHealth]);

  const drillData = useMemo((): DrillRatio[] => {
    if (!drillPillar) return [];
    return PILLAR_RATIOS[drillPillar].map((key) => {
      const info = ratioLookup?.[key];
      return {
        key,
        name: info?.friendly ?? RATIO_FRIENDLY[key] ?? key,
        score: info?.health != null && isFinite(info.health) ? Math.round(info.health) : NaN,
        trend: computeTrend(info?.series),
      };
    });
  }, [drillPillar, ratioLookup]);

  const selectPillar = (pid: PillarId) => {
    setSelectedPillar((prev) => (prev === pid ? null : pid));
  };

  const openDrill = (pid: PillarId, e: React.MouseEvent) => {
    e.stopPropagation();
    setDrillPillar(pid);
    setDrillOpen(true);
  };

  const closeDrill = () => {
    setDrillOpen(false);
  };

  // Score display with fallback dash
  const fmt = (score: number) => (isFinite(score) ? `${score} / 100` : "— / 100");

  return (
    <>
      <style>{`
        .th-hero { position: relative; width: 100%; max-width: 420px; aspect-ratio: 9/16; overflow: hidden; margin: 0 auto; }
        .th-hero * { box-sizing: border-box; }
        .th-tree-img { width: 100%; height: 100%; object-fit: cover; display: block; filter: brightness(2.2) contrast(1.05); }

        .th-zone { opacity: 0; transition: opacity 0.5s ease; }
        .th-zone.active { opacity: 1; }
        .th-zone-glow { fill: none; stroke-width: 3; stroke-linecap: round; filter: drop-shadow(0 0 8px currentColor); }

        .th-label {
          position: absolute; display: flex; flex-direction: column; gap: 2px;
          align-items: flex-start;
          opacity: 0; animation: th-fadeIn 0.6s ease forwards; cursor: pointer;
          pointer-events: auto; transition: transform 0.2s ease;
        }
        .th-label:active { transform: scale(0.97); }
        .th-label-cash { top: 13%; left: 50%; transform: translateX(-50%); animation-delay: 0.2s; }
        .th-label-cash:hover { transform: translateX(-50%) scale(1.05); }
        .th-label:not(.th-label-cash):hover { transform: scale(1.05); }
        .th-label-profit    { top: 26%; right: 4%; animation-delay: 0.45s; }
        .th-label-assets    { top: 55%; left: 3%; animation-delay: 0.7s; }
        .th-label-financing { bottom: 18%; right: 4%; animation-delay: 0.95s; }

        .th-chip {
          display: flex; align-items: center; gap: 6px;
          background: rgba(4,13,10,0.72);
          border: 1px solid rgba(212,175,55,0.4);
          backdrop-filter: blur(8px); border-radius: 4px; padding: 6px 10px; white-space: nowrap;
          transition: border-color 0.3s ease, background 0.3s ease;
          font-family: 'DM Sans', sans-serif;
        }
        .th-label.selected .th-chip {
          border-color: rgba(212,175,55,0.9);
          background: rgba(4,13,10,0.9);
        }
        .th-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; animation: th-pulse 2.4s ease-in-out infinite; }
        .th-label-name { font-family: 'Cormorant Garamond', serif; font-size: 13px; font-weight: 300; letter-spacing: 0.12em; text-transform: uppercase; }
        .th-label-value { font-size: 12px; font-weight: 500; color: rgba(255,235,170,0.95); letter-spacing: 0.04em; padding-left: 12px; text-shadow: 0 1px 3px rgba(0,0,0,0.7); font-family: 'DM Sans', sans-serif; }
        .th-score-bar { height: 4px; background: rgba(0,0,0,0.4); border-radius: 2px; overflow: hidden; margin: 2px 2px 0; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08); }
        .th-score-fill { height: 100%; border-radius: 2px; }

        .th-drill-prompt {
          display: none; align-items: center; gap: 5px;
          margin: 6px 0 0; padding: 6px 12px;
          font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; font-weight: 500;
          color: #f0e8d4;
          background: rgba(6,16,12,0.92);
          backdrop-filter: blur(6px);
          border: 1px solid rgba(212,175,55,0.45);
          border-radius: 4px; cursor: pointer;
          box-shadow: 0 2px 8px rgba(0,0,0,0.5);
          white-space: nowrap; width: fit-content;
          transition: background 0.2s ease, border-color 0.2s ease;
          font-family: 'DM Sans', sans-serif;
        }
        .th-label.selected .th-drill-prompt { display: inline-flex; animation: th-fadeIn 0.4s ease; }
        .th-drill-prompt:hover { background: rgba(255,255,255,0.12); border-color: rgba(255,255,255,0.3); }
        .th-drill-arrow { transition: transform 0.2s ease; }
        .th-drill-prompt:hover .th-drill-arrow { transform: translateX(2px); }

        .th-health {
          position: absolute; top: 14px; right: 14px;
          z-index: 5; text-align: right; pointer-events: none;
          background: rgba(6,16,12,0.78); backdrop-filter: blur(8px);
          border: 1px solid rgba(212,175,55,0.3);
          border-radius: 8px; padding: 8px 12px 10px;
          opacity: 0; animation: th-fadeIn 0.9s ease 0.1s forwards;
          font-family: 'DM Sans', sans-serif;
        }
        .th-health-eyebrow { font-size: 8px; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(232,224,208,0.6); margin-bottom: -1px; }
        .th-health-score { font-family: 'Cormorant Garamond', serif; font-weight: 300; font-size: 40px; line-height: 0.95; letter-spacing: 0.01em; text-shadow: 0 2px 10px rgba(0,0,0,0.6); }
        .th-health-score-row { display: flex; align-items: baseline; justify-content: flex-end; gap: 4px; }
        .th-health-outof { font-size: 11px; color: rgba(232,224,208,0.5); }
        .th-health-track { width: 90px; height: 3px; margin: 6px 0 0 auto; background: rgba(0,0,0,0.45); border-radius: 2px; overflow: hidden; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08); }
        .th-health-fill { height: 100%; border-radius: 2px; transition: width 1s ease; }

        .th-hint {
          position: absolute; top: 14px; left: 14px;
          z-index: 5; font-size: 11px; letter-spacing: 0.08em; line-height: 1.4;
          color: rgba(232,224,208,0.85); pointer-events: none; transition: opacity 0.4s ease;
          text-align: left; font-weight: 400;
          background: rgba(4,13,10,0.55); backdrop-filter: blur(6px);
          border-left: 2px solid rgba(212,175,55,0.6);
          padding: 7px 11px; border-radius: 0 4px 4px 0;
          max-width: 145px; font-family: 'DM Sans', sans-serif;
        }
        .th-hint.hidden { opacity: 0; }

        .th-brand {
          position: absolute; bottom: 0; left: 0; right: 0; z-index: 6;
          padding: 16px 20px 20px;
          background: linear-gradient(to top, rgba(4,13,10,0.92) 0%, transparent 100%);
          display: flex; flex-direction: column; gap: 4px;
          pointer-events: none;
        }
        .th-brand-name { font-family: 'Cormorant Garamond', serif; font-size: 22px; font-weight: 300; letter-spacing: 0.3em; color: #d4af37; }
        .th-brand-tagline { font-size: 10px; letter-spacing: 0.14em; color: rgba(232,224,208,0.5); text-transform: uppercase; font-family: 'DM Sans', sans-serif; }

        .th-backdrop {
          position: absolute; inset: 0; z-index: 9; background: rgba(0,0,0,0);
          pointer-events: none; transition: background 0.3s ease;
        }
        .th-backdrop.open { background: rgba(0,0,0,0.45); pointer-events: auto; }

        .th-drill-panel {
          position: absolute; left: 0; right: 0; bottom: 0; z-index: 10;
          background: rgba(6,16,12,0.97); backdrop-filter: blur(16px);
          border-top: 1px solid rgba(212,175,55,0.25);
          border-radius: 16px 16px 0 0;
          padding: 18px 20px 24px;
          transform: translateY(100%); transition: transform 0.38s cubic-bezier(0.22,1,0.36,1);
          max-height: 72%; overflow-y: auto;
          font-family: 'DM Sans', sans-serif;
        }
        .th-drill-panel.open { transform: translateY(0); }
        .th-drill-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
        .th-drill-title { font-family: 'Cormorant Garamond', serif; font-size: 20px; font-weight: 300; letter-spacing: 0.15em; text-transform: uppercase; }
        .th-drill-total { font-size: 11px; color: rgba(232,224,208,0.55); letter-spacing: 0.08em; margin-bottom: 16px; }
        .th-drill-close { width: 30px; height: 30px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.15); background: transparent; color: rgba(232,224,208,0.8); font-size: 16px; cursor: pointer; display: flex; align-items: center; justify-content: center; line-height: 1; }
        .th-drill-close:hover { background: rgba(255,255,255,0.08); }

        .th-ratio-row { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 12px; padding: 11px 0; border-bottom: 1px solid rgba(255,255,255,0.06); cursor: pointer; transition: background 0.15s ease; border-radius: 4px; }
        .th-ratio-row:last-child { border-bottom: none; }
        .th-ratio-row:hover { background: rgba(255,255,255,0.04); }
        .th-ratio-name { font-size: 13px; color: #e8e0d0; font-weight: 400; }
        .th-ratio-score { font-size: 13px; font-weight: 500; font-variant-numeric: tabular-nums; min-width: 30px; text-align: right; }
        .th-ratio-trend { font-size: 13px; min-width: 18px; text-align: center; }
        .th-trend-up { color: #7ec8a0; }
        .th-trend-down { color: #e8857a; }
        .th-trend-flat { color: rgba(232,224,208,0.4); }

        .th-mote {
          position: absolute; border-radius: 50%;
          background: rgba(255,223,130,1);
          box-shadow: 0 0 4px 1px rgba(255,210,90,0.8), 0 0 8px 2px rgba(212,175,55,0.4);
          opacity: 0; will-change: transform, opacity;
          animation: th-drift linear infinite;
        }

        @keyframes th-fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes th-pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(0.7); } }
        @keyframes th-drift {
          0%   { opacity: 0; transform: translateY(8px) translateX(0); }
          15%  { opacity: var(--th-peak); }
          85%  { opacity: var(--th-peak); }
          100% { opacity: 0; transform: translateY(-26px) translateX(var(--th-sway)); }
        }
        @media (prefers-reduced-motion: reduce) { .th-mote { animation: none; opacity: 0.12; } }
        .th-line { stroke-width: 1; stroke-dasharray: 4 3; opacity: 0.5; }
      `}</style>

      <div className="th-hero" style={{ background: "#040d0a", color: "#e8e0d0" }}>
        {/* Tree image */}
        <img className="th-tree-img" src="/tree-hero.jpg" alt="Business health tree" />

        {/* Gradient overlay */}
        <div style={{
          position: "absolute", inset: 0, zIndex: 1, pointerEvents: "none",
          background: `radial-gradient(ellipse 60% 40% at 50% 50%, transparent 40%, rgba(4,13,10,0.35) 100%),
            linear-gradient(to bottom, rgba(4,13,10,0.1) 0%, transparent 30%, transparent 60%, rgba(4,13,10,0.55) 100%)`,
        }} />

        {/* Ambient gold motes */}
        <div style={{ position: "absolute", inset: 0, zIndex: 1, pointerEvents: "none", overflow: "hidden" }}>
          {motes.map((m, i) => (
            <div
              key={i}
              className="th-mote"
              style={{
                left: m.left, top: m.top, width: m.width, height: m.height,
                animationDuration: m.duration, animationDelay: m.delay,
                ...{ "--th-peak": m.peak, "--th-sway": m.sway } as Record<string, string | number>,
              }}
            />
          ))}
        </div>

        {/* Highlight zones */}
        <svg
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 2, pointerEvents: "none" }}
          viewBox="0 0 420 747" preserveAspectRatio="none"
        >
          {/* Canopy = Profit */}
          <g className={`th-zone${selectedPillar === "profit" ? " active" : ""}`}>
            <path
              className="th-zone-glow"
              d={ZONE_PATHS.profit}
              style={{ color: "#d4af37", stroke: "#d4af37", fill: "rgba(212,175,55,0.10)" }}
              opacity="0.9"
            />
          </g>
          {/* Stem = Assets */}
          <g className={`th-zone${selectedPillar === "assets" ? " active" : ""}`}>
            <path
              className="th-zone-glow"
              d={ZONE_PATHS.assets}
              style={{ color: "#7ec8a0", stroke: "#7ec8a0", fill: "rgba(126,200,160,0.16)" }}
              opacity="0.85" strokeWidth="2"
            />
            <path
              className="th-zone-glow"
              d="M205,355 C200,430 188,478 196,540 C201,578 211,600 213,616"
              style={{ color: "#7ec8a0", stroke: "#caf0dc" }}
              opacity="0.95" strokeWidth="1.5"
            />
          </g>
          {/* Roots = Financing */}
          <g className={`th-zone${selectedPillar === "financing" ? " active" : ""}`}>
            <path
              className="th-zone-glow"
              d={ZONE_PATHS.financing_fill}
              style={{ color: "#a78bfa", stroke: "none", fill: "rgba(167,139,250,0.14)" }}
              opacity="0.85"
            />
            {[
              "M215,612 C170,638 110,655 58,690",
              "M215,612 C185,646 150,665 103,692",
              "M215,612 C210,648 196,672 163,693",
              "M215,612 C222,648 242,672 273,693",
              "M215,612 C245,646 285,665 332,692",
              "M215,612 C260,638 320,655 367,690",
            ].map((d, i) => (
              <path key={i} className="th-zone-glow" d={d} style={{ color: "#a78bfa", stroke: "#a78bfa" }} opacity="0.95" />
            ))}
          </g>
          {/* Whole tree = Cash */}
          <g className={`th-zone${selectedPillar === "cash" ? " active" : ""}`}>
            <path
              className="th-zone-glow"
              d={ZONE_PATHS.profit}
              style={{ color: "#60b8e0", stroke: "#60b8e0", fill: "rgba(96,184,224,0.06)" }}
              opacity="0.75"
            />
            <path
              className="th-zone-glow"
              d={ZONE_PATHS.assets}
              style={{ color: "#60b8e0", stroke: "#60b8e0", fill: "rgba(96,184,224,0.10)" }}
              opacity="0.75"
            />
            {[
              "M215,615 C170,640 110,655 60,688",
              "M215,615 C185,648 150,665 105,690",
              "M215,615 C210,650 195,672 165,692",
              "M215,615 C225,650 245,672 275,692",
              "M215,615 C245,648 285,665 330,690",
              "M215,615 C260,640 320,655 365,688",
            ].map((d, i) => (
              <path key={i} className="th-zone-glow" d={d} style={{ color: "#60b8e0", stroke: "#60b8e0" }} opacity="0.6" strokeWidth="2" />
            ))}
          </g>
        </svg>

        {/* Invisible hit areas — click tree region to select pillar */}
        <svg
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 3, pointerEvents: "none" }}
          viewBox="0 0 420 747" preserveAspectRatio="none"
        >
          {(["profit", "assets", "financing"] as const).map((pid) => (
            <path
              key={pid}
              d={HIT_PATHS[pid]}
              fill="rgba(255,255,255,0.001)"
              style={{ cursor: "pointer", pointerEvents: "all" }}
              onClick={() => selectPillar(pid)}
            />
          ))}
        </svg>

        {/* Connector lines */}
        <svg
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 2, pointerEvents: "none" }}
          viewBox="0 0 420 747" preserveAspectRatio="none"
        >
          <line className="th-line" stroke="#60b8e0" x1="210" y1="140" x2="210" y2="240" />
          <line className="th-line" stroke="#d4af37" x1="330" y1="210" x2="270" y2="200" />
          <line className="th-line" stroke="#7ec8a0" x1="120" y1="430" x2="195" y2="470" />
          <line className="th-line" stroke="#a78bfa" x1="300" y1="570" x2="250" y2="640" />
        </svg>

        {/* Labels */}
        <div style={{ position: "absolute", inset: 0, zIndex: 4, pointerEvents: "none" }}>
          {(["cash", "profit", "assets", "financing"] as PillarId[]).map((pid) => {
            const score = pillarScores[pid];
            const pct = isFinite(score) ? score : 0;
            const col = PILLAR_COLORS[pid];
            const isSelected = selectedPillar === pid;
            return (
              <div
                key={pid}
                className={`th-label th-label-${pid}${isSelected ? " selected" : ""}`}
                style={{ pointerEvents: "auto" }}
                onClick={() => selectPillar(pid)}
              >
                <div className="th-chip">
                  <span
                    className="th-dot"
                    style={{ background: col, boxShadow: `0 0 6px ${col}` }}
                  />
                  <span className="th-label-name" style={{ color: col }}>{PILLAR_LABELS[pid]}</span>
                </div>
                <span className="th-label-value">{fmt(score)}</span>
                <div className="th-score-bar" style={{ width: "100%" }}>
                  <div
                    className="th-score-fill"
                    style={{
                      width: `${pct}%`,
                      background: col,
                      boxShadow: `0 0 6px ${col}`,
                    }}
                  />
                </div>
                <button
                  className="th-drill-prompt"
                  onClick={(e) => openDrill(pid, e)}
                >
                  View ratios <span className="th-drill-arrow">→</span>
                </button>
              </div>
            );
          })}
        </div>

        {/* Hint */}
        <div className={`th-hint${selectedPillar ? " hidden" : ""}`}>
          Tap a label or part<br />of the tree to explore
        </div>

        {/* Composite health score */}
        <div className="th-health">
          <div className="th-health-eyebrow">Business Health</div>
          <div className="th-health-score-row">
            <span
              className="th-health-score"
              style={{ color: healthColor(compositeHealth) }}
            >
              {isFinite(compositeHealth) ? compositeHealth : "—"}
            </span>
            <span className="th-health-outof">/ 100</span>
          </div>
          <div className="th-health-track">
            <div
              className="th-health-fill"
              style={{
                width: isFinite(compositeHealth) ? `${compositeHealth}%` : "0%",
                background: healthColor(compositeHealth),
                boxShadow: `0 0 8px ${healthColor(compositeHealth)}`,
              }}
            />
          </div>
        </div>

        {/* Drill backdrop */}
        <div
          className={`th-backdrop${drillOpen ? " open" : ""}`}
          onClick={closeDrill}
        />

        {/* Drill panel */}
        <div ref={panelRef} className={`th-drill-panel${drillOpen ? " open" : ""}`}>
          {drillPillar && (
            <>
              <div className="th-drill-header">
                <div className="th-drill-title" style={{ color: PILLAR_COLORS[drillPillar] }}>
                  {PILLAR_LABELS[drillPillar]}
                </div>
                <button className="th-drill-close" onClick={closeDrill}>✕</button>
              </div>
              <div className="th-drill-total">
                Composite health score {isFinite(pillarScores[drillPillar]) ? pillarScores[drillPillar] : "—"} / 100
              </div>
              {drillData.map((row) => (
                <div
                  key={row.key}
                  className="th-ratio-row"
                  onClick={() => {
                    closeDrill();
                    onSelect({ tab: "dashboard", section: row.key });
                  }}
                >
                  <span className="th-ratio-name">{row.name}</span>
                  <span
                    className="th-ratio-score"
                    style={{ color: PILLAR_COLORS[drillPillar] }}
                  >
                    {isFinite(row.score) ? row.score : "—"}
                  </span>
                  <span className={`th-ratio-trend ${
                    row.trend === "up" ? "th-trend-up" :
                    row.trend === "down" ? "th-trend-down" : "th-trend-flat"
                  }`}>
                    {row.trend === "up" ? "↑" : row.trend === "down" ? "↓" : "→"}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>

        {/* Brand */}
        <div className="th-brand">
          <div className="th-brand-name">MILŌN</div>
          <div className="th-brand-tagline">Business Health Intelligence</div>
        </div>
      </div>
    </>
  );
}
