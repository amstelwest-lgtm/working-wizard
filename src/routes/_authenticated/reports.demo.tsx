import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  Download,
  FileText,
  Loader2,
  Lightbulb,
  AlertTriangle,
  TrendingUp,
  Droplets,
  BarChart2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAccountantProfile } from "@/contexts/accountant-profile";
import type { RatioResult } from "@/reports/health-scorecard";
import type { Intervention } from "@/reports/intervention-priority";
import type { CashForecastWeek } from "@/reports/cash-forecast";
import type { WorkingCapitalData } from "@/reports/cash-cycle";
import type { ProfitabilityData } from "@/reports/profitability-waterfall";

export const Route = createFileRoute("/_authenticated/reports/demo")({
  component: ReportsDemoPage,
  head: () => ({ meta: [{ title: "Report Preview — Milōn" }] }),
});

// ── Mock data ──────────────────────────────────────────────────────────────

const MOCK_SME_DATA = {
  name: "Acme Trading (Pty) Ltd",
  period: "June 2025",
};

const MOCK_RATIO_RESULTS: RatioResult[] = [
  { ratio_key: "grossMargin", ratio_name: "Gross Margin", pillar: "profit", current_value: 0.38, health_score: 62, health_tier: "at_risk", prior_period_value: 0.35, prior_period_score: 54, formatted_value: "38.0%" },
  { ratio_key: "operatingMargin", ratio_name: "Operating Margin", pillar: "profit", current_value: 0.19, health_score: 76, health_tier: "healthy", prior_period_value: 0.17, prior_period_score: 68, formatted_value: "19.0%" },
  { ratio_key: "revenueGrowth", ratio_name: "Revenue Growth", pillar: "profit", current_value: 0.06, health_score: 41, health_tier: "at_risk", prior_period_value: 0.04, prior_period_score: 33, formatted_value: "6.0%" },
  { ratio_key: "fixedCostRatio", ratio_name: "Fixed Cost Ratio", pillar: "profit", current_value: 0.28, health_score: 71, health_tier: "healthy", prior_period_value: 0.30, prior_period_score: 65, formatted_value: "28.0%" },
  { ratio_key: "assetTurnover", ratio_name: "Asset Turnover", pillar: "assets", current_value: 1.30, health_score: 74, health_tier: "healthy", prior_period_value: 1.22, prior_period_score: 68, formatted_value: "1.30×" },
  { ratio_key: "roa", ratio_name: "Return on Assets", pillar: "assets", current_value: 0.14, health_score: 83, health_tier: "healthy", prior_period_value: 0.12, prior_period_score: 74, formatted_value: "14.0%" },
  { ratio_key: "inventoryDays", ratio_name: "Inventory Days", pillar: "assets", current_value: 47, health_score: 55, health_tier: "at_risk", prior_period_value: 52, prior_period_score: 48, formatted_value: "47 d" },
  { ratio_key: "equityMultiplier", ratio_name: "Equity Multiplier", pillar: "financing", current_value: 2.1, health_score: 70, health_tier: "healthy", prior_period_value: 2.3, prior_period_score: 63, formatted_value: "2.10×" },
  { ratio_key: "debtToEquity", ratio_name: "Debt-to-Equity", pillar: "financing", current_value: 1.1, health_score: 67, health_tier: "at_risk", prior_period_value: 1.2, prior_period_score: 62, formatted_value: "1.10×" },
  { ratio_key: "debtToAssets", ratio_name: "Debt-to-Assets", pillar: "financing", current_value: 0.52, health_score: 61, health_tier: "at_risk", prior_period_value: 0.55, prior_period_score: 55, formatted_value: "52.0%" },
  { ratio_key: "currentRatio", ratio_name: "Current Ratio", pillar: "cash", current_value: 1.15, health_score: 28, health_tier: "critical", prior_period_value: 1.40, prior_period_score: 46, formatted_value: "1.15×" },
  { ratio_key: "debtorDays", ratio_name: "Debtor Days", pillar: "cash", current_value: 54, health_score: 40, health_tier: "at_risk", prior_period_value: 49, prior_period_score: 49, formatted_value: "54 d" },
  { ratio_key: "ocfToEbitda", ratio_name: "Cash Quality", pillar: "cash", current_value: 0.72, health_score: 60, health_tier: "at_risk", prior_period_value: 0.79, prior_period_score: 67, formatted_value: "0.72×" },
  { ratio_key: "workingCapitalFunding", ratio_name: "WC Funding", pillar: "cash", current_value: 0.31, health_score: 32, health_tier: "critical", prior_period_value: 0.27, prior_period_score: 42, formatted_value: "31.0%" },
];

