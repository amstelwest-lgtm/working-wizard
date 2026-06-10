import React, { useState } from "react";
import "./_group.css";

const AsciiBar = ({ value, max, colorClass }: { value: number; max: number; colorClass: string }) => {
  const blocks = 5;
  const filled = Math.round((value / max) * blocks);
  
  const bar = Array.from({ length: blocks }).map((_, i) => (
    i < filled ? "■" : "□"
  )).join("");

  return <span className={colorClass}>[{bar}]</span>;
};

const Sparkline = ({ data, colorClass }: { data: number[]; colorClass: string }) => {
  // A simple fake sparkline using svg
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * 100;
    const y = 100 - ((d - min) / range) * 100;
    return `${x},${y}`;
  }).join(" ");

  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-16 h-6 ml-auto opacity-70">
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        className={colorClass}
        points={points}
      />
    </svg>
  );
};

interface KPICardProps {
  name: string;
  value: string;
  unit: string;
  status: "good" | "watch" | "danger";
  barValue: number;
  barMax: number;
  description: string;
  trend: number[];
  benchmarks: string[];
}

const KPICard = ({ name, value, unit, status, barValue, barMax, description, trend, benchmarks }: KPICardProps) => {
  const statusColor = status === "good" ? "text-[#22c55e]" : status === "watch" ? "text-[#FFB800]" : "text-[#ef4444]";
  
  return (
    <div className="bg-[#111111] border border-[#1e1e1e] p-4 flex flex-col gap-3">
      <div className="flex justify-between items-start">
        <div className="text-xs uppercase tracking-wider text-[#666] font-semibold">{name}</div>
        <AsciiBar value={barValue} max={barMax} colorClass={statusColor} />
      </div>
      
      <div className="flex items-baseline gap-1">
        <span className={`text-2xl font-semibold ${status === "good" ? "text-white" : statusColor}`}>
          {value}
        </span>
        <span className="text-sm text-[#a3a3a3]">{unit}</span>
      </div>

      <div className="flex items-center gap-2">
        <Sparkline data={trend} colorClass={statusColor} />
      </div>

      <div className="text-xs text-[#a3a3a3] leading-relaxed border-t border-[#1e1e1e] pt-2 mt-1">
        {description}
      </div>

      <div className="flex gap-2 mt-auto pt-2">
        {benchmarks.map((b, i) => (
          <span key={i} className="text-[10px] uppercase tracking-wider bg-[#1e1e1e] text-[#a3a3a3] px-2 py-1">
            {b}
          </span>
        ))}
      </div>
    </div>
  );
};

