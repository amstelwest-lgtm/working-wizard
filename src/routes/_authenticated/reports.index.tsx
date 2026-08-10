import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useCallback, useMemo } from "react";
import { toast } from "sonner";
import {
  Download, Eye, Loader2, FileText, Lightbulb, BarChart2,
  Droplets, TrendingUp, ShieldCheck, Layers, Users,
  BarChart, Trophy, Settings, Zap, ExternalLink, ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { useAccountantProfile } from "@/contexts/accountant-profile";
import type { AccountantProfile } from "@/contexts/accountant-profile";
import { computeRatios, scoreTier } from "@/lib/ratios";
import type { RatioInputs } from "@/lib/ratios";
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
import type { ClientReviewSignoff } from "@/lib/review-signoffs.functions";
import type { ReportSignoffStamp } from "@/components/pdf/pdf-document";
import {
  parseOperatingProfile,
  type ClientOperatingProfile,
} from "@/lib/client-profile";
import {
  profileIndustryLabel,
  profilePriorityWeight,
} from "@/lib/profile-signals";

export const Route = createFileRoute("/_authenticated/reports/")({
  validateSearch: (search: Record<string, unknown>) => ({
    client: typeof search.client === "string" ? search.client : undefined,
    clientId: typeof search.clientId === "string" ? search.clientId : undefined,
  }),
  component: ReportsPage,
  head: () => ({ meta: [{ title: "Reports — Milōn" }] }),
});

// ── Constants ──────────────────────────────────────────────────────────────

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
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
  { ratio_key: "grossMargin", ratio_name: "Gross Margin", pillar: "profit", current_value: 0.38, health_score: 62, health_tier: "at_risk", prior_period_value: 0.35, prior_period_score: 54, formatted_value: "38.0%" },
  { ratio_key: "operatingMargin", ratio_name: "Operating Margin", pillar: "profit", current_value: 0.19, health_score: 76, health_tier: "healthy", prior_period_value: 0.17, prior_period_score: 68, formatted_value: "19.0%" },
  { ratio_key: "revenueGrowth", ratio_name: "Revenue Growth", pillar: "profit", current_value: 0.136, health_score: 41, health_tier: "at_risk", prior_period_value: 0.04, prior_period_score: 33, formatted_value: "13.6%" },
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
  { ratio_key: "currentRatio", ratio_name: "Current Ratio", health_tier: "critical", step_number: 1, step_title: "Build a 13-week rolling cash flow forecast", step_description: "Create a weekly cash projection covering the next 13 weeks. Update every Monday with actual vs. forecast figures.", timeframe: "1–2 weeks", effort: "Low", impact: "9/10", category: "cash" },
  { ratio_key: "workingCapitalFunding", ratio_name: "WC Funding", health_tier: "critical", step_number: 1, step_title: "Invoice immediately on job completion — same-day billing", step_description: "Set a business rule: every completed job is invoiced the same day. Late invoicing is the #1 cause of high working capital funding intensity.", timeframe: "1 week", effort: "Low", impact: "8/10", category: "cash" },
  { ratio_key: "debtorDays", ratio_name: "Debtor Days", health_tier: "at_risk", step_number: 1, step_title: "Launch a structured 3-stage debtor chasing schedule", step_description: "Implement a formal collection process: reminder at 25 days, phone call at 35 days, final notice at 45 days.", timeframe: "2 weeks", effort: "Medium", impact: "8/10", category: "cash" },
  { ratio_key: "grossMargin", ratio_name: "Gross Margin", health_tier: "at_risk", step_number: 1, step_title: "Raise prices on top 3 products by 5%", step_description: "A 5% price increase on top-selling lines goes straight to gross margin. Test on new customers first.", timeframe: "2–4 weeks", effort: "Low", impact: "10/10", category: "profit" },
];

const MOCK_FORECAST: CashForecastWeek[] = [
  { period_label: "Week 1", opening_balance: 245000, total_receipts: 185000, total_payments: 210000, net_movement: -25000, closing_balance: 220000, scenario: "moderate", runway_weeks: 13 },
  { period_label: "Week 2", opening_balance: 220000, total_receipts: 195000, total_payments: 205000, net_movement: -10000, closing_balance: 210000, scenario: "moderate", runway_weeks: 12 },
  { period_label: "Week 3", opening_balance: 210000, total_receipts: 165000, total_payments: 220000, net_movement: -55000, closing_balance: 155000, scenario: "moderate", runway_weeks: 11 },
  { period_label: "Week 4", opening_balance: 155000, total_receipts: 210000, total_payments: 195000, net_movement: 15000, closing_balance: 170000, scenario: "moderate", runway_weeks: 10 },
  { period_label: "Week 5", opening_balance: 170000, total_receipts: 145000, total_payments: 230000, net_movement: -85000, closing_balance: 85000, scenario: "moderate", runway_weeks: 9 },
  { period_label: "Week 6", opening_balance: 85000, total_receipts: 275000, total_payments: 195000, net_movement: 80000, closing_balance: 165000, scenario: "moderate", runway_weeks: 8 },
  { period_label: "Week 7", opening_balance: 165000, total_receipts: 155000, total_payments: 210000, net_movement: -55000, closing_balance: 110000, scenario: "moderate", runway_weeks: 7 },
  { period_label: "Week 8", opening_balance: 110000, total_receipts: 190000, total_payments: 195000, net_movement: -5000, closing_balance: 105000, scenario: "moderate", runway_weeks: 6 },
  { period_label: "Week 9", opening_balance: 105000, total_receipts: 160000, total_payments: 215000, net_movement: -55000, closing_balance: 50000, scenario: "moderate", runway_weeks: 5 },
  { period_label: "Week 10", opening_balance: 50000, total_receipts: 290000, total_payments: 195000, net_movement: 95000, closing_balance: 145000, scenario: "moderate", runway_weeks: 4 },
  { period_label: "Week 11", opening_balance: 145000, total_receipts: 175000, total_payments: 200000, net_movement: -25000, closing_balance: 120000, scenario: "moderate", runway_weeks: 3 },
  { period_label: "Week 12", opening_balance: 120000, total_receipts: 205000, total_payments: 195000, net_movement: 10000, closing_balance: 130000, scenario: "moderate", runway_weeks: 2 },
  { period_label: "Week 13", opening_balance: 130000, total_receipts: 215000, total_payments: 195000, net_movement: 20000, closing_balance: 150000, scenario: "moderate", runway_weeks: 1 },
];

const MOCK_WC: WorkingCapitalData = { debtor_days: 54, debtor_days_prior: 49, inventory_days: 47, inventory_days_prior: 52, wip_days: 12, wip_days_prior: 14, creditor_days: 35, creditor_days_prior: 33, cash_conversion_cycle: 78, ccc_prior: 82, working_capital_funding: 0.31, working_capital_utilization: 0.65, working_capital_days: 90, annual_revenue: 12_500_000, cash_trapped_rands: 854_167, health_scores: { debtor_days: 40, inventory_days: 55, creditor_days: 75, wip_days: 68, working_capital_days: 48, working_capital_funding: 32, working_capital_utilization: 58 } };

const MOCK_PROFIT: ProfitabilityData = { revenue: 12_500_000, gross_profit: 4_750_000, gross_margin_pct: 0.38, gross_margin_score: 62, gross_margin_tier: "at_risk", operating_profit: 2_375_000, operating_margin_pct: 0.19, operating_margin_score: 76, operating_margin_tier: "healthy", ebt: 2_218_750, interest_burden_pct: 0.177, interest_burden_score: 72, tax: 554_688, tax_burden_pct: 0.044, tax_burden_score: 74, net_profit: 1_664_063, net_margin_pct: 0.133, net_margin_score: 68, net_margin_tier: "at_risk", prior_period: { revenue: 11_000_000, gross_profit: 3_850_000, gross_margin_pct: 0.35, gross_margin_score: 54, operating_profit: 1_980_000, operating_margin_pct: 0.18, operating_margin_score: 68, ebt: 1_848_000, interest_burden_pct: 0.168, interest_burden_score: 65, tax: 462_000, tax_burden_pct: 0.042, tax_burden_score: 68, net_profit: 1_386_000, net_margin_pct: 0.126, net_margin_score: 62 } };

const MOCK_LEVERAGE: LeverageSolvencyData = { total_debt: 3_800_000, total_equity: 3_530_000, net_profit: 450_000, drawings: 120_000, prior_equity: 3_200_000, debt_lines: [{ label: "ABSA Business Term Loan", amount: 1_500_000, annual_rate_pct: 11.5, maturity_year: 2026 }, { label: "Working Capital Facility", amount: 850_000, annual_rate_pct: 13.0, maturity_year: 2025 }, { label: "Equipment Finance (John Deere)", amount: 950_000, annual_rate_pct: 9.8, maturity_year: 2028 }, { label: "Director Loan Account", amount: 500_000, annual_rate_pct: 0, maturity_year: 2027 }], health_scores: { fundingStructure: 52, equityMultiplier: 70, debtToEquity: 67, debtToAssets: 61, interestBurden: 72 } };

const MOCK_ASSETS: AssetProductivityData = { roe: 0.127, net_margin: 0.133, asset_turnover: 1.30, equity_multiplier: 2.1, capex_periods: [{ label: "Jun 2024", capex: 320_000, depreciation: 280_000 }, { label: "Sep 2024", capex: 180_000, depreciation: 285_000 }, { label: "Dec 2024", capex: 240_000, depreciation: 290_000 }, { label: "Jun 2025", capex: 410_000, depreciation: 295_000 }], health_scores: { assetTurnover: 74, roa: 83, fixedCapitalUtilization: 65, assetReinvestmentRatio: 68, capexIntensity: 71 }, ratios: { assetTurnover: { value: "1.30×" }, roa: { value: "14.0%" }, fixedCapitalUtilization: { value: "68.0%" }, assetReinvestmentRatio: { value: "1.39×" }, capexIntensity: { value: "3.3%" } } };

