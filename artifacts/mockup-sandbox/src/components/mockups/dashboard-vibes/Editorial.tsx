import React, { useState } from 'react';
import { Download, ExternalLink, Moon, Sun } from 'lucide-react';

const kpiData = [
  {
    name: "Revenue",
    value: "£2.4M",
    status: "good",
    description: "Annualized run rate based on last quarter.",
    trend: [1, 2, 2.5, 3, 4, 3.8, 4.5, 5.2, 5.8, 6.2],
    benchmarks: ["Top quartile", "+12% YoY"]
  },
  {
    name: "Gross Margin",
    value: "38%",
    status: "good",
    description: "Direct costs remaining stable.",
    trend: [35, 36, 36, 37, 36, 37, 38, 38, 38, 38],
    benchmarks: ["Sector avg 34%"]
  },
  {
    name: "Operating Margin",
    value: "20%",
    status: "good",
    description: "Operating leverage improving with scale.",
    trend: [15, 16, 17, 17, 18, 19, 19, 19, 20, 20],
    benchmarks: ["Target 18%"]
  },
  {
    name: "Net Margin",
    value: "11%",
    status: "good",
    description: "After tax and interest deductions.",
    trend: [8, 8, 9, 10, 10, 10, 11, 10, 11, 11],
    benchmarks: ["Above target"]
  },
  {
    name: "Debtor Days",
    value: "55",
    status: "warning",
    description: "Collections slowing. 15 days over standard terms.",
    trend: [40, 42, 45, 48, 50, 52, 53, 54, 55, 55],
    benchmarks: ["Target 40 days", "Action required"]
  },
  {
    name: "Cash Runway",
    value: "14 wks",
    status: "critical",
    description: "Approaching critical 12-week threshold.",
    trend: [24, 22, 20, 19, 18, 17, 16, 15, 14, 14],
    benchmarks: ["Target >24 wks", "High priority"]
  },
  {
    name: "Degree of Operating Leverage",
    value: "3.2x",
    status: "critical",
    description: "High fixed cost base increases earnings volatility.",
    trend: [2.5, 2.6, 2.8, 2.9, 3.0, 3.1, 3.1, 3.2, 3.2, 3.2],
    benchmarks: ["Sector avg 2.1x"]
  },
  {
    name: "Customer Concentration",
    value: "34%",
    status: "warning",
    description: "Revenue share of top 5 clients.",
    trend: [25, 28, 30, 32, 33, 33, 34, 34, 34, 34],
    benchmarks: ["Target <25%"]
  }
];

