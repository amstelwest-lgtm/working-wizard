import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { toast } from "sonner";
import {
  Download,
  Eye,
  Loader2,
  FileText,
  Lightbulb,
  BarChart2,
  Droplets,
  TrendingUp,
  ShieldCheck,
  Layers,
  Users,
  BarChart,
  Trophy,
  Settings,
  Zap,
  ExternalLink,
  Scale,
} from "lucide-react";
import { BackLink } from "@/components/back-link";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { useAccountantProfile } from "@/contexts/accountant-profile";
import type { AccountantProfile } from "@/contexts/accountant-profile";
import { withCanonicalDebtorCreditorDays } from "@/lib/deliverable-input-config";
import {
  computeRatios,
  healthBandLabel,
  scoreTier,
  BUSINESS_TYPE_TO_BENCHMARK,
  periodMonthsOf,
  benchmarkHealthyEnd,
  creditorDaysPaysSlowly,
  metricDirection,
  SLOW_CREDITOR_DAYS_STEP,
  interestBurdenRatio,
  taxBurdenRatio,
} from "@/lib/ratios";
import {
  ASSET_REPORT_NEEDS,
  cashFlowKnown,
  effectivePeriodMonths,
  LEVERAGE_REPORT_NEEDS,
  reportScalarInputs,
} from "@/lib/equity-coherence";
import { reportNumber } from "@/lib/report-catalog";
import type { RatioInputs } from "@/lib/ratios";
import {
  NOT_SCORED_LABEL,
  scorePlaybookCatalogue,
  scoreRatio,
  pillarForRatioName,
} from "@/lib/health-score";
import { CASH_RUNWAY_THRESHOLD_RAND } from "@/lib/cash-runway";
import {
  assessClientMetrics,
  forecastIsCashGenerative,
  resolveThirteenWeekForecast,
  runwayDisplayLabel,
  scoreWorkingCapitalFunding,
  type ClientRunway,
} from "@/lib/client-metrics";
import {
  hashFigures,
  latestSnapshotId,
  recordDelivery,
  warnIfDeliveryFailed,
  warnIfPdfArchiveFailed,
} from "@/lib/advisory-deliveries";
import { useAuth } from "@/hooks/use-auth";
import { useTrack } from "@/hooks/use-track";
import { PlaybookDrawer } from "@/components/playbook-drawer";
import { ThemeToggle } from "@/components/theme-toggle";
import { supabase } from "@/integrations/supabase/client";

import type { RatioResult } from "@/reports/health-scorecard";
import type { Intervention } from "@/reports/intervention-priority";
import type { CashForecastWeek } from "@/reports/cash-forecast";
import type { WorkingCapitalData } from "@/reports/cash-cycle";
import type { ProfitabilityData } from "@/reports/profitability-waterfall";
import type { LeverageSolvencyData } from "@/reports/leverage-solvency";
import type { AssetProductivityData } from "@/reports/asset-productivity";
import type { LaborProductivityData } from "@/reports/labor-productivity";
import type { RatioMovementRow } from "@/reports/ratio-movement";
import type { BenchmarkRow } from "@/reports/benchmark-report";
import {
  budgetActualFromFinancials,
  buildBudgetPdfModel,
  illustrativeBudgetPack,
  parseBudgetDocument,
  type BudgetPdfActual,
} from "@/lib/budget-pdf";
import { reseedBudgetIfScaleBroken } from "@/lib/budget.bridges";
import { periodProfitBridge } from "@/lib/period-profit";
import type { BudgetDocument } from "@/lib/budget.types";
import type { ClientReviewSignoff, ReviewScope } from "@/lib/review-signoffs.functions";
import { ReviewSignoffButton } from "@/components/review-signoff";
import "@/styles/accountant-portal.css";
import type { ReportSignoffStamp } from "@/components/pdf/pdf-document";
import { parseOperatingProfile, type ClientOperatingProfile } from "@/lib/client-profile";
import { clientIndustryLabel, profilePriorityWeight } from "@/lib/profile-signals";
import { parseDebtSchedule, totalDebtFromSchedule } from "@/lib/debt-schedule";
import { resolvePriorSnapshot, withPriorRatioScores } from "@/lib/prior-period";
import { reportDataPeriodLabel, reportPeriodMonthYear, readStatementMeta } from "@/lib/statement-period";
import {
  debtToEquityReading,
  presentReturn,
  presentScorecardRatio,
  priorFiguresAreCopy,
  reportDownloadGate,
  scoredReturnHealth,
} from "@/lib/report-coherence";
import {
  coerceMarketSelection,
  laborCostLabel,
  laborProductivityFileStem,
  laborProductivityTitle,
  localizeCopy,
  spellLabor,
  parseMarketSelection,
  resolveMarket,
  t,
  ZA_MARKET,
  type ResolvedMarket,
} from "@/lib/market";

export const Route = createFileRoute("/_authenticated/reports/")({
  validateSearch: (search: Record<string, unknown>) => ({
    client: typeof search.client === "string" ? search.client : undefined,
    clientId: typeof search.clientId === "string" ? search.clientId : undefined,
    report: typeof search.report === "string" ? search.report : undefined,
    action:
      search.action === "download" || search.action === "preview"
        ? (search.action as "download" | "preview")
        : undefined,
  }),
  component: ReportsPage,
  head: () => ({ meta: [{ title: "Reports — Milōn" }] }),
});

const REPORT_KEYS = [
  "scorecard",
  "intervention",
  "forecast",
  "cycle",
  "waterfall",
  "leverage",
  "assets",
  "labor",
  "movement",
  "benchmark",
  "budget",
] as const;

// ── Constants ──────────────────────────────────────────────────────────────

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = [CURRENT_YEAR - 2, CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1].map(String);

const INDUSTRIES = [
  { code: "ZA-461", name: "Wholesale Trade — Non-Specialised" },
  { code: "ZA-471", name: "Retail Trade — Food & Beverages" },
  { code: "ZA-431", name: "Construction — General Building" },
  { code: "ZA-620", name: "IT Services & Software" },
  { code: "ZA-701", name: "Professional & Legal Services" },
  { code: "ZA-562", name: "Restaurants & Food Service" },
  { code: "ZA-494", name: "Road Freight Transport" },
  { code: "ZA-682", name: "Real Estate Activities" },
  { code: "ZA-331", name: "Repair of Machinery & Equipment" },
  { code: "ZA-101", name: "Processing of Meat & Food Products" },
];

// ── Settings type ──────────────────────────────────────────────────────────

type Settings = {
  smeName: string;
  periodMonth: string;
  periodYear: string;
  industryCode: string;
  includePrior: boolean;
};

// ── Mock data (demo) ───────────────────────────────────────────────────────

const MOCK_RATIOS: RatioResult[] = [
  {
    ratio_key: "grossMargin",
    ratio_name: "Gross Margin",
    pillar: "profit",
    current_value: 0.38,
    health_score: 62,
    health_tier: "at_risk",
    prior_period_value: 0.35,
    prior_period_score: 54,
    formatted_value: "38.0%",
  },
  {
    ratio_key: "operatingMargin",
    ratio_name: "Operating Margin",
    pillar: "profit",
    current_value: 0.19,
    health_score: 76,
    health_tier: "healthy",
    prior_period_value: 0.17,
    prior_period_score: 68,
    formatted_value: "19.0%",
  },
  {
    ratio_key: "revenueGrowth",
    ratio_name: "Revenue Growth",
    pillar: "profit",
    current_value: 0.136,
    health_score: 41,
    health_tier: "at_risk",
    prior_period_value: 0.04,
    prior_period_score: 33,
    formatted_value: "13.6%",
  },
  {
    ratio_key: "fixedCostRatio",
    ratio_name: "Fixed Cost Ratio",
    pillar: "profit",
    current_value: 0.28,
    health_score: 71,
    health_tier: "healthy",
    prior_period_value: 0.3,
    prior_period_score: 65,
    formatted_value: "28.0%",
  },
  {
    ratio_key: "assetTurnover",
    ratio_name: "Asset Turnover",
    pillar: "assets",
    current_value: 1.3,
    health_score: 74,
    health_tier: "healthy",
    prior_period_value: 1.22,
    prior_period_score: 68,
    formatted_value: "1.30×",
  },
  {
    ratio_key: "roa",
    ratio_name: "Return on Assets",
    pillar: "assets",
    current_value: 0.14,
    health_score: 83,
    health_tier: "healthy",
    prior_period_value: 0.12,
    prior_period_score: 74,
    formatted_value: "14.0%",
  },
  {
    ratio_key: "inventoryDays",
    ratio_name: "Inventory Days",
    pillar: "assets",
    current_value: 47,
    health_score: 55,
    health_tier: "at_risk",
    prior_period_value: 52,
    prior_period_score: 48,
    formatted_value: "47 d",
  },
  {
    ratio_key: "equityMultiplier",
    ratio_name: "Equity Multiplier",
    pillar: "financing",
    current_value: 2.1,
    health_score: 70,
    health_tier: "healthy",
    prior_period_value: 2.3,
    prior_period_score: 63,
    formatted_value: "2.10×",
  },
  {
    ratio_key: "debtToEquity",
    ratio_name: "Debt-to-Equity",
    pillar: "financing",
    current_value: 1.1,
    health_score: 67,
    health_tier: "at_risk",
    prior_period_value: 1.2,
    prior_period_score: 62,
    formatted_value: "1.10×",
  },
  {
    ratio_key: "debtToAssets",
    ratio_name: "Debt-to-Assets",
    pillar: "financing",
    current_value: 0.52,
    health_score: 61,
    health_tier: "at_risk",
    prior_period_value: 0.55,
    prior_period_score: 55,
    formatted_value: "52.0%",
  },
  {
    ratio_key: "currentRatio",
    ratio_name: "Current Ratio",
    pillar: "cash",
    current_value: 1.15,
    health_score: 28,
    health_tier: "critical",
    prior_period_value: 1.4,
    prior_period_score: 46,
    formatted_value: "1.15×",
  },
  {
    ratio_key: "debtorDays",
    ratio_name: "Debtor Days",
    pillar: "cash",
    current_value: 54,
    health_score: 40,
    health_tier: "at_risk",
    prior_period_value: 49,
    prior_period_score: 49,
    formatted_value: "54 d",
  },
  {
    ratio_key: "ocfToEbitda",
    ratio_name: "Cash Quality",
    pillar: "cash",
    current_value: 0.72,
    health_score: 60,
    health_tier: "at_risk",
    prior_period_value: 0.79,
    prior_period_score: 67,
    formatted_value: "0.72×",
  },
  {
    ratio_key: "workingCapitalFunding",
    ratio_name: "WC Funding",
    pillar: "cash",
    current_value: 0.31,
    health_score: 32,
    health_tier: "critical",
    prior_period_value: 0.27,
    prior_period_score: 42,
    formatted_value: "31.0%",
  },
];

const MOCK_INTERVENTIONS: Intervention[] = [
  {
    ratio_key: "currentRatio",
    ratio_name: "Current Ratio",
    health_tier: "critical",
    step_number: 1,
    step_title: "Build a 13-week rolling cash flow forecast",
    step_description:
      "Create a weekly cash projection covering the next 13 weeks. Update every Monday with actual vs. forecast figures.",
    timeframe: "1–2 weeks",
    effort: "Low",
    impact: "9/10",
    category: "cash",
  },
  {
    ratio_key: "workingCapitalFunding",
    ratio_name: "WC Funding",
    health_tier: "critical",
    step_number: 1,
    step_title: "Invoice immediately on job completion — same-day billing",
    step_description:
      "Set a business rule: every completed job is invoiced the same day. Late invoicing is the #1 cause of high working capital funding intensity.",
    timeframe: "1 week",
    effort: "Low",
    impact: "8/10",
    category: "cash",
  },
  {
    ratio_key: "debtorDays",
    ratio_name: "Debtor Days",
    health_tier: "at_risk",
    step_number: 1,
    step_title: "Launch a structured 3-stage debtor chasing schedule",
    step_description:
      "Implement a formal collection process: reminder at 25 days, phone call at 35 days, final notice at 45 days.",
    timeframe: "2 weeks",
    effort: "Medium",
    impact: "8/10",
    category: "cash",
  },
  {
    ratio_key: "grossMargin",
    ratio_name: "Gross Margin",
    health_tier: "at_risk",
    step_number: 1,
    step_title: "Raise prices on top 3 products by 5%",
    step_description:
      "A 5% price increase on top-selling lines goes straight to gross margin. Test on new customers first.",
    timeframe: "2–4 weeks",
    effort: "Low",
    impact: "10/10",
    category: "profit",
  },
];

const MOCK_FORECAST: CashForecastWeek[] = [
  {
    period_label: "Week 1",
    opening_balance: 245000,
    total_receipts: 185000,
    total_payments: 210000,
    net_movement: -25000,
    closing_balance: 220000,
    scenario: "moderate",
    runway_weeks: 13,
  },
  {
    period_label: "Week 2",
    opening_balance: 220000,
    total_receipts: 195000,
    total_payments: 205000,
    net_movement: -10000,
    closing_balance: 210000,
    scenario: "moderate",
    runway_weeks: 12,
  },
  {
    period_label: "Week 3",
    opening_balance: 210000,
    total_receipts: 165000,
    total_payments: 220000,
    net_movement: -55000,
    closing_balance: 155000,
    scenario: "moderate",
    runway_weeks: 11,
  },
  {
    period_label: "Week 4",
    opening_balance: 155000,
    total_receipts: 210000,
    total_payments: 195000,
    net_movement: 15000,
    closing_balance: 170000,
    scenario: "moderate",
    runway_weeks: 10,
  },
  {
    period_label: "Week 5",
    opening_balance: 170000,
    total_receipts: 145000,
    total_payments: 230000,
    net_movement: -85000,
    closing_balance: 85000,
    scenario: "moderate",
    runway_weeks: 9,
  },
  {
    period_label: "Week 6",
    opening_balance: 85000,
    total_receipts: 275000,
    total_payments: 195000,
    net_movement: 80000,
    closing_balance: 165000,
    scenario: "moderate",
    runway_weeks: 8,
  },
  {
    period_label: "Week 7",
    opening_balance: 165000,
    total_receipts: 155000,
    total_payments: 210000,
    net_movement: -55000,
    closing_balance: 110000,
    scenario: "moderate",
    runway_weeks: 7,
  },
  {
    period_label: "Week 8",
    opening_balance: 110000,
    total_receipts: 190000,
    total_payments: 195000,
    net_movement: -5000,
    closing_balance: 105000,
    scenario: "moderate",
    runway_weeks: 6,
  },
  {
    period_label: "Week 9",
    opening_balance: 105000,
    total_receipts: 160000,
    total_payments: 215000,
    net_movement: -55000,
    closing_balance: 50000,
    scenario: "moderate",
    runway_weeks: 5,
  },
  {
    period_label: "Week 10",
    opening_balance: 50000,
    total_receipts: 290000,
    total_payments: 195000,
    net_movement: 95000,
    closing_balance: 145000,
    scenario: "moderate",
    runway_weeks: 4,
  },
  {
    period_label: "Week 11",
    opening_balance: 145000,
    total_receipts: 175000,
    total_payments: 200000,
    net_movement: -25000,
    closing_balance: 120000,
    scenario: "moderate",
    runway_weeks: 3,
  },
  {
    period_label: "Week 12",
    opening_balance: 120000,
    total_receipts: 205000,
    total_payments: 195000,
    net_movement: 10000,
    closing_balance: 130000,
    scenario: "moderate",
    runway_weeks: 2,
  },
  {
    period_label: "Week 13",
    opening_balance: 130000,
    total_receipts: 215000,
    total_payments: 195000,
    net_movement: 20000,
    closing_balance: 150000,
    scenario: "moderate",
    runway_weeks: 1,
  },
];

const MOCK_WC: WorkingCapitalData = {
  debtor_days: 54,
  debtor_days_prior: 49,
  inventory_days: 47,
  inventory_days_prior: 52,
  wip_days: 12,
  wip_days_prior: 14,
  creditor_days: 35,
  creditor_days_prior: 33,
  cash_conversion_cycle: 78,
  ccc_prior: 82,
  working_capital_funding: 0.31,
  working_capital_utilization: 0.65,
  working_capital_days: 90,
  annual_revenue: 12_500_000,
  cash_trapped_rands: 854_167,
  health_scores: {
    debtor_days: 40,
    inventory_days: 55,
    creditor_days: 75,
    wip_days: 68,
    working_capital_days: 48,
    working_capital_funding: 32,
    working_capital_utilization: 58,
  },
};

const MOCK_PROFIT: ProfitabilityData = {
  revenue: 12_500_000,
  gross_profit: 4_750_000,
  gross_margin_pct: 0.38,
  gross_margin_score: 62,
  gross_margin_tier: "at_risk",
  operating_profit: 2_375_000,
  operating_margin_pct: 0.19,
  operating_margin_score: 76,
  operating_margin_tier: "healthy",
  ebt: 2_218_750,
  interest_burden_pct: 0.177,
  interest_burden_score: 72,
  tax: 554_688,
  tax_burden_pct: 0.044,
  tax_burden_score: 74,
  net_profit: 1_664_063,
  net_margin_pct: 0.133,
  net_margin_score: 68,
  net_margin_tier: "at_risk",
  prior_period: {
    revenue: 11_000_000,
    gross_profit: 3_850_000,
    gross_margin_pct: 0.35,
    gross_margin_score: 54,
    operating_profit: 1_980_000,
    operating_margin_pct: 0.18,
    operating_margin_score: 68,
    ebt: 1_848_000,
    interest_burden_pct: 0.168,
    interest_burden_score: 65,
    tax: 462_000,
    tax_burden_pct: 0.042,
    tax_burden_score: 68,
    net_profit: 1_386_000,
    net_margin_pct: 0.126,
    net_margin_score: 62,
  },
};