const MOCK_LABOR: LaborProductivityData = { employee_count: 47, total_labor_cost: 8_750_000, total_revenue: 12_500_000, total_gp: 4_750_000, revenue_per_employee: 265_957, rpe_prior: 244_444, gp_per_labor_rand: 0.543, revenue_growth: 0.136, inflation_rate: 0.057, periods: [{ label: "Jun 2024", revenue: 10_250_000, employees: 42, labor_cost: 7_350_000 }, { label: "Sep 2024", revenue: 10_800_000, employees: 44, labor_cost: 7_750_000 }, { label: "Dec 2024", revenue: 11_500_000, employees: 45, labor_cost: 8_200_000 }, { label: "Jun 2025", revenue: 12_500_000, employees: 47, labor_cost: 8_750_000 }], health_scores: { gpToLabor: 64, salesPerEmployee: 72, revenueGrowth: 41 } };

const MOCK_MOVEMENT: RatioMovementRow[] = [
  { ratio_key: "grossMargin", ratio_name: "Gross Margin", pillar: "profit", unit: "%", current: 0.38, three_months: 0.37, six_months: 0.36, twelve_months: 0.35 },
  { ratio_key: "operatingMargin", ratio_name: "Operating Margin", pillar: "profit", unit: "%", current: 0.19, three_months: 0.18, six_months: 0.18, twelve_months: 0.17 },
  { ratio_key: "revenueGrowth", ratio_name: "Revenue Growth", pillar: "profit", unit: "%", current: 0.136, three_months: 0.11, six_months: 0.08, twelve_months: 0.04 },
  { ratio_key: "fixedCostRatio", ratio_name: "Fixed Cost Ratio", pillar: "profit", unit: "%", current: 0.28, three_months: 0.29, six_months: 0.30, twelve_months: 0.31, lower_is_better: true },
  { ratio_key: "netMargin", ratio_name: "Net Margin", pillar: "profit", unit: "%", current: 0.133, three_months: 0.128, six_months: 0.121, twelve_months: 0.126 },
  { ratio_key: "assetTurnover", ratio_name: "Asset Turnover", pillar: "assets", unit: "×", current: 1.30, three_months: 1.27, six_months: 1.24, twelve_months: 1.22 },
  { ratio_key: "roa", ratio_name: "Return on Assets", pillar: "assets", unit: "%", current: 0.14, three_months: 0.135, six_months: 0.13, twelve_months: 0.12 },
  { ratio_key: "inventoryDays", ratio_name: "Inventory Days", pillar: "assets", unit: "d", current: 47, three_months: 49, six_months: 50, twelve_months: 52, lower_is_better: true },
  { ratio_key: "fcUtilization", ratio_name: "Fixed Capital Utilization", pillar: "assets", unit: "%", current: 0.68, three_months: 0.66, six_months: 0.65, twelve_months: 0.63 },
  { ratio_key: "capexIntensity", ratio_name: "Capex Intensity", pillar: "assets", unit: "%", current: 0.033, three_months: 0.028, six_months: 0.032, twelve_months: 0.025 },
  { ratio_key: "equityMultiplier", ratio_name: "Equity Multiplier", pillar: "financing", unit: "×", current: 2.1, three_months: 2.15, six_months: 2.2, twelve_months: 2.3, lower_is_better: true },
  { ratio_key: "debtToEquity", ratio_name: "Debt-to-Equity", pillar: "financing", unit: "×", current: 1.10, three_months: 1.15, six_months: 1.18, twelve_months: 1.20, lower_is_better: true },
  { ratio_key: "debtToAssets", ratio_name: "Debt-to-Assets", pillar: "financing", unit: "%", current: 0.52, three_months: 0.53, six_months: 0.54, twelve_months: 0.55, lower_is_better: true },
  { ratio_key: "interestBurden", ratio_name: "Interest Burden", pillar: "financing", unit: "%", current: 0.177, three_months: 0.182, six_months: 0.185, twelve_months: 0.168, lower_is_better: true },
  { ratio_key: "fundingStructure", ratio_name: "Funding Structure", pillar: "financing", unit: "%", current: 0.52, three_months: 0.53, six_months: 0.55, twelve_months: 0.55, lower_is_better: true },
  { ratio_key: "currentRatio", ratio_name: "Current Ratio", pillar: "cash", unit: "×", current: 1.15, three_months: 1.22, six_months: 1.32, twelve_months: 1.40 },
  { ratio_key: "debtorDays", ratio_name: "Debtor Days", pillar: "cash", unit: "d", current: 54, three_months: 52, six_months: 51, twelve_months: 49, lower_is_better: true },
  { ratio_key: "ocfToEbitda", ratio_name: "Cash Quality (OCF/EBITDA)", pillar: "cash", unit: "×", current: 0.72, three_months: 0.75, six_months: 0.77, twelve_months: 0.79 },
  { ratio_key: "wcFunding", ratio_name: "WC Funding Ratio", pillar: "cash", unit: "%", current: 0.31, three_months: 0.30, six_months: 0.28, twelve_months: 0.27, lower_is_better: true },
  { ratio_key: "ccc", ratio_name: "Cash Conversion Cycle", pillar: "cash", unit: "d", current: 78, three_months: 80, six_months: 81, twelve_months: 82, lower_is_better: true },
];

const MOCK_BENCHMARK: BenchmarkRow[] = [
  { ratio_key: "grossMargin", ratio_name: "Gross Margin", pillar: "profit", current_value: 0.38, formatted_current: "38.0%", health_score: 62, health_tier: "at_risk", sector_median: 0.32, sector_top_quartile: 0.45, formatted_median: "32.0%", formatted_top_quartile: "45.0%" },
  { ratio_key: "operatingMargin", ratio_name: "Operating Margin", pillar: "profit", current_value: 0.19, formatted_current: "19.0%", health_score: 76, health_tier: "healthy", sector_median: 0.12, sector_top_quartile: 0.22, formatted_median: "12.0%", formatted_top_quartile: "22.0%" },
  { ratio_key: "revenueGrowth", ratio_name: "Revenue Growth", pillar: "profit", current_value: 0.136, formatted_current: "13.6%", health_score: 41, health_tier: "at_risk", sector_median: 0.08, sector_top_quartile: 0.18, formatted_median: "8.0%", formatted_top_quartile: "18.0%" },
  { ratio_key: "netMargin", ratio_name: "Net Margin", pillar: "profit", current_value: 0.133, formatted_current: "13.3%", health_score: 68, health_tier: "at_risk", sector_median: 0.07, sector_top_quartile: 0.15, formatted_median: "7.0%", formatted_top_quartile: "15.0%" },
  { ratio_key: "assetTurnover", ratio_name: "Asset Turnover", pillar: "assets", current_value: 1.30, formatted_current: "1.30×", health_score: 74, health_tier: "healthy", sector_median: 1.10, sector_top_quartile: 1.45, formatted_median: "1.10×", formatted_top_quartile: "1.45×" },
  { ratio_key: "roa", ratio_name: "Return on Assets", pillar: "assets", current_value: 0.14, formatted_current: "14.0%", health_score: 83, health_tier: "healthy", sector_median: 0.09, sector_top_quartile: 0.16, formatted_median: "9.0%", formatted_top_quartile: "16.0%" },
  { ratio_key: "inventoryDays", ratio_name: "Inventory Days", pillar: "assets", current_value: 47, formatted_current: "47d", health_score: 55, health_tier: "at_risk", sector_median: 45, sector_top_quartile: 30, formatted_median: "45d", formatted_top_quartile: "30d", lower_is_better: true },
  { ratio_key: "equityMultiplier", ratio_name: "Equity Multiplier", pillar: "financing", current_value: 2.1, formatted_current: "2.10×", health_score: 70, health_tier: "healthy", sector_median: 2.3, sector_top_quartile: 1.8, formatted_median: "2.30×", formatted_top_quartile: "1.80×", lower_is_better: true },
  { ratio_key: "debtToEquity", ratio_name: "Debt-to-Equity", pillar: "financing", current_value: 1.1, formatted_current: "1.10×", health_score: 67, health_tier: "at_risk", sector_median: 1.05, sector_top_quartile: 0.7, formatted_median: "1.05×", formatted_top_quartile: "0.70×", lower_is_better: true },
  { ratio_key: "debtToAssets", ratio_name: "Debt-to-Assets", pillar: "financing", current_value: 0.52, formatted_current: "52.0%", health_score: 61, health_tier: "at_risk", sector_median: 0.48, sector_top_quartile: 0.35, formatted_median: "48.0%", formatted_top_quartile: "35.0%", lower_is_better: true },
  { ratio_key: "currentRatio", ratio_name: "Current Ratio", pillar: "cash", current_value: 1.15, formatted_current: "1.15×", health_score: 28, health_tier: "critical", sector_median: 1.50, sector_top_quartile: 2.10, formatted_median: "1.50×", formatted_top_quartile: "2.10×" },
  { ratio_key: "debtorDays", ratio_name: "Debtor Days", pillar: "cash", current_value: 54, formatted_current: "54d", health_score: 40, health_tier: "at_risk", sector_median: 45, sector_top_quartile: 30, formatted_median: "45d", formatted_top_quartile: "30d", lower_is_better: true },
  { ratio_key: "wcFunding", ratio_name: "WC Funding Ratio", pillar: "cash", current_value: 0.31, formatted_current: "31.0%", health_score: 32, health_tier: "critical", sector_median: 0.22, sector_top_quartile: 0.14, formatted_median: "22.0%", formatted_top_quartile: "14.0%", lower_is_better: true },
  { ratio_key: "ccc", ratio_name: "Cash Conversion Cycle", pillar: "cash", current_value: 78, formatted_current: "78d", health_score: 38, health_tier: "critical", sector_median: 55, sector_top_quartile: 38, formatted_median: "55d", formatted_top_quartile: "38d", lower_is_better: true },
];

// ── Client report data ─────────────────────────────────────────────────────

type ClientReportData = {
  hasData: boolean;
  clientName: string;
  cashRunwayWeeks: number | null;
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
  reviewSignoffs: { financials: ClientReviewSignoff | null; cash_forecast: ClientReviewSignoff | null };
  /** Owner 10Q profile — shapes report narratives / ordering, not layout. */
  operatingProfile: ClientOperatingProfile | null;
};

const DEFAULT_MOVEMENT_LABELS = {
  current: "Current",
  three_months: "3 Months Ago",
  six_months: "6 Months Ago",
  twelve_months: "12 Months Ago",
};