const MOCK_INTERVENTIONS: Intervention[] = [
  { ratio_key: "currentRatio", ratio_name: "Current Ratio", health_tier: "critical", step_number: 1, step_title: "Build a 13-week rolling cash flow forecast", step_description: "Create a weekly cash projection covering the next 13 weeks. Update every Monday with actual vs. forecast figures. This is the single most important step for a low current ratio — it shows exactly when cash pinch points will hit, giving you lead time to act before the crisis arrives.", timeframe: "1–2 weeks", effort: "Low", impact: "9/10", category: "cash" },
  { ratio_key: "workingCapitalFunding", ratio_name: "WC Funding", health_tier: "critical", step_number: 1, step_title: "Invoice immediately on job completion — same-day billing", step_description: "Set a business rule: every completed job or delivered product is invoiced the same day. Late invoicing is the #1 cause of high working capital funding intensity. Pair this with a 24-hour follow-up call on all invoices beyond 30 days outstanding.", timeframe: "1 week", effort: "Low", impact: "8/10", category: "cash" },
  { ratio_key: "debtorDays", ratio_name: "Debtor Days", health_tier: "at_risk", step_number: 1, step_title: "Launch a structured 3-stage debtor chasing schedule", step_description: "Implement a formal collection process: reminder email at 25 days, phone call at 35 days, final written notice at 45 days. Assign one person as debtor controller. A consistent process alone typically reduces average debtor days by 15–20% within two months.", timeframe: "2 weeks", effort: "Medium", impact: "8/10", category: "cash" },
  { ratio_key: "grossMargin", ratio_name: "Gross Margin", health_tier: "at_risk", step_number: 1, step_title: "Raise prices on top 3 products by 5% — test first on new customers", step_description: "Most SMEs are underpriced and don't realise it. A 5% price increase on top-selling lines goes straight to gross margin. Test on new customers first, then roll out to existing customers.", timeframe: "2–4 weeks", effort: "Low", impact: "10/10", category: "profit" },
  { ratio_key: "revenueGrowth", ratio_name: "Revenue Growth", health_tier: "at_risk", step_number: 1, step_title: "Re-activate 10 dormant customers this quarter", step_description: "Pull a list of customers who bought 12–24 months ago but have since gone quiet. Call or email the top 10 with a targeted offer. Re-activation campaigns cost 5× less than new customer acquisition.", timeframe: "4 weeks", effort: "Low", impact: "7/10", category: "profit" },
  { ratio_key: "inventoryDays", ratio_name: "Inventory Days", health_tier: "at_risk", step_number: 1, step_title: "Identify and liquidate slow-moving stock lines", step_description: "Run an inventory aging report. Any SKU with more than 60 days on hand and declining velocity is a cash trap. Offer a 15–20% discount to clear slow movers this month.", timeframe: "3 weeks", effort: "Medium", impact: "7/10", category: "assets" },
  { ratio_key: "debtToAssets", ratio_name: "Debt-to-Assets", health_tier: "at_risk", step_number: 1, step_title: "Redirect 20% of monthly free cash flow to accelerated debt repayment", step_description: "Identify your most expensive debt by interest rate. Set a standing monthly transfer to reduce that balance. Even modest extra repayments reduce the debt-to-assets ratio over time.", timeframe: "1 month", effort: "Low", impact: "7/10", category: "financing" },
];

const MOCK_CASH_FORECAST: CashForecastWeek[] = [
  { period_label: "Week 1",  opening_balance: 245000, total_receipts: 185000, total_payments: 210000, net_movement: -25000, closing_balance: 220000, scenario: "moderate", runway_weeks: 13 },
  { period_label: "Week 2",  opening_balance: 220000, total_receipts: 195000, total_payments: 205000, net_movement: -10000, closing_balance: 210000, scenario: "moderate", runway_weeks: 12 },
  { period_label: "Week 3",  opening_balance: 210000, total_receipts: 165000, total_payments: 220000, net_movement: -55000, closing_balance: 155000, scenario: "moderate", runway_weeks: 11 },
  { period_label: "Week 4",  opening_balance: 155000, total_receipts: 210000, total_payments: 195000, net_movement:  15000, closing_balance: 170000, scenario: "moderate", runway_weeks: 10 },
  { period_label: "Week 5",  opening_balance: 170000, total_receipts: 145000, total_payments: 230000, net_movement: -85000, closing_balance:  85000, scenario: "moderate", runway_weeks:  9 },
  { period_label: "Week 6",  opening_balance:  85000, total_receipts: 275000, total_payments: 195000, net_movement:  80000, closing_balance: 165000, scenario: "moderate", runway_weeks:  8 },
  { period_label: "Week 7",  opening_balance: 165000, total_receipts: 155000, total_payments: 210000, net_movement: -55000, closing_balance: 110000, scenario: "moderate", runway_weeks:  7 },
  { period_label: "Week 8",  opening_balance: 110000, total_receipts: 190000, total_payments: 195000, net_movement:  -5000, closing_balance: 105000, scenario: "moderate", runway_weeks:  6 },
  { period_label: "Week 9",  opening_balance: 105000, total_receipts: 160000, total_payments: 215000, net_movement: -55000, closing_balance:  50000, scenario: "moderate", runway_weeks:  5 },
  { period_label: "Week 10", opening_balance:  50000, total_receipts: 290000, total_payments: 195000, net_movement:  95000, closing_balance: 145000, scenario: "moderate", runway_weeks:  4 },
  { period_label: "Week 11", opening_balance: 145000, total_receipts: 175000, total_payments: 200000, net_movement: -25000, closing_balance: 120000, scenario: "moderate", runway_weeks:  3 },
  { period_label: "Week 12", opening_balance: 120000, total_receipts: 205000, total_payments: 195000, net_movement:  10000, closing_balance: 130000, scenario: "moderate", runway_weeks:  2 },
  { period_label: "Week 13", opening_balance: 130000, total_receipts: 215000, total_payments: 195000, net_movement:  20000, closing_balance: 150000, scenario: "moderate", runway_weeks:  1 },
];