const MOCK_LEVERAGE: LeverageSolvencyData = {
  total_debt: 3_800_000,
  total_equity: 3_530_000,
  total_assets: 7_330_000,
  debt_facilities_captured: true,
  net_profit: 450_000,
  drawings: 120_000,
  prior_equity: 3_200_000,
  debt_lines: [
    {
      label: "ABSA Business Term Loan",
      amount: 1_500_000,
      annual_rate_pct: 11.5,
      maturity_year: 2026,
    },
    {
      label: "Working Capital Facility",
      amount: 850_000,
      annual_rate_pct: 13.0,
      maturity_year: 2025,
    },
    {
      label: "Equipment Finance (John Deere)",
      amount: 950_000,
      annual_rate_pct: 9.8,
      maturity_year: 2028,
    },
    { label: "Director Loan Account", amount: 500_000, annual_rate_pct: 0, maturity_year: 2027 },
  ],
  health_scores: {
    fundingStructure: 52,
    equityMultiplier: 70,
    debtToEquity: 67,
    debtToAssets: 61,
    interestBurden: 72,
  },
};

const MOCK_ASSETS: AssetProductivityData = {
  roe: 0.127,
  net_margin: 0.133,
  asset_turnover: 1.3,
  equity_multiplier: 2.1,
  capex_periods: [
    { label: "Jun 2024", capex: 320_000, depreciation: 280_000 },
    { label: "Sep 2024", capex: 180_000, depreciation: 285_000 },
    { label: "Dec 2024", capex: 240_000, depreciation: 290_000 },
    { label: "Jun 2025", capex: 410_000, depreciation: 295_000 },
  ],
  health_scores: {
    assetTurnover: 74,
    roa: 83,
    fixedCapitalUtilization: 65,
    assetReinvestmentRatio: 68,
    capexIntensity: 71,
  },
  ratios: {
    assetTurnover: { value: "1.30×" },
    roa: { value: "14.0%" },
    fixedCapitalUtilization: { value: "68.0%" },
    assetReinvestmentRatio: { value: "1.39×" },
    capexIntensity: { value: "3.3%" },
  },
};

const MOCK_LABOR: LaborProductivityData = {
  employee_count: 47,
  total_labor_cost: 8_750_000,
  total_revenue: 12_500_000,
  total_gp: 4_750_000,
  gp_known: true,
  revenue_per_employee: 265_957,
  rpe_prior: 244_444,
  gp_per_labor_rand: 0.543,
  revenue_growth: 0.136,
  inflation_rate: 0.057,
  periods: [
    { label: "Jun 2024", revenue: 10_250_000, employees: 42, labor_cost: 7_350_000 },
    { label: "Sep 2024", revenue: 10_800_000, employees: 44, labor_cost: 7_750_000 },
    { label: "Dec 2024", revenue: 11_500_000, employees: 45, labor_cost: 8_200_000 },
    { label: "Jun 2025", revenue: 12_500_000, employees: 47, labor_cost: 8_750_000 },
  ],
  health_scores: { gpToLabor: 64, salesPerEmployee: 72, revenueGrowth: 41 },
};

const MOCK_MOVEMENT: RatioMovementRow[] = [
  {
    ratio_key: "grossMargin",
    ratio_name: "Gross Margin",
    pillar: "profit",
    unit: "%",
    current: 0.38,
    three_months: 0.37,
    six_months: 0.36,
    twelve_months: 0.35,
  },
  {
    ratio_key: "operatingMargin",
    ratio_name: "Operating Margin",
    pillar: "profit",
    unit: "%",
    current: 0.19,
    three_months: 0.18,
    six_months: 0.18,
    twelve_months: 0.17,
  },
  {
    ratio_key: "revenueGrowth",
    ratio_name: "Revenue Growth",
    pillar: "profit",
    unit: "%",
    current: 0.136,
    three_months: 0.11,
    six_months: 0.08,
    twelve_months: 0.04,
  },
  {
    ratio_key: "fixedCostRatio",
    ratio_name: "Fixed Cost Ratio",
    pillar: "profit",
    unit: "%",
    current: 0.28,
    three_months: 0.29,
    six_months: 0.3,
    twelve_months: 0.31,
    lower_is_better: true,
  },
  {
    ratio_key: "netMargin",
    ratio_name: "Net Margin",
    pillar: "profit",
    unit: "%",
    current: 0.133,
    three_months: 0.128,
    six_months: 0.121,
    twelve_months: 0.126,
  },
  {
    ratio_key: "assetTurnover",
    ratio_name: "Asset Turnover",
    pillar: "assets",
    unit: "×",
    current: 1.3,
    three_months: 1.27,
    six_months: 1.24,
    twelve_months: 1.22,
  },
  {
    ratio_key: "roa",
    ratio_name: "Return on Assets",
    pillar: "assets",
    unit: "%",
    current: 0.14,
    three_months: 0.135,
    six_months: 0.13,
    twelve_months: 0.12,
  },
  {
    ratio_key: "inventoryDays",
    ratio_name: "Inventory Days",
    pillar: "assets",
    unit: "d",
    current: 47,
    three_months: 49,
    six_months: 50,
    twelve_months: 52,
    lower_is_better: true,
  },
  {
    ratio_key: "fcUtilization",
    ratio_name: "Fixed Capital Utilization",
    pillar: "assets",
    unit: "%",
    current: 0.68,
    three_months: 0.66,
    six_months: 0.65,
    twelve_months: 0.63,
  },
  {
    ratio_key: "capexIntensity",
    ratio_name: "Capex Intensity",
    pillar: "assets",
    unit: "%",
    current: 0.033,
    three_months: 0.028,
    six_months: 0.032,
    twelve_months: 0.025,
  },
  {
    ratio_key: "equityMultiplier",
    ratio_name: "Equity Multiplier",
    pillar: "financing",
    unit: "×",
    current: 2.1,
    three_months: 2.15,
    six_months: 2.2,
    twelve_months: 2.3,
    lower_is_better: true,
  },
  {
    ratio_key: "debtToEquity",
    ratio_name: "Debt-to-Equity",
    pillar: "financing",
    unit: "×",
    current: 1.1,
    three_months: 1.15,
    six_months: 1.18,
    twelve_months: 1.2,
    lower_is_better: true,
  },
  {
    ratio_key: "debtToAssets",
    ratio_name: "Debt-to-Assets",
    pillar: "financing",
    unit: "%",
    current: 0.52,
    three_months: 0.53,
    six_months: 0.54,
    twelve_months: 0.55,
    lower_is_better: true,
  },
  {
    ratio_key: "interestBurden",
    ratio_name: "Interest Burden",
    pillar: "financing",
    unit: "%",
    current: 0.177,
    three_months: 0.182,
    six_months: 0.185,
    twelve_months: 0.168,
    lower_is_better: true,
  },
  {
    ratio_key: "fundingStructure",
    ratio_name: "Funding Structure",
    pillar: "financing",
    unit: "%",
    current: 0.52,
    three_months: 0.53,
    six_months: 0.55,
    twelve_months: 0.55,
    lower_is_better: true,
  },
  {
    ratio_key: "currentRatio",
    ratio_name: "Current Ratio",
    pillar: "cash",
    unit: "×",
    current: 1.15,
    three_months: 1.22,
    six_months: 1.32,
    twelve_months: 1.4,
  },
  {
    ratio_key: "debtorDays",
    ratio_name: "Debtor Days",
    pillar: "cash",
    unit: "d",
    current: 54,
    three_months: 52,
    six_months: 51,
    twelve_months: 49,
    lower_is_better: true,
  },
  {
    ratio_key: "ocfToEbitda",
    ratio_name: "Cash Quality (OCF/EBITDA)",
    pillar: "cash",
    unit: "×",
    current: 0.72,
    three_months: 0.75,
    six_months: 0.77,
    twelve_months: 0.79,
  },
  {
    ratio_key: "wcFunding",
    ratio_name: "WC Funding Ratio",
    pillar: "cash",
    unit: "%",
    current: 0.31,
    three_months: 0.3,
    six_months: 0.28,
    twelve_months: 0.27,
    lower_is_better: true,
  },
  {
    ratio_key: "ccc",
    ratio_name: "Cash Conversion Cycle",
    pillar: "cash",
    unit: "d",
    current: 78,
    three_months: 80,
    six_months: 81,
    twelve_months: 82,
    lower_is_better: true,
  },
];

const MOCK_BENCHMARK: BenchmarkRow[] = [
  {
    ratio_key: "grossMargin",
    ratio_name: "Gross Margin",
    pillar: "profit",
    current_value: 0.38,
    formatted_current: "38.0%",
    health_score: 62,
    health_tier: "at_risk",
    sector_median: 0.32,
    sector_top_quartile: 0.45,
    formatted_median: "32.0%",
    formatted_top_quartile: "45.0%",
  },
  {
    ratio_key: "operatingMargin",
    ratio_name: "Operating Margin",
    pillar: "profit",
    current_value: 0.19,
    formatted_current: "19.0%",
    health_score: 76,
    health_tier: "healthy",
    sector_median: 0.12,
    sector_top_quartile: 0.22,
    formatted_median: "12.0%",
    formatted_top_quartile: "22.0%",
  },
  {
    ratio_key: "revenueGrowth",
    ratio_name: "Revenue Growth",
    pillar: "profit",
    current_value: 0.136,
    formatted_current: "13.6%",
    health_score: 41,
    health_tier: "at_risk",
    sector_median: 0.08,
    sector_top_quartile: 0.18,
    formatted_median: "8.0%",
    formatted_top_quartile: "18.0%",
  },
  {
    ratio_key: "netMargin",
    ratio_name: "Net Margin",
    pillar: "profit",
    current_value: 0.133,
    formatted_current: "13.3%",
    health_score: 68,
    health_tier: "at_risk",
    sector_median: 0.07,
    sector_top_quartile: 0.15,
    formatted_median: "7.0%",
    formatted_top_quartile: "15.0%",
  },
  {
    ratio_key: "assetTurnover",
    ratio_name: "Asset Turnover",
    pillar: "assets",
    current_value: 1.3,
    formatted_current: "1.30×",
    health_score: 74,
    health_tier: "healthy",
    sector_median: 1.1,
    sector_top_quartile: 1.45,
    formatted_median: "1.10×",
    formatted_top_quartile: "1.45×",
  },
  {
    ratio_key: "roa",
    ratio_name: "Return on Assets",
    pillar: "assets",
    current_value: 0.14,
    formatted_current: "14.0%",
    health_score: 83,
    health_tier: "healthy",
    sector_median: 0.09,
    sector_top_quartile: 0.16,
    formatted_median: "9.0%",
    formatted_top_quartile: "16.0%",
  },
  {
    ratio_key: "inventoryDays",
    ratio_name: "Inventory Days",
    pillar: "assets",
    current_value: 47,
    formatted_current: "47d",
    health_score: 55,
    health_tier: "at_risk",
    sector_median: 45,
    sector_top_quartile: 30,
    formatted_median: "45d",
    formatted_top_quartile: "30d",
    lower_is_better: true,
  },
  {
    ratio_key: "equityMultiplier",
    ratio_name: "Equity Multiplier",
    pillar: "financing",
    current_value: 2.1,
    formatted_current: "2.10×",
    health_score: 70,
    health_tier: "healthy",
    sector_median: 2.3,
    sector_top_quartile: 1.8,
    formatted_median: "2.30×",
    formatted_top_quartile: "1.80×",
    lower_is_better: true,
  },
  {
    ratio_key: "debtToEquity",
    ratio_name: "Debt-to-Equity",
    pillar: "financing",
    current_value: 1.1,
    formatted_current: "1.10×",
    health_score: 67,
    health_tier: "at_risk",
    sector_median: 1.05,
    sector_top_quartile: 0.7,
    formatted_median: "1.05×",
    formatted_top_quartile: "0.70×",
    lower_is_better: true,
  },
  {
    ratio_key: "debtToAssets",
    ratio_name: "Debt-to-Assets",
    pillar: "financing",
    current_value: 0.52,
    formatted_current: "52.0%",
    health_score: 61,
    health_tier: "at_risk",
    sector_median: 0.48,
    sector_top_quartile: 0.35,
    formatted_median: "48.0%",
    formatted_top_quartile: "35.0%",
    lower_is_better: true,
  },
  {
    ratio_key: "currentRatio",
    ratio_name: "Current Ratio",
    pillar: "cash",
    current_value: 1.15,
    formatted_current: "1.15×",
    health_score: 28,
    health_tier: "critical",
    sector_median: 1.5,
    sector_top_quartile: 2.1,
    formatted_median: "1.50×",
    formatted_top_quartile: "2.10×",
  },
  {
    ratio_key: "debtorDays",
    ratio_name: "Debtor Days",
    pillar: "cash",
    current_value: 54,
    formatted_current: "54d",
    health_score: 40,
    health_tier: "at_risk",
    sector_median: 45,
    sector_top_quartile: 30,
    formatted_median: "45d",
    formatted_top_quartile: "30d",
    lower_is_better: true,
  },
  {
    ratio_key: "wcFunding",
    ratio_name: "WC Funding Ratio",
    pillar: "cash",
    current_value: 0.31,
    formatted_current: "31.0%",
    health_score: 32,
    health_tier: "critical",
    sector_median: 0.22,
    sector_top_quartile: 0.14,
    formatted_median: "22.0%",
    formatted_top_quartile: "14.0%",
    lower_is_better: true,
  },
  {
    ratio_key: "ccc",
    ratio_name: "Cash Conversion Cycle",
    pillar: "cash",
    current_value: 78,
    formatted_current: "78d",
    health_score: 38,
    health_tier: "critical",
    sector_median: 55,
    sector_top_quartile: 38,
    formatted_median: "55d",
    formatted_top_quartile: "38d",
    lower_is_better: true,
  },
];

// ── Client report data ─────────────────────────────────────────────────────

type ClientReportData = {
  hasData: boolean;
  clientName: string;
  cashRunwayWeeks: number | null;
  runwayLabel: string | null;
  cashGenerative: boolean;
  forecastMinimum: number;
  financials: Record<string, string>;
  rawRatios: Record<string, number>;
  ratioResults: RatioResult[];
  workingCapital: WorkingCapitalData | null;
  profitability: ProfitabilityData | null;
  leverage: LeverageSolvencyData | null;
  assets: AssetProductivityData | null;
  labor: LaborProductivityData | null;
  movement: RatioMovementRow[];
  movementPeriodLabels: {
    current: string;
    three_months: string;
    six_months: string;
    twelve_months: string;
  };
  benchmark: BenchmarkRow[];
  cashForecast: CashForecastWeek[] | null;
  financialsUpdatedAt: string | null;
  lastForecastAt: string | null;
  reviewSignoffs: {
    financials: ClientReviewSignoff | null;
    cash_forecast: ClientReviewSignoff | null;
    profitability: ClientReviewSignoff | null;
    budget: ClientReviewSignoff | null;
  };
  /** Saved `clients.budget`. Null when the client has no plan yet. */
  budget: BudgetDocument | null;
  budgetActuals: BudgetPdfActual[];
  budgetUpdatedAt: string | null;
  /** Owner 10Q profile — shapes report narratives / ordering, not layout. */
  operatingProfile: ClientOperatingProfile | null;
  /**
   * Live sector used for Benchmark PDF title + rows (from client business_type /
   * profile). Null in demo / when type unset — never invent a sector label.
   */
  benchmarkSector: { code: string; name: string } | null;
  market: ResolvedMarket;
  /** Statement period, e.g. "September 2026" or "1–21 Sep 2026 (part month)". */
  dataPeriodLabel: string | null;
  /** Month name matching the studio dropdown, from the statement period end. */
  periodMonth: string | null;
  periodYear: string | null;
};

const DEFAULT_MOVEMENT_LABELS = {
  current: "Current",
  three_months: "3 Months Ago",
  six_months: "6 Months Ago",
  twelve_months: "12 Months Ago",
};

const EMPTY_CLIENT_DATA: ClientReportData = {
  hasData: false,
  clientName: "",
  cashRunwayWeeks: null,
  runwayLabel: null,
  cashGenerative: false,
  forecastMinimum: CASH_RUNWAY_THRESHOLD_RAND,
  financials: {},
  rawRatios: {},
  ratioResults: [],
  workingCapital: null,
  profitability: null,
  leverage: null,
  assets: null,
  labor: null,
  movement: [],
  movementPeriodLabels: DEFAULT_MOVEMENT_LABELS,
  benchmark: [],
  cashForecast: null,
  financialsUpdatedAt: null,
  lastForecastAt: null,
  reviewSignoffs: { financials: null, cash_forecast: null, profitability: null, budget: null },
  budget: null,
  budgetActuals: [],
  budgetUpdatedAt: null,
  operatingProfile: null,
  benchmarkSector: null,
  market: ZA_MARKET,
  dataPeriodLabel: null,
  periodMonth: null,
  periodYear: null,
};

// ── Data-builder helpers ────────────────────────────────────────────────────

function getNum(fin: Record<string, string>, key: string): number {
  const v = fin[key];
  return v && v.trim() !== "" ? parseFloat(v) : NaN;
}

function scoreForRatio(name: string, val: number, market: ResolvedMarket = ZA_MARKET): number {
  return scoreRatio(name, val, market);
}