const EMPTY_CLIENT_DATA: ClientReportData = {
  hasData: false, clientName: "", cashRunwayWeeks: null,
  financials: {}, rawRatios: {}, ratioResults: [],
  workingCapital: null, profitability: null, leverage: null,
  assets: null, labor: null,
  movement: [], movementPeriodLabels: DEFAULT_MOVEMENT_LABELS,
  benchmark: [], cashForecast: null,
  financialsUpdatedAt: null, lastForecastAt: null,
  reviewSignoffs: { financials: null, cash_forecast: null },
  operatingProfile: null,
};

// ── Data-builder helpers ────────────────────────────────────────────────────

function getNum(fin: Record<string, string>, key: string): number {
  const v = fin[key];
  return v && v.trim() !== "" ? parseFloat(v) : NaN;
}

function scoreForRatio(name: string, val: number): number {
  if (!Number.isFinite(val)) return 50;
  if (name === "Net Margin")               return Math.min(100, Math.max(0, (val / 0.15) * 100));
  if (name === "Operating Margin")         return Math.min(100, Math.max(0, (val / 0.20) * 100));
  if (name === "Gross Margin")             return Math.min(100, Math.max(0, (val / 0.40) * 100));
  if (name === "Return on Assets")         return Math.min(100, Math.max(0, (val / 0.12) * 100));
  if (name === "Return on Equity")         return Math.min(100, Math.max(0, (val / 0.20) * 100));
  if (name === "Asset Turnover")           return Math.min(100, Math.max(0, (val / 1.5)  * 100));
  if (name === "Debtor Days")              return Math.min(100, Math.max(0, ((90 - val) / 90) * 100));
  if (name === "Inventory Days")           return Math.min(100, Math.max(0, ((90 - val) / 90) * 100));
  if (name === "Creditor Days")            return Math.min(100, Math.max(0, (val / 60) * 100));
  if (name === "Working Capital Days")     return Math.min(100, Math.max(0, ((90 - val) / 90) * 100));
  if (name === "OCF / EBITDA")             return Math.min(100, Math.max(0, val * 100));
  if (name === "Interest Burden")          return Math.min(100, Math.max(0, val * 100));
  if (name === "Equity Multiplier")        return Math.min(100, Math.max(0, ((4 - val) / 3) * 100));
  if (name === "Gross Profit / Labor")     return Math.min(100, Math.max(0, (val / 0.6) * 100));
  if (name === "Sales-per-Employee Ratio") return Math.min(100, Math.max(0, (val / 300_000) * 100));
  return 50;
}

function fmtRatioVal(name: string, val: number): string {
  if (!Number.isFinite(val)) return "—";
  if (name.includes("Days")) return `${Math.round(val)}d`;
  if (name === "Asset Turnover" || name === "Equity Multiplier" ||
      name === "Degree of Operating Leverage" || name === "OCF / EBITDA")
    return `${val.toFixed(2)}×`;
  return `${(val * 100).toFixed(1)}%`;
}

function pillarForRatio(name: string): "profit" | "assets" | "financing" | "cash" {
  if (name.includes("Margin") || name.includes("Growth") ||
      name.includes("Leverage") || name.includes("Labor") || name.includes("Customer"))
    return "profit";
  if (name.includes("Days") || name.includes("Capital") || name.includes("OCF"))
    return "cash";
  if ((name.includes("Equity") && !name.includes("Return")) ||
      name.includes("Multiplier") || name.includes("Burden") || name.includes("Debt"))
    return "financing";
  return "assets";
}

function buildRatioResults(rawRatios: Record<string, number>): RatioResult[] {
  return Object.entries(rawRatios)
    .filter(([, v]) => Number.isFinite(v))
    .map(([name, val]) => {
      const score = Math.round(scoreForRatio(name, val));
      return {
        ratio_key: name.toLowerCase().replace(/[^a-z0-9]/g, "_"),
        ratio_name: name,
        pillar: pillarForRatio(name),
        current_value: val,
        health_score: score,
        health_tier: scoreTier(score),
        formatted_value: fmtRatioVal(name, val),
      };
    });
}

// Static ZA-SME baseline benchmarks (industry-neutral)
const BENCH_META: Record<string, {
  median: number; top: number; lower?: boolean;
  unit: string; pillar: "profit" | "assets" | "financing" | "cash";
}> = {
  "Gross Margin":         { median: 0.32, top: 0.45, unit: "%", pillar: "profit" },
  "Operating Margin":     { median: 0.12, top: 0.22, unit: "%", pillar: "profit" },
  "Net Margin":           { median: 0.07, top: 0.15, unit: "%", pillar: "profit" },
  "Asset Turnover":       { median: 1.10, top: 1.45, unit: "×", pillar: "assets" },
  "Return on Assets":     { median: 0.09, top: 0.16, unit: "%", pillar: "assets" },
  "Inventory Days":       { median: 45,   top: 30,   lower: true, unit: "d",  pillar: "assets" },
  "Equity Multiplier":    { median: 2.3,  top: 1.8,  lower: true, unit: "×",  pillar: "financing" },
  "Debtor Days":          { median: 45,   top: 30,   lower: true, unit: "d",  pillar: "cash" },
  "Working Capital Days": { median: 55,   top: 38,   lower: true, unit: "d",  pillar: "cash" },
  "OCF / EBITDA":         { median: 0.70, top: 0.90, unit: "×",  pillar: "cash" },
};

function fmtBenchVal(val: number, unit: string): string {
  if (unit === "%") return `${(val * 100).toFixed(1)}%`;
  if (unit === "×") return `${val.toFixed(2)}×`;
  return `${Math.round(val)}d`;
}

function buildBenchmarkRows(rawRatios: Record<string, number>, ratioResults: RatioResult[]): BenchmarkRow[] {
  return Object.entries(BENCH_META)
    .filter(([name]) => Number.isFinite(rawRatios[name]))
    .map(([name, b]) => {
      const val = rawRatios[name];
      const rr  = ratioResults.find((r) => r.ratio_name === name);
      const score = rr?.health_score ?? Math.round(scoreForRatio(name, val));
      return {
        ratio_key: name.toLowerCase().replace(/[^a-z0-9]/g, "_"),
        ratio_name: name,
        pillar: b.pillar,
        current_value: val,
        formatted_current: fmtBenchVal(val, b.unit),
        health_score: score,
        health_tier: scoreTier(score),
        sector_median: b.median,
        sector_top_quartile: b.top,
        formatted_median: fmtBenchVal(b.median, b.unit),
        formatted_top_quartile: fmtBenchVal(b.top, b.unit),
        lower_is_better: b.lower,
      } as BenchmarkRow;
    });
}

// Ratio Movement row definitions
const MOVEMENT_META: Array<{
  name: string; key: string;
  pillar: "profit" | "assets" | "financing" | "cash";
  unit: string; lower?: boolean;
}> = [
  { name: "Gross Margin",         key: "gross_margin",          pillar: "profit",    unit: "%" },
  { name: "Operating Margin",     key: "operating_margin",      pillar: "profit",    unit: "%" },
  { name: "Net Margin",           key: "net_margin",            pillar: "profit",    unit: "%" },
  { name: "Asset Turnover",       key: "asset_turnover",        pillar: "assets",    unit: "×" },
  { name: "Return on Assets",     key: "return_on_assets",      pillar: "assets",    unit: "%" },
  { name: "Inventory Days",       key: "inventory_days",        pillar: "assets",    unit: "d", lower: true },
  { name: "Equity Multiplier",    key: "equity_multiplier",     pillar: "financing", unit: "×", lower: true },
  { name: "Debtor Days",          key: "debtor_days",           pillar: "cash",      unit: "d", lower: true },
  { name: "Working Capital Days", key: "working_capital_days",  pillar: "cash",      unit: "d", lower: true },
  { name: "OCF / EBITDA",         key: "ocf_ebitda",            pillar: "cash",      unit: "×" },
];

type DatedSnapshot = {
  period_label: string;
  period_date: string;          // ISO YYYY-MM-DD
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
  const t3m  = new Date(refDate); t3m.setMonth(t3m.getMonth() - 3);
  const t6m  = new Date(refDate); t6m.setMonth(t6m.getMonth() - 6);
  const t12m = new Date(refDate); t12m.setFullYear(t12m.getFullYear() - 1);

  // ±45 days window for 3m/6m; ±60 days for 12m
  const s3m  = closestSnapshot(snapshots, t3m,  45);
  const s6m  = closestSnapshot(snapshots, t6m,  45);
  const s12m = closestSnapshot(snapshots, t12m, 60);

  const labels: ClientReportData["movementPeriodLabels"] = {
    current:      "Current",
    three_months: s3m  ? s3m.period_label  : "3 Months Ago",
    six_months:   s6m  ? s6m.period_label  : "6 Months Ago",
    twelve_months:s12m ? s12m.period_label : "12 Months Ago",
  };

  const rows = MOVEMENT_META
    .filter(({ name }) => Number.isFinite(rawRatios[name]))
    .map(({ name, key, pillar, unit, lower }) => ({
      ratio_key: key,
      ratio_name: name,
      pillar,
      unit,
      current:       rawRatios[name],
      three_months:  s3m  && s3m.ratios[name]  != null ? Number(s3m.ratios[name])  : null,
      six_months:    s6m  && s6m.ratios[name]  != null ? Number(s6m.ratios[name])  : null,
      twelve_months: s12m && s12m.ratios[name] != null ? Number(s12m.ratios[name]) : null,
      lower_is_better: lower,
    } as RatioMovementRow));

  return { rows, labels };
}

