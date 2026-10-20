/**
 * Section headings stay with their first row on every report PDF.
 * Run: pnpm test:report-section-keep
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { getDocumentProxy } from "unpdf";
import { varianceIsZeroPair, variancePctCell } from "../src/lib/budget.variance";
import { buildBudgetPdfModel, illustrativeBudgetPack } from "../src/lib/budget-pdf";
import { resolveMarket, ZA_MARKET, type ResolvedMarket } from "../src/lib/market/resolve";
import { buildScorecardRatioResults, scorecardRatiosFromFinancials } from "../src/lib/scorecard-rows";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

assert(varianceIsZeroPair(0, 0), "both sides zero is a zero pair");
assert(!varianceIsZeroPair(0, null), "a blank actual is not a zero pair");
assert(!varianceIsZeroPair(0, 10), "a zero budget with a real actual is not a zero pair");
assert(!varianceIsZeroPair(10, 0), "a real budget with a zero actual is not a zero pair");
assert(variancePctCell(null, "budget is near zero") === "n/a", "a near-zero budget with a balance still prints n/a");

const SECTION_TITLES = [
  "Conversion Cycle Timeline",
  "Cash Trapped in the Cycle",
  "Working Capital Ratio Analysis",
  "Funding Structure",
  "Leverage Ratio Analysis",
  "Debt Facility Breakdown",
  "Equity Movement",
  "Projected Closing Balance by Week",
  "Weekly Cash Movement Detail",
  "Forecast Assumptions",
  "Wave 1 — Act Now",
  "Wave 2 — Stabilise",
  "Wave 2 — Stabilize",
  "Wave 3 — Strengthen",
  "Revenue vs Labour cost",
  "Revenue vs Labor cost",
  "Period Detail",
  "Labour Productivity ratios",
  "Labor Productivity ratios",
  "Revenue-to-Profit Bridge",
  "Margin Ladder",
  "Current vs Prior Period",
  "Profit Pillar Ratio Analysis",
  "DuPont Decomposition — ROE Driver Analysis",
  "Asset Ratio Analysis",
  "Capex vs Depreciation Trend",
  "Profit and loss",
  "Revenue drivers",
  "Overheads",
  "Partner notes",
  "Profit",
  "Assets",
  "Financing",
  "Cash",
];

const REPORTS = [
  "src/reports/health-scorecard.tsx",
  "src/reports/intervention-priority.tsx",
  "src/reports/cash-forecast.tsx",
  "src/reports/cash-cycle.tsx",
  "src/reports/profitability-waterfall.tsx",
  "src/reports/leverage-solvency.tsx",
  "src/reports/asset-productivity.tsx",
  "src/reports/labor-productivity.tsx",
  "src/reports/ratio-movement.tsx",
  "src/reports/benchmark-report.tsx",
  "src/reports/budget-variance.tsx",
];

for (const file of REPORTS) {
  const src = readFileSync(resolve(file), "utf8");
  assert(src.includes("ReportSection"), `${file} uses the shared section primitive`);
  const headers = src.split("<SectionHeader").length - 1;
  const wrapped = src.split("heading={<SectionHeader").length - 1;
  assert(headers > 0 && headers === wrapped, `${file} passes every section header through ReportSection`);
}

function norm(line: string): string {
  return line.trim().toLowerCase().replace(/\s+/g, " ");
}

function isHeadingLine(line: string): boolean {
  const text = norm(line);
  const titles = [...SECTION_TITLES].sort((a, b) => b.length - a.length);
  for (const title of titles) {
    const name = norm(title);
    if (text === name) return true;
    if (!text.startsWith(`${name} `)) continue;
    const rest = text.slice(name.length).trim();
    if (/^(score\s*)?\d{0,3}$/.test(rest)) return true;
  }
  return false;
}

function isChrome(line: string): boolean {
  const text = norm(line);
  if (!text) return true;
  if (/^(score|\d{1,3})$/.test(text)) return true;
  if (text === "illustrative data" || text === "draft" || text === "sample") return true;
  if (text.includes("confidential")) return true;
  if (text.includes("prepared with")) return true;
  if (text.includes("prepared for the addressee")) return true;
  if (/^\d+\s*\/\s*\d+$/.test(text)) return true;
  if (text.startsWith("signed off by")) return true;
  return false;
}

function isProse(line: string): boolean {
  if (isHeadingLine(line) || isChrome(line)) return false;
  const words = line.trim().split(/\s+/);
  return words.length >= 10 && /[.]/.test(line);
}

type TextItem = { str: string; transform: number[] };

async function pageLines(buf: Buffer): Promise<string[][]> {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const pages: string[][] = [];
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    const buckets = new Map<number, Array<{ x: number; str: string }>>();
    for (const item of content.items as TextItem[]) {
      if (!item.str || !item.str.trim()) continue;
      const x = item.transform[4] ?? 0;
      const y = item.transform[5] ?? 0;
      if (y < 78) continue;
      const key = Math.round(y / 2) * 2;
      const row = buckets.get(key) ?? [];
      row.push({ x, str: item.str });
      buckets.set(key, row);
    }
    const lines = [...buckets.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, parts]) =>
        parts
          .sort((a, b) => a.x - b.x)
          .map((part) => part.str)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter((line) => line && !isChrome(line));
    pages.push(lines);
  }
  return pages;
}

function assertSectionsStayTogether(label: string, pages: string[][]) {
  pages.forEach((lines, index) => {
    const last = [...lines].reverse().find((line) => !isChrome(line)) ?? "";
    assert(!isHeadingLine(last), `${label} page ${index + 1} ends on a section heading (${last})`);
  });
  pages.forEach((lines, index) => {
    lines.forEach((line, lineIndex) => {
      if (!isHeadingLine(line)) return;
      const after = lines.slice(lineIndex + 1).filter((row) => !isChrome(row) && !isHeadingLine(row));
      assert(after.length > 0, `${label} page ${index + 1} heading has no row (${line})`);
      if (!after.every(isProse)) return;
      const next = pages[index + 1]?.find((row) => !isChrome(row)) ?? "";
      assert(
        !next || isHeadingLine(next),
        `${label} page ${index + 1} heading and its first row are on different pages (${line} → ${next})`,
      );
    });
  });
}

const US = resolveMarket({ country: "US", regionCode: "NY" });
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

const financials = {
  revenue: "1000000",
  cogs: "600000",
  ebit: "150000",
  ebt: "140000",
  netIncome: "100000",
  ebitda: "180000",
  operatingCashflow: "160000",
  totalAssets: "800000",
  equity: "400000",
  receivables: "120000",
  inventory: "80000",
  payables: "60000",
  fixedCosts: "200000",
  variableCosts: "400000",
  top5Revenue: "400000",
  laborCost: "250000",
  employees: "10",
  periodMonths: "12",
};

function scorecardRows(market: ResolvedMarket) {
  return buildScorecardRatioResults(scorecardRatiosFromFinancials(financials), market, {
    equity: 400000,
    periodMonths: 12,
    cashFlowKnown: true,
  });
}

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

const workingCapital = {
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
};

async function elementsFor(shape: "za" | "us" | "sparse") {
  const market = shape === "us" ? US : ZA_MARKET;
  const sparse = shape === "sparse";
  const { HealthScorecardPDF } = await import("../src/reports/health-scorecard.js");
  const { InterventionPriorityPDF } = await import("../src/reports/intervention-priority.js");
  const { CashForecastPDF } = await import("../src/reports/cash-forecast.js");
  const { CashCyclePDF } = await import("../src/reports/cash-cycle.js");
  const { ProfitabilityWaterfallPDF } = await import("../src/reports/profitability-waterfall.js");
  const { LeverageSolvencyPDF } = await import("../src/reports/leverage-solvency.js");
  const { AssetProductivityPDF } = await import("../src/reports/asset-productivity.js");
  const { LaborProductivityPDF } = await import("../src/reports/labor-productivity.js");
  const { RatioMovementPDF } = await import("../src/reports/ratio-movement.js");
  const { BenchmarkReportPDF } = await import("../src/reports/benchmark-report.js");
  const { BudgetVariancePDF } = await import("../src/reports/budget-variance.js");

  const ratios = scorecardRows(market);
  const pack = illustrativeBudgetPack("2026-01");
  const common = { smeData: SME, accountantProfile: ACCOUNTANT, isDemo: true, market };

  return [
    ["scorecard", createElement(HealthScorecardPDF, { ...common, ratioResults: sparse ? ratios.slice(0, 1) : ratios })],
    [
      "intervention",
      createElement(InterventionPriorityPDF, {
        ...common,
        interventions: sparse
          ? []
          : [
              {
                ratio_key: "cash_conversion_cycle",
                ratio_name: "Cash Conversion Cycle",
                health_tier: "critical" as const,
                step_number: 1,
                step_title: "Reduce debtor days",
                step_description: "Chase invoices that are past the agreed terms.",
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
                step_title: "Review pricing",
                step_description: "Check the prices on the largest lines.",
                timeframe: "60 days",
                effort: "High",
                impact: "High",
                category: "Profitability",
              },
            ],
      }),
    ],
    [
      "forecast",
      createElement(CashForecastPDF, {
        ...common,
        cashForecast: sparse ? weeks.slice(0, 1) : weeks,
        scenario: "growth",
        minimumThreshold: 150_000,
        assumptions: sparse ? [] : ["Sales growth of 5% per month assumed."],
      }),
    ],
    ["cycle", createElement(CashCyclePDF, { ...common, workingCapitalData: workingCapital })],
    [
      "waterfall",
      createElement(ProfitabilityWaterfallPDF, {
        ...common,
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
          ...(sparse
            ? {}
            : {
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
              }),
        },
      }),
    ],
    [
      "leverage",
      createElement(LeverageSolvencyPDF, {
        ...common,
        data: {
          total_debt: sparse ? 0 : 2_400_000,
          total_equity: 3_800_000,
          net_profit: 680_000,
          drawings: 120_000,
          prior_equity: sparse ? undefined : 3_240_000,
          debt_lines: sparse
            ? []
            : [
                { label: "Term loan", amount: 1_500_000, annual_rate_pct: 11.5, maturity_year: 2027 },
                { label: "Overdraft", amount: 500_000, annual_rate_pct: 14, maturity_year: 2025 },
              ],
          health_scores: {
            fundingStructure: 68,
            equityMultiplier: 72,
            debtToEquity: 55,
            debtToAssets: 60,
            interestBurden: 48,
          },
        },
      }),
    ],
    [
      "assets",
      createElement(AssetProductivityPDF, {
        ...common,
        data: {
          roe: 0.18,
          net_margin: 0.12,
          asset_turnover: 1.5,
          equity_multiplier: 1.8,
          capex_periods: sparse
            ? []
            : [
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
      }),
    ],
    [
      "labor",
      createElement(LaborProductivityPDF, {
        ...common,
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
          periods: sparse
            ? [{ label: "Dec 2024", revenue: 12_000_000, employees: 24, labor_cost: 3_600_000 }]
            : [
                { label: "Dec 2022", revenue: 9_800_000, employees: 20, labor_cost: 2_900_000 },
                { label: "Dec 2023", revenue: 11_100_000, employees: 22, labor_cost: 3_300_000 },
                { label: "Dec 2024", revenue: 12_000_000, employees: 24, labor_cost: 3_600_000 },
              ],
          health_scores: { gpToLabor: 75, salesPerEmployee: 68, revenueGrowth: 72 },
        },
      }),
    ],
    [
      "movement",
      createElement(RatioMovementPDF, {
        ...common,
        ratios: sparse
          ? [
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
            ]
          : [
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
            ],
      }),
    ],
    [
      "benchmark",
      createElement(BenchmarkReportPDF, {
        ...common,
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
          ...(sparse
            ? []
            : [
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
              ]),
        ],
      }),
    ],
    [
      "budget",
      createElement(BudgetVariancePDF, {
        ...common,
        model: buildBudgetPdfModel(pack.doc, sparse ? [] : pack.actuals, market),
      }),
    ],
  ] as const;
}

async function main() {
  const { renderToBuffer } = await import("@react-pdf/renderer");
  for (const shape of ["za", "us", "sparse"] as const) {
    const reports = await elementsFor(shape);
    assert(reports.length === 11, "the catalogue is eleven reports");
    for (const [name, element] of reports) {
      const buf = await renderToBuffer(element);
      const pages = await pageLines(buf);
      assertSectionsStayTogether(`${shape}/${name}`, pages);
      if (name === "budget" && shape !== "sparse") {
        const text = pages.flat().join("\n");
        assert(text.toLowerCase().includes("depreciation"), `${shape} budget prints depreciation`);
        assert(!/\bn\/a\b/i.test(text), `${shape} budget zero pair does not print n/a`);
        const dep = pages.flat().find((line) => /depreciation/i.test(line)) ?? "";
        assert(!/—\s+[R$]/.test(dep), `${shape} budget zero pair has no amount under the dash (${dep})`);
      }
    }
  }
  console.log("report-section-keep: ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
