import React, { useState } from "react";
import { 
  ArrowRight, Activity, ArrowUpRight, ArrowDownRight,
  TrendingUp, Download, ExternalLink, Settings,
  AlertTriangle, ShieldAlert, CheckCircle2,
  Clock, Zap, LayoutDashboard, Target, Crosshair
} from "lucide-react";
import "./_group.css";

const kpis = [
  {
    id: "rev",
    name: "Revenue",
    value: "£2.4M",
    status: "healthy",
    statusLabel: "+12% YoY",
    description: "Annualized run rate based on current quarter.",
    chips: ["Target: £2.2M"],
    trend: [30, 40, 45, 50, 49, 60, 70, 90]
  },
  {
    id: "gm",
    name: "Gross Margin",
    value: "38%",
    status: "healthy",
    statusLabel: "Top Quartile",
    description: "Direct costs are well controlled.",
    chips: ["Industry: 32%"],
    trend: [32, 33, 34, 34, 35, 36, 38, 38]
  },
  {
    id: "om",
    name: "Operating Margin",
    value: "20%",
    status: "healthy",
    statusLabel: "Stable",
    description: "Overhead scaling efficiently.",
    chips: ["Target: 18%"],
    trend: [15, 16, 15, 18, 19, 19, 20, 20]
  },
  {
    id: "nm",
    name: "Net Margin",
    value: "11%",
    status: "watch",
    statusLabel: "Pressure",
    description: "Impacted by recent financing costs.",
    chips: ["Last Q: 13%"],
    trend: [12, 13, 14, 13, 12, 11, 10, 11]
  },
  {
    id: "debtor",
    name: "Debtor Days",
    value: "55",
    status: "watch",
    statusLabel: "Increasing",
    description: "Collections are slowing down.",
    chips: ["Target: 45", "Sector: 50"],
    trend: [42, 45, 48, 50, 52, 53, 54, 55]
  },
  {
    id: "creditor",
    name: "Creditor Days",
    value: "42",
    status: "healthy",
    statusLabel: "Optimized",
    description: "In line with supplier terms.",
    chips: ["Terms: 45"],
    trend: [38, 39, 40, 41, 42, 42, 42, 42]
  },
  {
    id: "cash",
    name: "Cash Runway",
    value: "14 wks",
    status: "alert",
    statusLabel: "Critical",
    description: "Approaching minimum operational buffer.",
    chips: ["Min Buffer: 12w", "Burn: £85k/mo"],
    trend: [24, 22, 20, 18, 16, 15, 14, 14]
  },
  {
    id: "dol",
    name: "Degree of Operating Leverage",
    value: "3.2x",
    status: "alert",
    statusLabel: "High Risk",
    description: "High fixed costs mean small revenue changes swing profits wildly.",
    chips: ["Ideal: <2.0x"],
    trend: [2.1, 2.3, 2.5, 2.8, 3.0, 3.1, 3.2, 3.2]
  }
];