function buildWorkingCapitalData(
  fin: Record<string, string>,
  rawRatios: Record<string, number>,
): WorkingCapitalData | null {
  const revenue = getNum(fin, "revenue");
  if (!Number.isFinite(revenue) || revenue <= 0) return null;
  const dd = Number.isFinite(rawRatios["Debtor Days"])    ? rawRatios["Debtor Days"]    : 0;
  const id = Number.isFinite(rawRatios["Inventory Days"]) ? rawRatios["Inventory Days"] : 0;
  const cd = Number.isFinite(rawRatios["Creditor Days"])  ? rawRatios["Creditor Days"]  : 0;
  if (!Number.isFinite(rawRatios["Debtor Days"]) && !Number.isFinite(rawRatios["Inventory Days"])) return null;
  const ccc = dd + id - cd;
  const wcFunding = ccc / 365;
  return {
    debtor_days: dd, inventory_days: id, wip_days: 0, creditor_days: cd,
    cash_conversion_cycle: ccc,
    working_capital_funding: wcFunding,
    working_capital_utilization: Math.min(1, Math.max(0, wcFunding * 2)),
    working_capital_days: ccc,
    annual_revenue: revenue,
    cash_trapped_rands: revenue * Math.max(0, wcFunding),
    health_scores: {
      debtor_days:              Math.round(scoreForRatio("Debtor Days", dd)),
      inventory_days:           Math.round(scoreForRatio("Inventory Days", id)),
      creditor_days:            Math.round(scoreForRatio("Creditor Days", cd)),
      wip_days:                 68,
      working_capital_days:     Math.round(scoreForRatio("Working Capital Days", ccc)),
      working_capital_funding:  Math.round(Math.min(100, Math.max(0, (1 - wcFunding) * 100))),
      working_capital_utilization: Math.round(Math.min(100, Math.max(0, (1 - wcFunding) * 90))),
    },
  };
}

function buildProfitabilityData(fin: Record<string, string>): ProfitabilityData | null {
  const revenue = getNum(fin, "revenue");
  const cogs    = getNum(fin, "cogs");
  const ebit    = getNum(fin, "ebit");
  const ebt     = getNum(fin, "ebt");
  const net     = getNum(fin, "netIncome");
  if (!Number.isFinite(revenue) || !Number.isFinite(ebit) || !Number.isFinite(net)) return null;
  const gp    = Number.isFinite(cogs) ? revenue - cogs : revenue * 0.5;
  const gmPct = gp / revenue;
  const omPct = ebit / revenue;
  const ebtVal = Number.isFinite(ebt) ? ebt : ebit;
  const ibPct  = ebit > 0 ? Math.max(0, (ebit - ebtVal) / ebit) : 0;
  const tax    = Math.max(0, ebtVal - net);
  const tbPct  = ebtVal > 0 ? tax / ebtVal : 0;
  const nmPct  = net / revenue;
  return {
    revenue, gross_profit: gp, gross_margin_pct: gmPct,
    gross_margin_score: Math.round(scoreForRatio("Gross Margin", gmPct)),
    gross_margin_tier:  scoreTier(Math.round(scoreForRatio("Gross Margin", gmPct))),
    operating_profit: ebit, operating_margin_pct: omPct,
    operating_margin_score: Math.round(scoreForRatio("Operating Margin", omPct)),
    operating_margin_tier:  scoreTier(Math.round(scoreForRatio("Operating Margin", omPct))),
    ebt: ebtVal,
    interest_burden_pct:   ibPct,
    interest_burden_score: Math.round(scoreForRatio("Interest Burden", 1 - ibPct)),
    tax, tax_burden_pct: tbPct,
    tax_burden_score: Math.round(Math.max(0, 100 - tbPct * 100)),
    net_profit: net, net_margin_pct: nmPct,
    net_margin_score: Math.round(scoreForRatio("Net Margin", nmPct)),
    net_margin_tier:  scoreTier(Math.round(scoreForRatio("Net Margin", nmPct))),
  };
}

function buildLeverageData(
  fin: Record<string, string>,
  rawRatios: Record<string, number>,
): LeverageSolvencyData | null {
  const equity      = getNum(fin, "equity");
  const totalAssets = getNum(fin, "totalAssets");
  const net         = getNum(fin, "netIncome");
  if (!Number.isFinite(equity) || !Number.isFinite(totalAssets)) return null;
  const totalDebt = Math.max(0, totalAssets - equity);
  const d2a = totalDebt / totalAssets;
  const d2e = equity > 0 ? totalDebt / equity : NaN;
  const em  = rawRatios["Equity Multiplier"];
  const ib  = rawRatios["Interest Burden"];
  return {
    total_debt: totalDebt, total_equity: equity,
    net_profit: Number.isFinite(net) ? net : 0,
    drawings: 0,
    prior_equity: equity * 0.92,
    debt_lines: totalDebt > 0 ? [{
      label: "Total Borrowings",
      amount: totalDebt,
      annual_rate_pct: 12.5,
      maturity_year: new Date().getFullYear() + 3,
    }] : [],
    health_scores: {
      fundingStructure: Math.round(Math.min(100, Math.max(0, (1 - d2a) * 100))),
      equityMultiplier: Number.isFinite(em) ? Math.round(scoreForRatio("Equity Multiplier", em)) : 50,
      debtToEquity:     Number.isFinite(d2e) ? Math.round(Math.min(100, Math.max(0, ((2 - d2e) / 2) * 100))) : 50,
      debtToAssets:     Math.round(Math.min(100, Math.max(0, (1 - d2a) * 100))),
      interestBurden:   Number.isFinite(ib) ? Math.round(ib * 100) : 50,
    },
  };
}

function buildAssetData(rawRatios: Record<string, number>): AssetProductivityData | null {
  const at = rawRatios["Asset Turnover"];
  const em = rawRatios["Equity Multiplier"];
  const nm = rawRatios["Net Margin"];
  if (!Number.isFinite(at) || !Number.isFinite(em) || !Number.isFinite(nm)) return null;
  const roa = nm * at;
  const roe = roa * em;
  return {
    roe, net_margin: nm, asset_turnover: at, equity_multiplier: em,
    capex_periods: [],
    health_scores: {
      assetTurnover:           Math.round(scoreForRatio("Asset Turnover", at)),
      roa:                     Math.round(scoreForRatio("Return on Assets", roa)),
      fixedCapitalUtilization: 60,
      assetReinvestmentRatio:  60,
      capexIntensity:          65,
    },
    ratios: {
      assetTurnover:           { value: `${at.toFixed(2)}×` },
      roa:                     { value: `${(roa * 100).toFixed(1)}%` },
      fixedCapitalUtilization: { value: "—" },
      assetReinvestmentRatio:  { value: "—" },
      capexIntensity:          { value: "—" },
    },
  };
}

function buildLaborData(
  fin: Record<string, string>,
  rawRatios: Record<string, number>,
): LaborProductivityData | null {
  const revenue   = getNum(fin, "revenue");
  const laborCost = getNum(fin, "laborCost");
  const employees = getNum(fin, "employees");
  const cogs      = getNum(fin, "cogs");
  if (!Number.isFinite(revenue) || !Number.isFinite(employees) ||
      !Number.isFinite(laborCost) || employees <= 0 || laborCost <= 0) return null;
  const gp        = Number.isFinite(cogs) ? revenue - cogs : revenue * 0.5;
  const rpe       = revenue / employees;
  const gpPerLabor = gp / laborCost;
  return {
    employee_count: Math.round(employees),
    total_labor_cost: laborCost,
    total_revenue: revenue,
    total_gp: gp,
    revenue_per_employee: rpe,
    rpe_prior: rpe * 0.95,
    gp_per_labor_rand: gpPerLabor,
    revenue_growth: Number.isFinite(rawRatios["Net Margin"]) ? 0.08 : 0,
    inflation_rate: 0.057,
    periods: [{ label: "Current Period", revenue, employees: Math.round(employees), labor_cost: laborCost }],
    health_scores: {
      gpToLabor:        Math.round(Math.min(100, Math.max(0, (gpPerLabor / 0.6) * 100))),
      salesPerEmployee: Math.round(Math.min(100, Math.max(0, (rpe / 300_000) * 100))),
      revenueGrowth:    Number.isFinite(rawRatios["Net Margin"]) ? Math.round(scoreForRatio("Net Margin", rawRatios["Net Margin"])) : 50,
    },
  };
}

// ── Cash forecast from saved CashForecastPanel data ───────────────────────
//
// Replicates the distribute() + computeScenario() logic in
// src/components/cash-forecast.tsx so the PDF uses exactly the same
// weekly figures the accountant configured in the panel.

type CfFrequency = "recurring-weekly" | "recurring-monthly" | "once-off" | "split-weeks" | "split-months";

type CfLineItem = {
  id: string; name: string; amount: string;
  frequency: CfFrequency; startWeek: number; splitCount: number;
};

type SavedCashflow = {
  startDate?: string; openingBalance?: string;
  revenue?: CfLineItem[]; expenses?: CfLineItem[]; other?: CfLineItem[];
  revAdj?: number; expAdj?: number; collectDelay?: number;
  headcountDelta?: number; avgSalary?: string; fixedCostDelta?: string;
  revGrowthPct?: number; capexAmount?: string; capexWeek?: number;
};

const CF_WEEKS = 13;

function cfDistribute(line: CfLineItem): number[] {
  const out = new Array(CF_WEEKS).fill(0);
  const amt = parseFloat(line.amount) || 0;
  if (amt === 0) return out;
  const start = Math.max(1, Math.min(CF_WEEKS, line.startWeek)) - 1;
  switch (line.frequency) {
    case "recurring-weekly":
      for (let i = start; i < CF_WEEKS; i++) out[i] = amt;
      break;
    case "recurring-monthly":
      for (let i = start; i < CF_WEEKS; i += 4) out[i] = amt;
      break;
    case "once-off":
      out[start] = amt;
      break;
    case "split-weeks": {
      const n = Math.max(1, line.splitCount);
      const per = amt / n;
      for (let i = start; i < Math.min(CF_WEEKS, start + n); i++) out[i] = per;
      break;
    }
    case "split-months": {
      const n = Math.max(1, line.splitCount);
      const per = amt / n;
      for (let i = 0; i < n; i++) {
        const w = start + i * 4;
        if (w < CF_WEEKS) out[w] = per;
      }
      break;
    }
  }
  return out;
}