const MOCK_WC_DATA: WorkingCapitalData = {
  debtor_days: 54, debtor_days_prior: 49,
  inventory_days: 47, inventory_days_prior: 52,
  wip_days: 12, wip_days_prior: 14,
  creditor_days: 35, creditor_days_prior: 33,
  cash_conversion_cycle: 78, ccc_prior: 82,
  working_capital_funding: 0.31,
  working_capital_utilization: 0.65,
  working_capital_days: 90,
  annual_revenue: 12_500_000,
  cash_trapped_rands: 854_167,
  health_scores: {
    debtor_days: 40, inventory_days: 55, creditor_days: 75,
    wip_days: 68, working_capital_days: 48,
    working_capital_funding: 32, working_capital_utilization: 58,
  },
};

const MOCK_PROFIT_DATA: ProfitabilityData = {
  revenue: 12_500_000,
  gross_profit: 4_750_000, gross_margin_pct: 0.38, gross_margin_score: 62, gross_margin_tier: "at_risk",
  operating_profit: 2_375_000, operating_margin_pct: 0.19, operating_margin_score: 76, operating_margin_tier: "healthy",
  ebt: 2_218_750, interest_burden_pct: 0.177, interest_burden_score: 72,
  tax: 554_688, tax_burden_pct: 0.044, tax_burden_score: 74,
  net_profit: 1_664_063, net_margin_pct: 0.133, net_margin_score: 68, net_margin_tier: "at_risk",
  prior_period: {
    revenue: 11_000_000,
    gross_profit: 3_850_000, gross_margin_pct: 0.35, gross_margin_score: 54,
    operating_profit: 1_980_000, operating_margin_pct: 0.18, operating_margin_score: 68,
    ebt: 1_848_000, interest_burden_pct: 0.168, interest_burden_score: 65,
    tax: 462_000, tax_burden_pct: 0.042, tax_burden_score: 68,
    net_profit: 1_386_000, net_margin_pct: 0.126, net_margin_score: 62,
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────

const THRESHOLD = 50_000;

function formatRand(v: number): string {
  const abs = Math.abs(Math.round(v));
  const s = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (v < 0 ? "-R " : "R ") + s;
}

function makeFilename(report: string): string {
  const sme = MOCK_SME_DATA.name.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "");
  const period = MOCK_SME_DATA.period.replace(/ /g, "_");
  return `${sme}_${period}_${report}.pdf`;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Mini preview components (HTML, not PDF) ────────────────────────────────

function ScoreBar({ score }: { score: number }) {
  const cls = score >= 70 ? "bg-emerald-500" : score >= 40 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="h-1.5 w-full rounded-full bg-slate-700">
      <div className={`h-1.5 rounded-full ${cls}`} style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
    </div>
  );
}

function TierPip({ tier }: { tier: string }) {
  const cls = tier === "critical" ? "bg-red-500" : tier === "at_risk" ? "bg-amber-500" : "bg-emerald-500";
  return <span className={`inline-block h-2 w-2 rounded-full ${cls} mr-1.5`} />;
}

function RatioPreviewRow({ r }: { r: RatioResult }) {
  const tc = r.health_tier === "critical" ? "text-red-400" : r.health_tier === "at_risk" ? "text-amber-400" : "text-emerald-400";
  const arrow = r.prior_period_score !== undefined
    ? r.health_score - r.prior_period_score > 2 ? "↑" : r.health_score - r.prior_period_score < -2 ? "↓" : "→"
    : "";
  const ac = arrow === "↑" ? "text-emerald-400" : arrow === "↓" ? "text-red-400" : "text-slate-500";
  return (
    <div className="grid grid-cols-[1fr_52px_40px_18px] items-center gap-2 px-3 py-1.5 odd:bg-slate-900/40">
      <span className="truncate text-xs text-slate-300">{r.ratio_name}</span>
      <span className="text-right font-mono text-xs font-semibold text-slate-200">{r.formatted_value}</span>
      <span className={`text-right text-xs font-bold ${tc}`}>{Math.round(r.health_score)}</span>
      <span className={`text-center text-sm ${ac}`}>{arrow}</span>
    </div>
  );
}

function MiniBar({ balance, max, threshold }: { balance: number; max: number; threshold: number }) {
  const pct = Math.max(0, balance) / max;
  const cls = balance < threshold ? "bg-red-500" : balance < threshold * 2 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="flex h-14 w-full items-end rounded-sm bg-slate-800">
        <div className={`w-full rounded-sm ${cls}`} style={{ height: `${Math.max(4, pct * 100)}%` }} />
      </div>
    </div>
  );
}