function fmtRatioVal(name: string, val: number): string {
  if (!Number.isFinite(val)) return "—";
  if (name.includes("Days")) return `${Math.round(val)}d`;
  if (
    name === "Asset Turnover" ||
    name === "Equity Multiplier" ||
    name === "Debt-to-Equity" ||
    name === "Degree of Operating Leverage" ||
    name === "OCF / EBITDA"
  )
    return `${val.toFixed(2)}×`;
  return `${(val * 100).toFixed(1)}%`;
}

function pillarForRatio(name: string): "profit" | "assets" | "financing" | "cash" {
  return pillarForRatioName(name);
}

function buildRatioResults(
  rawRatios: Record<string, number>,
  market: ResolvedMarket = ZA_MARKET,
  context?: {
    equity?: number | null;
    periodMonths?: number | null;
    partMonth?: boolean;
    cashFlowKnown?: boolean;
  },
): RatioResult[] {
  const rows: RatioResult[] = [];
  for (const [name, val] of Object.entries(rawRatios)) {
    const presented = presentScorecardRatio({
      name,
      value: val,
      equity: context?.equity,
      currency: market.currency,
      periodMonths: context?.periodMonths,
      partMonth: context?.partMonth,
      cashFlowKnown: context?.cashFlowKnown,
    });
    if (!presented.include) continue;
    const scoredValue = presented.scoredValue;
    const score =
      presented.unscored || scoredValue == null
        ? 0
        : Math.round(scoreForRatio(name, scoredValue, market));
    rows.push({
      ratio_key: name.toLowerCase().replace(/[^a-z0-9]/g, "_"),
      ratio_name: name,
      pillar: pillarForRatio(name),
      current_value: scoredValue ?? (Number.isFinite(val) ? val : Number.NaN),
      health_score: score,
      health_tier: presented.unscored ? "at_risk" : scoreTier(score),
      formatted_value: presented.text ?? fmtRatioVal(name, scoredValue ?? val),
      annotation: presented.note,
      unscored: presented.unscored || undefined,
    });
  }
  return rows;
}

/**
 * Live benchmark PDF rows come only from `industry_benchmarks` for the client's
 * sector. Invented ZA-SME medians (old BENCH_META) must never appear under a
 * real client name — demo path still uses MOCK_BENCHMARK.
 */
const METRIC_KEY_TO_RATIO: Record<
  string,
  {
    name: string;
    unit: "%" | "×" | "d";
    pillar: "profit" | "assets" | "financing" | "cash";
  }
> = {
  grossMargin: { name: "Gross Margin", unit: "%", pillar: "profit" },
  operatingMargin: { name: "Operating Margin", unit: "%", pillar: "profit" },
  netMargin: { name: "Net Margin", unit: "%", pillar: "profit" },
  assetTurnover: { name: "Asset Turnover", unit: "×", pillar: "assets" },
  roa: { name: "Return on Assets", unit: "%", pillar: "assets" },
  inventoryDays: { name: "Inventory Days", unit: "d", pillar: "assets" },
  debtorDays: { name: "Debtor Days", unit: "d", pillar: "cash" },
  creditorDays: { name: "Creditor Days", unit: "d", pillar: "cash" },
  fixedCostRatio: { name: "Fixed Cost Ratio", unit: "%", pillar: "profit" },
  roe: { name: "Return on Equity", unit: "%", pillar: "financing" },
};

type SectorBenchProps = {
  median: number;
  top: number;
  lower: boolean;
  unit: "%" | "×" | "d";
  pillar: "profit" | "assets" | "financing" | "cash";
  direction?: "higher_is_better" | "lower_is_better" | "sweet_spot";
  healthyMin?: number | null;
  healthyMax?: number | null;
};

/** DB stores pct as 0–100; ratio space (and PDF fmt) uses 0–1. */
function normalizeBenchProps(
  metricName: string,
  unit: string,
  p25: number,
  p50: number,
  p75: number,
  higherIsBetter: boolean,
  meta: { unit: "%" | "×" | "d"; pillar: "profit" | "assets" | "financing" | "cash" },
): SectorBenchProps {
  const scale = unit === "pct" ? 0.01 : 1;
  const spec = metricDirection(metricName);
  const bound = spec
    ? benchmarkHealthyEnd(spec, p25 * scale, p75 * scale)
    : {
        top: (higherIsBetter ? p75 : p25) * scale,
        lowerIsBetter: !higherIsBetter,
      };
  return {
    median: p50 * scale,
    top: bound.top,
    lower: bound.lowerIsBetter,
    unit: meta.unit,
    pillar: meta.pillar,
    direction: spec?.direction,
    healthyMin: spec?.healthyMin ?? null,
    healthyMax: spec?.healthyMax ?? null,
  };
}

async function loadSectorBenchmarks(
  businessTypeId: string | null | undefined,
): Promise<Record<string, SectorBenchProps>> {
  const sector = businessTypeId ? BUSINESS_TYPE_TO_BENCHMARK[businessTypeId] : null;
  if (!sector) return {};
  const { data, error } = await supabase
    .from("industry_benchmarks")
    .select("metric_key, p25, p50, p75, unit, higher_is_better")
    .eq("business_type", sector);
  if (error || !data) return {};
  const out: Record<string, SectorBenchProps> = {};
  for (const row of data) {
    const meta = METRIC_KEY_TO_RATIO[row.metric_key];
    if (!meta) continue;
    out[meta.name] = normalizeBenchProps(
      meta.name,
      row.unit,
      Number(row.p25),
      Number(row.p50),
      Number(row.p75),
      Boolean(row.higher_is_better),
      meta,
    );
  }
  return out;
}

function fmtBenchVal(val: number, unit: string): string {
  if (unit === "%") return `${(val * 100).toFixed(1)}%`;
  if (unit === "×") return `${val.toFixed(2)}×`;
  return `${Math.round(val)}d`;
}

function buildBenchmarkRows(
  rawRatios: Record<string, number>,
  ratioResults: RatioResult[],
  sector: Record<string, SectorBenchProps>,
): BenchmarkRow[] {
  return Object.entries(sector)
    .filter(([name]) => {
      const rr = ratioResults.find((r) => r.ratio_name === name);
      if (rr?.unscored) return true;
      return Number.isFinite(rawRatios[name]);
    })
    .map(([name, b]) => {
      const val = rawRatios[name];
      const rr = ratioResults.find((r) => r.ratio_name === name);
      const unscored = Boolean(rr?.unscored);
      const score = unscored ? 0 : (rr?.health_score ?? Math.round(scoreForRatio(name, val)));
      return {
        ratio_key: name.toLowerCase().replace(/[^a-z0-9]/g, "_"),
        ratio_name: name,
        pillar: b.pillar,
        current_value: unscored ? Number.NaN : val,
        formatted_current: unscored ? (rr?.formatted_value ?? "n/a") : fmtBenchVal(val, b.unit),
        health_score: score,
        health_tier: unscored ? "at_risk" : scoreTier(score),
        unscored,
        sector_median: b.median,
        sector_top_quartile: b.top,
        formatted_median: fmtBenchVal(b.median, b.unit),
        formatted_top_quartile: fmtBenchVal(b.top, b.unit),
        lower_is_better: b.lower,
        direction: b.direction,
        healthy_min: b.healthyMin ?? null,
        healthy_max: b.healthyMax ?? null,
      } as BenchmarkRow;
    });
}

// Ratio Movement row definitions
const MOVEMENT_META: Array<{
  name: string;
  key: string;
  pillar: "profit" | "assets" | "financing" | "cash";
  unit: string;
  lower?: boolean;
}> = [
  { name: "Gross Margin", key: "gross_margin", pillar: "profit", unit: "%" },
  { name: "Operating Margin", key: "operating_margin", pillar: "profit", unit: "%" },
  { name: "Net Margin", key: "net_margin", pillar: "profit", unit: "%" },
  { name: "Asset Turnover", key: "asset_turnover", pillar: "assets", unit: "×" },
  { name: "Return on Assets", key: "return_on_assets", pillar: "assets", unit: "%" },
  { name: "Inventory Days", key: "inventory_days", pillar: "assets", unit: "d", lower: true },
  {
    name: "Equity Multiplier",
    key: "equity_multiplier",
    pillar: "financing",
    unit: "×",
    lower: true,
  },
  { name: "Debtor Days", key: "debtor_days", pillar: "cash", unit: "d", lower: true },
  {
    name: "Working Capital Days",
    key: "working_capital_days",
    pillar: "cash",
    unit: "d",
    lower: true,
  },
  { name: "OCF / EBITDA", key: "ocf_ebitda", pillar: "cash", unit: "×" },
];

type DatedSnapshot = {
  period_label: string;
  period_date: string; // ISO YYYY-MM-DD
  ratios: Record<string, number>;
};

/**
 * Finds the snapshot whose period_date is closest to `targetDate` and within
 * `toleranceDays` of it. Returns null when no snapshot qualifies.
 */
function closestSnapshot(
  snapshots: DatedSnapshot[],
  targetDate: Date,
  toleranceDays: number,
): DatedSnapshot | null {
  let best: DatedSnapshot | null = null;
  let bestDiff = Infinity;
  for (const s of snapshots) {
    const d = new Date(s.period_date);
    const diff = Math.abs(d.getTime() - targetDate.getTime()) / 86_400_000; // ms→days
    if (diff <= toleranceDays && diff < bestDiff) {
      best = s;
      bestDiff = diff;
    }
  }
  return best;
}

function buildMovementRows(
  rawRatios: Record<string, number>,
  snapshots: DatedSnapshot[],
  refDate: Date,
): { rows: RatioMovementRow[]; labels: ClientReportData["movementPeriodLabels"] } {
  // Target dates for each comparison column
  const t3m = new Date(refDate);
  t3m.setMonth(t3m.getMonth() - 3);
  const t6m = new Date(refDate);
  t6m.setMonth(t6m.getMonth() - 6);
  const t12m = new Date(refDate);
  t12m.setFullYear(t12m.getFullYear() - 1);

  // ±45 days window for 3m/6m; ±60 days for 12m
  const s3m = closestSnapshot(snapshots, t3m, 45);
  const s6m = closestSnapshot(snapshots, t6m, 45);
  const s12m = closestSnapshot(snapshots, t12m, 60);

  const labels: ClientReportData["movementPeriodLabels"] = {
    current: "Current",
    three_months: s3m ? s3m.period_label : "3 Months Ago",
    six_months: s6m ? s6m.period_label : "6 Months Ago",
    twelve_months: s12m ? s12m.period_label : "12 Months Ago",
  };

  const rows = MOVEMENT_META.filter(({ name }) => Number.isFinite(rawRatios[name])).map(
    ({ name, key, pillar, unit, lower }) =>
      ({
        ratio_key: key,
        ratio_name: name,
        pillar,
        unit,
        current: rawRatios[name],
        three_months: s3m && s3m.ratios[name] != null ? Number(s3m.ratios[name]) : null,
        six_months: s6m && s6m.ratios[name] != null ? Number(s6m.ratios[name]) : null,
        twelve_months: s12m && s12m.ratios[name] != null ? Number(s12m.ratios[name]) : null,
        lower_is_better: lower,
      }) as RatioMovementRow,
  );

  return { rows, labels };
}

function buildWorkingCapitalData(
  fin: Record<string, string>,
  rawRatios: Record<string, number>,
): WorkingCapitalData | null {
  const revenue = getNum(fin, "revenue");
  if (!Number.isFinite(revenue) || revenue <= 0) return null;
  const months = periodMonthsOf(fin);
  const annualRevenue = revenue * (12 / months);
  const dd = Number.isFinite(rawRatios["Debtor Days"]) ? rawRatios["Debtor Days"] : 0;
  const id = Number.isFinite(rawRatios["Inventory Days"]) ? rawRatios["Inventory Days"] : 0;
  const cd = Number.isFinite(rawRatios["Creditor Days"]) ? rawRatios["Creditor Days"] : 0;
  if (!Number.isFinite(rawRatios["Debtor Days"]) && !Number.isFinite(rawRatios["Inventory Days"]))
    return null;
  const ccc = dd + id - cd;
  const wcFunding = ccc / 365;
  return {
    debtor_days: dd,
    inventory_days: id,
    wip_days: 0,
    creditor_days: cd,
    cash_conversion_cycle: ccc,
    working_capital_funding: wcFunding,
    working_capital_utilization: Math.min(1, Math.max(0, wcFunding * 2)),
    working_capital_days: ccc,
    annual_revenue: annualRevenue,
    cash_trapped_rands: annualRevenue * Math.max(0, wcFunding),
    health_scores: {
      debtor_days: Math.round(scoreForRatio("Debtor Days", dd)),
      inventory_days: Math.round(scoreForRatio("Inventory Days", id)),
      creditor_days: Math.round(scoreForRatio("Creditor Days", cd)),
      // WIP not in financials — score 0 days honestly (not a soft-demo 68).
      wip_days: Math.round(scoreForRatio("Inventory Days", 0)),
      working_capital_days: Math.round(scoreForRatio("Working Capital Days", ccc)),
      working_capital_funding: Math.round(scoreWorkingCapitalFunding(wcFunding)),
      working_capital_utilization: Math.round(
        scoreWorkingCapitalFunding(wcFunding) === 0 && (wcFunding < -1 || wcFunding > 2)
          ? 0
          : Math.min(100, Math.max(0, (1 - Math.min(2, Math.max(-1, wcFunding))) * 90)),
      ),
    },
  };
}

function buildProfitabilityData(
  fin: Record<string, string>,
  priorFin?: Record<string, string> | null,
): ProfitabilityData | null {
  const revenue = getNum(fin, "revenue");
  const cogs = getNum(fin, "cogs");
  const ebit = getNum(fin, "ebit");
  const ebt = getNum(fin, "ebt");
  const net = getNum(fin, "netIncome");
  if (!Number.isFinite(revenue) || !Number.isFinite(ebit) || !Number.isFinite(net)) return null;
  // Never invent GP from 50% of revenue — COGS required for gross margin.
  if (!Number.isFinite(cogs)) return null;
  const gp = revenue - cogs;
  const gmPct = gp / revenue;
  const omPct = ebit / revenue;
  const depreciation = periodProfitBridge(fin).depreciation;
  const ebtVal = Number.isFinite(ebt) ? ebt : ebit;
  const interestBurden = interestBurdenRatio(ebit, ebtVal);
  const taxBurden = taxBurdenRatio(ebtVal, net);
  const tax = Math.max(0, ebtVal - net);
  const nmPct = net / revenue;
  const current = {
    revenue,
    gross_profit: gp,
    gross_margin_pct: gmPct,
    gross_margin_score: Math.round(scoreForRatio("Gross Margin", gmPct)),
    gross_margin_tier: scoreTier(Math.round(scoreForRatio("Gross Margin", gmPct))),
    operating_profit: ebit,
    operating_margin_pct: omPct,
    operating_margin_score: Math.round(scoreForRatio("Operating Margin", omPct)),
    operating_margin_tier: scoreTier(Math.round(scoreForRatio("Operating Margin", omPct))),
    ebt: ebtVal,
    interest_burden_pct: Number.isFinite(interestBurden) ? interestBurden : undefined,
    interest_burden_score: Number.isFinite(interestBurden)
      ? Math.round(scoreForRatio("Interest Burden", interestBurden))
      : 0,
    tax,
    tax_burden_pct: Number.isFinite(taxBurden) ? taxBurden : undefined,
    tax_burden_score: Number.isFinite(taxBurden)
      ? Math.round(scoreForRatio("Tax Burden", taxBurden))
      : 0,
    net_profit: net,
    net_margin_pct: nmPct,
    net_margin_score: Math.round(scoreForRatio("Net Margin", nmPct)),
    net_margin_tier: scoreTier(Math.round(scoreForRatio("Net Margin", nmPct))),
    depreciation,
  };

  let prior_period: ProfitabilityData["prior_period"] | undefined;
  if (priorFin) {
    const pRev = getNum(priorFin, "revenue");
    const pCogs = getNum(priorFin, "cogs");
    const pEbit = getNum(priorFin, "ebit");
    const pEbt = getNum(priorFin, "ebt");
    const pNet = getNum(priorFin, "netIncome");
    if (
      Number.isFinite(pRev) &&
      Number.isFinite(pEbit) &&
      Number.isFinite(pNet) &&
      Number.isFinite(pCogs)
    ) {
      const pGp = pRev - pCogs;
      const pDepreciation = periodProfitBridge(priorFin).depreciation;
      const pEbtVal = Number.isFinite(pEbt) ? pEbt : pEbit;
      const pInterest = interestBurdenRatio(pEbit, pEbtVal);
      const pTaxBurden = taxBurdenRatio(pEbtVal, pNet);
      const pTax = Math.max(0, pEbtVal - pNet);
      prior_period = {
        revenue: pRev,
        gross_profit: pGp,
        gross_margin_pct: pGp / pRev,
        gross_margin_score: Math.round(scoreForRatio("Gross Margin", pGp / pRev)),
        gross_margin_tier: scoreTier(Math.round(scoreForRatio("Gross Margin", pGp / pRev))),
        operating_profit: pEbit,
        operating_margin_pct: pEbit / pRev,
        operating_margin_score: Math.round(scoreForRatio("Operating Margin", pEbit / pRev)),
        operating_margin_tier: scoreTier(
          Math.round(scoreForRatio("Operating Margin", pEbit / pRev)),
        ),
        ebt: pEbtVal,
        interest_burden_pct: Number.isFinite(pInterest) ? pInterest : undefined,
        interest_burden_score: Number.isFinite(pInterest)
          ? Math.round(scoreForRatio("Interest Burden", pInterest))
          : 0,
        tax: pTax,
        tax_burden_pct: Number.isFinite(pTaxBurden) ? pTaxBurden : undefined,
        tax_burden_score: Number.isFinite(pTaxBurden)
          ? Math.round(scoreForRatio("Tax Burden", pTaxBurden))
          : 0,
        net_profit: pNet,
        net_margin_pct: pNet / pRev,
        net_margin_score: Math.round(scoreForRatio("Net Margin", pNet / pRev)),
        net_margin_tier: scoreTier(Math.round(scoreForRatio("Net Margin", pNet / pRev))),
        depreciation: pDepreciation,
      };
    }
  }

  if (
    prior_period &&
    priorFiguresAreCopy(
      { revenue, netIncome: net },
      { revenue: prior_period.revenue, netIncome: prior_period.net_profit },
    )
  ) {
    prior_period = undefined;
  }

  return { ...current, prior_period };
}

