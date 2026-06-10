import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
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
import { PlaybookDrawer } from "@/components/playbook-drawer";

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

export const Route = createFileRoute("/_authenticated/reports/")({
  validateSearch: (search: Record<string, unknown>) => ({
    client: typeof search.client === "string" ? search.client : undefined,
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

const GEN: Record<string, GenFn> = {
  scorecard: async (s, p) => {
    const { HealthScorecardPDF } = await import("@/reports/health-scorecard");
    return renderToBlob(HealthScorecardPDF, { smeData: makeSme(s), ratioResults: MOCK_RATIOS, accountantProfile: p });
  },
  intervention: async (s, p) => {
    const { InterventionPriorityPDF } = await import("@/reports/intervention-priority");
    return renderToBlob(InterventionPriorityPDF, { smeData: makeSme(s), interventions: MOCK_INTERVENTIONS, accountantProfile: p });
  },
  forecast: async (s, p) => {
    const { CashForecastPDF } = await import("@/reports/cash-forecast");
    return renderToBlob(CashForecastPDF, { smeData: makeSme(s), cashForecast: MOCK_FORECAST, scenario: "moderate", accountantProfile: p });
  },
  cycle: async (s, p) => {
    const { CashCyclePDF } = await import("@/reports/cash-cycle");
    return renderToBlob(CashCyclePDF, { smeData: makeSme(s), workingCapitalData: MOCK_WC, accountantProfile: p });
  },
  waterfall: async (s, p) => {
    const { ProfitabilityWaterfallPDF } = await import("@/reports/profitability-waterfall");
    return renderToBlob(ProfitabilityWaterfallPDF, { smeData: makeSme(s), profitabilityData: MOCK_PROFIT, accountantProfile: p });
  },
  leverage: async (s, p) => {
    const { LeverageSolvencyPDF } = await import("@/reports/leverage-solvency");
    return renderToBlob(LeverageSolvencyPDF, { smeData: makeSme(s), data: MOCK_LEVERAGE, accountantProfile: p });
  },
  assets: async (s, p) => {
    const { AssetProductivityPDF } = await import("@/reports/asset-productivity");
    return renderToBlob(AssetProductivityPDF, { smeData: makeSme(s), data: MOCK_ASSETS, accountantProfile: p });
  },
  labor: async (s, p) => {
    const { LaborProductivityPDF } = await import("@/reports/labor-productivity");
    return renderToBlob(LaborProductivityPDF, { smeData: makeSme(s), data: MOCK_LABOR, accountantProfile: p });
  },
  movement: async (s, p) => {
    const { RatioMovementPDF } = await import("@/reports/ratio-movement");
    return renderToBlob(RatioMovementPDF, { smeData: makeSme(s), ratios: MOCK_MOVEMENT, accountantProfile: p });
  },
  benchmark: async (s, p) => {
    const { BenchmarkReportPDF } = await import("@/reports/benchmark-report");
    const industry = INDUSTRIES.find((i) => i.code === s.industryCode) ?? INDUSTRIES[0];
    return renderToBlob(BenchmarkReportPDF, { smeData: makeSme(s), industryCode: industry.code, industryName: industry.name, benchmarkRows: MOCK_BENCHMARK, accountantProfile: p });
  },
};

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
  report, isGenerating, isPreviewing, isClient,
  onGenerate, onPreview,
}: {
  report: ReportMeta;
  isGenerating: boolean;
  isPreviewing: boolean;
  isClient: boolean;
  onGenerate: () => void;
  onPreview: () => void;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-slate-800 bg-slate-900/50 transition-colors hover:border-slate-700">
      <div className="p-4 pb-3 flex-1">
        <div className="flex items-start gap-3">
          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${report.iconBg}`}>
            {report.icon}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-[10px] font-semibold text-slate-600">#{report.id}</span>
              <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${report.category === "essential" ? "bg-blue-950/60 text-blue-400" : "bg-slate-800 text-slate-400"}`}>
                {report.category}
              </span>
              <span className="text-[10px] text-slate-600">{report.pages}</span>
            </div>
            <h3 className="text-sm font-semibold leading-snug text-slate-100 mb-1">{report.name}</h3>
            <p className="text-[11px] leading-relaxed text-slate-500">{report.description}</p>
          </div>
        </div>
      </div>

      <div className="flex gap-2 px-4 pb-4">
        <Button
          variant="outline"
          size="sm"
          className="flex-1 border-slate-700 bg-transparent text-slate-300 hover:bg-slate-800 hover:text-slate-100 text-xs gap-1.5"
          onClick={onPreview}
          disabled={!isClient || isPreviewing}
        >
          {isPreviewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
          Preview
        </Button>
        <Button
          size="sm"
          className={`flex-1 text-xs gap-1.5 text-white ${report.btnBg}`}
          onClick={onGenerate}
          disabled={!isClient || isGenerating}
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
  const inputCls = "w-full rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-slate-500 focus:outline-none";

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 space-y-5 sticky top-6">
      <div className="flex items-center gap-2">
        <Settings className="h-4 w-4 text-slate-400" />
        <h2 className="text-sm font-semibold text-slate-200">Report Settings</h2>
      </div>

      {/* SME Name */}
      <div>
        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Client / SME Name</label>
        <input
          className={inputCls}
          value={settings.smeName}
          onChange={(e) => onChange({ smeName: e.target.value })}
          placeholder="e.g. Acme Trading (Pty) Ltd"
        />
      </div>

      {/* Reporting period */}
      <div>
        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Reporting Period</label>
        <div className="grid grid-cols-2 gap-2">
          <Select value={settings.periodMonth} onValueChange={(v) => onChange({ periodMonth: v })}>
            <SelectTrigger className="border-slate-700 bg-slate-800/60 text-slate-200 text-sm h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-700">
              {MONTHS.map((m) => <SelectItem key={m} value={m} className="text-slate-200 focus:bg-slate-800">{m}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={settings.periodYear} onValueChange={(v) => onChange({ periodYear: v })}>
            <SelectTrigger className="border-slate-700 bg-slate-800/60 text-slate-200 text-sm h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-700">
              {YEARS.map((y) => <SelectItem key={y} value={y} className="text-slate-200 focus:bg-slate-800">{y}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Industry */}
      <div>
        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Industry (Benchmark Report)</label>
        <Select value={settings.industryCode} onValueChange={(v) => onChange({ industryCode: v })}>
          <SelectTrigger className="border-slate-700 bg-slate-800/60 text-slate-200 text-sm h-9 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-slate-900 border-slate-700">
            {INDUSTRIES.map((i) => <SelectItem key={i.code} value={i.code} className="text-slate-200 focus:bg-slate-800 text-xs">{i.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Prior period toggle */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-slate-300">Include Prior Period</p>
          <p className="text-[10px] text-slate-500 mt-0.5">Show comparison columns in tables</p>
        </div>
        <Switch
          checked={settings.includePrior}
          onCheckedChange={(v) => onChange({ includePrior: v })}
          className="data-[state=checked]:bg-blue-600"
        />
      </div>

      <hr className="border-slate-800" />

      {/* Brand preview */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Report Branding</p>
        {profile.firmName ? (
          <div className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-800/40 px-3 py-2.5">
            <div className="h-8 w-8 shrink-0 rounded" style={{ backgroundColor: profile.accentColor }} />
            <div>
              <p className="text-xs font-semibold text-slate-200">{profile.firmName}</p>
              {profile.tagline && <p className="text-[10px] text-slate-500">{profile.tagline}</p>}
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-amber-900/40 bg-amber-950/20 px-3 py-2.5">
            <p className="text-xs text-amber-400">No brand configured</p>
            <p className="text-[10px] text-amber-500/70 mt-0.5">PDFs will use default Milōn branding</p>
          </div>
        )}
        <Link to="/settings/brand" className="mt-2 flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors">
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
      <DialogContent className="max-w-5xl h-[88vh] flex flex-col bg-slate-950 border-slate-800 p-0 gap-0">
        <DialogHeader className="flex-row items-center justify-between px-5 py-3 border-b border-slate-800 shrink-0 space-y-0">
          <DialogTitle className="text-sm font-semibold text-slate-200">
            {state?.name ?? "Report Preview"}
          </DialogTitle>
          <Button size="sm" variant="outline" className="gap-1.5 border-slate-700 text-slate-300 hover:bg-slate-800 text-xs" onClick={onDownload}>
            <Download className="h-3.5 w-3.5" />Download
          </Button>
        </DialogHeader>

        <div className="flex-1 overflow-hidden bg-slate-100">
          {state?.loading ? (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <Loader2 className="h-8 w-8 animate-spin text-slate-500 mx-auto mb-3" />
                <p className="text-sm text-slate-600">Generating PDF…</p>
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
      className="w-full text-left rounded-lg border border-slate-800 bg-slate-900/40 hover:bg-slate-800/60 hover:border-slate-700 transition-colors p-3 group"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-xs font-medium text-slate-200 leading-snug">{ratio.ratio_name}</p>
        <span className={`flex-shrink-0 inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${TIER_CHIP[ratio.health_tier]}`}>
          {ratio.health_tier === "at_risk" ? "At Risk" : ratio.health_tier === "critical" ? "Critical" : "Healthy"}
        </span>
      </div>
      {/* Score bar */}
      <div className="h-1 rounded-full bg-slate-800 mb-2">
        <div
          className={`h-1 rounded-full transition-all ${TIER_DOT[ratio.health_tier]}`}
          style={{ width: `${ratio.health_score}%` }}
        />
      </div>
      <p className="text-[10px] text-slate-500 group-hover:text-slate-400 transition-colors">Score {ratio.health_score} · View steps →</p>
    </button>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────

function ReportsPage() {
  const { client: clientParam } = Route.useSearch();
  const { profile } = useAccountantProfile();
  const [isClient, setIsClient] = useState(false);
  const [settings, setSettings] = useState<Settings>({
    smeName: clientParam ?? "Acme Trading (Pty) Ltd",
    periodMonth: "June",
    periodYear: "2025",
    industryCode: INDUSTRIES[0].code,
    includePrior: true,
  });
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<PreviewState | null>(null);
  const [zipProgress, setZipProgress] = useState<{ done: number; total: number } | null>(null);
  const [playbookOpen, setPlaybookOpen] = useState(false);
  const [selectedPlaybook, setSelectedPlaybook] = useState<PlaybookRatio | null>(null);

  function openPlaybook(ratio: PlaybookRatio) {
    setSelectedPlaybook(ratio);
    setPlaybookOpen(true);
  }

  useEffect(() => { setIsClient(true); }, []);

  // Clean up blob URL on close
  const closePreview = useCallback(() => {
    if (previewState?.blobUrl) URL.revokeObjectURL(previewState.blobUrl);
    setPreviewState(null);
    setPreviewKey(null);
  }, [previewState]);

  // ── Generate single PDF ──────────────────────────────────────────────────

  async function handleGenerate(report: ReportMeta) {
    if (!isClient) return;
    setLoadingKey(report.key);
    try {
      const blob = await GEN[report.key](settings, profile);
      triggerDownload(blob, makeSafeFilename(settings, report.filename));
      toast.success(`${report.name} downloaded.`);
    } catch (err) {
      toast.error(`Generation failed: ${(err as Error).message}`);
      console.error(err);
    } finally {
      setLoadingKey(null);
    }
  }

  // ── Preview single PDF ───────────────────────────────────────────────────

  async function handlePreview(report: ReportMeta) {
    if (!isClient) return;
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
    if (!isClient) return;
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
    <main className="min-h-screen bg-[#07090f] text-slate-50 px-4 py-8">
      <div className="mx-auto max-w-[1400px]">

        {/* Back nav */}
        <div className="mb-6">
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />Back to Dashboard
          </Link>
        </div>

        {/* Header */}
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Zap className="h-4 w-4 text-[#c9962b]" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Milōn Report Suite</span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-100">Financial Reports</h1>
            <p className="mt-1 text-sm text-slate-400">
              10 white-label PDF reports — configure settings then generate or preview individual reports.
            </p>
          </div>

          <div className="flex flex-col items-end gap-2">
            {zipProgress ? (
              <div className="w-60">
                <p className="text-xs text-slate-400 mb-1.5">Generating {zipProgress.done}/{zipProgress.total} reports…</p>
                <Progress value={zipPct} className="h-2 bg-slate-800" />
              </div>
            ) : (
              <Button
                className="gap-2 bg-[#c9962b] hover:bg-[#b8851f] font-semibold text-white"
                onClick={handleGenerateAll}
                disabled={!isClient}
              >
                <Download className="h-4 w-4" />
                Generate All as ZIP
              </Button>
            )}
            <Link to="/reports/demo" className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
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
                <span className="rounded-full bg-blue-900/40 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-400">Essential — {essential.length} Reports</span>
                <div className="flex-1 border-t border-slate-800" />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {essential.map((r) => (
                  <ReportCard
                    key={r.key}
                    report={r}
                    isGenerating={loadingKey === r.key}
                    isPreviewing={previewKey === r.key}
                    isClient={isClient}
                    onGenerate={() => handleGenerate(r)}
                    onPreview={() => handlePreview(r)}
                  />
                ))}
              </div>
            </section>

            {/* Optional */}
            <section>
              <div className="mb-3 flex items-center gap-2">
                <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Optional — {optional.length} Reports</span>
                <div className="flex-1 border-t border-slate-800" />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {optional.map((r) => (
                  <ReportCard
                    key={r.key}
                    report={r}
                    isGenerating={loadingKey === r.key}
                    isPreviewing={previewKey === r.key}
                    isClient={isClient}
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
                <div className="flex-1 border-t border-slate-800" />
              </div>
              <p className="text-xs text-slate-500 mb-5">
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