function InterventionPreviewRow({ item, idx }: { item: Intervention; idx: number }) {
  const bc = item.health_tier === "critical" ? "border-red-500/60 bg-red-950/20" : item.health_tier === "at_risk" ? "border-amber-500/60 bg-amber-950/20" : "border-emerald-500/60 bg-emerald-950/20";
  return (
    <div className={`mb-2 rounded border-l-4 px-3 py-2 ${bc}`}>
      <p className="mb-0.5 text-[11px] text-slate-400">#{idx + 1} · {item.ratio_name}</p>
      <p className="text-xs font-semibold leading-snug text-slate-200">{item.step_title}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <span className="rounded bg-blue-900/40 px-1.5 py-0.5 text-[10px] text-blue-300">{item.timeframe}</span>
        <span className="rounded bg-amber-900/30 px-1.5 py-0.5 text-[10px] text-amber-300">{item.effort} effort</span>
        <span className="rounded bg-emerald-900/30 px-1.5 py-0.5 text-[10px] text-emerald-300">{item.impact} impact</span>
      </div>
    </div>
  );
}

// ── Report card wrapper ────────────────────────────────────────────────────

function ReportCard({
  icon,
  iconBg,
  title,
  pages,
  description,
  onDownload,
  loading,
  isClient,
  btnClass,
  children,
}: {
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  pages: string;
  description: string;
  onDownload: () => void;
  loading: boolean;
  isClient: boolean;
  btnClass: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden">
      <div className="flex items-center gap-3 border-b border-slate-800 px-5 py-4">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${iconBg}`}>
          {icon}
        </div>
        <div>
          <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
          <p className="text-[11px] text-slate-500">{pages} · A4</p>
        </div>
      </div>
      <p className="px-5 pt-4 text-xs text-slate-400 leading-relaxed">{description}</p>
      <div className="flex-1 overflow-hidden px-5 py-4">{children}</div>
      <div className="border-t border-slate-800 px-5 py-4">
        <Button
          className={`w-full gap-2 font-semibold text-white ${btnClass}`}
          onClick={onDownload}
          disabled={!isClient || loading}
        >
          {loading ? (
            <><Loader2 className="h-4 w-4 animate-spin" />Generating PDF…</>
          ) : (
            <><Download className="h-4 w-4" />Download PDF</>
          )}
        </Button>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

type LoadingKey = "scorecard" | "intervention" | "forecast" | "cycle" | "waterfall" | null;

function ReportsDemoPage() {
  const { profile } = useAccountantProfile();
  const [isClient, setIsClient] = useState(false);
  const [loading, setLoading] = useState<LoadingKey>(null);

  useEffect(() => { setIsClient(true); }, []);

  // ── Download handlers ──────────────────────────────────────────────────

  async function dl(key: LoadingKey, fn: () => Promise<void>) {
    if (!isClient) return;
    setLoading(key);
    try { await fn(); }
    catch (err) {
      toast.error(`Generation failed: ${(err as Error).message}`);
      console.error(err);
    } finally { setLoading(null); }
  }

  const downloadScorecard = () => dl("scorecard", async () => {
    const [{ pdf }, { HealthScorecardPDF }] = await Promise.all([
      import("@react-pdf/renderer"),
      import("@/reports/health-scorecard"),
    ]);
    const blob = await pdf((HealthScorecardPDF as (p: unknown) => unknown)({ smeData: MOCK_SME_DATA, ratioResults: MOCK_RATIO_RESULTS, accountantProfile: profile }) as Parameters<typeof pdf>[0]).toBlob();
    triggerDownload(blob, makeFilename("HealthScorecard"));
    toast.success("Health Scorecard downloaded.");
  });

  const downloadIntervention = () => dl("intervention", async () => {
    const [{ pdf }, { InterventionPriorityPDF }] = await Promise.all([
      import("@react-pdf/renderer"),
      import("@/reports/intervention-priority"),
    ]);
    const blob = await pdf((InterventionPriorityPDF as (p: unknown) => unknown)({ smeData: MOCK_SME_DATA, interventions: MOCK_INTERVENTIONS, accountantProfile: profile }) as Parameters<typeof pdf>[0]).toBlob();
    triggerDownload(blob, makeFilename("InterventionPlan"));
    toast.success("Intervention Plan downloaded.");
  });

  const downloadForecast = () => dl("forecast", async () => {
    const [{ pdf }, { CashForecastPDF }] = await Promise.all([
      import("@react-pdf/renderer"),
      import("@/reports/cash-forecast"),
    ]);
    const blob = await pdf((CashForecastPDF as (p: unknown) => unknown)({ smeData: MOCK_SME_DATA, cashForecast: MOCK_CASH_FORECAST, scenario: "moderate", accountantProfile: profile }) as Parameters<typeof pdf>[0]).toBlob();
    triggerDownload(blob, makeFilename("CashForecast_13Week"));
    toast.success("Cash Forecast downloaded.");
  });

  const downloadCycle = () => dl("cycle", async () => {
    const [{ pdf }, { CashCyclePDF }] = await Promise.all([
      import("@react-pdf/renderer"),
      import("@/reports/cash-cycle"),
    ]);
    const blob = await pdf((CashCyclePDF as (p: unknown) => unknown)({ smeData: MOCK_SME_DATA, workingCapitalData: MOCK_WC_DATA, accountantProfile: profile }) as Parameters<typeof pdf>[0]).toBlob();
    triggerDownload(blob, makeFilename("CashCycleReport"));
    toast.success("Cash Cycle Report downloaded.");
  });

  const downloadWaterfall = () => dl("waterfall", async () => {
    const [{ pdf }, { ProfitabilityWaterfallPDF }] = await Promise.all([
      import("@react-pdf/renderer"),
      import("@/reports/profitability-waterfall"),
    ]);
    const blob = await pdf((ProfitabilityWaterfallPDF as (p: unknown) => unknown)({ smeData: MOCK_SME_DATA, profitabilityData: MOCK_PROFIT_DATA, accountantProfile: profile }) as Parameters<typeof pdf>[0]).toBlob();
    triggerDownload(blob, makeFilename("ProfitabilityWaterfall"));
    toast.success("Profitability Waterfall downloaded.");
  });

  // ── Derived stats ─────────────────────────────────────────────────────

  const overallScore = Math.round(MOCK_RATIO_RESULTS.reduce((s, r) => s + r.health_score, 0) / MOCK_RATIO_RESULTS.length);
  const criticalCount = MOCK_RATIO_RESULTS.filter(r => r.health_tier === "critical").length;
  const atRiskCount   = MOCK_RATIO_RESULTS.filter(r => r.health_tier === "at_risk").length;
  const maxBalance    = Math.max(...MOCK_CASH_FORECAST.map(w => w.closing_balance), 1);
  const minBalance    = Math.min(...MOCK_CASH_FORECAST.map(w => w.closing_balance));
  const ccc           = MOCK_WC_DATA.cash_conversion_cycle;
  const cccClass      = ccc <= 45 ? "text-emerald-400" : ccc <= 75 ? "text-amber-400" : "text-red-400";

  const overallTierClass = overallScore >= 70 ? "text-emerald-400 border-emerald-500/50"
    : overallScore >= 40 ? "text-amber-400 border-amber-500/50"
    : "text-red-400 border-red-500/50";

  return (
    <main className="min-h-screen bg-[#07090f] text-slate-50 px-4 py-8">
      <div className="mx-auto max-w-6xl space-y-6">

        {/* Nav */}
        <div className="flex items-center justify-between gap-4">
          <Link to="/dashboard" className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors">
            <ArrowLeft className="h-4 w-4" />Back to Dashboard
          </Link>
          {profile.firmName ? (
            <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-1.5">
              <span className="text-xs text-slate-500">Branded as</span>
              <span className="text-xs font-semibold text-slate-300">{profile.firmName}</span>
              <Link to="/settings/brand" className="text-[10px] text-[#c9962b] hover:underline">Edit</Link>
            </div>
          ) : (
            <Link to="/settings/brand" className="flex items-center gap-1.5 rounded-lg border border-amber-800/40 bg-amber-950/20 px-3 py-1.5 text-xs text-amber-300 hover:text-amber-200 transition-colors">
              <AlertTriangle className="h-3.5 w-3.5" />Add brand settings
            </Link>
          )}
        </div>

        {/* Header */}
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">Report Preview</h1>
          <p className="mt-1 text-sm text-slate-400">
            Demo data for <span className="font-semibold text-slate-300">{MOCK_SME_DATA.name}</span> — {MOCK_SME_DATA.period}.
            Click any Download button to generate and preview the real PDF.
          </p>
        </div>

        {/* Summary bar */}
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {[
            { label: "Overall", value: String(overallScore), cls: overallTierClass.split(" ")[0] },
            { label: "Critical", value: String(criticalCount), cls: "text-red-400" },
            { label: "At Risk", value: String(atRiskCount), cls: "text-amber-400" },
            { label: "Cash Bal", value: "R245k", cls: "text-slate-200" },
            { label: "CCC", value: `${ccc}d`, cls: cccClass },
            { label: "Net Margin", value: "13.3%", cls: overallScore >= 70 ? "text-emerald-400" : "text-amber-400" },
          ].map(({ label, value, cls }) => (
            <div key={label} className="rounded-lg border border-slate-800 bg-slate-900/40 p-3 text-center">
              <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">{label}</p>
              <p className={`text-xl font-bold ${cls}`}>{value}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <Tabs defaultValue="scorecard">
          <TabsList className="mb-4 flex h-auto flex-wrap gap-1 bg-slate-900/60 border border-slate-800 p-1 rounded-xl w-full">
            {[
              { value: "scorecard",    icon: <FileText   className="h-3.5 w-3.5" />, label: "Health Scorecard" },
              { value: "intervention", icon: <Lightbulb  className="h-3.5 w-3.5" />, label: "Interventions" },
              { value: "forecast",     icon: <BarChart2  className="h-3.5 w-3.5" />, label: "Cash Forecast" },
              { value: "cycle",        icon: <Droplets   className="h-3.5 w-3.5" />, label: "Cash Cycle" },
              { value: "waterfall",    icon: <TrendingUp className="h-3.5 w-3.5" />, label: "Profitability" },
            ].map(t => (
              <TabsTrigger key={t.value} value={t.value}
                className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium flex-1 min-w-[100px] data-[state=active]:bg-slate-800 data-[state=active]:text-slate-100 text-slate-400">
                {t.icon}{t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* ── Tab 1: Health Scorecard ── */}
          <TabsContent value="scorecard">
            <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
              <ReportCard
                icon={<FileText className="h-5 w-5 text-blue-400" />}
                iconBg="bg-blue-500/15"
                title="Financial Health Scorecard"
                pages="2 pages"
                description="Overall health score, 2×2 pillar summary grid, and a full ratio detail table with movement arrows and tier badges."
                onDownload={downloadScorecard}
                loading={loading === "scorecard"}
                isClient={isClient}
                btnClass="bg-[#1d4ed8] hover:bg-[#1e40af]"
              >
                <div className="rounded-lg border border-slate-800 overflow-hidden">
                  <div className="grid grid-cols-[1fr_52px_40px_18px] gap-2 bg-slate-800/60 px-3 py-1.5">
                    {["Ratio", "Value", "Score", "±"].map(h => (
                      <span key={h} className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{h}</span>
                    ))}
                  </div>
                  {MOCK_RATIO_RESULTS.map(r => <RatioPreviewRow key={r.ratio_key} r={r} />)}
                </div>
              </ReportCard>

              {/* Overall health snapshot */}
              <div className="space-y-4">
                <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
                  <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-3">Overall Health</p>
                  <div className="flex items-center gap-4 mb-3">
                    <span className={`text-5xl font-bold ${overallTierClass.split(" ")[0]}`}>{overallScore}</span>
                    <div>
                      <ScoreBar score={overallScore} />
                      <p className="text-xs text-slate-500 mt-1">{criticalCount} critical · {atRiskCount} at risk</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {(["profit","assets","financing","cash"] as const).map(pillar => {
                      const ratios = MOCK_RATIO_RESULTS.filter(r => r.pillar === pillar);
                      const ps = Math.round(ratios.reduce((s, r) => s + r.health_score, 0) / (ratios.length || 1));
                      const crit = ratios.filter(r => r.health_tier === "critical").length;
                      const LABELS: Record<string, string> = { profit: "Profit", assets: "Assets", financing: "Financing", cash: "Cash" };
                      return (
                        <div key={pillar} className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                          <p className="text-[9px] uppercase tracking-widest text-slate-500">{LABELS[pillar]}</p>
                          <p className={`text-xl font-bold mt-0.5 ${ps >= 70 ? "text-emerald-400" : ps >= 40 ? "text-amber-400" : "text-red-400"}`}>{ps}</p>
                          <ScoreBar score={ps} />
                          {crit > 0 && <p className="text-[9px] text-red-400 mt-1">{crit} critical</p>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* ── Tab 2: Interventions ── */}
          <TabsContent value="intervention">
            <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
              <ReportCard
                icon={<Lightbulb className="h-5 w-5 text-amber-400" />}
                iconBg="bg-amber-500/15"
                title="Priority Intervention Plan"
                pages="2–3 pages"
                description="Top actions sorted critical-first, each with timeframe, effort, and impact badges. Flows automatically across pages."
                onDownload={downloadIntervention}
                loading={loading === "intervention"}
                isClient={isClient}
                btnClass="bg-[#c9962b] hover:bg-[#b8861f]"
              >
                {MOCK_INTERVENTIONS.map((item, idx) => <InterventionPreviewRow key={`${item.ratio_key}-${idx}`} item={item} idx={idx} />)}
              </ReportCard>

              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 space-y-4">
                <p className="text-[10px] uppercase tracking-widest text-slate-500">Action breakdown</p>
                {["critical","at_risk","healthy"].map(tier => {
                  const count = MOCK_INTERVENTIONS.filter(i => i.health_tier === tier).length;
                  const cls = tier === "critical" ? "bg-red-500/20 text-red-300 border-red-800/40"
                    : tier === "at_risk" ? "bg-amber-500/20 text-amber-300 border-amber-800/40"
                    : "bg-emerald-500/20 text-emerald-300 border-emerald-800/40";
                  const label = tier === "at_risk" ? "At Risk" : tier.charAt(0).toUpperCase() + tier.slice(1);
                  return (
                    <div key={tier} className={`flex items-center justify-between rounded-lg border px-4 py-3 ${cls}`}>
                      <span className="text-sm font-semibold">{label} actions</span>
                      <span className="text-2xl font-bold">{count}</span>
                    </div>
                  );
                })}
                <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3">
                  <p className="text-xs text-slate-400">Total steps</p>
                  <p className="text-3xl font-bold text-slate-100">{MOCK_INTERVENTIONS.length}</p>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* ── Tab 3: Cash Forecast ── */}
          <TabsContent value="forecast">
            <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
              <ReportCard
                icon={<BarChart2 className="h-5 w-5 text-violet-400" />}
                iconBg="bg-violet-500/15"
                title="13-Week Cash Flow Forecast"
                pages="2 pages"
                description="Scenario badge, summary metrics, colour-coded bar chart (red below threshold, amber approaching, green healthy), and full weekly data table with assumptions."
                onDownload={downloadForecast}
                loading={loading === "forecast"}
                isClient={isClient}
                btnClass="bg-violet-700 hover:bg-violet-800"
              >
                {/* Mini bar chart */}
                <div className="flex items-end gap-[3px] h-20 bg-slate-800/40 rounded-lg px-2 py-2 mb-2">
                  {MOCK_CASH_FORECAST.map((w, i) => (
                    <MiniBar key={i} balance={w.closing_balance} max={maxBalance} threshold={THRESHOLD} />
                  ))}
                </div>
                <div className="flex items-center gap-4 text-[10px] text-slate-500">
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500 inline-block" />Healthy</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500 inline-block" />Watch</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500 inline-block" />Critical</span>
                  <span className="ml-auto">Min threshold: R{THRESHOLD.toLocaleString()}</span>
                </div>
              </ReportCard>

              <div className="space-y-4">
                <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 space-y-3">
                  <p className="text-[10px] uppercase tracking-widest text-slate-500">Forecast summary</p>
                  {[
                    { label: "Opening Balance", value: formatRand(MOCK_CASH_FORECAST[0].opening_balance), cls: "text-slate-100" },
                    { label: "Minimum Balance (wk 9)", value: formatRand(minBalance), cls: minBalance < THRESHOLD ? "text-red-400" : "text-amber-400" },
                    { label: "Closing Balance (wk 13)", value: formatRand(MOCK_CASH_FORECAST[12].closing_balance), cls: "text-slate-100" },
                    { label: "Projected Runway", value: `${MOCK_CASH_FORECAST[12].runway_weeks} weeks`, cls: "text-slate-100" },
                  ].map(({ label, value, cls }) => (
                    <div key={label} className="flex justify-between items-center border-b border-slate-800/60 pb-2">
                      <span className="text-xs text-slate-400">{label}</span>
                      <span className={`text-sm font-semibold ${cls}`}>{value}</span>
                    </div>
                  ))}
                </div>
                <div className="rounded-lg border border-amber-800/40 bg-amber-950/20 px-4 py-3">
                  <p className="text-xs font-semibold text-amber-300">Week 9 watch point</p>
                  <p className="text-xs text-amber-400/70 mt-1">Closing balance drops to {formatRand(MOCK_CASH_FORECAST[8].closing_balance)} — exactly at the R50k threshold. Pre-arrange an overdraft facility in weeks 4–6 as a buffer.</p>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* ── Tab 4: Cash Cycle ── */}
          <TabsContent value="cycle">
            <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
              <ReportCard
                icon={<Droplets className="h-5 w-5 text-cyan-400" />}
                iconBg="bg-cyan-500/15"
                title="Cash Flow Cycle Report"
                pages="2 pages"
                description="Visual cash cycle diagram showing inventory → WIP → debtors → cash, creditor offset, CCC total, and a cash-trapped callout with daily release calculation."
                onDownload={downloadCycle}
                loading={loading === "cycle"}
                isClient={isClient}
                btnClass="bg-cyan-700 hover:bg-cyan-800"
              >
                {/* Mini cycle diagram */}
                <div className="flex items-center gap-1.5 text-xs mb-3 flex-wrap">
                  {[
                    { label: "Inventory", days: MOCK_WC_DATA.inventory_days, cls: "bg-slate-700 text-slate-200" },
                    { label: "WIP", days: MOCK_WC_DATA.wip_days, cls: "bg-slate-700 text-slate-200" },
                    { label: "Debtors", days: MOCK_WC_DATA.debtor_days, cls: "bg-amber-900/50 text-amber-300" },
                  ].map(({ label, days, cls }) => (
                    <div key={label} className="flex items-center gap-1">
                      <div className={`rounded px-2 py-1.5 text-center ${cls}`}>
                        <p className="text-[9px] uppercase tracking-wide">{label}</p>
                        <p className="text-base font-bold">{days}d</p>
                      </div>
                      <span className="text-slate-600">→</span>
                    </div>
                  ))}
                  <div className="rounded bg-emerald-900/40 px-2 py-1.5 text-center">
                    <p className="text-[9px] uppercase tracking-wide text-emerald-400">Cash In</p>
                  </div>
                </div>
                <div className="rounded-lg border border-slate-800 p-3 space-y-2 text-xs">
                  {[
                    { label: "Creditor offset", value: `-${MOCK_WC_DATA.creditor_days}d`, cls: "text-emerald-400" },
                    { label: "Cash Conversion Cycle", value: `${ccc} days`, cls: cccClass + " font-bold" },
                    { label: "Cash trapped", value: formatRand(MOCK_WC_DATA.cash_trapped_rands), cls: "text-red-400 font-bold" },
                  ].map(({ label, value, cls }) => (
                    <div key={label} className="flex justify-between">
                      <span className="text-slate-400">{label}</span>
                      <span className={cls}>{value}</span>
                    </div>
                  ))}
                </div>
              </ReportCard>

              <div className="space-y-3">
                <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
                  <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-3">Working capital ratios</p>
                  {[
                    { name: "Debtor Days", score: 40, val: `${MOCK_WC_DATA.debtor_days}d` },
                    { name: "Inventory Days", score: 55, val: `${MOCK_WC_DATA.inventory_days}d` },
                    { name: "WIP Days", score: 68, val: `${MOCK_WC_DATA.wip_days}d` },
                    { name: "Creditor Days", score: 75, val: `${MOCK_WC_DATA.creditor_days}d` },
                    { name: "WC Funding", score: 32, val: `${(MOCK_WC_DATA.working_capital_funding * 100).toFixed(0)}%` },
                  ].map(({ name, score, val }) => (
                    <div key={name} className="flex items-center gap-3 mb-2">
                      <TierPip tier={score >= 70 ? "healthy" : score >= 40 ? "at_risk" : "critical"} />
                      <span className="flex-1 text-xs text-slate-300">{name}</span>
                      <span className="text-xs font-mono font-semibold text-slate-200 w-12 text-right">{val}</span>
                      <span className={`text-xs font-bold w-8 text-right ${score >= 70 ? "text-emerald-400" : score >= 40 ? "text-amber-400" : "text-red-400"}`}>{score}</span>
                    </div>
                  ))}
                </div>
                <div className="rounded-lg border border-red-800/40 bg-red-950/20 px-4 py-3">
                  <p className="text-xs font-semibold text-red-300">Every 1 day improvement releases:</p>
                  <p className="text-lg font-bold text-red-200 mt-1">{formatRand(Math.round(MOCK_WC_DATA.annual_revenue / 365))}</p>
                  <p className="text-[10px] text-red-400/70 mt-0.5">in freed working capital</p>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* ── Tab 5: Profitability Waterfall ── */}
          <TabsContent value="waterfall">
            <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
              <ReportCard
                icon={<TrendingUp className="h-5 w-5 text-emerald-400" />}
                iconBg="bg-emerald-500/15"
                title="Profitability Waterfall"
                pages="2 pages"
                description="Visual waterfall from revenue → COGS → gross profit → opex → operating profit → interest → EBT → tax → net profit, with tier badges and a prior-period comparison table."
                onDownload={downloadWaterfall}
                loading={loading === "waterfall"}
                isClient={isClient}
                btnClass="bg-emerald-700 hover:bg-emerald-800"
              >
                {/* Mini waterfall */}
                {[
                  { label: "Revenue", pct: 1, color: "bg-slate-600", value: formatRand(MOCK_PROFIT_DATA.revenue) },
                  { label: "Gross Profit", pct: MOCK_PROFIT_DATA.gross_margin_pct, color: "bg-amber-500", value: `${(MOCK_PROFIT_DATA.gross_margin_pct * 100).toFixed(1)}%` },
                  { label: "Operating Profit", pct: MOCK_PROFIT_DATA.operating_margin_pct, color: "bg-emerald-500", value: `${(MOCK_PROFIT_DATA.operating_margin_pct * 100).toFixed(1)}%` },
                  { label: "Net Profit", pct: MOCK_PROFIT_DATA.net_margin_pct, color: "bg-emerald-600", value: `${(MOCK_PROFIT_DATA.net_margin_pct * 100).toFixed(1)}%` },
                ].map(({ label, pct, color, value }) => (
                  <div key={label} className="flex items-center gap-2 mb-2">
                    <span className="w-28 text-[10px] text-slate-400 truncate">{label}</span>
                    <div className="flex-1 h-4 bg-slate-800 rounded overflow-hidden">
                      <div className={`h-4 rounded ${color}`} style={{ width: `${pct * 100}%` }} />
                    </div>
                    <span className="w-14 text-right text-[10px] font-semibold text-slate-300">{value}</span>
                  </div>
                ))}
                <p className="text-[10px] text-slate-500 mt-3 pt-2 border-t border-slate-800">
                  For every R100 of revenue → <span className="font-bold text-slate-300">R{(MOCK_PROFIT_DATA.net_margin_pct * 100).toFixed(2)} reaches net profit</span>
                </p>
              </ReportCard>

              <div className="space-y-3">
                <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
                  <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-3">Current vs prior period</p>
                  {[
                    { label: "Revenue", cur: MOCK_PROFIT_DATA.revenue, prior: MOCK_PROFIT_DATA.prior_period?.revenue },
                    { label: "Gross Margin", cur: MOCK_PROFIT_DATA.gross_margin_pct * 100, prior: (MOCK_PROFIT_DATA.prior_period?.gross_margin_pct ?? 0) * 100, isPct: true },
                    { label: "Operating Margin", cur: MOCK_PROFIT_DATA.operating_margin_pct * 100, prior: (MOCK_PROFIT_DATA.prior_period?.operating_margin_pct ?? 0) * 100, isPct: true },
                    { label: "Net Margin", cur: MOCK_PROFIT_DATA.net_margin_pct * 100, prior: (MOCK_PROFIT_DATA.prior_period?.net_margin_pct ?? 0) * 100, isPct: true },
                  ].map(({ label, cur, prior, isPct }) => {
                    const change = prior !== undefined ? cur - prior : null;
                    const isUp = change !== null && change > 0;
                    return (
                      <div key={label} className="flex items-center justify-between border-b border-slate-800/50 pb-2 mb-2">
                        <span className="text-xs text-slate-400">{label}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-semibold text-slate-200">{isPct ? `${cur.toFixed(1)}%` : formatRand(cur)}</span>
                          {change !== null && (
                            <span className={`text-[10px] font-bold ${isUp ? "text-emerald-400" : "text-red-400"}`}>
                              {isUp ? "+" : ""}{change.toFixed(1)}{isPct ? "pp" : ""}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3">
                  <p className="text-xs text-slate-500">Net profit (current period)</p>
                  <p className="text-2xl font-bold text-emerald-400">{formatRand(MOCK_PROFIT_DATA.net_profit)}</p>
                  <p className="text-xs text-slate-500 mt-1">vs {formatRand(MOCK_PROFIT_DATA.prior_period?.net_profit ?? 0)} prior period</p>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>

      </div>
    </main>
  );
}