function buildLeverageData(
  fin: Record<string, string>,
  rawRatios: Record<string, number>,
  priorEquityFromSnapshot?: number | null,
): LeverageSolvencyData | null {
  const equity = getNum(fin, "equity");
  const totalAssets = getNum(fin, "totalAssets");
  const net = getNum(fin, "netIncome");
  if (!Number.isFinite(equity) || !Number.isFinite(totalAssets)) return null;

  const schedule = parseDebtSchedule(
    (() => {
      try {
        const raw = (fin as Record<string, unknown>).debt_schedule;
        if (raw) return raw;
        // When financials were stringified, debt_schedule may be a JSON string key
        const s = fin["debt_schedule"];
        return s ? s : null;
      } catch {
        return null;
      }
    })(),
  );

  // Prefer captured facilities; never invent residual debt from assets − equity.
  const fromSchedule = totalDebtFromSchedule(schedule);
  const debt_facilities_captured = schedule.lines.some((l) => l.amount > 0 || l.label.trim());
  const totalDebt = debt_facilities_captured ? fromSchedule : 0;
  const debt_lines = debt_facilities_captured
    ? schedule.lines
        .filter((l) => l.label.trim() || l.amount > 0)
        .map((l) => ({
          label: l.label.trim() || "Facility",
          amount: l.amount,
          annual_rate_pct: l.annual_rate_pct ?? 0,
          maturity_year: l.maturity_year ?? new Date().getFullYear() + 3,
        }))
    : [];

  const liabilities = getNum(fin, "totalLiabilities");
  const d2a = debt_facilities_captured && totalAssets > 0 ? totalDebt / totalAssets : NaN;
  const deReading = debtToEquityReading({
    totalLiabilities: Number.isFinite(liabilities) ? liabilities : null,
    facilityDebt: totalDebt,
    facilitiesCaptured: debt_facilities_captured,
    equity,
  });
  const d2e = deReading.value;
  const em = rawRatios["Equity Multiplier"];
  const ib = rawRatios["Interest Burden"];
  const priorEquity =
    schedule.prior_equity != null && Number.isFinite(schedule.prior_equity)
      ? schedule.prior_equity
      : priorEquityFromSnapshot != null && Number.isFinite(priorEquityFromSnapshot)
        ? priorEquityFromSnapshot
        : null;
  const drawings =
    schedule.drawings_ytd != null && Number.isFinite(schedule.drawings_ytd)
      ? schedule.drawings_ytd
      : 0;

  return {
    total_debt: totalDebt,
    total_equity: equity,
    total_assets: totalAssets,
    total_liabilities: Number.isFinite(liabilities) ? liabilities : null,
    debt_facilities_captured,
    net_profit: Number.isFinite(net) ? net : 0,
    drawings,
    prior_equity: priorEquity,
    debt_lines,
    health_scores: {
      fundingStructure: Number.isFinite(d2a)
        ? Math.round(Math.min(100, Math.max(0, (1 - d2a) * 100)))
        : null,
      equityMultiplier: Number.isFinite(em)
        ? Math.round(scoreForRatio("Equity Multiplier", em))
        : null,
      debtToEquity: Number.isFinite(d2e) ? Math.round(scoreForRatio("Debt-to-Equity", d2e)) : null,
      debtToAssets: Number.isFinite(d2a)
        ? Math.round(Math.min(100, Math.max(0, (1 - d2a) * 100)))
        : null,
      interestBurden: Number.isFinite(ib) ? Math.round(ib * 100) : null,
    },
  };
}

function buildAssetData(
  rawRatios: Record<string, number>,
  context?: {
    equity?: number | null;
    currency?: string | null;
    periodMonths?: number | null;
    partMonth?: boolean;
  },
): AssetProductivityData | null {
  const at = rawRatios["Asset Turnover"];
  const em = rawRatios["Equity Multiplier"];
  const nm = rawRatios["Net Margin"];
  if (!Number.isFinite(at) || !Number.isFinite(em) || !Number.isFinite(nm)) return null;
  const roa = Number.isFinite(rawRatios["Return on Assets"]) ? rawRatios["Return on Assets"] : nm * at;
  const roe = Number.isFinite(rawRatios["Return on Equity"]) ? rawRatios["Return on Equity"] : roa * em;
  const roeView = presentReturn({
    ratioName: "Return on Equity",
    value: roe,
    equity: context?.equity,
    currency: context?.currency,
    periodMonths: context?.periodMonths,
    partMonth: context?.partMonth,
  });
  const roaView = presentReturn({
    ratioName: "Return on Assets",
    value: roa,
    periodMonths: context?.periodMonths,
    partMonth: context?.partMonth,
  });
  return {
    roe,
    roe_headline: roeView.headline,
    roe_note: roeView.note,
    roe_unscored: roeView.unscored,
    roe_text: roeView.text,
    roa_text: roaView.text,
    roa_headline: roaView.headline,
    roa_note: roaView.note,
    roa_unscored: roaView.unscored,
    net_margin: nm,
    asset_turnover: at,
    equity_multiplier: em,
    capex_periods: [],
    health_scores: {
      assetTurnover: Math.round(scoreForRatio("Asset Turnover", at)),
      roa: scoredReturnHealth(
        roaView,
        Number.isFinite(roa) ? scoreForRatio("Return on Assets", roa) : Number.NaN,
      ),
      // Capex / fixed-asset ratios need inputs we do not yet capture — never invent.
      fixedCapitalUtilization: null,
      assetReinvestmentRatio: null,
      capexIntensity: null,
    },
    ratios: {
      assetTurnover: { value: `${at.toFixed(2)}×` },
      roa: { value: roaView.text },
      fixedCapitalUtilization: { value: "—" },
      assetReinvestmentRatio: { value: "—" },
      capexIntensity: { value: "—" },
    },
  };
}

function buildLaborData(
  fin: Record<string, string>,
  _rawRatios: Record<string, number>,
  priorFin?: Record<string, string> | null,
  market: ResolvedMarket = ZA_MARKET,
): LaborProductivityData | null {
  const revenue = getNum(fin, "revenue");
  const laborCost = getNum(fin, "laborCost");
  const employees = getNum(fin, "employees");
  const cogs = getNum(fin, "cogs");
  const hasRevenue = Number.isFinite(revenue) && revenue > 0;
  const hasEmployees = Number.isFinite(employees) && employees > 0;
  const hasLabor = Number.isFinite(laborCost) && laborCost > 0;
  if (!hasRevenue && !hasEmployees && !hasLabor) return null;
  const gpKnown = hasRevenue && Number.isFinite(cogs);
  const gp = gpKnown ? revenue - cogs : 0;
  const rpe = hasRevenue && hasEmployees ? revenue / employees : Number.NaN;
  const gpPerLabor = gpKnown && hasLabor ? gp / laborCost : null;

  const priorRev = priorFin ? getNum(priorFin, "revenue") : NaN;
  const priorEmp = priorFin ? getNum(priorFin, "employees") : NaN;
  const rpePrior =
    Number.isFinite(priorRev) && Number.isFinite(priorEmp) && priorEmp > 0
      ? priorRev / priorEmp
      : null;
  const revenueGrowth =
    Number.isFinite(priorRev) && priorRev > 0 ? (revenue - priorRev) / priorRev : null;

  return {
    employee_count: hasEmployees ? Math.round(employees) : 0,
    total_labor_cost: hasLabor ? laborCost : 0,
    total_revenue: hasRevenue ? revenue : 0,
    total_gp: gp,
    gp_known: gpKnown,
    revenue_per_employee: rpe,
    rpe_prior: rpePrior,
    gp_per_labor_rand: gpPerLabor,
    revenue_growth: revenueGrowth,
    inflation_rate: null, // never invent CPI
    periods: [
      {
        label: "Current Period",
        revenue: hasRevenue ? revenue : 0,
        employees: hasEmployees ? Math.round(employees) : 0,
        labor_cost: hasLabor ? laborCost : 0,
      },
    ],
    health_scores: {
      gpToLabor:
        gpPerLabor != null ? Math.round(scoreForRatio("Gross Profit / Labor", gpPerLabor, market)) : null,
      salesPerEmployee:
        hasEmployees && Number.isFinite(rpe)
          ? Math.round(scoreForRatio("Sales-per-Employee Ratio", rpe, market))
          : null,
      revenueGrowth:
        revenueGrowth != null
          ? Math.round(Math.min(100, Math.max(0, ((revenueGrowth + 0.05) / 0.25) * 100)))
          : null,
    },
  };
}

// ── Cash forecast ──────────────────────────────────────────────────────────
//
// Same resolver as the cash screen and the Bot. A stale stored forecast
// (old dates, a mismatched opening, or a structural shortfall while the
// runway is cash generative) is ignored.

type CfFrequency =
  | "recurring-weekly"
  | "recurring-monthly"
  | "once-off"
  | "split-weeks"
  | "split-months";

type CfLineItem = {
  id: string;
  name: string;
  amount: string;
  frequency: CfFrequency;
  startWeek: number;
  splitCount: number;
};

type SavedCashflow = {
  startDate?: string;
  openingBalance?: string;
  revenue?: CfLineItem[];
  expenses?: CfLineItem[];
  other?: CfLineItem[];
  revAdj?: number;
  expAdj?: number;
  collectDelay?: number;
  headcountDelta?: number;
  avgSalary?: string;
  fixedCostDelta?: string;
  revGrowthPct?: number;
  capexAmount?: string;
  capexWeek?: number;
};

function buildCashForecastFromSavedCashflow(
  cf: SavedCashflow,
  openingCash: number | null,
  financials: Record<string, unknown> | null,
  runway: ClientRunway,
  timeZone?: string | null,
): { weeks: CashForecastWeek[] | null; minimum: number } {
  const outlook = resolveThirteenWeekForecast({
    financials,
    cashflow: cf,
    openingCash,
    runway,
    timeZone,
  });
  const empty =
    outlook.opening === 0 &&
    outlook.inflow.every((n) => n === 0) &&
    outlook.outflow.every((n) => n === 0);
  if (empty) return { weeks: null, minimum: outlook.floor };
  const weeks = outlook.inflow.map((inflow, i) => {
    const receipts = Math.round(inflow);
    const payments = Math.round(outlook.outflow[i] ?? 0);
    const opening = i === 0 ? outlook.opening : outlook.closing[i - 1];
    const closing = outlook.closing[i];
    return {
      period_label: `Week ${i + 1}`,
      opening_balance: Math.round(opening),
      total_receipts: receipts,
      total_payments: payments,
      net_movement: receipts - payments,
      closing_balance: Math.round(closing),
      scenario: "moderate" as const,
      runway_weeks: 0,
    };
  });
  return { weeks, minimum: outlook.floor };
}


// Build real interventions from the playbook-data.json filtered by the
// client's actual at-risk/critical ratios (camelCase ratio_key format).
async function buildInterventions(
  ratioResults: RatioResult[],
  profile?: ClientOperatingProfile | null,
): Promise<Intervention[]> {
  // Map the snake_case ratio_key from ratioResults back to camelCase playbook keys
  const KEY_MAP: Record<string, string> = {
    gross_margin: "grossMargin",
    net_margin: "netMargin",
    operating_margin: "operatingMargin",
    return_on_assets: "roa",
    asset_turnover: "assetTurnover",
    debtor_days: "debtorDays",
    inventory_days: "inventoryDays",
    creditor_days: "creditorDays",
    equity_multiplier: "equityMultiplier",
    working_capital_days: "workingCapitalFunding",
    ocf_ebitda: "ocfToEbitda",
    ocf___ebitda: "ocfToEbitda",
    gross_profit___labor: "gpToLabor",
    sales_per_employee_ratio: "salesPerEmployee",
    fixed_cost_ratio: "fixedCostRatio",
    interest_burden: "interestBurden",
  };

  const rawPlaybook = await import("@/lib/playbook-data.json");
  const allSteps = (rawPlaybook.default ?? rawPlaybook) as Intervention[];

  const atRiskRatios = ratioResults.filter(
    (r) => !r.unscored && (r.health_tier === "critical" || r.health_tier === "at_risk"),
  );

  const result: Intervention[] = [];
  for (const rr of atRiskRatios) {
    const playbookKey = KEY_MAP[rr.ratio_key] ?? rr.ratio_key;
    const steps = allSteps.filter(
      (s) => s.ratio_key === playbookKey && s.health_tier === rr.health_tier,
    );
    // Only include step 1 per ratio to keep the report concise.
    // Creditor days past the healthy band are slow payment (arrears), not early settlement.
    if (playbookKey === "creditorDays" && creditorDaysPaysSlowly(rr.current_value)) {
      const base = steps[0];
      result.push({
        ratio_key: playbookKey,
        ratio_name: rr.ratio_name,
        health_tier: rr.health_tier,
        step_number: 1,
        step_title: SLOW_CREDITOR_DAYS_STEP.step_title,
        step_description: SLOW_CREDITOR_DAYS_STEP.step_description,
        timeframe: base?.timeframe ?? "immediate",
        effort: base?.effort ?? "low",
        impact: base?.impact ?? "high",
        category: base?.category ?? "cash",
      });
      continue;
    }
    if (steps.length > 0) {
      result.push({ ...steps[0], ratio_name: rr.ratio_name, health_tier: rr.health_tier });
    }
  }
  if (result.length === 0) return [];

  const tierRank = (t: string) => (t === "critical" ? 2 : t === "at_risk" ? 1 : 0);
  const impactOf = (s: string) => {
    const m = /^(\d+)/.exec(s);
    return m ? Number(m[1]) : 5;
  };
  result.sort((a, b) => {
    const score = (iv: Intervention) =>
      (tierRank(iv.health_tier) * 10 + impactOf(iv.impact)) *
      profilePriorityWeight(profile, iv.ratio_name);
    return score(b) - score(a);
  });
  return result;
}

