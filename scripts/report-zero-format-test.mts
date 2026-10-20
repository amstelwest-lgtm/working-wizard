/**
 * Report PDFs print an em dash for a rounded zero.
 * 11 reports × normal / all-zero / mixed × ZA and US.
 * Run: pnpm test:report-zero-format
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { getDocumentProxy } from "unpdf";
import { formatVariancePct } from "../src/lib/budget.variance";
import {
  budgetActualFromFinancials,
  buildBudgetPdfModel,
  illustrativeBudgetPack,
} from "../src/lib/budget-pdf";
import { fyMonths } from "../src/lib/budget.months";
import { formatReportAmount } from "../src/lib/market/format";
import { resolveMarket, ZA_MARKET, type ResolvedMarket } from "../src/lib/market/resolve";
import {
  buildScorecardRatioResults,
  scorecardRatiosFromFinancials,
} from "../src/lib/scorecard-rows";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const US = resolveMarket({ country: "US", regionCode: "NY" });

assert(formatReportAmount(0, US) === "—", "US zero money is a dash");
assert(formatReportAmount(0.4, US) === "—", "a value that rounds to 0 is a dash");
assert(formatReportAmount(1, US) === "$1", `US unit stays $1, got ${formatReportAmount(1, US)}`);
assert(
  formatReportAmount(1, ZA_MARKET) === "R 1",
  `ZA unit stays R 1, got ${formatReportAmount(1, ZA_MARKET)}`,
);
assert(formatReportAmount(-40, US) === "-$40", "a real negative keeps its minus");
assert(formatReportAmount(0, US, { sign: "parens" }) === "—", "a zero payment is not ($0)");
assert(
  formatReportAmount(25, US, { sign: "parens" }) === "($25)",
  "a real payment keeps parentheses",
);
assert(formatReportAmount(0, US, { sign: "always" }) === "—", "a zero signed amount has no plus");
assert(
  formatReportAmount(12, US, { sign: "always" }) === "+$12",
  "a positive variance keeps its plus",
);
assert(
  formatReportAmount(-8, ZA_MARKET, { sign: "always" }) === "-R 8",
  "ZA signed amount keeps the gap",
);
assert(formatReportAmount(0, US, { style: "percent" }) === "—", "a zero ratio is not 0.0%");
assert(
  formatReportAmount(0.1, US, { style: "percent" }) === "10.0%",
  "a real ratio stays a percent",
);
assert(
  formatReportAmount(0, US, { style: "compact", sign: "parens" }) === "—",
  "a zero chart decrease is a dash",
);
assert(formatVariancePct(0.01) === "—", "a near-zero variance percent is a dash");
assert(formatVariancePct(-12.5) === "-12.5%", "a real variance percent keeps its sign");
assert(
  formatVariancePct(null, "budget is negative") === "budget is negative",
  "a variance note is kept",
);
assert(formatReportAmount(0, US, { fractionDigits: 2 }) === "—", "two-decimal zero is a dash");
assert(formatReportAmount(9.36, US, { fractionDigits: 2 }) === "$9.36", "US cents stay");
assert(
  formatReportAmount(9.36, ZA_MARKET, { fractionDigits: 2 }) === "R 9,36",
  "ZA cents keep the gap",
);

const exec = readFileSync(resolve("src/components/pdf/exec-summary.tsx"), "utf8");
assert(exec.includes('f.direction !== "flat"'), "a flat KPI direction draws no arrow");

const MONTHS = "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec";
const US_DATE = new RegExp(`\\b(?:${MONTHS}) \\d{1,2}, \\d{4}\\b`);
const ZA_DATE = new RegExp(`\\b\\d{1,2} (?:${MONTHS}) \\d{4}\\b`);
const BANNED: Array<[RegExp, string]> = [
  [/\$0(?![\d.,])/, "$0"],
  [/\$0[,.]0+(?!\d)/, "$0.00"],
  [/\(\$0\)/, "($0)"],
  [/-\$0(?![\d.,])/, "-$0"],
  [/\+\$0(?![\d.,])/, "+$0"],
  [/R 0(?![\d.,])/, "R 0"],
  [/R 0[,.]0+(?!\d)/, "R 0,00"],
  [/(^|[^A-Za-z0-9])R0(?![\d.,])/, "R0"],
  [/(?<![\d.])0\.0%/, "0.0%"],
  [/\/\//, "//"],
];

type TextItem = { str: string; transform: number[] };

async function pageText(buf: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const lines: string[] = [];
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    const buckets = new Map<number, Array<{ x: number; str: string }>>();
    for (const item of content.items as TextItem[]) {
      if (!item.str || !item.str.trim()) continue;
      const y = item.transform[5] ?? 0;
      const key = Math.round(y / 2) * 2;
      const row = buckets.get(key) ?? [];
      row.push({ x: item.transform[4] ?? 0, str: item.str });
      buckets.set(key, row);
    }
    for (const [, parts] of [...buckets.entries()].sort((a, b) => b[0] - a[0])) {
      lines.push(
        parts
          .sort((a, b) => a.x - b.x)
          .map((part) => part.str)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim(),
      );
    }
  }
  return lines.join("\n");
}

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

type Shape = "normal" | "zero" | "mixed";

function amount(shape: Shape, value: number, slot = 0): number {
  if (shape === "zero") return 0;
  if (shape === "mixed") return slot % 2 === 0 ? 0 : value;
  return value;
}

const qaCover = {
  revenue: 700000,
  cogs: 280000,
  ebit: 60000,
  ebitda: 69000,
  fixedCosts: 351000,
  periodMonths: "12",
  periodStart: "2026-01-01",
  periodEnd: "2026-09-30",
};

function fullYearBudget(market: ResolvedMarket) {
  const { doc } = illustrativeBudgetPack("2026-01");
  const months = fyMonths("2026-01");
  const monthly = 700_000 / 12;
  doc.revenueLines = doc.revenueLines.map((line, index) => ({
    ...line,
    months: Object.fromEntries(
      months.map((month) => [
        month,
        index === 0 ? { volume: 1, price: monthly } : { volume: 0, price: 0 },
      ]),
    ),
  }));
  const actual = budgetActualFromFinancials(qaCover, market);
  return buildBudgetPdfModel(doc, actual ? [actual] : [], market);
}

function zeroBudget(market: ResolvedMarket) {
  const { doc } = illustrativeBudgetPack("2026-01");
  const months = fyMonths("2026-01");
  doc.revenueLines = doc.revenueLines.map((line) => ({
    ...line,
    months: Object.fromEntries(months.map((month) => [month, { volume: 0, price: 0 }])),
  }));
  doc.overheads = doc.overheads.map((line) => ({
    ...line,
    months: Object.fromEntries(months.map((month) => [month, 0])),
  }));
  doc.openingCash = 0;
  const actual = budgetActualFromFinancials(
    { ...qaCover, revenue: 0, cogs: 0, ebit: 0, ebitda: 0, fixedCosts: 0 },
    market,
  );
  return buildBudgetPdfModel(doc, actual ? [actual] : [], market);
}

function financials(shape: Shape): Record<string, string> {
  const n = (value: number, slot: number) => String(amount(shape, value, slot));
  return {
    revenue: n(1_000_000, 1),
    cogs: n(600_000, 0),
    ebit: n(150_000, 1),
    ebt: n(140_000, 1),
    netIncome: n(100_000, 1),
    ebitda: n(180_000, 1),
    operatingCashflow: n(160_000, 1),
    totalAssets: n(800_000, 1),
    equity: n(400_000, 1),
    receivables: n(120_000, 0),
    inventory: n(80_000, 1),
    payables: n(60_000, 0),
    fixedCosts: n(200_000, 1),
    variableCosts: n(400_000, 0),
    top5Revenue: n(400_000, 1),
    laborCost: n(250_000, 0),
    employees: shape === "zero" ? "0" : "10",
    periodMonths: "12",
  };
}

async function elementsFor(market: ResolvedMarket, shape: Shape) {
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

  const fin = financials(shape);
  const ratios = buildScorecardRatioResults(scorecardRatiosFromFinancials(fin), market, {
    equity: Number(fin.equity),
    periodMonths: 12,
    cashFlowKnown: shape !== "zero",
  });
  const weeks = Array.from({ length: 13 }, (_, i) => ({
    period_label: `Week ${i + 1}`,
    opening_balance: amount(shape, 500_000, i),
    total_receipts: amount(shape, 220_000, i),
    total_payments: amount(shape, 190_000, i + 1),
    net_movement: amount(shape, 30_000, i),
    closing_balance: amount(shape, 530_000, i),
    scenario: "growth" as const,
    runway_weeks: shape === "zero" ? 0 : 26 - i,
  }));
  const revenue = amount(shape, 12_000_000, 1);
  const tax = amount(shape, 436_800, 0);
  const common = { smeData: SME, accountantProfile: ACCOUNTANT, isDemo: true, market };
  const margin = (value: number) => (shape === "zero" ? 0 : value);
  const benchPct = (value: number) =>
    formatReportAmount(shape === "zero" ? 0 : value, market, { style: "percent" });

  return [
    ["scorecard", createElement(HealthScorecardPDF, { ...common, ratioResults: ratios })],
    [
      "intervention",
      createElement(InterventionPriorityPDF, {
        ...common,
        interventions:
          shape === "zero"
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
              ],
      }),
    ],
    [
      "forecast",
      createElement(CashForecastPDF, {
        ...common,
        cashForecast: weeks,
        scenario: "growth",
        minimumThreshold: amount(shape, 150_000, 0),
        assumptions: shape === "zero" ? [] : ["Sales growth of 5% per month assumed."],
      }),
    ],
    [
      "cycle",
      createElement(CashCyclePDF, {
        ...common,
        workingCapitalData: {
          debtor_days: shape === "zero" ? 0 : 42,
          debtor_days_prior: 48,
          inventory_days: 35,
          inventory_days_prior: 38,
          wip_days: 5,
          wip_days_prior: 6,
          creditor_days: 28,
          creditor_days_prior: 25,
          cash_conversion_cycle: shape === "zero" ? 0 : 54,
          ccc_prior: 67,
          working_capital_funding: margin(0.72),
          working_capital_utilization: margin(0.65),
          working_capital_days: 54,
          annual_revenue: amount(shape, 8_500_000, 1),
          cash_trapped_rands: amount(shape, 1_258_000, 0),
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
      }),
    ],
    [
      "waterfall",
      createElement(ProfitabilityWaterfallPDF, {
        ...common,
        profitabilityData: {
          revenue,
          gross_profit: amount(shape, 4_560_000, 1),
          gross_margin_pct: margin(0.38),
          gross_margin_score: 72,
          gross_margin_tier: "healthy",
          operating_profit: amount(shape, 1_800_000, 1),
          operating_margin_pct: margin(0.15),
          operating_margin_score: 65,
          operating_margin_tier: "healthy",
          ebt: amount(shape, 1_560_000, 1),
          interest_burden_pct: margin(0.013),
          interest_burden_score: 70,
          tax,
          tax_burden_pct: margin(0.28),
          tax_burden_score: 80,
          net_profit: amount(shape, 1_123_200, 1),
          net_margin_pct: margin(0.0936),
          net_margin_score: 68,
          net_margin_tier: "healthy",
          prior_period: {
            revenue: amount(shape, 11_100_000, 1),
            gross_profit: amount(shape, 4_107_000, 1),
            gross_margin_pct: margin(0.37),
            operating_profit: amount(shape, 1_554_000, 1),
            operating_margin_pct: margin(0.14),
            ebt: amount(shape, 1_332_000, 1),
            tax: amount(shape, 373_000, 0),
            net_profit: amount(shape, 959_000, 1),
            net_margin_pct: margin(0.0864),
          },
        },
      }),
    ],
    [
      "leverage",
      createElement(LeverageSolvencyPDF, {
        ...common,
        data: {
          total_debt: amount(shape, 2_400_000, 1),
          total_equity: amount(shape, 3_800_000, 1),
          total_liabilities: amount(shape, 2_600_000, 1),
          net_profit: amount(shape, 680_000, 0),
          drawings: amount(shape, 120_000, 0),
          prior_equity: amount(shape, 3_240_000, 1),
          debt_lines:
            shape === "zero"
              ? []
              : [
                  {
                    label: "Term loan",
                    amount: amount(shape, 1_500_000, 1),
                    annual_rate_pct: 11.5,
                    maturity_year: 2027,
                  },
                  {
                    label: "Overdraft",
                    amount: amount(shape, 500_000, 1),
                    annual_rate_pct: shape === "mixed" ? 0 : 14,
                    maturity_year: 2025,
                  },
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
          roe: margin(0.18),
          net_margin: margin(0.12),
          asset_turnover: shape === "zero" ? 0 : 1.5,
          equity_multiplier: shape === "zero" ? 0 : 1.8,
          capex_periods: [
            {
              label: "Dec 2024",
              capex: amount(shape, 210_000, 1),
              depreciation: amount(shape, 108_000, 0),
            },
          ],
          health_scores: {
            assetTurnover: 72,
            roa: 58,
            fixedCapitalUtilization: 65,
            assetReinvestmentRatio: 80,
            capexIntensity: 45,
          },
          ratios: {
            assetTurnover: { value: shape === "zero" ? "0.00×" : "1.50×" },
            roa: { value: benchPct(0.18) },
            fixedCapitalUtilization: { value: "0.82×" },
            assetReinvestmentRatio: { value: "1.94×" },
            capexIntensity: { value: benchPct(0.042) },
          },
        },
      }),
    ],
    [
      "labor",
      createElement(LaborProductivityPDF, {
        ...common,
        data: {
          employee_count: shape === "zero" ? 0 : 24,
          total_labor_cost: amount(shape, 3_600_000, 0),
          total_revenue: amount(shape, 12_000_000, 1),
          total_gp: amount(shape, 4_560_000, 1),
          revenue_per_employee: amount(shape, 500_000, 1),
          rpe_prior: amount(shape, 465_000, 1),
          gp_per_labor_rand: shape === "zero" ? 0 : 1.27,
          revenue_growth: margin(0.08),
          inflation_rate: margin(0.062),
          periods: [
            {
              label: "Current Period",
              revenue: amount(shape, 12_000_000, 1),
              employees: shape === "mixed" ? 0 : shape === "zero" ? 0 : 24,
              labor_cost: amount(shape, 3_600_000, 0),
            },
            {
              label: "Prior Period",
              revenue: amount(shape, 9_800_000, 1),
              employees: shape === "zero" ? 0 : 20,
              labor_cost: amount(shape, 2_900_000, 1),
            },
          ],
          health_scores: { gpToLabor: 75, salesPerEmployee: 68, revenueGrowth: 72 },
        },
      }),
    ],
    [
      "movement",
      createElement(RatioMovementPDF, {
        ...common,
        ratios: [
          {
            ratio_key: "gross_margin",
            ratio_name: "Gross Margin",
            pillar: "profit" as const,
            unit: "%",
            current: margin(0.38),
            three_months: margin(0.36),
            six_months: shape === "mixed" ? 0 : margin(0.33),
            twelve_months: margin(0.31),
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
            current_value: margin(0.38),
            formatted_current: benchPct(0.38),
            health_score: 72,
            health_tier: "healthy" as const,
            sector_median: margin(0.32),
            sector_top_quartile: 0.45,
            formatted_median: benchPct(0.32),
            formatted_top_quartile: formatReportAmount(0.45, market, { style: "percent" }),
          },
        ],
      }),
    ],
    [
      "budget",
      createElement(BudgetVariancePDF, {
        ...common,
        model:
          shape === "zero"
            ? zeroBudget(market)
            : shape === "mixed"
              ? fullYearBudget(market)
              : fullYearBudget(market),
      }),
    ],
  ] as const;
}

function assertClean(label: string, text: string, market: ResolvedMarket) {
  for (const [pattern, name] of BANNED) {
    const hit = text.match(pattern);
    assert(!hit, `${label} contains ${name} (${hit?.[0]})`);
  }
  const stray = text.match(/(?:\$[\d,]+|R\s+\d[\d\s]*?)\s+[-–](?!\s*(?:\$|R|\d))/);
  assert(!stray, `${label} KPI has a stray dash (${stray?.[0]})`);
  if (market.currency === "USD") {
    assert(US_DATE.test(text), `${label} is missing a US date`);
    assert(!ZA_DATE.test(text), `${label} uses a ZA date`);
  } else {
    assert(ZA_DATE.test(text), `${label} is missing a ZA date`);
    assert(!US_DATE.test(text), `${label} uses a US date`);
  }
}

async function main() {
  const { renderToBuffer } = await import("@react-pdf/renderer");
  for (const market of [ZA_MARKET, US]) {
    for (const shape of ["normal", "zero", "mixed"] as const) {
      const reports = await elementsFor(market, shape);
      assert(reports.length === 11, "the catalogue is eleven reports");
      for (const [name, element] of reports) {
        const buf = await renderToBuffer(element);
        const text = await pageText(buf);
        const label = `${market.currency}/${shape}/${name}`;
        assertClean(label, text, market);
        if (name === "labor" && shape !== "zero") {
          const flat = text.replace(/\s+/g, " ").toLowerCase();
          const unit = market.currency === "USD" ? "gp per $1 of wages" : "gp per r 1 of wages";
          assert(flat.includes(unit), `${label} keeps the wage unit (${unit})`);
        }
        if (name === "budget" && shape !== "zero") {
          assert(
            text.includes("Jan 2026 – Dec 2026"),
            `${label} compared span is ${text.match(/Jan 20\d\d[^.\n]*/)?.[0]}`,
          );
          assert(!text.includes("Jan 26"), `${label} still prints a two-digit year`);
          assert(!/In line/.test(text), `${label} still prints In line for a zero variance`);
        }
        if (name === "forecast" && shape !== "normal") {
          assert(text.includes("Week 1"), `${label} keeps the week row label`);
          assert(!text.includes("date-ok"), `${label} prints a date-ok marker`);
        }
      }
    }
  }
  console.log("report-zero-format: ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
