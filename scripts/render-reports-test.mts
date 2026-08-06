/**
 * PDF Report Smoke-Test Runner
 *
 * Renders every report (plus edge-case variants) to an in-memory buffer and
 * fails loudly if any render throws. Run with:
 *
 *   pnpm run test:reports
 *
 * or via the registered validation step "render-reports".
 *
 * Uses vite-node so the @/ alias and TypeScript path aliases resolve correctly.
 * Relies on scripts/vite-test.config.ts (minimal config, no SSR plugins).
 */

import { createElement } from "react";

// ── Shared fixtures ─────────────────────────────────────────────────────────

const SME = { name: "Acme (Pty) Ltd", period: "December 2024" };

const ACCOUNTANT = {
  firmName: "Test Accounting Co",
  logoUrl: null,
  primaryColor: "#1a1a2e",
  secondaryColor: "#16213e",
  accentColor: "#0f3460",
  accountantName: "Jane Doe",
  accountantEmail: "jane@testfirm.co.za",
  tagline: null,
};

// ── Test case registry ───────────────────────────────────────────────────────

type TestCase = {
  name: string;
  /** Return the React element to render. Must be called after dynamic import. */
  build: () => Promise<import("react").ReactElement>;
};

const cases: TestCase[] = [
  // ── 1. Asset Productivity ─────────────────────────────────────────────────
  {
    name: "AssetProductivity / demo",
    async build() {
      const { AssetProductivityPDF } = await import("../src/reports/asset-productivity.js");
      return createElement(AssetProductivityPDF, {
        smeData: SME,
        accountantProfile: ACCOUNTANT,
        isDemo: true,
        data: {
          roe: 0.18,
          net_margin: 0.12,
          asset_turnover: 1.5,
          equity_multiplier: 1.8,
          capex_periods: [
            { label: "Dec 2022", capex: 120_000, depreciation: 95_000 },
            { label: "Dec 2023", capex: 85_000, depreciation: 100_000 },
            { label: "Dec 2024", capex: 210_000, depreciation: 108_000 },
          ],
          health_scores: {
            assetTurnover: 72,
            roa: 58,
            fixedCapitalUtilization: 65,
            assetReinvestmentRatio: 80,
            capexIntensity: 45,
          },
          ratios: {
            assetTurnover: { value: "1.50×" },
            roa: { value: "18.0%" },
            fixedCapitalUtilization: { value: "0.82×" },
            assetReinvestmentRatio: { value: "1.94×" },
            capexIntensity: { value: "4.2%" },
          },
        },
      });
    },
  },
  {
    name: "AssetProductivity / empty capex",
    async build() {
      const { AssetProductivityPDF } = await import("../src/reports/asset-productivity.js");
      return createElement(AssetProductivityPDF, {
        smeData: SME,
        accountantProfile: ACCOUNTANT,
        data: {
          roe: 0.1,
          net_margin: 0.08,
          asset_turnover: 1.1,
          equity_multiplier: 1.4,
          capex_periods: [], // edge case: no periods
          health_scores: {
            assetTurnover: 50,
            roa: 40,
            fixedCapitalUtilization: 35,
            assetReinvestmentRatio: 55,
            capexIntensity: 30,
          },
          ratios: {
            assetTurnover: { value: "1.10×" },
            roa: { value: "10.0%" },
            fixedCapitalUtilization: { value: "0.70×" },
            assetReinvestmentRatio: { value: "1.10×" },
            capexIntensity: { value: "2.1%" },
          },
        },
      });
    },
  },

  // ── 2. Benchmark Report ───────────────────────────────────────────────────
  {
    name: "BenchmarkReport / demo",
    async build() {
      const { BenchmarkReportPDF } = await import("../src/reports/benchmark-report.js");
      return createElement(BenchmarkReportPDF, {
        smeData: SME,
        accountantProfile: ACCOUNTANT,
        isDemo: true,
        industryCode: "6201",
        industryName: "Retail Trade",
        benchmarkRows: [
          {
            ratio_key: "gross_margin",
            ratio_name: "Gross Margin",
            pillar: "profit" as const,
            current_value: 0.38,
            formatted_current: "38.0%",
            health_score: 72,
            health_tier: "healthy" as const,
            sector_median: 0.32,
            sector_top_quartile: 0.45,
            formatted_median: "32.0%",
            formatted_top_quartile: "45.0%",
          },
          {
            ratio_key: "debtor_days",
            ratio_name: "Debtor Days",
            pillar: "cash" as const,
            current_value: 45,
            formatted_current: "45d",
            health_score: 40,
            health_tier: "at_risk" as const,
            sector_median: 30,
            sector_top_quartile: 20,
            formatted_median: "30d",
            formatted_top_quartile: "20d",
            lower_is_better: true,
          },
        ],
      });
    },
  },

  // ── 3. Cash Cycle ─────────────────────────────────────────────────────────
  {
    name: "CashCycle / demo",
    async build() {
      const { CashCyclePDF } = await import("../src/reports/cash-cycle.js");
      return createElement(CashCyclePDF, {
        smeData: SME,
        accountantProfile: ACCOUNTANT,
        isDemo: true,
        workingCapitalData: {
          debtor_days: 42,
          debtor_days_prior: 48,
          inventory_days: 35,
          inventory_days_prior: 38,
          wip_days: 5,
          wip_days_prior: 6,
          creditor_days: 28,
          creditor_days_prior: 25,
          cash_conversion_cycle: 54,
          ccc_prior: 67,
          working_capital_funding: 0.72,
          working_capital_utilization: 0.65,
          working_capital_days: 54,
          annual_revenue: 8_500_000,
          cash_trapped_rands: 1_258_000,
          health_scores: {
            debtor_days: 60,
            inventory_days: 70,
            creditor_days: 55,
            wip_days: 80,
            working_capital_days: 62,
            working_capital_funding: 68,
            working_capital_utilization: 58,
          },
        },
      });
    },
  },

  // ── 4. Cash Forecast ──────────────────────────────────────────────────────
  {
    name: "CashForecast / growth scenario",
    async build() {
      const { CashForecastPDF } = await import("../src/reports/cash-forecast.js");
      const weeks = Array.from({ length: 13 }, (_, i) => ({
        period_label: `Week ${i + 1}`,
        opening_balance: 500_000 + i * 20_000,
        total_receipts: 220_000 + i * 5_000,
        total_payments: 190_000 + i * 3_000,
        net_movement: 30_000 + i * 2_000,
        closing_balance: 530_000 + i * 22_000,
        scenario: "growth" as const,
        runway_weeks: 26 - i,
      }));
      return createElement(CashForecastPDF, {
        smeData: SME,
        accountantProfile: ACCOUNTANT,
        isDemo: true,
        cashForecast: weeks,
        scenario: "growth",
        minimumThreshold: 150_000,
        assumptions: [
          "Sales growth of 5% per month assumed.",
          "Supplier terms unchanged at 30 days net.",
        ],
      });
    },
  },
  {
    name: "CashForecast / critical scenario",
    async build() {
      const { CashForecastPDF } = await import("../src/reports/cash-forecast.js");
      const weeks = Array.from({ length: 13 }, (_, i) => ({
        period_label: `Week ${i + 1}`,
        opening_balance: 200_000 - i * 15_000,
        total_receipts: 80_000,
        total_payments: 95_000,
        net_movement: -15_000,
        closing_balance: Math.max(0, 200_000 - (i + 1) * 15_000),
        scenario: "critical" as const,
        runway_weeks: Math.max(0, 13 - i),
      }));
      return createElement(CashForecastPDF, {
        smeData: SME,
        accountantProfile: ACCOUNTANT,
        cashForecast: weeks,
        scenario: "critical",
      });
    },
  },

  // ── 5. Health Scorecard ───────────────────────────────────────────────────
  {
    name: "HealthScorecard / demo",
    async build() {
      const { HealthScorecardPDF } = await import("../src/reports/health-scorecard.js");
      return createElement(HealthScorecardPDF, {
        smeData: SME,
        accountantProfile: ACCOUNTANT,
        isDemo: true,
        ratioResults: [
          {
            ratio_key: "gross_margin",
            ratio_name: "Gross Margin",
            pillar: "profit" as const,
            current_value: 0.38,
            health_score: 72,
            health_tier: "healthy" as const,
            prior_period_value: 0.35,
            prior_period_score: 65,
            formatted_value: "38.0%",
          },
          {
            ratio_key: "asset_turnover",
            ratio_name: "Asset Turnover",
            pillar: "assets" as const,
            current_value: 1.5,
            health_score: 68,
            health_tier: "healthy" as const,
            formatted_value: "1.50×",
          },
          {
            ratio_key: "debt_to_equity",
            ratio_name: "Debt to Equity",
            pillar: "financing" as const,
            current_value: 0.6,
            health_score: 55,
            health_tier: "at_risk" as const,
            formatted_value: "0.60×",
          },
          {
            ratio_key: "cash_conversion_cycle",
            ratio_name: "Cash Conversion Cycle",
            pillar: "cash" as const,
            current_value: 54,
            health_score: 30,
            health_tier: "critical" as const,
            formatted_value: "54d",
          },
        ],
      });
    },
  },

  // ── 6. Intervention Priority ─────────────────────────────────────────────
  {
    name: "InterventionPriority / with items",
    async build() {
      const { InterventionPriorityPDF } = await import(
        "../src/reports/intervention-priority.js"
      );
      return createElement(InterventionPriorityPDF, {
        smeData: SME,
        accountantProfile: ACCOUNTANT,
        isDemo: true,
        interventions: [
          {
            ratio_key: "cash_conversion_cycle",
            ratio_name: "Cash Conversion Cycle",
            health_tier: "critical" as const,
            step_number: 1,
            step_title: "Reduce debtor days",
            step_description:
              "Implement a 14-day follow-up process for all overdue invoices.",
            timeframe: "30 days",
            effort: "Medium",
            impact: "High",
            category: "Cash Flow",
          },
          {
            ratio_key: "gross_margin",
            ratio_name: "Gross Margin",
            health_tier: "at_risk" as const,
            step_number: 2,
            step_title: "Review pricing strategy",
            step_description:
              "Benchmark prices against competitors and identify margin leakage.",
            timeframe: "60 days",
            effort: "High",
            impact: "High",
            category: "Profitability",
          },
        ],
      });
    },
  },
  {
    name: "InterventionPriority / empty (no interventions)",
    async build() {
      const { InterventionPriorityPDF } = await import(
        "../src/reports/intervention-priority.js"
      );
      return createElement(InterventionPriorityPDF, {
        smeData: SME,
        accountantProfile: ACCOUNTANT,
        interventions: [], // edge case: all healthy, nothing to fix
      });
    },
  },

  // ── 7. Labor Productivity ─────────────────────────────────────────────────
  {
    name: "LaborProductivity / demo",
    async build() {
      const { LaborProductivityPDF } = await import(
        "../src/reports/labor-productivity.js"
      );
      return createElement(LaborProductivityPDF, {
        smeData: SME,
        accountantProfile: ACCOUNTANT,
        isDemo: true,
        data: {
          employee_count: 24,
          total_labor_cost: 3_600_000,
          total_revenue: 12_000_000,
          total_gp: 4_560_000,
          revenue_per_employee: 500_000,
          rpe_prior: 465_000,
          gp_per_labor_rand: 1.27,
          revenue_growth: 0.08,
          inflation_rate: 0.062,
          periods: [
            { label: "Dec 2022", revenue: 9_800_000, employees: 20, labor_cost: 2_900_000 },
            { label: "Dec 2023", revenue: 11_100_000, employees: 22, labor_cost: 3_300_000 },
            { label: "Dec 2024", revenue: 12_000_000, employees: 24, labor_cost: 3_600_000 },
          ],
          health_scores: {
            gpToLabor: 75,
            salesPerEmployee: 68,
            revenueGrowth: 72,
          },
        },
      });
    },
  },

  // ── 8. Leverage & Solvency ────────────────────────────────────────────────
  {
    name: "LeverageSolvency / with debt lines",
    async build() {
      const { LeverageSolvencyPDF } = await import("../src/reports/leverage-solvency.js");
      return createElement(LeverageSolvencyPDF, {
        smeData: SME,
        accountantProfile: ACCOUNTANT,
        isDemo: true,
        data: {
          total_debt: 2_400_000,
          total_equity: 3_800_000,
          net_profit: 680_000,
          drawings: 120_000,
          prior_equity: 3_240_000,
          debt_lines: [
            { label: "FNB Term Loan", amount: 1_500_000, annual_rate_pct: 11.5, maturity_year: 2027 },
            { label: "Overdraft Facility", amount: 500_000, annual_rate_pct: 14.0, maturity_year: 2025 },
            { label: "Asset Finance", amount: 400_000, annual_rate_pct: 10.0, maturity_year: 2028 },
          ],
          health_scores: {
            fundingStructure: 68,
            equityMultiplier: 72,
            debtToEquity: 55,
            debtToAssets: 60,
            interestBurden: 48,
          },
        },
      });
    },
  },
  {
    name: "LeverageSolvency / no debt lines",
    async build() {
      const { LeverageSolvencyPDF } = await import("../src/reports/leverage-solvency.js");
      return createElement(LeverageSolvencyPDF, {
        smeData: SME,
        accountantProfile: ACCOUNTANT,
        data: {
          total_debt: 0,
          total_equity: 2_000_000,
          net_profit: 400_000,
          drawings: 80_000,
          prior_equity: 1_680_000,
          debt_lines: [], // edge case: debt-free business
          health_scores: {
            fundingStructure: 95,
            equityMultiplier: 90,
            debtToEquity: 95,
            debtToAssets: 92,
            interestBurden: 100,
          },
        },
      });
    },
  },

  // ── 9. Profitability Waterfall ────────────────────────────────────────────
  {
    name: "ProfitabilityWaterfall / with prior period",
    async build() {
      const { ProfitabilityWaterfallPDF } = await import(
        "../src/reports/profitability-waterfall.js"
      );
      return createElement(ProfitabilityWaterfallPDF, {
        smeData: SME,
        accountantProfile: ACCOUNTANT,
        isDemo: true,
        profitabilityData: {
          revenue: 12_000_000,
          gross_profit: 4_560_000,
          gross_margin_pct: 0.38,
          gross_margin_score: 72,
          gross_margin_tier: "healthy",
          operating_profit: 1_800_000,
          operating_margin_pct: 0.15,
          operating_margin_score: 65,
          operating_margin_tier: "healthy",
          ebt: 1_560_000,
          interest_burden_pct: 0.013,
          interest_burden_score: 70,
          tax: 436_800,
          tax_burden_pct: 0.28,
          tax_burden_score: 80,
          net_profit: 1_123_200,
          net_margin_pct: 0.0936,
          net_margin_score: 68,
          net_margin_tier: "healthy",
          prior_period: {
            revenue: 11_100_000,
            gross_profit: 4_107_000,
            gross_margin_pct: 0.37,
            operating_profit: 1_554_000,
            operating_margin_pct: 0.14,
            ebt: 1_332_000,
            tax: 373_000,
            net_profit: 959_000,
            net_margin_pct: 0.0864,
          },
        },
      });
    },
  },
  {
    name: "ProfitabilityWaterfall / single period (no prior)",
    async build() {
      const { ProfitabilityWaterfallPDF } = await import(
        "../src/reports/profitability-waterfall.js"
      );
      return createElement(ProfitabilityWaterfallPDF, {
        smeData: SME,
        accountantProfile: ACCOUNTANT,
        profitabilityData: {
          revenue: 5_000_000,
          gross_profit: 1_800_000,
          gross_margin_pct: 0.36,
          operating_profit: 600_000,
          operating_margin_pct: 0.12,
          ebt: 540_000,
          tax: 151_200,
          net_profit: 388_800,
          net_margin_pct: 0.0778,
          // no prior_period — edge case
        },
      });
    },
  },

  // ── 10. Ratio Movement ────────────────────────────────────────────────────
  {
    name: "RatioMovement / multi-period",
    async build() {
      const { RatioMovementPDF } = await import("../src/reports/ratio-movement.js");
      return createElement(RatioMovementPDF, {
        smeData: SME,
        accountantProfile: ACCOUNTANT,
        isDemo: true,
        ratios: [
          {
            ratio_key: "gross_margin",
            ratio_name: "Gross Margin",
            pillar: "profit" as const,
            unit: "%",
            current: 0.38,
            three_months: 0.36,
            six_months: 0.33,
            twelve_months: 0.31,
          },
          {
            ratio_key: "debtor_days",
            ratio_name: "Debtor Days",
            pillar: "cash" as const,
            unit: "d",
            current: 42,
            three_months: 45,
            six_months: 50,
            twelve_months: 55,
            lower_is_better: true,
          },
          {
            ratio_key: "asset_turnover",
            ratio_name: "Asset Turnover",
            pillar: "assets" as const,
            unit: "×",
            current: 1.5,
            three_months: null,
            six_months: null,
            twelve_months: null, // edge case: no historical data
          },
        ],
        periodLabels: {
          current: "Dec 2024",
          three_months: "Sep 2024",
          six_months: "Jun 2024",
          twelve_months: "Dec 2023",
        },
      });
    },
  },
  {
    name: "RatioMovement / single period (nulls everywhere)",
    async build() {
      const { RatioMovementPDF } = await import("../src/reports/ratio-movement.js");
      return createElement(RatioMovementPDF, {
        smeData: SME,
        accountantProfile: ACCOUNTANT,
        ratios: [
          {
            ratio_key: "net_margin",
            ratio_name: "Net Margin",
            pillar: "profit" as const,
            unit: "%",
            current: 0.09,
            three_months: null,
            six_months: null,
            twelve_months: null,
          },
        ],
      });
    },
  },
];