async function loadBudgetActualsForPdf(clientId: string): Promise<BudgetPdfActual[]> {
  const loose = supabase as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (
          k: string,
          v: string,
        ) => {
          order: (
            k: string,
            o: { ascending: boolean },
          ) => Promise<{
            data: Array<{ month: string; status: string; totals: unknown }> | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
  };
  const { data, error } = await loose
    .from("budget_month_actuals")
    .select("month, status, totals")
    .eq("client_id", clientId)
    .order("month", { ascending: true });
  if (error) {
    if (!/budget_month_actuals|42P01|42703/i.test(error.message ?? "")) {
      console.warn("budget actuals for report:", error.message);
    }
    return [];
  }
  const out: BudgetPdfActual[] = [];
  for (const row of data ?? []) {
    if (!/^\d{4}-\d{2}$/.test(row.month)) continue;
    out.push({
      month: row.month,
      status: row.status === "confirmed" ? "confirmed" : "draft",
      totals: (row.totals && typeof row.totals === "object"
        ? row.totals
        : {}) as BudgetPdfActual["totals"],
    });
  }
  return out;
}

async function loadClientReportData(clientId: string): Promise<ClientReportData> {
  const [clientRes, snapshotRes, signoffRes] = await Promise.all([
    supabase
      .from("clients")
      .select(
        "id, name, cash_runway_weeks, financials, cashflow, financials_updated_at, last_forecast_at, operating_profile, business_type, market, budget, budget_updated_at",
      )
      .eq("id", clientId)
      .maybeSingle(),
    supabase
      .from("client_financial_snapshots")
      .select("id, period_label, period_date, ratios, financials")
      .eq("client_id", clientId)
      .order("period_date", { ascending: false })
      .limit(20), // fetch enough history to cover 12-month windows
    (
      supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (
              k: string,
              v: string,
            ) => Promise<{ data: ClientReviewSignoff[] | null; error: { message: string } | null }>;
          };
        };
      }
    )
      .from("client_review_signoffs")
      .select("*")
      .eq("client_id", clientId),
  ]);

  if (signoffRes.error) {
    // Fail closed (report renders with no sign-off stamp) rather than silently — an
    // accountant should notice if sign-off status can't be verified before a report ships.
    console.error("Failed to load review sign-offs for report:", signoffRes.error.message);
  }

  const clientRow = clientRes.data as unknown as {
    name: string;
    cash_runway_weeks: number | null;
    financials: unknown;
    cashflow: unknown;
    financials_updated_at: string | null;
    last_forecast_at: string | null;
    operating_profile?: unknown;
    business_type?: string | null;
    market?: unknown;
    budget?: unknown;
    budget_updated_at?: string | null;
  } | null;
  const market = resolveMarket(
    parseMarketSelection(clientRow?.market) ?? coerceMarketSelection(clientRow?.market ?? null),
  );
  const operatingProfile = parseOperatingProfile(clientRow?.operating_profile);
  const businessTypeId = clientRow?.business_type ?? operatingProfile?.businessTypeId ?? null;
  const sectorBench = await loadSectorBenchmarks(businessTypeId);
  const benchmarkSector = resolveBenchmarkSector(businessTypeId, operatingProfile);
  const preliminary = assessClientMetrics({
    financials:
      clientRow?.financials && typeof clientRow.financials === "object"
        ? (clientRow.financials as Record<string, unknown>)
        : null,
    cashflow: clientRow?.cashflow,
    financialsUpdatedAt: clientRow?.financials_updated_at ?? null,
    timeZone: market.timezone,
  });
  const preliminaryWeeks =
    preliminary.runway.kind === "weeks" || preliminary.runway.kind === "zero"
      ? preliminary.runway.weeks
      : null;
  const reviewSignoffs = {
    financials: (signoffRes.data ?? []).find((s) => s.scope === "financials") ?? null,
    cash_forecast: (signoffRes.data ?? []).find((s) => s.scope === "cash_forecast") ?? null,
    profitability: (signoffRes.data ?? []).find((s) => s.scope === "profitability") ?? null,
    budget: (signoffRes.data ?? []).find((s) => s.scope === "budget") ?? null,
  };
  const storedBudget = parseBudgetDocument(clientRow?.budget);
  const budgetUpdatedAt = clientRow?.budget_updated_at ?? storedBudget?.updatedAt ?? null;
  const uploadedBudgetActuals = await loadBudgetActualsForPdf(clientId);
  const rawFinancials =
    clientRow?.financials && typeof clientRow.financials === "object"
      ? (clientRow.financials as Record<string, unknown>)
      : null;
  const budget = storedBudget
    ? reseedBudgetIfScaleBroken(
        storedBudget,
        rawFinancials as Record<string, string | number | null | undefined> | null,
      )
    : null;
  const statementActual = budgetActualFromFinancials(rawFinancials);
  const budgetActuals =
    uploadedBudgetActuals.length > 0
      ? uploadedBudgetActuals
      : statementActual
        ? [statementActual]
        : [];
  const periodParts = reportPeriodMonthYear(rawFinancials);
  const dataPeriodLabel = reportDataPeriodLabel(rawFinancials);
  const baseEmpty = {
    ...EMPTY_CLIENT_DATA,
    clientName: clientRow?.name ?? "",
    cashRunwayWeeks: preliminaryWeeks,
    runwayLabel: runwayDisplayLabel(preliminary.runway),
    cashGenerative: preliminary.runway.kind === "cash_generative",
    financialsUpdatedAt: clientRow?.financials_updated_at ?? null,
    lastForecastAt: clientRow?.last_forecast_at ?? null,
    reviewSignoffs,
    operatingProfile,
    benchmarkSector,
    market,
    budget,
    budgetActuals,
    budgetUpdatedAt,
    dataPeriodLabel,
    periodMonth: periodParts?.month ?? null,
    periodYear: periodParts?.year ?? null,
  };
  if (!clientRow?.financials) return baseEmpty;

  const rawFin = clientRow.financials as Record<string, string | number | null | object>;
  const debtRaw = (rawFin as Record<string, unknown>).debt_schedule;
  const fyStartMonth = operatingProfile?.fyStartMonth ?? market.fyStartMonthDefault;
  const fin = reportScalarInputs(rawFin as Record<string, unknown>, { fyStartMonth });
  // Keep debt_schedule as a JSON string key so buildLeverageData can parse it
  if (debtRaw != null) {
    fin["debt_schedule"] = typeof debtRaw === "string" ? debtRaw : JSON.stringify(debtRaw);
  }
  if (!fin["revenue"] || fin["revenue"].trim() === "") return { ...baseEmpty, financials: fin };

  const ratioInputs: RatioInputs = {
    revenue: fin["revenue"] ?? "",
    cogs: fin["cogs"] ?? "",
    ebit: fin["ebit"] ?? "",
    ebt: fin["ebt"] ?? "",
    netIncome: fin["netIncome"] ?? "",
    ebitda: fin["ebitda"] ?? "",
    operatingCashflow: fin["operatingCashflow"] ?? "",
    totalAssets: fin["totalAssets"] ?? "",
    equity: fin["equity"] ?? "",
    receivables: fin["receivables"] ?? "",
    inventory: fin["inventory"] ?? "",
    payables: fin["payables"] ?? "",
    fixedCosts: fin["fixedCosts"] ?? "",
    variableCosts: fin["variableCosts"] ?? "",
    top5Revenue: fin["top5Revenue"] ?? "",
    laborCost: fin["laborCost"] ?? "",
    employees: fin["employees"] ?? "",
    founderHours: fin["founderHours"] ?? "",
    totalLiabilities: fin["totalLiabilities"] ?? "",
    periodMonths: fin["periodMonths"] ?? "",
  };
  const rawRatios = withCanonicalDebtorCreditorDays(
    computeRatios(ratioInputs),
    rawFin as Record<string, unknown>,
  );
  const statementMeta = readStatementMeta(rawFin);
  const partMonth = Boolean(dataPeriodLabel?.includes("part month"));
  const periodMonths = effectivePeriodMonths(fin, { fyStartMonth });
  const equityNow = getNum(fin, "equity");
  const snapshots: DatedSnapshot[] = (snapshotRes.data ?? []).map((s) => ({
    period_label: s.period_label,
    period_date: s.period_date as string,
    ratios: (s.ratios as Record<string, number>) ?? {},
  }));
  const priorSnap = resolvePriorSnapshot(
    (snapshotRes.data ?? []).map((s) => ({
      id: s.id as string | undefined,
      period_label: s.period_label as string,
      period_date: s.period_date as string,
      financials: (s.financials as Record<string, unknown>) ?? null,
      ratios: (s.ratios as Record<string, number>) ?? null,
    })),
    new Date(),
    { periodEnd: statementMeta.periodEnd, financials: rawFin as Record<string, unknown> },
  );
  let ratioResults = buildRatioResults(rawRatios, market, {
    equity: equityNow,
    periodMonths,
    partMonth,
    cashFlowKnown: cashFlowKnown(fin),
  });
  ratioResults = withPriorRatioScores(ratioResults, priorSnap?.ratios ?? null);

  const priorEquityNum = (() => {
    const pe = priorSnap?.financials?.equity;
    if (pe == null || pe === "") return null;
    const n = typeof pe === "number" ? pe : parseFloat(String(pe));
    return Number.isFinite(n) ? n : null;
  })();

  const priorFinForProfit = priorSnap?.financials
    ? (Object.fromEntries(
        Object.entries(priorSnap.financials)
          .filter(([, v]) => v == null || typeof v !== "object")
          .map(([k, v]) => [k, v != null ? String(v) : ""]),
      ) as Record<string, string>)
    : null;

  const { rows: movementRows, labels: movementLabels } = buildMovementRows(
    rawRatios,
    snapshots,
    new Date(),
  );

  const assessed = assessClientMetrics({
    financials: rawFin as Record<string, unknown>,
    cashflow: clientRow.cashflow,
    financialsUpdatedAt: clientRow.financials_updated_at,
    priorFinancials: priorSnap?.financials ?? null,
    timeZone: market.timezone,
  });
  const healthWeeks =
    assessed.runway.kind === "weeks" || assessed.runway.kind === "zero"
      ? assessed.runway.weeks
      : null;
  const savedCashflow = (clientRow.cashflow ?? {}) as SavedCashflow;
  const cashOutlook = buildCashForecastFromSavedCashflow(
    savedCashflow,
    assessed.cash.amount,
    rawFin as Record<string, unknown>,
    assessed.runway,
    market.timezone,
  );
  const cashForecast = cashOutlook.weeks;
  // Floor is four weeks of the resolved outflows. A stored threshold from the
  // old annual-as-monthly series (about $170k) must not override that.
  const forecastMinimum = cashOutlook.minimum;
  const forecastReceipts = cashForecast?.reduce((sum, week) => sum + week.total_receipts, 0) ?? 0;
  const forecastPayments = cashForecast?.reduce((sum, week) => sum + week.total_payments, 0) ?? 0;
  const cashGenerative =
    assessed.runway.kind === "cash_generative" &&
    cashForecast != null &&
    forecastIsCashGenerative(forecastReceipts, forecastPayments);

  return {
    hasData: true,
    clientName: clientRow.name,
    cashRunwayWeeks: healthWeeks,
    runwayLabel: runwayDisplayLabel(assessed.runway),
    cashGenerative,
    forecastMinimum,
    financials: fin,
    rawRatios,
    ratioResults,
    workingCapital: buildWorkingCapitalData(fin, rawRatios),
    profitability: buildProfitabilityData(fin, priorFinForProfit),
    leverage: buildLeverageData(fin, rawRatios, priorEquityNum),
    assets: buildAssetData(rawRatios, {
      equity: equityNow,
      currency: market.currency,
      periodMonths,
      partMonth,
    }),
    labor: buildLaborData(fin, rawRatios, priorFinForProfit, market),
    movement: movementRows,
    movementPeriodLabels: movementLabels,
    benchmark: buildBenchmarkRows(rawRatios, ratioResults, sectorBench),
    cashForecast,
    financialsUpdatedAt: clientRow.financials_updated_at,
    lastForecastAt: clientRow.last_forecast_at,
    reviewSignoffs,
    operatingProfile,
    benchmarkSector,
    market,
    budget,
    budgetActuals,
    budgetUpdatedAt,
    dataPeriodLabel,
    periodMonth: periodParts?.month ?? null,
    periodYear: periodParts?.year ?? null,
  };
}

/** Freshness timestamp is null when there is nothing to be stale against yet. */
function isSignoffStale(signoff: ClientReviewSignoff | null, freshAt: string | null): boolean {
  if (!signoff) return true;
  if (!freshAt) return false;
  return new Date(freshAt).getTime() > new Date(signoff.signed_off_at).getTime();
}

function signoffFreshAt(scope: ReviewScope, cd: ClientReportData | null): string | null {
  if (!cd) return null;
  if (scope === "cash_forecast") return cd.lastForecastAt;
  if (scope === "budget") return cd.budgetUpdatedAt;
  return cd.financialsUpdatedAt;
}

/** Only current (non-stale) sign-offs are stamped onto a report footer. */
function signoffStampFor(
  scope: "financials" | "cash_forecast" | "profitability" | "budget",
  cd: ClientReportData | null,
): ReportSignoffStamp | null {
  if (!cd) return null;
  const signoff = cd.reviewSignoffs[scope];
  const freshAt = signoffFreshAt(scope, cd);
  if (!signoff || isSignoffStale(signoff, freshAt)) return null;
  return {
    signedOffByName: signoff.signed_off_by_name,
    signedOffByInitials: signoff.signed_off_by_initials ?? null,
    signedOffByTitle: signoff.signed_off_by_title,
    firmName: signoff.firm_name,
    signedOffAt: signoff.signed_off_at,
    signatureData: signoff.signature_data ?? null,
  };
}

/** G19 — drop prior columns when the Studio toggle is off. */
function stripPriorFromRatios(rows: RatioResult[]): RatioResult[] {
  return rows.map((r) => {
    const { prior_period_value: _pv, prior_period_score: _ps, ...rest } = r;
    return rest;
  });
}

function withoutPriorProfit(d: ProfitabilityData): ProfitabilityData {
  const { prior_period: _p, ...rest } = d;
  return rest;
}

function withoutPriorLabor(d: LaborProductivityData): LaborProductivityData {
  return { ...d, rpe_prior: null, revenue_growth: null };
}

function resolveBenchmarkSector(
  businessTypeId: string | null | undefined,
  operatingProfile: ClientOperatingProfile | null,
): { code: string; name: string } | null {
  const bt = businessTypeId ?? operatingProfile?.businessTypeId ?? null;
  if (!bt) return null;
  const sector = BUSINESS_TYPE_TO_BENCHMARK[bt];
  if (!sector) return null;
  return {
    code: `sector:${sector}`,
    name: clientIndustryLabel(operatingProfile, bt),
  };
}

// ── PDF generation helpers ─────────────────────────────────────────────────

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

async function renderToBlob(Component: unknown, props: unknown): Promise<Blob> {
  const { pdf } = await import("@react-pdf/renderer");
  const element = (Component as (p: unknown) => unknown)(props);
  return pdf(element as Parameters<typeof pdf>[0]).toBlob();
}

function periodFileSlug(label: string): string {
  return label
    .replace(/[–—]/g, "-")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function makeSafeFilename(s: Settings, reportName: string, periodLabel?: string | null): string {
  const sme = (s.smeName || "Client").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "");
  const period = periodFileSlug(periodLabel?.trim() || `${s.periodMonth} ${s.periodYear}`);
  return `${sme}_${period}_${reportName}.pdf`;
}

// ── Per-report generate functions ──────────────────────────────────────────

type GenFn = (s: Settings, profile: AccountantProfile) => Promise<Blob>;

/** Period label with a "Demo Data" suffix when real figures are unavailable. */
function makeSmeWithNote(
  s: Settings,
  isDemo: boolean,
  dataPeriod?: string | null,
): { name: string; period: string } {
  const live = dataPeriod?.trim() || `${s.periodMonth} ${s.periodYear}`;
  return {
    name: s.smeName || "Demo Client",
    period: isDemo
      ? `${s.periodMonth} ${s.periodYear} · Demo Data — upload financials for real figures`
      : live,
  };
}