export function Terminal() {
  const [activeTab, setActiveTab] = useState("RATIOS");

  const tabs = ["TODAY", "RATIOS", "CASH", "MOVES", "TASKS"];

  const kpis: KPICardProps[] = [
    {
      name: "Revenue (TTM)",
      value: "2.4",
      unit: "M GBP",
      status: "good",
      barValue: 4,
      barMax: 5,
      description: "Trailing 12-month top line. +14% vs LY.",
      trend: [1.8, 1.9, 2.0, 2.2, 2.3, 2.4],
      benchmarks: ["IND: 2.1M", "TGT: 2.5M"]
    },
    {
      name: "Gross Margin",
      value: "38",
      unit: "%",
      status: "good",
      barValue: 4,
      barMax: 5,
      description: "Direct costs managed well. Material costs stable.",
      trend: [35, 36, 36, 37, 38, 38],
      benchmarks: ["IND: 35%", "TGT: 40%"]
    },
    {
      name: "Operating Margin",
      value: "20",
      unit: "%",
      status: "good",
      barValue: 4,
      barMax: 5,
      description: "EBIT over revenue. Strong overhead control.",
      trend: [15, 16, 18, 19, 19, 20],
      benchmarks: ["IND: 15%", "TGT: 22%"]
    },
    {
      name: "Net Margin",
      value: "11",
      unit: "%",
      status: "watch",
      barValue: 3,
      barMax: 5,
      description: "Bottom line impact from recent debt service costs.",
      trend: [12, 12, 11, 10, 10, 11],
      benchmarks: ["IND: 8%", "TGT: 15%"]
    },
    {
      name: "Debtor Days",
      value: "55",
      unit: "DAYS",
      status: "watch",
      barValue: 3,
      barMax: 5,
      description: "Collections slowing. Top 3 clients extending terms.",
      trend: [45, 48, 50, 52, 54, 55],
      benchmarks: ["IND: 45", "TGT: 40"]
    },
    {
      name: "Cash Runway",
      value: "14",
      unit: "WEEKS",
      status: "danger",
      barValue: 1,
      barMax: 5,
      description: "Current cash vs burn rate. Attention required.",
      trend: [24, 20, 18, 16, 15, 14],
      benchmarks: ["IND: 24W", "MIN: 12W"]
    },
    {
      name: "Deg. Operating Lev.",
      value: "3.2",
      unit: "X",
      status: "danger",
      barValue: 4,
      barMax: 5, // Reversed meaning in context, high risk
      description: "High fixed costs vs variable. Volume sensitive.",
      trend: [2.5, 2.7, 2.9, 3.0, 3.1, 3.2],
      benchmarks: ["IND: 2.0X", "TGT: <2.5X"]
    },
    {
      name: "Cust. Concentration",
      value: "34",
      unit: "%",
      status: "watch",
      barValue: 3,
      barMax: 5,
      description: "Top 5 clients share of total revenue. Moderately high.",
      trend: [28, 30, 31, 32, 33, 34],
      benchmarks: ["IND: 25%", "MAX: 30%"]
    },
    {
      name: "Sales / Employee",
      value: "217",
      unit: "K GBP",
      status: "good",
      barValue: 5,
      barMax: 5,
      description: "Efficiency metric. Headcount growth lagging revenue.",
      trend: [180, 190, 195, 205, 210, 217],
      benchmarks: ["IND: 190K", "TGT: 200K"]
    },
    {
      name: "Profit Power",
      value: "280",
      unit: "K GBP",
      status: "good",
      barValue: 4,
      barMax: 5,
      description: "True underlying cash generation capacity.",
      trend: [200, 220, 240, 250, 270, 280],
      benchmarks: ["IND: 200K", "TGT: 300K"]
    }
  ];

  return (
    <div className="vibe-terminal min-h-screen text-sm select-none flex flex-col">
      {/* Header */}
      <header className="border-b border-[#1e1e1e] bg-[#0a0a0a] flex items-center justify-between px-6 py-3 shrink-0 sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <div className="font-bold text-[#FFB800] tracking-widest text-lg flex items-center gap-2">
            <span className="opacity-70">█</span> LEDGERLINE<span className="opacity-50 text-xs">.SYS</span>
          </div>
          <div className="text-[#666] text-xs px-2 py-0.5 border border-[#333]">
            v2.1.4
          </div>
        </div>
        
        <div className="flex items-center gap-6 text-xs font-semibold tracking-wider text-[#a3a3a3]">
          <button className="hover:text-white transition-colors">[TOGGLE_MODE]</button>
          <button className="hover:text-white transition-colors">[EXPORT_CSV]</button>
          <button className="text-[#FFB800] hover:text-white transition-colors">[PORTAL_ACCESS]</button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 p-6 flex flex-col gap-6 max-w-[1400px] mx-auto w-full">
        
        {/* Top Profile Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Business Profile */}
          <div className="bg-[#111111] border border-[#1e1e1e] p-4 flex flex-col gap-4">
            <div className="flex justify-between items-center border-b border-[#1e1e1e] pb-2">
              <span className="text-[#666] uppercase text-xs font-bold">BUSINESS_ENTITY</span>
              <span className="text-[#FFB800] text-xs">ID: ACME-8842</span>
            </div>
            <div className="flex justify-between items-end">
              <div>
                <h1 className="text-xl text-white font-medium mb-1">Acme Manufacturing Ltd</h1>
                <div className="text-[#a3a3a3] text-xs">SECTOR: INDUSTRIAL / REGION: EMEA</div>
              </div>
              <select className="bg-[#0a0a0a] border border-[#333] text-[#a3a3a3] text-xs py-1 px-2 focus:outline-none focus:border-[#FFB800]">
                <option>CONSOLIDATED</option>
                <option>UK_OPS_ONLY</option>
                <option>EU_OPS_ONLY</option>
              </select>
            </div>
          </div>

          {/* Risk Profile */}
          <div className="bg-[#111111] border border-[#1e1e1e] p-4 flex flex-col gap-4">
            <div className="flex justify-between items-center border-b border-[#1e1e1e] pb-2">
              <span className="text-[#666] uppercase text-xs font-bold">RISK_PARAMETERS</span>
              <span className="text-[#a3a3a3] text-xs">MODEL: STANDARD</span>
            </div>
            <div className="flex items-center justify-between h-full">
              <div className="text-xs text-[#a3a3a3] max-w-[200px]">
                Defines threshold sensitivities for health indicators and alerts.
              </div>
              <div className="flex border border-[#333] bg-[#0a0a0a]">
                {["CONS", "BAL", "AGGR"].map(r => (
                  <button 
                    key={r}
                    className={`px-4 py-1.5 text-xs font-bold transition-colors ${
                      r === "BAL" 
                        ? "bg-[#1e1e1e] text-[#FFB800]" 
                        : "text-[#666] hover:text-[#a3a3a3]"
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Tab Bar */}
        <div className="flex border-b border-[#1e1e1e] mt-4">
          {tabs.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-6 py-2 text-sm tracking-widest font-semibold transition-all ${
                activeTab === tab 
                  ? "text-[#FFB800] border-b-2 border-[#FFB800] -mb-[1px]" 
                  : "text-[#666] hover:text-[#a3a3a3]"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Tab Content - Ratios Grid */}
        <div className="mt-4">
          <div className="flex justify-between items-center mb-4">
            <div className="text-xs text-[#666] uppercase tracking-widest flex gap-4">
              <span>METRICS: 10</span>
              <span>ALERTS: 2 <span className="text-[#ef4444] animate-pulse">■</span></span>
              <span>UPDATED: 08:42 Z</span>
            </div>
            <div className="text-xs text-[#666] flex gap-4">
              <span>VIEW: GRID</span>
              <span>SORT: ALPHANUMERIC</span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {kpis.map((kpi, idx) => (
              <KPICard key={idx} {...kpi} />
            ))}
          </div>
        </div>

      </main>
      
      {/* Footer */}
      <footer className="border-t border-[#1e1e1e] bg-[#0a0a0a] p-2 flex justify-between items-center text-[10px] text-[#666] uppercase tracking-widest px-6 mt-auto shrink-0">
        <div>SYS_OK</div>
        <div className="flex gap-4">
          <span>LAT: 12MS</span>
          <span>MEM: 24MB</span>
          <span>NET: ESTABLISHED</span>
        </div>
      </footer>
    </div>
  );
}

export default Terminal;