function buildCashForecastFromSavedCashflow(
  cf: SavedCashflow,
  cashRunwayWeeks: number | null,
): CashForecastWeek[] | null {
  const revenue  = cf.revenue  ?? [];
  const expenses = cf.expenses ?? [];
  const other    = cf.other    ?? [];

  // Require at least one non-zero line item — empty panel = no real data
  const hasAmount = [...revenue, ...expenses, ...other].some(
    (l) => parseFloat(l.amount) > 0
  );
  if (!hasAmount) return null;

  const revAdj       = (cf.revAdj ?? 100) / 100;
  const expAdj       = (cf.expAdj ?? 100) / 100;
  const collectDelay = Math.max(0, Math.min(CF_WEEKS - 1, Math.round(cf.collectDelay ?? 0)));
  const headDelta    = cf.headcountDelta ?? 0;
  const avgSal       = parseFloat(cf.avgSalary ?? "0") || 0;
  const fixedDelta   = parseFloat(cf.fixedCostDelta ?? "0") || 0;
  const revGrowth    = cf.revGrowthPct ?? 0;
  const capexAmt     = parseFloat(cf.capexAmount ?? "0") || 0;
  const capexWk      = cf.capexWeek ?? 1;

  const shiftVals = (vals: number[]) => {
    if (!collectDelay) return vals;
    const out = new Array(CF_WEEKS).fill(0);
    for (let i = 0; i < CF_WEEKS; i++) {
      const j = i + collectDelay;
      if (j < CF_WEEKS) out[j] += vals[i];
    }
    return out;
  };
  const growthMul = (i: number) => Math.pow(1 + revGrowth / 100, i);

  const inflow  = new Array(CF_WEEKS).fill(0) as number[];
  const outflow = new Array(CF_WEEKS).fill(0) as number[];

  revenue.forEach((l) => {
    shiftVals(cfDistribute(l).map((v) => v * revAdj)).forEach((v, i) => (inflow[i] += v * growthMul(i)));
  });
  [...expenses, ...other].forEach((l) => {
    cfDistribute(l).map((v) => v * expAdj).forEach((v, i) => (outflow[i] += v));
  });
  // Scenario adjustments (mirrors CashForecastPanel.computeScenario)
  if (headDelta !== 0) {
    const weekly = (headDelta * avgSal) / 4.33;
    for (let i = 0; i < CF_WEEKS; i++) outflow[i] += Math.abs(weekly);
  }
  if (fixedDelta !== 0) {
    const weekly = fixedDelta / 4.33;
    for (let i = 0; i < CF_WEEKS; i++) outflow[i] += weekly;
  }
  if (capexAmt !== 0) {
    const w = Math.max(1, Math.min(CF_WEEKS, capexWk)) - 1;
    outflow[w] += capexAmt;
  }

  const opening = parseFloat(cf.openingBalance ?? "0") || 0;
  const runway  = cashRunwayWeeks ?? CF_WEEKS;
  const weeks: CashForecastWeek[] = [];
  let balance = opening;
  for (let i = 0; i < CF_WEEKS; i++) {
    const receipts = Math.round(inflow[i]);
    const payments = Math.round(outflow[i]);
    const net_movement = receipts - payments;
    const closing = balance + net_movement;
    weeks.push({
      period_label: `Week ${i + 1}`,
      opening_balance: Math.round(balance),
      total_receipts: receipts,
      total_payments: payments,
      net_movement,
      closing_balance: Math.round(closing),
      scenario: "moderate",
      runway_weeks: Math.max(0, runway - i),
    });
    balance = closing;
  }
  return weeks;
}