export function Editorial() {
  const [theme, setTheme] = useState('light');
  const [riskProfile, setRiskProfile] = useState('Balanced');

  return (
    <div className="min-h-screen text-[#1a1a1a] font-sans selection:bg-[#B8860B] selection:text-white pb-20" style={{ backgroundColor: '#FAF6F0' }}>
      {/* Header */}
      <header className="border-b border-[#DDD5C8] bg-white/50 px-8 py-5 flex items-center justify-between sticky top-0 z-10 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-[#1a1a1a] flex items-center justify-center">
            <span className="text-white font-['Instrument_Serif'] text-xl">L</span>
          </div>
          <span className="font-['Instrument_Serif'] text-2xl tracking-tight text-[#1a1a1a]">Ledgerline</span>
        </div>
        <div className="flex items-center gap-4">
          <button onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')} className="p-2 rounded-md hover:bg-[#F2EDE5] transition-colors border border-transparent text-[#4a4a4a]">
            {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
          </button>
          <button className="flex items-center gap-2 px-4 py-1.5 text-sm font-medium border border-[#DDD5C8] rounded-md hover:bg-[#F2EDE5] transition-colors bg-white">
            <Download size={14} />
            Export
          </button>
          <button className="flex items-center gap-2 px-4 py-1.5 text-sm font-medium border border-[#DDD5C8] rounded-md hover:bg-[#F2EDE5] transition-colors bg-white">
            <ExternalLink size={14} />
            Portal
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-8 py-10 space-y-12">
        {/* Title Section */}
        <section className="space-y-2">
          <h1 className="font-['Instrument_Serif'] text-5xl text-[#1a1a1a]">Acme Manufacturing Ltd</h1>
          <p className="text-[#666] text-sm uppercase tracking-widest font-medium">Financial Review • Q3 2024</p>
        </section>

        {/* Profiles */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="p-6 border border-[#DDD5C8] bg-[#F2EDE5] rounded-none">
            <h3 className="text-xs uppercase tracking-wider text-[#666] mb-4 font-semibold">Business Profile</h3>
            <div className="flex gap-2">
              {['Manufacturing', 'SaaS', 'Retail'].map(type => (
                <button 
                  key={type} 
                  className={`px-4 py-2 text-sm border transition-colors ${type === 'Manufacturing' ? 'border-[#B8860B] bg-white text-[#B8860B]' : 'border-[#DDD5C8] bg-transparent text-[#666] hover:bg-white/50'}`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>
          <div className="p-6 border border-[#DDD5C8] bg-[#F2EDE5] rounded-none">
            <h3 className="text-xs uppercase tracking-wider text-[#666] mb-4 font-semibold">Risk Profile</h3>
            <div className="flex gap-2">
              {['Conservative', 'Balanced', 'Aggressive'].map(profile => (
                <button 
                  key={profile}
                  onClick={() => setRiskProfile(profile)}
                  className={`px-4 py-2 text-sm border transition-colors ${riskProfile === profile ? 'border-[#B8860B] bg-white text-[#B8860B]' : 'border-[#DDD5C8] bg-transparent text-[#666] hover:bg-white/50'}`}
                >
                  {profile}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Tab Bar */}
        <nav className="flex gap-8 border-b border-[#DDD5C8]">
          {['Today', 'Ratios', 'Cash', 'Moves', 'Tasks'].map(tab => (
            <button 
              key={tab}
              className={`pb-4 text-sm font-medium uppercase tracking-wide transition-colors relative ${tab === 'Ratios' ? 'text-[#B8860B]' : 'text-[#666] hover:text-[#1a1a1a]'}`}
            >
              {tab}
              {tab === 'Ratios' && (
                <div className="absolute bottom-0 left-0 w-full h-[2px] bg-[#B8860B]" />
              )}
            </button>
          ))}
        </nav>

        {/* KPI Grid */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {kpiData.map((kpi, idx) => (
            <div key={idx} className="p-8 border border-[#DDD5C8] bg-[#F2EDE5] flex flex-col justify-between gap-6">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-xs uppercase tracking-widest text-[#666] font-semibold mb-2">{kpi.name}</h3>
                  <div className="font-['Instrument_Serif'] text-5xl text-[#1a1a1a]">{kpi.value}</div>
                </div>
                <div className="w-24 h-10 flex items-end justify-between opacity-50 mix-blend-multiply">
                  {kpi.trend.map((val, i) => (
                    <div 
                      key={i} 
                      className="w-[2px] bg-[#888] rounded-t-sm" 
                      style={{ height: `${(val / Math.max(...kpi.trend)) * 100}%` }}
                    />
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                {/* Health Bar */}
                <div className="h-1 w-full bg-[#DDD5C8] rounded-full overflow-hidden">
                  <div 
                    className={`h-full rounded-full ${kpi.status === 'good' ? 'bg-[#4A6B50]' : kpi.status === 'warning' ? 'bg-[#B8860B]' : 'bg-[#8B3A3A]'}`}
                    style={{ width: kpi.status === 'good' ? '85%' : kpi.status === 'warning' ? '50%' : '20%' }}
                  />
                </div>

                <div className="flex justify-between items-end">
                  <p className="text-sm text-[#555] max-w-[60%] leading-relaxed">{kpi.description}</p>
                  <div className="flex gap-2 flex-col items-end">
                    {kpi.benchmarks.map((bm, i) => (
                      <span key={i} className="text-[11px] uppercase tracking-wider px-2 py-1 bg-[#E8E0D5] text-[#555] rounded-sm">
                        {bm}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