function Sparkline({ data, status }: { data: number[], status: string }) {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const height = 40;
  const width = 120;
  
  const points = data.map((val, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((val - min) / range) * height;
    return `${x},${y}`;
  }).join(" ");

  let strokeClass = "neon-sparkline";
  if (status === "watch") strokeClass = "neon-sparkline-amber";
  if (status === "alert") strokeClass = "neon-sparkline-red";

  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        <linearGradient id="neon-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#00D4FF" />
          <stop offset="100%" stopColor="#7C3AED" />
        </linearGradient>
      </defs>
      <polyline
        points={points}
        className={strokeClass}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Neon() {
  const [activeTab, setActiveTab] = useState("Ratios");

  return (
    <div className="vibe-neon p-6 md:p-8 flex flex-col gap-8">
      {/* Header */}
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl neon-bg-gradient flex items-center justify-center shadow-[0_0_15px_rgba(124,58,237,0.5)]">
            <Activity className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              Ledgerline
            </h1>
            <p className="text-xs tracking-widest uppercase text-slate-400 font-medium mt-1">Acme Manufacturing Ltd</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button className="neon-card px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 hover:text-white text-slate-300">
            <Download className="w-4 h-4" /> Export
          </button>
          <button className="neon-card neon-border-gradient px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 text-white shadow-[0_0_15px_rgba(0,212,255,0.15)] hover:shadow-[0_0_20px_rgba(0,212,255,0.3)] transition-shadow">
            <ExternalLink className="w-4 h-4 text-[#00D4FF]" /> Portal
          </button>
        </div>
      </header>

      {/* Profiles */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="neon-card p-5 rounded-2xl flex items-center justify-between group cursor-pointer hover:ring-1 hover:ring-cyan-400/30">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <LayoutDashboard className="w-4 h-4 text-slate-400 group-hover:text-cyan-400 transition-colors" />
              <h2 className="text-xs tracking-widest uppercase text-slate-400 font-bold">Business Profile</h2>
            </div>
            <p className="text-lg font-semibold text-white mt-1">Manufacturing</p>
          </div>
          <Settings className="w-5 h-5 text-slate-500 group-hover:text-white transition-colors" />
        </div>
        
        <div className="neon-card p-5 rounded-2xl flex items-center justify-between group cursor-pointer hover:ring-1 hover:ring-violet-400/30">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Target className="w-4 h-4 text-slate-400 group-hover:text-violet-400 transition-colors" />
              <h2 className="text-xs tracking-widest uppercase text-slate-400 font-bold">Risk Profile</h2>
            </div>
            <p className="text-lg font-semibold text-white mt-1">Aggressive Growth</p>
          </div>
          <div className="flex gap-1">
            <div className="w-2 h-2 rounded-full bg-slate-600"></div>
            <div className="w-2 h-2 rounded-full bg-slate-600"></div>
            <div className="w-2 h-2 rounded-full bg-violet-500 shadow-[0_0_8px_rgba(124,58,237,0.8)]"></div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex flex-wrap gap-2">
        {["Today", "Ratios", "Cash", "Moves", "Tasks"].map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-5 py-2.5 rounded-full text-sm font-semibold transition-all duration-300 ${
              activeTab === tab 
                ? "neon-bg-gradient text-white shadow-[0_0_15px_rgba(0,212,255,0.3)]" 
                : "text-slate-400 hover:text-white hover:bg-white/5"
            }`}
          >
            {tab}
          </button>
        ))}
      </nav>

      {/* KPI Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 pb-12">
        {kpis.map((kpi) => (
          <div key={kpi.id} className="neon-card p-6 rounded-2xl flex flex-col h-full relative overflow-hidden group">
            {/* Background subtle glow based on status */}
            {kpi.status === 'alert' && <div className="absolute -top-24 -right-24 w-48 h-48 bg-red-500/10 rounded-full blur-3xl pointer-events-none"></div>}
            {kpi.status === 'healthy' && <div className="absolute -top-24 -right-24 w-48 h-48 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none"></div>}
            
            <div className="flex justify-between items-start mb-6">
              <div>
                <h3 className="text-xs tracking-widest uppercase text-slate-400 font-bold mb-2">{kpi.name}</h3>
                <div className="flex items-baseline gap-3">
                  <span className="text-4xl font-bold text-white tracking-tight">{kpi.value}</span>
                  <span className={`text-xs font-bold px-2 py-1 rounded-md ${
                    kpi.status === 'healthy' ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20' :
                    kpi.status === 'watch' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                    'bg-red-500/10 text-red-400 border border-red-500/20'
                  }`}>
                    {kpi.statusLabel}
                  </span>
                </div>
              </div>
              <div className="opacity-70 group-hover:opacity-100 transition-opacity">
                <Sparkline data={kpi.trend} status={kpi.status} />
              </div>
            </div>

            <div className="mb-6 h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
              <div 
                className={`h-full rounded-full ${
                  kpi.status === 'healthy' ? 'neon-health-green w-[85%]' :
                  kpi.status === 'watch' ? 'neon-health-amber w-[55%]' :
                  'neon-health-red w-[25%]'
                }`}
              ></div>
            </div>

            <div className="mt-auto">
              <p className="text-sm text-slate-400 mb-4">{kpi.description}</p>
              <div className="flex flex-wrap gap-2">
                {kpi.chips.map((chip, idx) => (
                  <span key={idx} className="text-[10px] uppercase tracking-wider font-bold text-slate-500 bg-slate-800/50 px-2.5 py-1 rounded-md border border-slate-700/50">
                    {chip}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default Neon;