// Build real interventions from the playbook-data.json filtered by the
// client's actual at-risk/critical ratios (camelCase ratio_key format).
async function buildInterventions(
  ratioResults: RatioResult[],
  profile?: ClientOperatingProfile | null,
): Promise<Intervention[]> {
  // Map the snake_case ratio_key from ratioResults back to camelCase playbook keys
  const KEY_MAP: Record<string, string> = {
    gross_margin:         "grossMargin",
    net_margin:           "netMargin",
    operating_margin:     "operatingMargin",
    return_on_assets:     "roa",
    asset_turnover:       "assetTurnover",
    debtor_days:          "debtorDays",
    inventory_days:       "inventoryDays",
    creditor_days:        "creditorDays",
    equity_multiplier:    "equityMultiplier",
    working_capital_days: "workingCapitalFunding",
    ocf_ebitda:           "ocfToEbitda",
    ocf___ebitda:         "ocfToEbitda",
    gross_profit___labor: "gpToLabor",
    sales_per_employee_ratio: "salesPerEmployee",
    fixed_cost_ratio:     "fixedCostRatio",
    interest_burden:      "interestBurden",
  };

  const rawPlaybook = await import("@/lib/playbook-data.json");
  const allSteps = (rawPlaybook.default ?? rawPlaybook) as Intervention[];

  const atRiskRatios = ratioResults.filter(
    (r) => r.health_tier === "critical" || r.health_tier === "at_risk"
  );

  const result: Intervention[] = [];
  for (const rr of atRiskRatios) {
    const playbookKey = KEY_MAP[rr.ratio_key] ?? rr.ratio_key;
    const steps = allSteps.filter(
      (s) => s.ratio_key === playbookKey && s.health_tier === rr.health_tier
    );
    // Only include step 1 per ratio to keep the report concise
    if (steps.length > 0) {
      result.push({ ...steps[0], ratio_name: rr.ratio_name, health_tier: rr.health_tier });
    }
  }
  if (result.length === 0) return MOCK_INTERVENTIONS;

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

async function loadClientReportData(clientId: string): Promise<ClientReportData> {
  const [clientRes, snapshotRes, signoffRes] = await Promise.all([
    supabase.from("clients")
      .select("id, name, cash_runway_weeks, financials, cashflow, financials_updated_at, last_forecast_at, operating_profile")
      .eq("id", clientId)
      .maybeSingle(),
    supabase.from("client_financial_snapshots")
      .select("period_label, period_date, ratios")
      .eq("client_id", clientId)
      .order("period_date", { ascending: false })
      .limit(20),  // fetch enough history to cover 12-month windows
    (supabase as unknown as { from: (t: string) => { select: (c: string) => { eq: (k: string, v: string) => Promise<{ data: ClientReviewSignoff[] | null; error: { message: string } | null }> } } })
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
    name: string; cash_runway_weeks: number | null; financials: unknown;
    cashflow: unknown; financials_updated_at: string | null; last_forecast_at: string | null;
    operating_profile?: unknown;
  } | null;
  const operatingProfile = parseOperatingProfile(clientRow?.operating_profile);
  const reviewSignoffs = {
    financials: (signoffRes.data ?? []).find((s) => s.scope === "financials") ?? null,
    cash_forecast: (signoffRes.data ?? []).find((s) => s.scope === "cash_forecast") ?? null,
  };
  const baseEmpty = {
    ...EMPTY_CLIENT_DATA,
    clientName: clientRow?.name ?? "",
    cashRunwayWeeks: clientRow?.cash_runway_weeks ?? null,
    financialsUpdatedAt: clientRow?.financials_updated_at ?? null,
    lastForecastAt: clientRow?.last_forecast_at ?? null,
    reviewSignoffs,
    operatingProfile,
  };
  if (!clientRow?.financials) return baseEmpty;

  const rawFin = clientRow.financials as Record<string, string | number | null>;
  const fin = Object.fromEntries(
    Object.entries(rawFin).map(([k, v]) => [k, v != null ? String(v) : ""])
  );
  if (!fin["revenue"] || fin["revenue"].trim() === "") return { ...baseEmpty, financials: fin };

  const ratioInputs: RatioInputs = {
    revenue: fin["revenue"] ?? "", cogs: fin["cogs"] ?? "",
    ebit: fin["ebit"] ?? "", ebt: fin["ebt"] ?? "",
    netIncome: fin["netIncome"] ?? "", ebitda: fin["ebitda"] ?? "",
    operatingCashflow: fin["operatingCashflow"] ?? "",
    totalAssets: fin["totalAssets"] ?? "", equity: fin["equity"] ?? "",
    receivables: fin["receivables"] ?? "", inventory: fin["inventory"] ?? "",
    payables: fin["payables"] ?? "", fixedCosts: fin["fixedCosts"] ?? "",
    variableCosts: fin["variableCosts"] ?? "", top5Revenue: fin["top5Revenue"] ?? "",
    laborCost: fin["laborCost"] ?? "", employees: fin["employees"] ?? "",
    founderHours: fin["founderHours"] ?? "",
  };
  const rawRatios = computeRatios(ratioInputs);
  const ratioResults = buildRatioResults(rawRatios);
  const snapshots: DatedSnapshot[] = (snapshotRes.data ?? []).map((s) => ({
    period_label: s.period_label,
    period_date:  s.period_date as string,
    ratios: (s.ratios as Record<string, number>) ?? {},
  }));

  const { rows: movementRows, labels: movementLabels } =
    buildMovementRows(rawRatios, snapshots, new Date());

  return {
    hasData: true,
    clientName: clientRow.name,
    cashRunwayWeeks: clientRow.cash_runway_weeks,
    financials: fin,
    rawRatios,
    ratioResults,
    workingCapital: buildWorkingCapitalData(fin, rawRatios),
    profitability:  buildProfitabilityData(fin),
    leverage:       buildLeverageData(fin, rawRatios),
    assets:         buildAssetData(rawRatios),
    labor:          buildLaborData(fin, rawRatios),
    movement:       movementRows,
    movementPeriodLabels: movementLabels,
    benchmark:      buildBenchmarkRows(rawRatios, ratioResults),
    cashForecast:   buildCashForecastFromSavedCashflow(
      (clientRow as unknown as { cashflow: SavedCashflow | null }).cashflow ?? {},
      clientRow.cash_runway_weeks,
    ),
    financialsUpdatedAt: clientRow.financials_updated_at,
    lastForecastAt: clientRow.last_forecast_at,
    reviewSignoffs,
    operatingProfile,
  };
}

/** Freshness timestamp is null when there is nothing to be stale against yet. */
function isSignoffStale(signoff: ClientReviewSignoff | null, freshAt: string | null): boolean {
  if (!signoff) return true;
  if (!freshAt) return false;
  return new Date(freshAt).getTime() > new Date(signoff.signed_off_at).getTime();
}

/** Only current (non-stale) sign-offs are stamped onto a report footer. */
function signoffStampFor(
  scope: "financials" | "cash_forecast",
  cd: ClientReportData | null,
): ReportSignoffStamp | null {
  if (!cd) return null;
  const signoff = cd.reviewSignoffs[scope];
  const freshAt = scope === "financials" ? cd.financialsUpdatedAt : cd.lastForecastAt;
  if (!signoff || isSignoffStale(signoff, freshAt)) return null;
  return {
    signedOffByName: signoff.signed_off_by_name,
    signedOffByInitials: signoff.signed_off_by_initials ?? null,
    signedOffByTitle: signoff.signed_off_by_title,
    firmName: signoff.firm_name,
    signedOffAt: signoff.signed_off_at,
  };
}

// ── PDF generation helpers ─────────────────────────────────────────────────

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function renderToBlob(Component: unknown, props: unknown): Promise<Blob> {
  const { pdf } = await import("@react-pdf/renderer");
  const element = (Component as (p: unknown) => unknown)(props);
  return pdf(element as Parameters<typeof pdf>[0]).toBlob();
}

function makeSme(s: Settings) {
  return { name: s.smeName || "Demo Client", period: `${s.periodMonth} ${s.periodYear}` };
}

function makeSafeFilename(s: Settings, reportName: string): string {
  const sme = (s.smeName || "Client").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "");
  const period = `${s.periodMonth}_${s.periodYear}`;
  return `${sme}_${period}_${reportName}.pdf`;
}

// ── Per-report generate functions ──────────────────────────────────────────

type GenFn = (s: Settings, profile: AccountantProfile) => Promise<Blob>;

/** Period label with a "Demo Data" suffix when real figures are unavailable. */
function makeSmeWithNote(s: Settings, isDemo: boolean): { name: string; period: string } {
  return {
    name: s.smeName || "Demo Client",
    period: isDemo
      ? `${s.periodMonth} ${s.periodYear} · Demo Data — upload financials for real figures`
      : `${s.periodMonth} ${s.periodYear}`,
  };
}

function buildGEN(clientData: ClientReportData | null): Record<string, GenFn> {
  const cd = clientData?.hasData ? clientData : null;
  const operatingProfile = clientData?.operatingProfile ?? null;
  const financialsStamp = signoffStampFor("financials", clientData);
  const forecastStamp = signoffStampFor("cash_forecast", clientData);

  return {
    scorecard: async (s, p) => {
      const { HealthScorecardPDF } = await import("@/reports/health-scorecard");
      const isDemo = !cd || cd.ratioResults.length === 0;
      return renderToBlob(HealthScorecardPDF, {
        smeData: makeSmeWithNote(s, isDemo),
        ratioResults: isDemo ? MOCK_RATIOS : cd.ratioResults,
        accountantProfile: p,
        isDemo,
        reviewSignoff: financialsStamp,
        operatingProfile,
      });
    },
    intervention: async (s, p) => {
      const { InterventionPriorityPDF } = await import("@/reports/intervention-priority");
      const isDemo = !cd || cd.ratioResults.length === 0;
      const interventions = isDemo
        ? MOCK_INTERVENTIONS
        : await buildInterventions(cd.ratioResults, operatingProfile);
      return renderToBlob(InterventionPriorityPDF, {
        smeData: makeSmeWithNote(s, isDemo),
        interventions,
        accountantProfile: p,
        isDemo,
        reviewSignoff: financialsStamp,
        operatingProfile,
      });
    },
    forecast: async (s, p) => {
      const { CashForecastPDF } = await import("@/reports/cash-forecast");
      const isDemo = !cd || !cd.cashForecast;
      return renderToBlob(CashForecastPDF, {
        smeData: makeSmeWithNote(s, isDemo),
        cashForecast: isDemo ? MOCK_FORECAST : cd!.cashForecast!,
        scenario: "moderate",
        accountantProfile: p,
        isDemo,
        reviewSignoff: forecastStamp,
        operatingProfile,
      });
    },
    cycle: async (s, p) => {
      const { CashCyclePDF } = await import("@/reports/cash-cycle");
      const isDemo = !cd || !cd.workingCapital;
      return renderToBlob(CashCyclePDF, {
        smeData: makeSmeWithNote(s, isDemo),
        workingCapitalData: isDemo ? MOCK_WC : cd!.workingCapital!,
        accountantProfile: p,
        isDemo,
        reviewSignoff: financialsStamp,
        operatingProfile,
      });
    },
    waterfall: async (s, p) => {
      const { ProfitabilityWaterfallPDF } = await import("@/reports/profitability-waterfall");
      const isDemo = !cd || !cd.profitability;
      return renderToBlob(ProfitabilityWaterfallPDF, {
        smeData: makeSmeWithNote(s, isDemo),
        profitabilityData: isDemo ? MOCK_PROFIT : cd!.profitability!,
        accountantProfile: p,
        isDemo,
        reviewSignoff: financialsStamp,
        operatingProfile,
      });
    },
    leverage: async (s, p) => {
      const { LeverageSolvencyPDF } = await import("@/reports/leverage-solvency");
      const isDemo = !cd || !cd.leverage;
      return renderToBlob(LeverageSolvencyPDF, {
        smeData: makeSmeWithNote(s, isDemo),
        data: isDemo ? MOCK_LEVERAGE : cd!.leverage!,
        accountantProfile: p,
        isDemo,
        reviewSignoff: financialsStamp,
        operatingProfile,
      });
    },
    assets: async (s, p) => {
      const { AssetProductivityPDF } = await import("@/reports/asset-productivity");
      const isDemo = !cd || !cd.assets;
      return renderToBlob(AssetProductivityPDF, {
        smeData: makeSmeWithNote(s, isDemo),
        data: isDemo ? MOCK_ASSETS : cd!.assets!,
        accountantProfile: p,
        isDemo,
        reviewSignoff: financialsStamp,
        operatingProfile,
      });
    },
    labor: async (s, p) => {
      const { LaborProductivityPDF } = await import("@/reports/labor-productivity");
      const isDemo = !cd || !cd.labor;
      return renderToBlob(LaborProductivityPDF, {
        smeData: makeSmeWithNote(s, isDemo),
        data: isDemo ? MOCK_LABOR : cd!.labor!,
        accountantProfile: p,
        isDemo,
        reviewSignoff: financialsStamp,
        operatingProfile,
      });
    },
    movement: async (s, p) => {
      const { RatioMovementPDF } = await import("@/reports/ratio-movement");
      const isDemo = !cd || cd.movement.length === 0;
      return renderToBlob(RatioMovementPDF, {
        smeData: makeSmeWithNote(s, isDemo),
        ratios: isDemo ? MOCK_MOVEMENT : cd!.movement,
        periodLabels: isDemo ? undefined : cd!.movementPeriodLabels,
        accountantProfile: p,
        isDemo,
        reviewSignoff: financialsStamp,
        operatingProfile,
      });
    },
    benchmark: async (s, p) => {
      const { BenchmarkReportPDF } = await import("@/reports/benchmark-report");
      const industry = INDUSTRIES.find((i) => i.code === s.industryCode) ?? INDUSTRIES[0];
      const isDemo = !cd || cd.benchmark.length === 0;
      return renderToBlob(BenchmarkReportPDF, {
        smeData: makeSmeWithNote(s, isDemo),
        industryCode: industry.code,
        industryName: profileIndustryLabel(operatingProfile, industry.name),
        benchmarkRows: isDemo ? MOCK_BENCHMARK : cd!.benchmark,
        accountantProfile: p,
        isDemo,
        reviewSignoff: financialsStamp,
        operatingProfile,
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
  { id: 1, key: "scorecard", name: "Financial Health Scorecard", description: "Overall score, 4-pillar breakdown, all 14 ratios with tier badges and movement arrows.", pages: "2 pages", category: "essential", icon: <FileText className="h-4 w-4 text-blue-400" />, iconBg: "bg-blue-500/15", btnBg: "bg-blue-700 hover:bg-blue-800", filename: "HealthScorecard" },
  { id: 2, key: "intervention", name: "Priority Intervention Plan", description: "Ranked action steps per failing ratio — sorted critical-first, with effort and impact ratings.", pages: "2–3 pages", category: "essential", icon: <Lightbulb className="h-4 w-4 text-amber-400" />, iconBg: "bg-amber-500/15", btnBg: "bg-amber-600 hover:bg-amber-700", filename: "InterventionPlan" },
  { id: 3, key: "forecast", name: "13-Week Cash Flow Forecast", description: "Colour-coded bar chart, scenario badge, weekly data table, and assumptions section.", pages: "2 pages", category: "essential", icon: <BarChart2 className="h-4 w-4 text-violet-400" />, iconBg: "bg-violet-500/15", btnBg: "bg-violet-700 hover:bg-violet-800", filename: "CashForecast" },
  { id: 4, key: "cycle", name: "Cash Flow Cycle Report", description: "Visual cycle diagram (Inventory → WIP → Debtors), creditor offset, and cash-trapped callout.", pages: "2 pages", category: "essential", icon: <Droplets className="h-4 w-4 text-cyan-400" />, iconBg: "bg-cyan-500/15", btnBg: "bg-cyan-700 hover:bg-cyan-800", filename: "CashCycleReport" },
  { id: 5, key: "waterfall", name: "Profitability Waterfall", description: "Revenue → Gross Profit → Operating Profit → EBT → Net Profit with tier badges and prior period compare.", pages: "2 pages", category: "essential", icon: <TrendingUp className="h-4 w-4 text-emerald-400" />, iconBg: "bg-emerald-500/15", btnBg: "bg-emerald-700 hover:bg-emerald-800", filename: "ProfitabilityWaterfall" },
  { id: 6, key: "leverage", name: "Leverage & Solvency", description: "Debt breakdown table, 5-year maturity bar chart, equity bridge, and financing ratio analysis.", pages: "2 pages", category: "optional", icon: <ShieldCheck className="h-4 w-4 text-rose-400" />, iconBg: "bg-rose-500/15", btnBg: "bg-rose-700 hover:bg-rose-800", filename: "LeverageSolvency" },
  { id: 7, key: "assets", name: "Asset Productivity", description: "DuPont ROE decomposition tree, Capex vs Depreciation trend, and asset ratio deep-dive.", pages: "2 pages", category: "optional", icon: <Layers className="h-4 w-4 text-indigo-400" />, iconBg: "bg-indigo-500/15", btnBg: "bg-indigo-700 hover:bg-indigo-800", filename: "AssetProductivity" },
  { id: 8, key: "labor", name: "Labour Productivity", description: "Revenue per employee trend, GP per R1 of labour visual, and growth vs inflation comparison.", pages: "2 pages", category: "optional", icon: <Users className="h-4 w-4 text-teal-400" />, iconBg: "bg-teal-500/15", btnBg: "bg-teal-700 hover:bg-teal-800", filename: "LabourProductivity" },
  { id: 9, key: "movement", name: "Ratio Movement", description: "All ratios across 4 time periods — red rows for sustained declines, amber for 3-period deterioration.", pages: "2–3 pages", category: "optional", icon: <BarChart className="h-4 w-4 text-orange-400" />, iconBg: "bg-orange-500/15", btnBg: "bg-orange-700 hover:bg-orange-800", filename: "RatioMovement" },
  { id: 10, key: "benchmark", name: "Industry Benchmark Report", description: "Every ratio vs sector median and top quartile with position badges (Below / Above / Top Quartile).", pages: "2–3 pages", category: "optional", icon: <Trophy className="h-4 w-4 text-yellow-400" />, iconBg: "bg-yellow-500/15", btnBg: "bg-yellow-600 hover:bg-yellow-700", filename: "BenchmarkReport" },
];

// ── Preview state ──────────────────────────────────────────────────────────

type PreviewState = {
  key: string;
  name: string;
  blobUrl: string | null;
  loading: boolean;
};

// ── Report card ────────────────────────────────────────────────────────────

function ReportCard({
  report, isGenerating, isPreviewing, isClient, dataLoading,
  onGenerate, onPreview,
}: {
  report: ReportMeta;
  isGenerating: boolean;
  isPreviewing: boolean;
  isClient: boolean;
  dataLoading: boolean;
  onGenerate: () => void;
  onPreview: () => void;
}) {
  return (
    <div className="report-card group flex flex-col rounded-xl border border-border bg-card shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-[#c9962b]/60 hover:shadow-md">
      <div className="p-4 pb-3 flex-1">
        <div className="flex items-start gap-3">
          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${report.iconBg}`}>
            {report.icon}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-[10px] font-semibold text-muted-foreground">#{report.id}</span>
              <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${report.category === "essential" ? "bg-[#c9962b]/10 text-[#a8791a] dark:text-[#e5c66b]" : "bg-muted text-muted-foreground"}`}>
                {report.category}
              </span>
              <span className="text-[10px] text-muted-foreground">{report.pages}</span>
            </div>
            <h3 className="text-sm font-semibold leading-snug text-foreground mb-1">{report.name}</h3>
            <p className="text-[11px] leading-relaxed text-muted-foreground">{report.description}</p>
          </div>
        </div>
      </div>

      <div className="flex gap-2 px-4 pb-4">
        <Button
          variant="outline"
          size="sm"
          className="flex-1 border-border bg-transparent text-foreground hover:bg-muted hover:text-foreground text-xs gap-1.5"
          onClick={onPreview}
          disabled={!isClient || isPreviewing || dataLoading}
        >
          {isPreviewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
          {dataLoading ? "Loading…" : "Preview"}
        </Button>
        <Button
          size="sm"
          className="flex-1 text-xs gap-1.5 bg-[#c9962b] text-white hover:bg-[#b8851f]"
          onClick={onGenerate}
          disabled={!isClient || isGenerating || dataLoading}
        >
          {isGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          Download
        </Button>
      </div>
    </div>
  );
}

// ── Settings panel ─────────────────────────────────────────────────────────

function SettingsPanel({
  settings, onChange, profile,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  profile: AccountantProfile;
}) {
  const inputCls = "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-[#c9962b] focus:outline-none focus:ring-1 focus:ring-[#c9962b]/40";

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-5 shadow-sm sticky top-6">
      <div className="flex items-center gap-2">
        <Settings className="h-4 w-4 text-[#c9962b]" />
        <h2 className="text-sm font-semibold text-foreground">Report Settings</h2>
      </div>

      {/* SME Name */}
      <div>
        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Client / SME Name</label>
        <input
          className={inputCls}
          value={settings.smeName}
          onChange={(e) => onChange({ smeName: e.target.value })}
          placeholder="e.g. Acme Trading (Pty) Ltd"
        />
      </div>

      {/* Reporting period */}
      <div>
        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Reporting Period</label>
        <div className="grid grid-cols-2 gap-2">
          <Select value={settings.periodMonth} onValueChange={(v) => onChange({ periodMonth: v })}>
            <SelectTrigger className="border-input bg-background text-foreground text-sm h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              {MONTHS.map((m) => <SelectItem key={m} value={m} className="text-popover-foreground focus:bg-muted">{m}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={settings.periodYear} onValueChange={(v) => onChange({ periodYear: v })}>
            <SelectTrigger className="border-input bg-background text-foreground text-sm h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              {YEARS.map((y) => <SelectItem key={y} value={y} className="text-popover-foreground focus:bg-muted">{y}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Industry */}
      <div>
        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Industry (Benchmark Report)</label>
        <Select value={settings.industryCode} onValueChange={(v) => onChange({ industryCode: v })}>
          <SelectTrigger className="border-input bg-background text-foreground text-sm h-9 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-popover border-border">
            {INDUSTRIES.map((i) => <SelectItem key={i.code} value={i.code} className="text-popover-foreground focus:bg-muted text-xs">{i.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Prior period toggle */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-foreground">Include Prior Period</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Show comparison columns in tables</p>
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
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Report Branding</p>
        {profile.firmName ? (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
            <div className="h-8 w-8 shrink-0 rounded" style={{ backgroundColor: profile.accentColor }} />
            <div>
              <p className="text-xs font-semibold text-foreground">{profile.firmName}</p>
              {profile.tagline && <p className="text-[10px] text-muted-foreground">{profile.tagline}</p>}
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-amber-900/40 bg-amber-950/20 px-3 py-2.5">
            <p className="text-xs text-amber-400">No brand configured</p>
            <p className="text-[10px] text-amber-500/70 mt-0.5">PDFs will use default Milōn branding</p>
          </div>
        )}
        <Link to="/settings/brand" className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <ExternalLink className="h-3 w-3" />Brand Settings
        </Link>
      </div>
    </div>
  );
}

// ── Preview modal ──────────────────────────────────────────────────────────

function PreviewModal({ state, onClose, onDownload }: { state: PreviewState | null; onClose: () => void; onDownload: () => void }) {
  return (
    <Dialog open={state !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-5xl h-[88vh] flex flex-col bg-background border-border p-0 gap-0">
        <DialogHeader className="flex-row items-center justify-between px-5 py-3 border-b border-border shrink-0 space-y-0">
          <DialogTitle className="text-sm font-semibold text-foreground">
            {state?.name ?? "Report Preview"}
          </DialogTitle>
          <Button size="sm" variant="outline" className="gap-1.5 border-border text-foreground hover:bg-muted text-xs" onClick={onDownload}>
            <Download className="h-3.5 w-3.5" />Download
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
  { key: "profit",     name: "Profitability",             color: "#b45309" },
  { key: "financing",  name: "Leverage & Financing",      color: "#7c3aed" },
  { key: "cash",       name: "Cash & Working Capital",    color: "#047857" },
  { key: "assets",     name: "Asset Productivity",        color: "#1d4ed8" },
  { key: "labour",     name: "Labour Productivity",       color: "#0e7490" },
  { key: "risk",       name: "Business Risk",             color: "#dc2626" },
] as const;

type PlaybookPillarKey = (typeof PLAYBOOK_PILLARS)[number]["key"];

interface PlaybookRatio {
  ratio_key: string;
  ratio_name: string;
  pillar: PlaybookPillarKey;
  health_tier: "critical" | "at_risk" | "healthy";
  health_score: number;
}

const PLAYBOOK_RATIOS: PlaybookRatio[] = [
  // Profitability
  { ratio_key: "grossMargin",         ratio_name: "Gross Profit Margin",   pillar: "profit",    health_tier: "at_risk",  health_score: 62 },
  { ratio_key: "directCostsRatio",    ratio_name: "Direct Cost Burden",    pillar: "profit",    health_tier: "at_risk",  health_score: 58 },
  { ratio_key: "fixedCostRatio",      ratio_name: "Fixed Cost Burden",     pillar: "profit",    health_tier: "healthy",  health_score: 71 },
  { ratio_key: "netMargin",           ratio_name: "Net Margin",            pillar: "profit",    health_tier: "at_risk",  health_score: 68 },
  { ratio_key: "revenueGrowth",       ratio_name: "Revenue Growth",        pillar: "profit",    health_tier: "at_risk",  health_score: 41 },
  { ratio_key: "dol",                 ratio_name: "Operating Leverage",    pillar: "profit",    health_tier: "at_risk",  health_score: 50 },
  // Financing
  { ratio_key: "interestBurden",      ratio_name: "Interest Burden",       pillar: "financing", health_tier: "healthy",  health_score: 72 },
  { ratio_key: "debtToEquity",        ratio_name: "Debt-to-Equity",        pillar: "financing", health_tier: "at_risk",  health_score: 67 },
  { ratio_key: "debtToAssets",        ratio_name: "Debt-to-Assets",        pillar: "financing", health_tier: "at_risk",  health_score: 61 },
  // Cash & Working Capital
  { ratio_key: "currentRatio",        ratio_name: "Current Ratio",         pillar: "cash",      health_tier: "critical", health_score: 28 },
  { ratio_key: "debtorDays",          ratio_name: "Debtor Days",           pillar: "cash",      health_tier: "at_risk",  health_score: 40 },
  { ratio_key: "creditorDays",        ratio_name: "Creditor Days",         pillar: "cash",      health_tier: "healthy",  health_score: 75 },
  { ratio_key: "wipDays",             ratio_name: "WIP Days",              pillar: "cash",      health_tier: "healthy",  health_score: 68 },
  { ratio_key: "workingCapitalFunding", ratio_name: "WC Funding Intensity", pillar: "cash",     health_tier: "critical", health_score: 32 },
  { ratio_key: "ocfToEbitda",         ratio_name: "Cash Quality",          pillar: "cash",      health_tier: "at_risk",  health_score: 60 },
  // Assets
  { ratio_key: "assetReinvestmentRatio", ratio_name: "Asset Reinvestment", pillar: "assets",   health_tier: "healthy",  health_score: 68 },
  { ratio_key: "capexIntensity",      ratio_name: "Capex Intensity",       pillar: "assets",    health_tier: "healthy",  health_score: 71 },
  // Labour
  { ratio_key: "gpToLabor",           ratio_name: "Labour ROI",            pillar: "labour",    health_tier: "at_risk",  health_score: 64 },
  { ratio_key: "salesPerEmployee",    ratio_name: "Revenue per Employee",  pillar: "labour",    health_tier: "healthy",  health_score: 72 },
  // Risk
  { ratio_key: "customerConcentration", ratio_name: "Customer Dependency", pillar: "risk",     health_tier: "at_risk",  health_score: 52 },
];

const TIER_CHIP: Record<string, string> = {
  critical: "bg-red-950/60 text-red-400 border border-red-800",
  at_risk:  "bg-amber-950/60 text-amber-400 border border-amber-800",
  healthy:  "bg-emerald-950/60 text-emerald-400 border border-emerald-800",
};

const TIER_DOT: Record<string, string> = {
  critical: "bg-red-500",
  at_risk:  "bg-amber-500",
  healthy:  "bg-emerald-500",
};

// ── Playbook ratio card ─────────────────────────────────────────────────────

function PlaybookRatioCard({ ratio, onClick }: { ratio: PlaybookRatio; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-lg border border-border bg-card hover:bg-muted/60 hover:border-[#c9962b]/50 transition-colors p-3 group"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-xs font-medium text-foreground leading-snug">{ratio.ratio_name}</p>
        <span className={`flex-shrink-0 inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${TIER_CHIP[ratio.health_tier]}`}>
          {ratio.health_tier === "at_risk" ? "At Risk" : ratio.health_tier === "critical" ? "Critical" : "Healthy"}
        </span>
      </div>
      {/* Score bar */}
      <div className="h-1 rounded-full bg-muted mb-2">
        <div
          className={`h-1 rounded-full transition-all ${TIER_DOT[ratio.health_tier]}`}
          style={{ width: `${ratio.health_score}%` }}
        />
      </div>
      <p className="text-[10px] text-muted-foreground group-hover:text-foreground transition-colors">Score {ratio.health_score} · View steps →</p>
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

function ReportsPage() {
  const { client: clientParam, clientId } = Route.useSearch();
  const { profile } = useAccountantProfile();
  const [isClient, setIsClient] = useState(false);
  const [settings, setSettings] = useState<Settings>({
    smeName: clientParam ?? "Acme Trading (Pty) Ltd",
    periodMonth: MONTHS[new Date().getMonth()],
    periodYear: String(new Date().getFullYear()),
    industryCode: INDUSTRIES[0].code,
    includePrior: true,
  });
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<PreviewState | null>(null);
  const [zipProgress, setZipProgress] = useState<{ done: number; total: number } | null>(null);
  const [playbookOpen, setPlaybookOpen] = useState(false);
  const [selectedPlaybook, setSelectedPlaybook] = useState<PlaybookRatio | null>(null);
  const [clientData, setClientData] = useState<ClientReportData | null>(null);
  const [dataLoading, setDataLoading] = useState(false);

  function openPlaybook(ratio: PlaybookRatio) {
    setSelectedPlaybook(ratio);
    setPlaybookOpen(true);
  }

  useEffect(() => { setIsClient(true); }, []);

  // Load real client financials whenever clientId changes.
  // Clear stale data *immediately* so exports cannot use the previous client's
  // figures while the new request is in flight.
  useEffect(() => {
    if (!clientId) { setClientData(null); return; }
    let cancelled = false;
    setClientData(null);   // clear before async starts
    setDataLoading(true);
    loadClientReportData(clientId).then((data) => {
      if (cancelled) return;
      setClientData(data);
      // Keep smeName in sync with the client's real name if it differs
      if (data.clientName) {
        setSettings((prev) => ({ ...prev, smeName: data.clientName }));
      }
    }).catch((err) => {
      console.error("Failed to load client report data:", err);
    }).finally(() => {
      if (!cancelled) setDataLoading(false);
    });
    return () => { cancelled = true; };
  }, [clientId]);

  // Build the GEN map from real client data (or null = demo data)
  const GEN = useMemo(() => buildGEN(clientData), [clientData]);

  // Clean up blob URL on close
  const closePreview = useCallback(() => {
    if (previewState?.blobUrl) URL.revokeObjectURL(previewState.blobUrl);
    setPreviewState(null);
    setPreviewKey(null);
  }, [previewState]);

  // ── Generate single PDF ──────────────────────────────────────────────────

  async function handleGenerate(report: ReportMeta) {
    if (!isClient || dataLoading) return;
    setLoadingKey(report.key);
    try {
      const blob = await GEN[report.key](settings, profile);
      triggerDownload(blob, makeSafeFilename(settings, report.filename));
      toast.success(`${report.name} downloaded.`);
      await recordReportIssued(clientId);
    } catch (err) {
      toast.error(`Generation failed: ${(err as Error).message}`);
      console.error(err);
    } finally {
      setLoadingKey(null);
    }
  }

  // ── Preview single PDF ───────────────────────────────────────────────────

  async function handlePreview(report: ReportMeta) {
    if (!isClient || dataLoading) return;
    if (previewState?.blobUrl) URL.revokeObjectURL(previewState.blobUrl);
    setPreviewKey(report.key);
    setPreviewState({ key: report.key, name: report.name, blobUrl: null, loading: true });
    try {
      const blob = await GEN[report.key](settings, profile);
      const url = URL.createObjectURL(blob);
      setPreviewState({ key: report.key, name: report.name, blobUrl: url, loading: false });
    } catch (err) {
      toast.error(`Preview failed: ${(err as Error).message}`);
      console.error(err);
      setPreviewState(null);
      setPreviewKey(null);
    }
  }

  // ── Generate all as ZIP ──────────────────────────────────────────────────

  async function handleGenerateAll() {
    if (!isClient || dataLoading) return;
    setZipProgress({ done: 0, total: REPORTS.length });
    try {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();

      for (let i = 0; i < REPORTS.length; i++) {
        const report = REPORTS[i];
        try {
          const blob = await GEN[report.key](settings, profile);
          zip.file(`${String(report.id).padStart(2, "0")}_${report.filename}.pdf`, blob);
        } catch (err) {
          console.warn(`Skipping ${report.name}:`, err);
        }
        setZipProgress({ done: i + 1, total: REPORTS.length });
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const sme = (settings.smeName || "Client").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "");
      triggerDownload(zipBlob, `${sme}_${settings.periodMonth}_${settings.periodYear}_Reports.zip`);
      toast.success("All reports downloaded as ZIP.");
      await recordReportIssued(clientId);
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

  return (
    <main className="reports-studio min-h-[100dvh] bg-background text-foreground px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-[1400px]">

        {/* Back nav */}
        <div className="mb-7 flex items-center justify-between">
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />Back to Dashboard
          </Link>
          <ThemeToggle />
        </div>

        {/* Header */}
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Zap className="h-4 w-4 text-[#c9962b]" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Milōn Report Suite</span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Financial Reports</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              10 white-label PDF reports — configure settings then generate or preview individual reports.
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
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
                    <span className="text-[11px] text-amber-700 dark:text-amber-400">
                      No financials uploaded — reports show demo data
                    </span>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-col items-end gap-2">
            {zipProgress ? (
              <div className="w-60">
                <p className="text-xs text-muted-foreground mb-1.5">Generating {zipProgress.done}/{zipProgress.total} reports…</p>
                <Progress value={zipPct} className="h-2 bg-muted" />
              </div>
            ) : (
              <Button
                className="gap-2 bg-[#c9962b] hover:bg-[#b8851f] font-semibold text-white"
                onClick={handleGenerateAll}
                disabled={!isClient || dataLoading}
              >
                {dataLoading
                  ? <><Loader2 className="h-4 w-4 animate-spin" />Loading client data…</>
                  : <><Download className="h-4 w-4" />Generate All as ZIP</>
                }
              </Button>
            )}
            <Link to="/reports/demo" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              View demo preview →
            </Link>
          </div>
        </div>

        {/* Main layout */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">

          {/* Card grid */}
          <div className="space-y-6">
            {/* Essential */}
            <section>
              <div className="mb-3 flex items-center gap-2">
                <span className="rounded-full bg-[#c9962b]/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#a8791a] dark:text-[#e5c66b]">Essential — {essential.length} Reports</span>
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
                    dataLoading={dataLoading}
                    onGenerate={() => handleGenerate(r)}
                    onPreview={() => handlePreview(r)}
                  />
                ))}
              </div>
            </section>

            {/* Optional */}
            <section>
              <div className="mb-3 flex items-center gap-2">
                <span className="rounded-full bg-muted px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Optional — {optional.length} Reports</span>
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
                    dataLoading={dataLoading}
                    onGenerate={() => handleGenerate(r)}
                    onPreview={() => handlePreview(r)}
                  />
                ))}
              </div>
            </section>

            {/* Playbooks */}
            <section>
              <div className="mb-3 flex items-center gap-2">
                <span className="rounded-full bg-violet-900/40 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-violet-400">
                  Playbooks — {PLAYBOOK_RATIOS.length} Action Plans
                </span>
                <div className="flex-1 border-t border-border" />
              </div>
              <p className="text-xs text-muted-foreground mb-5">
                Step-by-step recovery and optimisation plans for every ratio, tailored to the current health tier. Click any ratio to open its 10-step playbook.
              </p>
              <div className="space-y-5">
                {PLAYBOOK_PILLARS.map((pillar) => {
                  const ratios = PLAYBOOK_RATIOS.filter((r) => r.pillar === pillar.key);
                  if (!ratios.length) return null;
                  return (
                    <div key={pillar.key}>
                      <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: pillar.color }}>
                        {pillar.name}
                      </p>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {ratios.map((ratio) => (
                          <PlaybookRatioCard key={ratio.ratio_key} ratio={ratio} onClick={() => openPlaybook(ratio)} />
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
          />
        </div>
      </div>

      {/* Playbook drawer */}
      <PlaybookDrawer
        ratioKey={selectedPlaybook?.ratio_key ?? null}
        ratioName={selectedPlaybook?.ratio_name ?? ""}
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
          a.download = makeSafeFilename(settings, report.filename);
          a.click();
        }}
      />
    </main>
  );
}