function buildGEN(clientData: ClientReportData | null): Record<string, GenFn> {
  const cd = clientData?.hasData ? clientData : null;
  const operatingProfile = clientData?.operatingProfile ?? null;
  const market = clientData?.market ?? ZA_MARKET;
  const financialsStamp = signoffStampFor("financials", clientData);
  const forecastStamp = signoffStampFor("cash_forecast", clientData);
  const profitabilityStamp = signoffStampFor("profitability", clientData);

  /** Live client with hasData must never fall through to MOCK_* for a missing slice. */
  function liveOrDemo<T>(
    slice: T | null | undefined,
    missingMsg: string,
  ): { isDemo: boolean; data: T | null } {
    if (!cd) return { isDemo: true, data: null };
    if (slice == null) throw new Error(missingMsg);
    return { isDemo: false, data: slice };
  }

  return {
    scorecard: async (s, p) => {
      const { HealthScorecardPDF } = await import("@/reports/health-scorecard");
      if (cd && cd.ratioResults.length === 0) {
        throw new Error(
          "No scorable ratios yet — complete financials before generating the scorecard.",
        );
      }
      const isDemo = !cd;
      const ratioRows = (isDemo ? MOCK_RATIOS : cd!.ratioResults).map((row) =>
        row.unscored ? row : { ...row, health_tier: scoreTier(row.health_score) },
      );
      return renderToBlob(HealthScorecardPDF, {
        smeData: makeSmeWithNote(s, isDemo, cd?.dataPeriodLabel),
        ratioResults: s.includePrior ? ratioRows : stripPriorFromRatios(ratioRows),
        accountantProfile: p,
        isDemo,
        reviewSignoff: financialsStamp,
        operatingProfile,
        cashRunwayWeeks: isDemo ? null : (cd!.cashRunwayWeeks ?? null),
        market,
      });
    },
    intervention: async (s, p) => {
      const { InterventionPriorityPDF } = await import("@/reports/intervention-priority");
      if (cd && cd.ratioResults.length === 0) {
        throw new Error(
          "No scorable ratios yet — complete financials before generating interventions.",
        );
      }
      const isDemo = !cd;
      const interventions = isDemo
        ? MOCK_INTERVENTIONS
        : await buildInterventions(cd!.ratioResults, operatingProfile);
      return renderToBlob(InterventionPriorityPDF, {
        smeData: makeSmeWithNote(s, isDemo, cd?.dataPeriodLabel),
        interventions,
        accountantProfile: p,
        isDemo,
        reviewSignoff: financialsStamp,
        operatingProfile,
        market,
      });
    },
    forecast: async (s, p) => {
      const { CashForecastPDF } = await import("@/reports/cash-forecast");
      const { isDemo, data } = liveOrDemo(
        cd?.cashForecast,
        "No cash forecast saved for this client — configure the Cash tab before generating.",
      );
      return renderToBlob(CashForecastPDF, {
        smeData: makeSmeWithNote(s, isDemo, cd?.dataPeriodLabel),
        cashForecast: isDemo ? MOCK_FORECAST : data!,
        scenario: "moderate",
        accountantProfile: p,
        isDemo,
        reviewSignoff: forecastStamp,
        operatingProfile,
        market,
        minimumThreshold: isDemo ? undefined : cd?.forecastMinimum,
        runwayLabel: isDemo ? null : cd?.runwayLabel,
        cashGenerative: isDemo ? false : Boolean(cd?.cashGenerative),
      });
    },
    cycle: async (s, p) => {
      const { CashCyclePDF } = await import("@/reports/cash-cycle");
      const { isDemo, data } = liveOrDemo(
        cd?.workingCapital,
        "Working-capital report needs debtor/inventory days — add receivables and inventory.",
      );
      return renderToBlob(CashCyclePDF, {
        smeData: makeSmeWithNote(s, isDemo, cd?.dataPeriodLabel),
        workingCapitalData: isDemo ? MOCK_WC : data!,
        accountantProfile: p,
        isDemo,
        reviewSignoff: financialsStamp,
        operatingProfile,
        market,
      });
    },
    waterfall: async (s, p) => {
      const { ProfitabilityWaterfallPDF } = await import("@/reports/profitability-waterfall");
      const { isDemo, data } = liveOrDemo(
        cd?.profitability,
        "Profitability waterfall needs revenue, COGS, EBIT, and net income — never invents gross profit.",
      );
      return renderToBlob(ProfitabilityWaterfallPDF, {
        smeData: makeSmeWithNote(s, isDemo, cd?.dataPeriodLabel),
        profitabilityData: (() => {
          const d = isDemo ? MOCK_PROFIT : data!;
          return s.includePrior ? d : withoutPriorProfit(d);
        })(),
        accountantProfile: p,
        isDemo,
        reviewSignoff: profitabilityStamp,
        operatingProfile,
        market,
      });
    },
    leverage: async (s, p) => {
      const { LeverageSolvencyPDF } = await import("@/reports/leverage-solvency");
      const { isDemo, data } = liveOrDemo(
        cd?.leverage,
        LEVERAGE_REPORT_NEEDS,
      );
      return renderToBlob(LeverageSolvencyPDF, {
        smeData: makeSmeWithNote(s, isDemo, cd?.dataPeriodLabel),
        data: isDemo ? MOCK_LEVERAGE : data!,
        accountantProfile: p,
        isDemo,
        reviewSignoff: financialsStamp,
        operatingProfile,
        market,
      });
    },
    assets: async (s, p) => {
      const { AssetProductivityPDF } = await import("@/reports/asset-productivity");
      const { isDemo, data } = liveOrDemo(
        cd?.assets,
        ASSET_REPORT_NEEDS,
      );
      return renderToBlob(AssetProductivityPDF, {
        smeData: makeSmeWithNote(s, isDemo, cd?.dataPeriodLabel),
        data: isDemo ? MOCK_ASSETS : data!,
        accountantProfile: p,
        isDemo,
        reviewSignoff: financialsStamp,
        operatingProfile,
        market,
      });
    },
    labor: async (s, p) => {
      const { LaborProductivityPDF } = await import("@/reports/labor-productivity");
      // A live client without headcount or labor cost still gets the file.
      // The ZIP used to skip it when liveOrDemo threw.
      if (cd && !cd.labor) {
        return renderToBlob(LaborProductivityPDF, {
          smeData: makeSmeWithNote(s, false, cd?.dataPeriodLabel),
          data: null,
          unavailableReason: `${laborProductivityTitle(market)} is not scored — revenue, headcount, and ${laborCostLabel(market).toLowerCase()} are all missing.`,
          accountantProfile: p,
          isDemo: false,
          reviewSignoff: financialsStamp,
          operatingProfile,
          market,
        });
      }
      const isDemo = !cd;
      const laborData = isDemo ? MOCK_LABOR : cd!.labor!;
      return renderToBlob(LaborProductivityPDF, {
        smeData: makeSmeWithNote(s, isDemo, cd?.dataPeriodLabel),
        data: s.includePrior ? laborData : withoutPriorLabor(laborData),
        accountantProfile: p,
        isDemo,
        reviewSignoff: financialsStamp,
        operatingProfile,
        market,
      });
    },
    movement: async (s, p) => {
      const { RatioMovementPDF } = await import("@/reports/ratio-movement");
      // A live client with figures but no history still gets a report: the PDF
      // renders its own "first period on record" state instead of erroring.
      const isDemo = !cd;
      return renderToBlob(RatioMovementPDF, {
        smeData: makeSmeWithNote(s, isDemo, cd?.dataPeriodLabel),
        ratios: isDemo ? MOCK_MOVEMENT : cd!.movement,
        periodLabels: isDemo ? undefined : cd!.movementPeriodLabels,
        accountantProfile: p,
        isDemo,
        reviewSignoff: financialsStamp,
        operatingProfile,
        market,
      });
    },
    benchmark: async (s, p) => {
      const { BenchmarkReportPDF } = await import("@/reports/benchmark-report");
      // Live clients: title must match the sector used for rows — never the
      // Studio picker alone (which can disagree with industry_benchmarks).
      const industry = cd?.benchmarkSector
        ? cd.benchmarkSector
        : (INDUSTRIES.find((i) => i.code === s.industryCode) ?? INDUSTRIES[0]);
      if (cd && cd.benchmark.length === 0) {
        throw new Error(
          "No sector benchmarks available — set the client business type / profile, then regenerate.",
        );
      }
      const isDemo = !cd;
      return renderToBlob(BenchmarkReportPDF, {
        smeData: makeSmeWithNote(s, isDemo, cd?.dataPeriodLabel),
        industryCode: industry.code,
        industryName: cd?.benchmarkSector
          ? industry.name
          : operatingProfile
            ? clientIndustryLabel(operatingProfile, industry.name)
            : industry.name,
        benchmarkRows: isDemo ? MOCK_BENCHMARK : cd!.benchmark,
        accountantProfile: p,
        isDemo,
        reviewSignoff: financialsStamp,
        operatingProfile,
        market,
      });
    },
    budget: async (s, p) => {
      const { BudgetVariancePDF } = await import("@/reports/budget-variance");
      const isDemo = !cd;
      const pack = isDemo ? illustrativeBudgetPack() : null;
      const doc = isDemo ? pack!.doc : cd!.budget;
      if (!doc) {
        throw new Error(
          "No budget saved yet — open the Budget tab and save a plan before generating this PDF.",
        );
      }
      const model = buildBudgetPdfModel(doc, isDemo ? pack!.actuals : cd!.budgetActuals, market);
      const budgetStamp = signoffStampFor("budget", clientData);
      return renderToBlob(BudgetVariancePDF, {
        smeData: {
          name: isDemo ? s.smeName || "Demo Client" : cd!.clientName,
          period: isDemo
            ? `${model.periodLabel} · Demo Data — illustrative figures`
            : cd?.dataPeriodLabel || model.periodLabel,
        },
        model,
        accountantProfile: p,
        isDemo,
        draft: !isDemo && !budgetStamp,
        reviewSignoff: budgetStamp,
        market,
      });
    },
  };
}

// ── Report metadata ────────────────────────────────────────────────────────

type ReportMeta = {
  id: number;
  key: string;
  name: string;
  description: string;
  pages: string;
  category: "essential" | "optional";
  icon: React.ReactNode;
  iconBg: string;
  btnBg: string;
  filename: string;
};

const REPORTS: ReportMeta[] = [
  {
    id: reportNumber("scorecard"),
    key: "scorecard",
    name: "Financial Health Scorecard",
    description:
      "Overall score, four pillars, and every tracked ratio with tier badges and movement arrows.",
    pages: "2 pages",
    category: "essential",
    icon: <FileText className="h-4 w-4 text-blue-400" />,
    iconBg: "bg-blue-500/15",
    btnBg: "bg-blue-700 hover:bg-blue-800",
    filename: "HealthScorecard",
  },
  {
    id: reportNumber("intervention"),
    key: "intervention",
    name: "Priority Intervention Plan",
    description:
      "Ranked action steps per failing ratio — sorted critical-first, with effort and impact ratings.",
    pages: "2–3 pages",
    category: "essential",
    icon: <Lightbulb className="h-4 w-4 text-amber-400" />,
    iconBg: "bg-amber-500/15",
    btnBg: "bg-amber-600 hover:bg-amber-700",
    filename: "InterventionPlan",
  },
  {
    id: reportNumber("forecast"),
    key: "forecast",
    name: "13-Week Cash Flow Forecast",
    description:
      "Colour-coded bar chart, scenario badge, weekly data table, and assumptions section.",
    pages: "2 pages",
    category: "essential",
    icon: <BarChart2 className="h-4 w-4 text-violet-400" />,
    iconBg: "bg-violet-500/15",
    btnBg: "bg-violet-700 hover:bg-violet-800",
    filename: "CashForecast",
  },
  {
    id: reportNumber("cycle"),
    key: "cycle",
    name: "Cash Flow Cycle Report",
    description:
      "Visual cycle diagram (Inventory → WIP → Debtors), creditor offset, and cash-trapped callout.",
    pages: "2 pages",
    category: "essential",
    icon: <Droplets className="h-4 w-4 text-cyan-400" />,
    iconBg: "bg-cyan-500/15",
    btnBg: "bg-cyan-700 hover:bg-cyan-800",
    filename: "CashCycleReport",
  },
  {
    id: reportNumber("waterfall"),
    key: "waterfall",
    name: "Profitability Waterfall",
    description:
      "Revenue → Gross Profit → Operating Profit → EBT → Net Profit with tier badges and prior period compare.",
    pages: "2 pages",
    category: "essential",
    icon: <TrendingUp className="h-4 w-4 text-emerald-400" />,
    iconBg: "bg-emerald-500/15",
    btnBg: "bg-emerald-700 hover:bg-emerald-800",
    filename: "ProfitabilityWaterfall",
  },
  {
    id: reportNumber("leverage"),
    key: "leverage",
    name: "Leverage & Solvency",
    description:
      "Debt breakdown table, 5-year maturity bar chart, equity bridge, and financing ratio analysis.",
    pages: "1 page",
    category: "optional",
    icon: <ShieldCheck className="h-4 w-4 text-rose-400" />,
    iconBg: "bg-rose-500/15",
    btnBg: "bg-rose-700 hover:bg-rose-800",
    filename: "LeverageSolvency",
  },
  {
    id: reportNumber("assets"),
    key: "assets",
    name: "Asset Productivity",
    description:
      "DuPont ROE decomposition tree, Capex vs Depreciation trend, and asset ratio deep-dive.",
    pages: "2 pages",
    category: "optional",
    icon: <Layers className="h-4 w-4 text-indigo-400" />,
    iconBg: "bg-indigo-500/15",
    btnBg: "bg-indigo-700 hover:bg-indigo-800",
    filename: "AssetProductivity",
  },
  {
    id: reportNumber("labor"),
    key: "labor",
    name: "Labour Productivity",
    description:
      "Revenue per employee trend, GP per R1 of labour visual, and growth vs inflation comparison.",
    pages: "2 pages",
    category: "optional",
    icon: <Users className="h-4 w-4 text-teal-400" />,
    iconBg: "bg-teal-500/15",
    btnBg: "bg-teal-700 hover:bg-teal-800",
    filename: "LabourProductivity",
  },
  {
    id: reportNumber("movement"),
    key: "movement",
    name: "Ratio Movement",
    description:
      "All ratios across 4 time periods — red rows for sustained declines, amber for 3-period deterioration.",
    pages: "2–3 pages",
    category: "optional",
    icon: <BarChart className="h-4 w-4 text-orange-400" />,
    iconBg: "bg-orange-500/15",
    btnBg: "bg-orange-700 hover:bg-orange-800",
    filename: "RatioMovement",
  },
  {
    id: reportNumber("benchmark"),
    key: "benchmark",
    name: "Industry Benchmark Report",
    description:
      "Every ratio vs sector median and top quartile with position badges (Below / Above / Top Quartile).",
    pages: "2–3 pages",
    category: "optional",
    icon: <Trophy className="h-4 w-4 text-yellow-400" />,
    iconBg: "bg-yellow-500/15",
    btnBg: "bg-yellow-600 hover:bg-yellow-700",
    filename: "BenchmarkReport",
  },
  {
    id: reportNumber("budget"),
    key: "budget",
    name: "Budget & Variance",
    description:
      "FY plan versus uploaded month actuals — revenue, COGS, operating expenses, and profit, with over/under variance.",
    pages: "2–3 pages",
    category: "essential",
    icon: <Scale className="h-4 w-4 text-[#c9962b]" />,
    iconBg: "bg-[#c9962b]/15",
    btnBg: "bg-[#b8851f] hover:bg-[#a8791a]",
    filename: "BudgetVariance",
  },
];

const REPORT_SIGNOFF_SCOPE: Record<string, ReviewScope> = {
  scorecard: "financials",
  intervention: "financials",
  forecast: "cash_forecast",
  cycle: "cash_forecast",
  waterfall: "profitability",
  leverage: "financials",
  assets: "financials",
  labor: "financials",
  movement: "financials",
  benchmark: "financials",
  budget: "budget",
};

// ── Preview state ──────────────────────────────────────────────────────────

type PreviewState = {
  key: string;
  name: string;
  blobUrl: string | null;
  loading: boolean;
};

/** Card title and ZIP stem. Labor/Labour comes from the firm locale, in one place. */
function reportCopy(report: ReportMeta, market: ResolvedMarket = ZA_MARKET): {
  name: string;
  filename: string;
} {
  if (report.key === "labor") {
    return {
      name: laborProductivityTitle(market),
      filename: laborProductivityFileStem(market),
    };
  }
  return { name: localizeCopy(report.name, market), filename: report.filename };
}

// ── Report card ────────────────────────────────────────────────────────────