// ── Runner ───────────────────────────────────────────────────────────────────

async function main() {
  // Dynamic import so this runs after vite-node resolves the alias
  const { renderToBuffer } = await import("@react-pdf/renderer");

  const results: { name: string; status: "PASS" | "FAIL"; error?: string }[] = [];
  let failed = 0;

  console.log(`\n🔍  PDF Smoke Test — ${cases.length} cases\n`);

  for (const tc of cases) {
    try {
      const element = await tc.build();
      const buf = await renderToBuffer(element);
      if (!buf || buf.length < 100) {
        throw new Error(`Rendered buffer suspiciously small (${buf?.length ?? 0} bytes)`);
      }
      results.push({ name: tc.name, status: "PASS" });
      console.log(`  ✅  ${tc.name} (${(buf.length / 1024).toFixed(0)} KB)`);
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ name: tc.name, status: "FAIL", error: msg });
      console.error(`  ❌  ${tc.name}`);
      console.error(`      ${msg}`);
    }
  }

  const passed = results.filter((r) => r.status === "PASS").length;
  console.log(`\n─────────────────────────────────────`);
  console.log(`  ${passed}/${results.length} passed${failed ? `  (${failed} FAILED)` : ""}`);
  console.log(`─────────────────────────────────────\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error in smoke-test runner:", err);
  process.exit(1);
});