function ReportCard({
  report,
  isGenerating,
  isPreviewing,
  isClient,
  dataLoading,
  blocked,
  unavailableReason,
  highlight,
  onGenerate,
  onPreview,
  market = ZA_MARKET,
  signoff = null,
  signoffStale = false,
  clientId,
  clientName,
  onSignoffChange,
}: {
  report: ReportMeta;
  isGenerating: boolean;
  isPreviewing: boolean;
  isClient: boolean;
  dataLoading: boolean;
  blocked: boolean;
  /** Inputs are still missing after derived equity. Disable instead of failing on click. */
  unavailableReason?: string | null;
  highlight?: boolean;
  onGenerate: () => void;
  onPreview: () => void;
  market?: ResolvedMarket;
  signoff?: ClientReviewSignoff | null;
  signoffStale?: boolean;
  clientId?: string;
  clientName?: string;
  onSignoffChange?: (next: ClientReviewSignoff | null) => void;
}) {
  const gate = reportDownloadGate({
    ready: isClient,
    loading: dataLoading,
    blocked,
    unavailableReason,
  });
  const scope = REPORT_SIGNOFF_SCOPE[report.key];
  const copy = reportCopy(report, market);
  return (
    <div
      id={`report-card-${report.key}`}
      className={`report-card group flex flex-col ${
        highlight ? "report-card--on" : ""
      }`}
    >
      <div className="report-card__rule" />
      <div className="p-5 pb-3 flex-1">
        <div className="flex items-start gap-3">
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${report.iconBg}`}
          >
            {report.icon}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#b8860b]">
                #{String(report.id).padStart(2, "0")}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] ${report.category === "essential" ? "bg-[#c9962b]/12 text-[#a8791a] dark:text-[#e5c66b]" : "bg-muted text-muted-foreground"}`}
              >
                {report.category}
              </span>
              <span className="text-[10px] text-muted-foreground">{report.pages}</span>
            </div>
            <h3 className="report-card__title">
              {copy.name}
            </h3>
            <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
              {localizeCopy(report.description, market)}
            </p>
            {unavailableReason ? (
              <p className="mt-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
                {unavailableReason}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {clientId && scope && onSignoffChange ? (
        <div className="flex justify-end px-5 pb-2">
          <ReviewSignoffButton
            compact
            clientId={clientId}
            clientName={clientName}
            scope={scope}
            signoff={signoff}
            isStale={signoffStale}
            onChange={onSignoffChange}
          />
        </div>
      ) : null}

      <div className="flex gap-2 px-5 pb-5">
        <Button
          variant="outline"
          size="sm"
          className="flex-1 border-border bg-transparent text-foreground hover:bg-muted hover:text-foreground text-xs gap-1.5"
          onClick={() => {
            if (gate.disabled || isPreviewing) return;
            onPreview();
          }}
          disabled={gate.disabled || isPreviewing}
          title={isPreviewing ? "This report is already opening" : gate.title}
        >
          {isPreviewing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Eye className="h-3.5 w-3.5" />
          )}
          {dataLoading ? "Loading…" : "Preview"}
        </Button>
        <Button
          size="sm"
          className="flex-1 text-xs gap-1.5 bg-[#c9962b] text-white hover:bg-[#b8851f]"
          onClick={() => {
            if (gate.disabled || isGenerating) return;
            onGenerate();
          }}
          disabled={gate.disabled || isGenerating}
          title={
            isGenerating ? "This report is already downloading" : gate.title
          }
        >
          {isGenerating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
          Download
        </Button>
      </div>
    </div>
  );
}

// ── Settings panel ─────────────────────────────────────────────────────────

function SettingsPanel({
  settings,
  onChange,
  profile,
  clientSector = null,
  statementPeriod = null,
  nameExample,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  profile: AccountantProfile;
  /** When set (live client with business type), Benchmark PDF uses this — picker is display-only. */
  clientSector?: { code: string; name: string } | null;
  /** Statement span. Wins over the calendar month the studio opens on. */
  statementPeriod?: string | null;
  nameExample: string;
}) {
  const inputCls =
    "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-[#c9962b] focus:outline-none focus:ring-1 focus:ring-[#c9962b]/40";

  return (
    <div className="reports-settings space-y-5 sticky top-6">
      <div className="flex items-center gap-2">
        <Settings className="h-4 w-4 text-[#c9962b]" />
        <h2 className="text-sm font-semibold text-foreground">Report Settings</h2>
      </div>

      {/* SME Name */}
      <div>
        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Client / SME Name
        </label>
        <input
          className={inputCls}
          value={settings.smeName}
          onChange={(e) => onChange({ smeName: e.target.value })}
          placeholder={`e.g. ${nameExample}`}
        />
      </div>

      {/* Reporting period */}
      <div>
        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Reporting Period
        </label>
        {statementPeriod ? (
          <p className="mb-2 text-sm font-semibold text-foreground">{statementPeriod}</p>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          <Select value={settings.periodMonth} onValueChange={(v) => onChange({ periodMonth: v })}>
            <SelectTrigger className="border-input bg-background text-foreground text-sm h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              {MONTHS.map((m) => (
                <SelectItem key={m} value={m} className="text-popover-foreground focus:bg-muted">
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={settings.periodYear} onValueChange={(v) => onChange({ periodYear: v })}>
            <SelectTrigger className="border-input bg-background text-foreground text-sm h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              {YEARS.map((y) => (
                <SelectItem key={y} value={y} className="text-popover-foreground focus:bg-muted">
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Industry */}
      <div>
        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Industry (Benchmark Report)
        </label>
        {clientSector ? (
          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5">
            <p className="text-sm font-medium text-foreground">{clientSector.name}</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              From this client&apos;s business type / profile — matches the sector benchmarks in the
              PDF.
            </p>
          </div>
        ) : (
          <Select
            value={settings.industryCode}
            onValueChange={(v) => onChange({ industryCode: v })}
          >
            <SelectTrigger className="border-input bg-background text-foreground text-sm h-9 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              {INDUSTRIES.map((i) => (
                <SelectItem
                  key={i.code}
                  value={i.code}
                  className="text-popover-foreground focus:bg-muted text-xs"
                >
                  {i.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Prior period toggle */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-foreground">Include Prior Period</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Show comparison columns in tables
          </p>
        </div>
        <Switch
          checked={settings.includePrior}
          onCheckedChange={(v) => onChange({ includePrior: v })}
          className="data-[state=checked]:bg-blue-600"
        />
      </div>

      <hr className="border-border" />

      {/* Brand preview */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Report Branding
        </p>
        {profile.firmName ? (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
            <div
              className="h-8 w-8 shrink-0 rounded"
              style={{ backgroundColor: profile.accentColor }}
            />
            <div>
              <p className="text-xs font-semibold text-foreground">{profile.firmName}</p>
              {profile.tagline && (
                <p className="text-[10px] text-muted-foreground">{profile.tagline}</p>
              )}
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-amber-900/40 bg-amber-950/20 px-3 py-2.5">
            <p className="text-xs text-amber-400">No brand configured</p>
            <p className="text-[10px] text-amber-500/70 mt-0.5">
              PDFs will use default Milōn branding
            </p>
          </div>
        )}
        <Link
          to="/settings/brand"
          className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ExternalLink className="h-3 w-3" />
          Brand Settings
        </Link>
      </div>
    </div>
  );
}

// ── Preview modal ──────────────────────────────────────────────────────────

function PreviewModal({
  state,
  onClose,
  onDownload,
}: {
  state: PreviewState | null;
  onClose: () => void;
  onDownload: () => void;
}) {
  return (
    <Dialog
      open={state !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-5xl h-[88vh] flex flex-col bg-background border-border p-0 gap-0">
        <DialogHeader className="flex-row items-center justify-between px-5 py-3 border-b border-border shrink-0 space-y-0">
          <DialogTitle className="text-sm font-semibold text-foreground">
            {state?.name ?? "Report Preview"}
          </DialogTitle>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 border-border text-foreground hover:bg-muted text-xs"
            onClick={onDownload}
          >
            <Download className="h-3.5 w-3.5" />
            Download
          </Button>
        </DialogHeader>

        <div className="flex-1 overflow-hidden bg-slate-100">
          {state?.loading ? (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">Generating PDF…</p>
              </div>
            </div>
          ) : state?.blobUrl ? (
            <iframe src={state.blobUrl} className="h-full w-full border-0" title={state.name} />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

// ── Playbook catalogue ──────────────────────────────────────────────────────

const PLAYBOOK_PILLARS = [
  { key: "profit", name: "Profitability", color: "#b45309" },
  { key: "financing", name: "Leverage & Financing", color: "#7c3aed" },
  { key: "cash", name: "Cash & Working Capital", color: "#047857" },
  { key: "assets", name: "Asset Productivity", color: "#1d4ed8" },
  { key: "labour", name: "Labour Productivity", color: "#0e7490" },
  { key: "risk", name: "Business Risk", color: "#dc2626" },
] as const;

type PlaybookPillarKey = (typeof PLAYBOOK_PILLARS)[number]["key"];

interface PlaybookRatio {
  ratio_key: string;
  ratio_name: string;
  pillar: PlaybookPillarKey;
  health_tier: "critical" | "at_risk" | "healthy";
  health_score: number;
  /** Live client has no scored value for this catalogue ratio. */
  unscored?: boolean;
}

const PLAYBOOK_RATIOS: PlaybookRatio[] = [
  // Profitability
  {
    ratio_key: "grossMargin",
    ratio_name: "Gross Profit Margin",
    pillar: "profit",
    health_tier: "at_risk",
    health_score: 62,
  },
  {
    ratio_key: "directCostsRatio",
    ratio_name: "Direct Cost Burden",
    pillar: "profit",
    health_tier: "at_risk",
    health_score: 58,
  },
  {
    ratio_key: "fixedCostRatio",
    ratio_name: "Fixed Cost Burden",
    pillar: "profit",
    health_tier: "healthy",
    health_score: 71,
  },
  {
    ratio_key: "netMargin",
    ratio_name: "Net Margin",
    pillar: "profit",
    health_tier: "at_risk",
    health_score: 68,
  },
  {
    ratio_key: "revenueGrowth",
    ratio_name: "Revenue Growth",
    pillar: "profit",
    health_tier: "at_risk",
    health_score: 41,
  },
  {
    ratio_key: "dol",
    ratio_name: "Operating Leverage",
    pillar: "profit",
    health_tier: "at_risk",
    health_score: 50,
  },
  // Financing
  {
    ratio_key: "interestBurden",
    ratio_name: "Interest Burden",
    pillar: "financing",
    health_tier: "healthy",
    health_score: 72,
  },
  {
    ratio_key: "debtToEquity",
    ratio_name: "Debt-to-Equity",
    pillar: "financing",
    health_tier: "at_risk",
    health_score: 67,
  },
  {
    ratio_key: "debtToAssets",
    ratio_name: "Debt-to-Assets",
    pillar: "financing",
    health_tier: "at_risk",
    health_score: 61,
  },
  // Cash & Working Capital
  {
    ratio_key: "currentRatio",
    ratio_name: "Current Ratio",
    pillar: "cash",
    health_tier: "critical",
    health_score: 28,
  },
  {
    ratio_key: "debtorDays",
    ratio_name: "Debtor Days",
    pillar: "cash",
    health_tier: "at_risk",
    health_score: 40,
  },
  {
    ratio_key: "creditorDays",
    ratio_name: "Creditor Days",
    pillar: "cash",
    health_tier: "healthy",
    health_score: 75,
  },
  {
    ratio_key: "wipDays",
    ratio_name: "WIP Days",
    pillar: "cash",
    health_tier: "healthy",
    health_score: 68,
  },
  {
    ratio_key: "workingCapitalFunding",
    ratio_name: "WC Funding Intensity",
    pillar: "cash",
    health_tier: "critical",
    health_score: 32,
  },
  {
    ratio_key: "ocfToEbitda",
    ratio_name: "Cash Quality",
    pillar: "cash",
    health_tier: "at_risk",
    health_score: 60,
  },
  // Assets
  {
    ratio_key: "assetReinvestmentRatio",
    ratio_name: "Asset Reinvestment",
    pillar: "assets",
    health_tier: "healthy",
    health_score: 68,
  },
  {
    ratio_key: "capexIntensity",
    ratio_name: "Capex Intensity",
    pillar: "assets",
    health_tier: "healthy",
    health_score: 71,
  },
  // Labour
  {
    ratio_key: "gpToLabor",
    ratio_name: "Labour ROI",
    pillar: "labour",
    health_tier: "at_risk",
    health_score: 64,
  },
  {
    ratio_key: "salesPerEmployee",
    ratio_name: "Revenue per Employee",
    pillar: "labour",
    health_tier: "healthy",
    health_score: 72,
  },
  // Risk
  {
    ratio_key: "customerConcentration",
    ratio_name: "Customer Dependency",
    pillar: "risk",
    health_tier: "at_risk",
    health_score: 52,
  },
];

const TIER_CHIP: Record<string, string> = {
  critical: "bg-red-950/60 text-red-400 border border-red-800",
  at_risk: "bg-amber-950/60 text-amber-400 border border-amber-800",
  healthy: "bg-emerald-950/60 text-emerald-400 border border-emerald-800",
};

const TIER_DOT: Record<string, string> = {
  critical: "bg-red-500",
  at_risk: "bg-amber-500",
  healthy: "bg-emerald-500",
};

// ── Playbook ratio card ─────────────────────────────────────────────────────

function PlaybookRatioCard({
  ratio,
  name,
  onClick,
}: {
  ratio: PlaybookRatio;
  name: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-lg border border-border bg-card hover:bg-muted/60 hover:border-[#c9962b]/50 transition-colors p-3 group"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-xs font-medium text-foreground leading-snug">{name}</p>
        <span
          className={`flex-shrink-0 inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
            ratio.unscored
              ? "border border-border bg-muted text-muted-foreground"
              : TIER_CHIP[ratio.health_tier]
          }`}
        >
          {ratio.unscored ? NOT_SCORED_LABEL : healthBandLabel(ratio.health_tier)}
        </span>
      </div>
      {/* Score bar */}
      <div className="h-1 rounded-full bg-muted mb-2">
        <div
          className={`h-1 rounded-full transition-all ${ratio.unscored ? "bg-slate-400" : TIER_DOT[ratio.health_tier]}`}
          style={{ width: `${ratio.unscored ? 0 : ratio.health_score}%` }}
        />
      </div>
      <p className="text-[10px] text-muted-foreground group-hover:text-foreground transition-colors">
        {ratio.unscored ? NOT_SCORED_LABEL : `Score ${ratio.health_score}`} · View steps →
      </p>
    </button>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────

/**
 * Increments `clients.reports_issued_count` when a report is actually
 * generated/downloaded from this studio. Best-effort: swallows the error if
 * the column doesn't exist yet (migration pending) or no client is linked.
 */
async function recordReportIssued(clientId: string | undefined) {
  if (!clientId) return;
  try {
    const { data, error: readErr } = await supabase
      .from("clients")
      .select("reports_issued_count")
      .eq("id", clientId)
      .maybeSingle();
    if (readErr) return;
    const next = (data?.reports_issued_count ?? 0) + 1;
    await supabase.from("clients").update({ reports_issued_count: next }).eq("id", clientId);
  } catch {
    // non-fatal — reports-issued is a stat, not a report-generation blocker
  }
}

export type ReportsStudioProps = {
  client?: string;
  clientId?: string;
  report?: string;
  action?: "preview" | "download";
  /** Render inside the client workspace Reports tab (no full-page chrome). */
  embedded?: boolean;
  /** Embedded deep-links call this instead of rewriting `/reports` search. */
  onSearchCleared?: () => void;
};

export function ReportsStudio({
  client: clientParam,
  clientId,
  report: reportParam,
  action: actionParam,
  embedded = false,
  onSearchCleared,
}: ReportsStudioProps) {
  const navigate = useNavigate();
  const { profile, firmId, brandLoading } = useAccountantProfile();
  const { user } = useAuth();
  const track = useTrack();
  const [isClient, setIsClient] = useState(false);
  const [settings, setSettings] = useState<Settings>({
    smeName: clientParam ?? "",
    periodMonth: MONTHS[new Date().getMonth()],
    periodYear: String(new Date().getFullYear()),
    industryCode: INDUSTRIES[0].code,
    includePrior: true,
  });
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<PreviewState | null>(() => {
    // Deep-link: open the preview shell immediately so the catalogue does not flash first.
    if (
      typeof window !== "undefined" &&
      reportParam &&
      REPORT_KEYS.includes(reportParam as (typeof REPORT_KEYS)[number]) &&
      actionParam !== "download"
    ) {
      const r = REPORTS.find((x) => x.key === reportParam);
      if (r) return { key: r.key, name: r.name, blobUrl: null, loading: true };
    }
    return null;
  });
  const [zipProgress, setZipProgress] = useState<{ done: number; total: number } | null>(null);
  const [playbookOpen, setPlaybookOpen] = useState(false);
  const [selectedPlaybook, setSelectedPlaybook] = useState<PlaybookRatio | null>(null);
  const [clientData, setClientData] = useState<ClientReportData | null>(null);
  const [dataLoading, setDataLoading] = useState(Boolean(clientId));
  const deepLinkHandled = useRef<string | null>(null);
  const deepLinkReport =
    reportParam && REPORT_KEYS.includes(reportParam as (typeof REPORT_KEYS)[number])
      ? (REPORTS.find((r) => r.key === reportParam) ?? null)
      : null;
  const [deepLinkBusy, setDeepLinkBusy] = useState(() => Boolean(deepLinkReport));
  const [firmClients, setFirmClients] = useState<Array<{ id: string; name: string }> | null>(null);
  const [firmMarket, setFirmMarket] = useState<ResolvedMarket>(ZA_MARKET);
  const needsClientPicker = !embedded;

  useEffect(() => {
    if (!needsClientPicker) return;
    if (brandLoading) return;
    if (!firmId) {
      setFirmClients([]);
      return;
    }
    let cancelled = false;
    Promise.all([
      supabase
        .from("clients")
        .select("id, name")
        .eq("firm_id", firmId)
        .order("created_at", { ascending: false }),
      supabase.from("firms").select("market").eq("id", firmId).maybeSingle(),
    ])
      .then(([clientsRes, firmRes]) => {
        if (cancelled) return;
        setFirmMarket(resolveMarket(coerceMarketSelection(firmRes.data?.market)));
        const rows = (clientsRes.data ?? []) as Array<{ id: string; name: string }>;
        setFirmClients(rows);
      })
      .catch(() => {
        if (!cancelled) setFirmClients([]);
      });
    return () => {
      cancelled = true;
    };
  }, [needsClientPicker, brandLoading, firmId]);

  useEffect(() => {
    if (!needsClientPicker || clientId || !firmClients?.length) return;
    const first = firmClients[0];
    void navigate({
      to: "/reports",
      search: {
        clientId: first.id,
        client: first.name,
        report: undefined,
        action: undefined,
      },
      replace: true,
    });
  }, [needsClientPicker, clientId, firmClients, navigate]);

  const showIllustrativeDemo =
    needsClientPicker && !clientId && firmClients !== null && firmClients.length === 0;
  const resolvingClient =
    needsClientPicker && !clientId && (firmClients === null || firmClients.length > 0);

  useEffect(() => {
    if (!showIllustrativeDemo) return;
    setSettings((prev) =>
      prev.smeName.trim()
        ? prev
        : { ...prev, smeName: t("entityExample", firmMarket) },
    );
  }, [showIllustrativeDemo, firmMarket]);

  /** Client-linked studio never ships mock figures — upload first. */
  const blockedForClient = Boolean(clientId) && !dataLoading && !clientData?.hasData;
  const unavailableFor = (key: string): string | null => {
    if (!clientData?.hasData) return null;
    if (key === "leverage" && !clientData.leverage) return LEVERAGE_REPORT_NEEDS;
    if (key === "assets" && !clientData.assets) return ASSET_REPORT_NEEDS;
    return null;
  };
  const studioBusy = dataLoading || resolvingClient;
  const zipGate = reportDownloadGate({
    ready: isClient,
    loading: studioBusy,
    blocked: blockedForClient,
  });

  const patchStudioSignoff = (scope: ReviewScope) => (next: ClientReviewSignoff | null) => {
    setClientData((cd) =>
      cd
        ? {
            ...cd,
            reviewSignoffs: {
              ...cd.reviewSignoffs,
              [scope]: next,
            },
          }
        : cd,
    );
  };

  function reportCardSignoff(r: ReportMeta) {
    const scope = REPORT_SIGNOFF_SCOPE[r.key];
    if (!clientId || !scope) return {};
    const signoff = clientData?.reviewSignoffs[scope as keyof typeof clientData.reviewSignoffs] ?? null;
    const freshAt = signoffFreshAt(scope, clientData);
    return {
      clientId,
      clientName: clientData?.clientName ?? clientParam,
      signoff,
      signoffStale: isSignoffStale(signoff, freshAt),
      onSignoffChange: patchStudioSignoff(scope),
    };
  }

  function openPlaybook(ratio: PlaybookRatio) {
    setSelectedPlaybook(ratio);
    setPlaybookOpen(true);
  }

  useEffect(() => {
    setIsClient(true);
  }, []);

  // Open preview shell immediately for deep-links (avoids catalogue flash).
  useEffect(() => {
    if (!deepLinkReport) return;
    if (actionParam === "download") {
      setLoadingKey(deepLinkReport.key);
      setDeepLinkBusy(true);
      return;
    }
    setPreviewKey(deepLinkReport.key);
    setPreviewState((prev) =>
      prev?.key === deepLinkReport.key
        ? prev
        : {
            key: deepLinkReport.key,
            name: reportCopy(deepLinkReport).name,
            blobUrl: null,
            loading: true,
          },
    );
    setDeepLinkBusy(true);
  }, [deepLinkReport, actionParam]);

  // Load real client financials whenever clientId changes.
  // Clear stale data *immediately* so exports cannot use the previous client's
  // figures while the new request is in flight.
  useEffect(() => {
    if (!clientId) {
      setClientData(null);
      setDataLoading(false);
      return;
    }
    let cancelled = false;
    setClientData(null); // clear before async starts
    setDataLoading(true);
    deepLinkHandled.current = null;
    loadClientReportData(clientId)
      .then((data) => {
        if (cancelled) return;
        setClientData(data);
        // Keep smeName in sync with the client's real name if it differs
        if (data.clientName || data.periodMonth || data.dataPeriodLabel) {
          setSettings((prev) => ({
            ...prev,
            ...(data.clientName ? { smeName: data.clientName } : {}),
            ...(data.periodMonth && data.periodYear
              ? { periodMonth: data.periodMonth, periodYear: data.periodYear }
              : {}),
          }));
        }
      })
      .catch((err) => {
        console.error("Failed to load client report data:", err);
      })
      .finally(() => {
        if (!cancelled) setDataLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  // Build the GEN map from real client data (or null = demo data)
  const GEN = useMemo(() => buildGEN(clientData), [clientData]);
  const playbookRatios = useMemo(() => {
    // A linked client never shows the no-client demo scores (Creditor Days 75, …).
    if (!clientId) {
      return PLAYBOOK_RATIOS.map((row) => ({ ...row, health_tier: scoreTier(row.health_score) }));
    }
    if (!clientData?.hasData) {
      return PLAYBOOK_RATIOS.map((row) => ({ ...row, health_score: 0, unscored: true }));
    }
    return scorePlaybookCatalogue(PLAYBOOK_RATIOS, clientData.rawRatios, clientData.market);
  }, [clientId, clientData]);

  // Clean up blob URL on close
  const closePreview = useCallback(() => {
    if (previewState?.blobUrl) URL.revokeObjectURL(previewState.blobUrl);
    setPreviewState(null);
    setPreviewKey(null);
    setDeepLinkBusy(false);
  }, [previewState]);

  function assertCanGenerate(): boolean {
    if (!isClient || studioBusy) return false;
    if (blockedForClient) {
      toast.error(
        "Upload financials for this client before generating reports. Demo figures are never shipped under a client name.",
      );
      return false;
    }
    return true;
  }

  async function logReportDelivery(reportKey: string, pdfBlob?: Blob | null) {
    if (!user || !clientId) return;
    const snapId = await latestSnapshotId(clientId);
    const logged = await recordDelivery({
      clientId,
      firmId,
      channel: "pdf_download",
      kind: "report_pdf",
      reportKey,
      snapshotId: snapId,
      figuresHash: hashFigures({
        ratios: clientData?.rawRatios ?? null,
        runway: clientData?.cashRunwayWeeks ?? null,
        reportKey,
      }),
      periodLabel: clientData?.dataPeriodLabel || `${settings.periodMonth} ${settings.periodYear}`,
      createdBy: user.id,
      // ZIP is not a single PDF artifact — skip blob archive for zip_all.
      pdfBlob: reportKey === "zip_all" ? null : (pdfBlob ?? null),
    });
    warnIfDeliveryFailed(logged.error);
    warnIfPdfArchiveFailed(logged.pdfError);
  }

  // ── Generate single PDF ──────────────────────────────────────────────────

  async function handleGenerate(report: ReportMeta) {
    if (loadingKey) return;
    if (!assertCanGenerate()) return;
    setLoadingKey(report.key);
    try {
      const blob = await GEN[report.key](settings, profile);
      const copy = reportCopy(report, clientData?.market ?? ZA_MARKET);
      triggerDownload(blob, makeSafeFilename(settings, copy.filename, clientData?.dataPeriodLabel));
      toast.success(`${copy.name} downloaded.`);
      track("report_downloaded", {
        surface: "reports",
        clientId,
        firmId,
        reportKey: report.key,
      });
      await recordReportIssued(clientId);
      await logReportDelivery(report.key, blob);
    } catch (err) {
      toast.error(`Generation failed: ${(err as Error).message}`);
      console.error(err);
    } finally {
      setLoadingKey(null);
    }
  }

  // ── Preview single PDF ───────────────────────────────────────────────────

  async function handlePreview(report: ReportMeta): Promise<boolean> {
    if (!assertCanGenerate()) return false;
    if (previewState?.blobUrl) URL.revokeObjectURL(previewState.blobUrl);
    setPreviewKey(report.key);
    setPreviewState({
      key: report.key,
      name: reportCopy(report, clientData?.market ?? ZA_MARKET).name,
      blobUrl: null,
      loading: true,
    });
    try {
      const blob = await GEN[report.key](settings, profile);
      const url = URL.createObjectURL(blob);
      setPreviewState({
        key: report.key,
        name: reportCopy(report, clientData?.market ?? ZA_MARKET).name,
        blobUrl: url,
        loading: false,
      });
      track("report_previewed", {
        surface: "reports",
        clientId,
        firmId,
        reportKey: report.key,
      });
      return true;
    } catch (err) {
      toast.error(`Preview failed: ${(err as Error).message}`);
      console.error(err);
      setPreviewState(null);
      setPreviewKey(null);
      return false;
    }
  }

  function clearDeepLinkSearch() {
    onSearchCleared?.();
    if (embedded) return;
    void navigate({
      to: "/reports",
      search: {
        client: clientParam,
        clientId,
        report: undefined,
        action: undefined,
      },
      replace: true,
    });
  }

  // Deep-link from client gallery: /reports?clientId=&report=labor&action=preview|download
  useEffect(() => {
    if (!isClient || studioBusy) return;
    if (!deepLinkReport) {
      setDeepLinkBusy(false);
      return;
    }
    const token = `${clientId ?? "demo"}:${deepLinkReport.key}:${actionParam ?? "preview"}`;
    if (deepLinkHandled.current === token) return;

    if (blockedForClient) {
      deepLinkHandled.current = token;
      setDeepLinkBusy(false);
      setPreviewState(null);
      setPreviewKey(null);
      setLoadingKey(null);
      toast.error("Upload financials for this client before generating reports.");
      clearDeepLinkSearch();
      return;
    }

    deepLinkHandled.current = token;
    if (actionParam === "download") {
      void (async () => {
        try {
          await handleGenerate(deepLinkReport);
        } finally {
          setDeepLinkBusy(false);
          clearDeepLinkSearch();
        }
      })();
    } else {
      void (async () => {
        const ok = await handlePreview(deepLinkReport);
        if (!ok) {
          setDeepLinkBusy(false);
          clearDeepLinkSearch();
          return;
        }
        // Keep the focus shell until the user closes the preview modal — avoids
        // remounting PreviewModal when flipping to the full catalogue.
        if (!embedded) {
          void navigate({
            to: "/reports",
            search: {
              client: clientParam,
              clientId,
              report: deepLinkReport.key,
              action: undefined,
            },
            replace: true,
          });
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once per deep-link token
  }, [
    isClient,
    dataLoading,
    studioBusy,
    reportParam,
    actionParam,
    clientId,
    blockedForClient,
    clientData?.hasData,
  ]);

  // ── Generate all as ZIP ──────────────────────────────────────────────────

  async function handleGenerateAll() {
    if (!assertCanGenerate()) return;
    setZipProgress({ done: 0, total: REPORTS.length });
    try {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();

      for (let i = 0; i < REPORTS.length; i++) {
        const report = REPORTS[i];
        try {
          const blob = await GEN[report.key](settings, profile);
          const copy = reportCopy(report, clientData?.market ?? ZA_MARKET);
          zip.file(`${String(report.id).padStart(2, "0")}_${copy.filename}.pdf`, blob);
        } catch (err) {
          console.warn(`Skipping ${report.name}:`, err);
        }
        setZipProgress({ done: i + 1, total: REPORTS.length });
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const sme = (settings.smeName || "Client")
        .replace(/[^a-zA-Z0-9]+/g, "_")
        .replace(/^_|_$/g, "");
      const zipPeriod = periodFileSlug(
        clientData?.dataPeriodLabel || `${settings.periodMonth} ${settings.periodYear}`,
      );
      triggerDownload(zipBlob, `${sme}_${zipPeriod}_Reports.zip`);
      toast.success("All reports downloaded as ZIP.");
      await recordReportIssued(clientId);
      await logReportDelivery("zip_all");
    } catch (err) {
      toast.error(`ZIP generation failed: ${(err as Error).message}`);
      console.error(err);
    } finally {
      setZipProgress(null);
    }
  }

  const zipPct = zipProgress ? Math.round((zipProgress.done / zipProgress.total) * 100) : 0;
  const essential = REPORTS.filter((r) => r.category === "essential");
  const optional = REPORTS.filter((r) => r.category === "optional");

  // Deep-link focus: skip painting the full catalogue until preview/download finishes.
  if (deepLinkBusy && deepLinkReport) {
    return (
      <main
        className={`reports-studio flex flex-col items-center justify-center bg-background px-4 text-foreground ${embedded ? "min-h-[40vh] py-10" : "min-h-[100dvh]"}`}
      >
        <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 text-center shadow-sm">
          <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin text-[#c9962b]" />
          <p className="text-sm font-semibold text-foreground">
            {actionParam === "download" ? "Preparing download" : "Preparing preview"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {reportCopy(deepLinkReport, clientData?.market ?? ZA_MARKET).name}
          </p>
          {clientParam || clientData?.clientName ? (
            <p className="mt-3 text-[11px] text-muted-foreground">
              {clientData?.clientName ?? clientParam}
              {dataLoading ? " · loading figures…" : ""}
            </p>
          ) : null}
        </div>
        <PreviewModal
          state={previewState}
          onClose={() => {
            closePreview();
            clearDeepLinkSearch();
          }}
          onDownload={() => {
            if (previewState?.blobUrl) {
              const a = document.createElement("a");
              a.href = previewState.blobUrl;
              a.download = makeSafeFilename(
                settings,
                reportCopy(deepLinkReport, clientData?.market ?? ZA_MARKET).filename,
                clientData?.dataPeriodLabel,
              );
              a.click();
              return;
            }
            void handleGenerate(deepLinkReport);
          }}
        />
      </main>
    );
  }

  return (
    <main
      className={`reports-studio text-foreground ${embedded ? "bg-transparent px-0 py-2" : "min-h-[100dvh] bg-background px-4 py-8 sm:px-6"}`}
    >
      <div className="mx-auto max-w-[1400px]">
        {/* Back nav — standalone studio only */}
        {!embedded && (
          <div className="mb-7 flex items-center justify-between">
            <BackLink to="/dashboard" variant="subtle">
              Back to dashboard
            </BackLink>
            <ThemeToggle />
          </div>
        )}

        {/* Header */}
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Zap className="h-4 w-4 text-[#c9962b]" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Milōn Report Suite
              </span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Financial Reports
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Board-ready PDFs, branded with your firm&apos;s logo and colours. Sign each
              report off so the stamp carries into the pack.
            </p>
            {/* Client data status badge */}
            {clientId && (
              <div className="mt-2 flex items-center gap-1.5">
                {dataLoading ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                    <span className="text-[11px] text-muted-foreground">Loading client data…</span>
                  </>
                ) : clientData?.hasData ? (
                  <>
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    <span className="text-[11px] text-emerald-600 dark:text-emerald-400">
                      Live data — {clientData.clientName}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500" />
                    <span className="text-[11px] text-red-700 dark:text-red-400">
                      No financials — generate blocked. Upload figures on the client file first.
                    </span>
                  </>
                )}
              </div>
            )}
            {needsClientPicker && firmClients && firmClients.length > 0 && (
              <div className="mt-3 max-w-xs">
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Client
                </label>
                <Select
                  value={clientId ?? firmClients[0]?.id}
                  onValueChange={(id) => {
                    const chosen = firmClients.find((row) => row.id === id);
                    void navigate({
                      to: "/reports",
                      search: {
                        clientId: id,
                        client: chosen?.name,
                        report: undefined,
                        action: undefined,
                      },
                    });
                  }}
                >
                  <SelectTrigger className="h-9 border-input bg-background text-sm text-foreground">
                    <SelectValue placeholder="Choose a client" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    {firmClients.map((row) => (
                      <SelectItem
                        key={row.id}
                        value={row.id}
                        className="text-popover-foreground focus:bg-muted"
                      >
                        {row.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {resolvingClient && (
              <div className="mt-2 flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                <span className="text-[11px] text-muted-foreground">Choosing the latest client…</span>
              </div>
            )}
            {showIllustrativeDemo && (
              <div className="mt-2 flex items-center gap-1.5">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
                <span className="text-[11px] text-amber-700 dark:text-amber-400">
                  No clients on this firm yet — PDFs use illustrative demo data (watermarked).
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-col items-end gap-2">
            {zipProgress ? (
              <div className="w-60">
                <p className="text-xs text-muted-foreground mb-1.5">
                  Generating {zipProgress.done}/{zipProgress.total} reports…
                </p>
                <Progress value={zipPct} className="h-2 bg-muted" />
              </div>
            ) : (
              <Button
                className="gap-2 bg-[#c9962b] hover:bg-[#b8851f] font-semibold text-white"
                onClick={() => {
                  if (zipGate.disabled) return;
                  handleGenerateAll();
                }}
                disabled={zipGate.disabled}
                title={zipGate.title}
              >
                {studioBusy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading client data…
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4" />
                    Generate All as ZIP
                  </>
                )}
              </Button>
            )}
          </div>
        </div>

        {/* Main layout */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
          {/* Card grid */}
          <div className="space-y-6">
            {/* Essential */}
            <section>
              <div className="mb-3 flex items-center gap-2">
                <span className="rounded-full bg-[#c9962b]/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#a8791a] dark:text-[#e5c66b]">
                  Essential — {essential.length} Reports
                </span>
                <div className="flex-1 border-t border-border" />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {essential.map((r) => (
                  <ReportCard
                    key={r.key}
                    report={r}
                    isGenerating={loadingKey === r.key}
                    isPreviewing={previewKey === r.key}
                    isClient={isClient}
                    dataLoading={studioBusy}
                    blocked={blockedForClient}
                    unavailableReason={unavailableFor(r.key)}
                    highlight={reportParam === r.key}
                    onGenerate={() => handleGenerate(r)}
                    onPreview={() => handlePreview(r)}
                    market={clientData?.market ?? ZA_MARKET}
                    {...reportCardSignoff(r)}
                  />
                ))}
              </div>
            </section>

            {/* Optional */}
            <section>
              <div className="mb-3 flex items-center gap-2">
                <span className="rounded-full bg-muted px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Optional — {optional.length} Reports
                </span>
                <div className="flex-1 border-t border-border" />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {optional.map((r) => (
                  <ReportCard
                    key={r.key}
                    report={r}
                    isGenerating={loadingKey === r.key}
                    isPreviewing={previewKey === r.key}
                    isClient={isClient}
                    dataLoading={studioBusy}
                    blocked={blockedForClient}
                    unavailableReason={unavailableFor(r.key)}
                    highlight={reportParam === r.key}
                    onGenerate={() => handleGenerate(r)}
                    onPreview={() => handlePreview(r)}
                    market={clientData?.market ?? ZA_MARKET}
                    {...reportCardSignoff(r)}
                  />
                ))}
              </div>
            </section>

            {/* Playbooks */}
            <section>
              <div className="mb-3 flex items-center gap-2">
                <span className="rounded-full bg-violet-900/40 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-violet-400">
                  Playbooks — {playbookRatios.length} Action Plans
                </span>
                <div className="flex-1 border-t border-border" />
              </div>
              <p className="text-xs text-muted-foreground mb-5">
                Step-by-step recovery and optimisation plans for every ratio, tailored to the
                current health tier. Click any ratio to open its 10-step playbook.
              </p>
              <div className="space-y-5">
                {PLAYBOOK_PILLARS.map((pillar) => {
                  const ratios = playbookRatios.filter((r) => r.pillar === pillar.key);
                  if (!ratios.length) return null;
                  const playbookMarket = clientData?.market ?? firmMarket;
                  return (
                    <div key={pillar.key}>
                      <p
                        className="text-[10px] font-semibold uppercase tracking-widest mb-2"
                        style={{ color: pillar.color }}
                      >
                        {spellLabor(pillar.name, playbookMarket)}
                      </p>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {ratios.map((ratio) => (
                          <PlaybookRatioCard
                            key={ratio.ratio_key}
                            ratio={ratio}
                            name={spellLabor(ratio.ratio_name, playbookMarket)}
                            onClick={() => openPlaybook(ratio)}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>

          {/* Settings sidebar */}
          <SettingsPanel
            settings={settings}
            onChange={(patch) => setSettings((prev) => ({ ...prev, ...patch }))}
            profile={profile}
            clientSector={clientData?.hasData ? clientData.benchmarkSector : null}
            statementPeriod={clientData?.dataPeriodLabel ?? null}
            nameExample={t("entityExample", clientData?.market ?? firmMarket)}
          />
        </div>
      </div>

      {/* Playbook drawer */}
      <PlaybookDrawer
        ratioKey={selectedPlaybook?.ratio_key ?? null}
        ratioName={spellLabor(selectedPlaybook?.ratio_name ?? "", clientData?.market ?? firmMarket)}
        healthTier={selectedPlaybook?.health_tier ?? "at_risk"}
        open={playbookOpen}
        onClose={() => setPlaybookOpen(false)}
      />

      {/* Preview modal */}
      <PreviewModal
        state={previewState}
        onClose={closePreview}
        onDownload={() => {
          if (!previewState?.blobUrl) return;
          const report = REPORTS.find((r) => r.key === previewState.key);
          if (!report) return;
          const a = document.createElement("a");
          a.href = previewState.blobUrl;
          a.download = makeSafeFilename(
            settings,
            reportCopy(report, clientData?.market ?? ZA_MARKET).filename,
            clientData?.dataPeriodLabel,
          );
          a.click();
        }}
      />
    </main>
  );
}

function ReportsPage() {
  return <ReportsStudio {...Route.useSearch()} />;
}
