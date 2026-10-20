/**
 * P&L-only books must not print a missing day count as 0 or score it.
 * 11 reports × P&L-only / full / stored-zero × ZA and US, plus the Health,
 * Cash, scorecard, and ratios tab presenters.
 * Run: pnpm test:report-missing-metrics
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { getDocumentProxy } from "unpdf";
import { buildSpherePillars } from "../src/components/sphere-hero-adapter";
import { formatVal, tierLabel } from "../src/components/owner-board-ui";
import { dayScoreDriverLabel, cashDriverDayFigures } from "../src/lib/cash-driver-label";
import { benchmarkEmptyCopy } from "../src/lib/benchmark-empty";
import { reportInputsFromFinancials } from "../src/lib/equity-coherence";
import { resolveMarket, ZA_MARKET, type ResolvedMarket } from "../src/lib/market/resolve";
import { reportReady } from "../src/lib/reports-drafter-copy";
import {
  buildScorecardRatioResults,
  scorecardRatiosFromFinancials,
} from "../src/lib/scorecard-rows";
import {
  buildAssetData,
  buildInterventions,
  buildLaborData,
  buildLeverageData,
  buildMovementRows,
  buildProfitabilityData,
  buildWorkingCapitalData,
} from "../src/routes/_authenticated/reports-studio";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const US = resolveMarket({ country: "US", regionCode: "NY" });
const SME = { name: "Acme Trading", period: "December 2024" };
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

type Shape = "pl" | "full" | "zero";

function books(shape: Shape): Record<string, string> {
  const base: Record<string, string> = {
    revenue: "1000000",
    cogs: "600000",
    ebit: "150000",
    ebt: "140000",
    netIncome: "100000",
    ebitda: "180000",
    operatingCashflow: "160000",
    fixedCosts: "200000",
    variableCosts: "400000",
    top5Revenue: "400000",
    laborCost: "250000",
    periodMonths: "12",
  };
  if (shape === "pl") return base;
  const stock = shape === "zero" ? "0" : { receivables: "120000", inventory: "80000", payables: "60000" };
  return {
    ...base,
    totalAssets: shape === "zero" ? "0" : "800000",
    equity: shape === "zero" ? "0" : "400000",
    receivables: shape === "zero" ? "0" : "120000",
    inventory: shape === "zero" ? "0" : "80000",
    payables: shape === "zero" ? "0" : "60000",
    employees: shape === "zero" ? "0" : "10",
    ...(typeof stock === "string" ? {} : stock),
  };
}

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

const DAY_ROW = /debtor days|creditor days|inventory days|working capital days|days sales outstanding|days payable outstanding|days inventory outstanding|cash conversion|funding gap|accounts payable/i;

function dayLeaks(text: string): string[] {
  const leaks: string[] = [];
  if (/\b0d\b/.test(text)) leaks.push("0d");
  if (/\b0 days\b/i.test(text)) leaks.push("0 days");
  const flat = text.replace(/\s+/g, " ");
  const band = flat.match(/((?:debtor|creditor|inventory|working capital) days|days sales outstanding|days payable outstanding).{0,80}?(HEALTHY|WATCH)/i);
  if (band) leaks.push(`${band[1]} ${band[2]}`);
  if (/It takes 0 days/i.test(flat)) leaks.push("It takes 0 days");
  if (/is 0d/i.test(flat)) leaks.push("is 0d");
  if (/Generation failed/i.test(text)) leaks.push("Generation failed");
  return leaks;
}

function appTabLine(name: string, value: number, score: number, financials: Record<string, string>, market: ResolvedMarket): string {
  const days = formatVal(value, "days", market, name, financials);
  const band = tierLabel(score, { name, value, financials });
  return `${name} ${days} ${band}`;
}

async function main() {
  const leaks: string[] = [];
  const studio = readFileSync(resolve("src/routes/_authenticated/reports-studio.tsx"), "utf8");
  const benchSlice = studio.slice(studio.indexOf("benchmark: async"), studio.indexOf("budget: async"));
  const empty = benchmarkEmptyCopy({
    profileSectorName: "Wholesale Trade — Non-Specialised",
    studioSectorName: "Wholesale Trade — Non-Specialised",
  });
  if (benchSlice.includes("throw error")) {
    leaks.push(`Generation failed: ${empty.message}`);
  }

  const { renderToBuffer } = await import("@react-pdf/renderer");
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
  const { buildBudgetPdfModel, budgetActualFromFinancials, illustrativeBudgetPack } = await import("../src/lib/budget-pdf.js");

  for (const market of [ZA_MARKET, US]) {
    for (const shape of ["pl", "full", "zero"] as const) {
      const fin = books(shape);
      const ratios = scorecardRatiosFromFinancials(fin);
      const rows = buildScorecardRatioResults(ratios, market, {
        equity: Number(fin.equity),
        periodMonths: 12,
        cashFlowKnown: true,
      });
      const readiness = reportInputsFromFinancials(fin);
      const cycleReady = reportReady("cycle", {
        leverageReady: readiness.leverageReady,
        assetReady: readiness.assetReady,
        cycleReady: shape !== "pl",
      });
      if (shape === "pl" && cycleReady) {
        leaks.push(`${market.currency}/pl cycle card stays enabled`);
      }
      if (shape !== "pl" && !cycleReady) {
        leaks.push(`${market.currency}/${shape} cycle card disabled`);
      }

      const wc = buildWorkingCapitalData(fin, ratios);
      const labor = buildLaborData(fin, ratios, null, market);
      const movement = buildMovementRows(ratios, [], new Date("2024-12-31"), market);
      const profit = buildProfitabilityData(fin);
      const leverage = buildLeverageData(fin, ratios);
      const assets = buildAssetData(ratios, { equity: Number(fin.equity), currency: market.currency, periodMonths: 12 });
      const interventions = await buildInterventions(rows, null, {
        revenue: Number(fin.revenue),
        netProfit: Number(fin.netIncome),
      });

      const debtor = rows.find((row) => row.ratio_name === "Debtor Days");
      const creditor = rows.find((row) => row.ratio_name === "Creditor Days");
      assert(debtor && creditor, "scorecard has debtor and creditor rows");

      if (shape === "pl") {
        for (const name of ["Debtor Days", "Creditor Days", "Inventory Days", "Working Capital Days"]) {
          const row = rows.find((item) => item.ratio_name === name);
          const value = row && Number.isFinite(row.current_value) ? row.current_value : ratios[name];
          const score = row?.health_score ?? 0;
          const line = appTabLine(name, value, score, fin, market);
          if (/\b0 d\b|\b0d\b|Healthy|Watch/i.test(line) || !line.includes("—") || !line.includes("Not enough data")) {
            leaks.push(`${market.currency} ratios tab ${line}`);
          }
        }
        const figures = cashDriverDayFigures(fin);
        const cashLine = dayScoreDriverLabel(
          "Debtor Days",
          figures.debtorDays,
          debtor.health_score,
          fin,
        );
        if (/\b0 days\b|score \d|Healthy|Watch/i.test(cashLine)) {
          leaks.push(`${market.currency} cash tab ${cashLine}`);
        }
        const pillars = buildSpherePillars({
          overallHealth: 70,
          pillarHealths: { profit: 70, assets: Number.NaN, financing: Number.NaN, cash: debtor.health_score },
          healthMap: { debtorDays: debtor.health_score, creditorDays: creditor.health_score },
          ratioMeta: {
            debtorDays: { friendly: "Debtor Days" },
            creditorDays: { friendly: "Creditor Days" },
          },
          dayCounts: figures,
          financials: fin,
        });
        const healthText = JSON.stringify(pillars);
        if (/\b0 days\b|score \d{2,3}/.test(healthText) && /debtorDays/.test(healthText)) {
          leaks.push(`${market.currency} health tab still scores missing days`);
        }
      }

      if (shape === "full") {
        const line = appTabLine("Debtor Days", debtor.current_value, debtor.health_score, fin, market);
        if (line.includes("Not enough data") || line.includes("—")) {
          leaks.push(`${market.currency} full books dashed a real debtor day (${line})`);
        }
      }
      if (shape === "zero") {
        const line = appTabLine("Debtor Days", debtor.current_value, debtor.health_score, fin, market);
        if (!/\b0 d\b|\b0d\b/.test(line)) {
          leaks.push(`${market.currency} stored zero debtor days were dashed (${line})`);
        }
      }

      const common = { smeData: SME, accountantProfile: ACCOUNTANT, isDemo: true, market };
      const weeks = Array.from({ length: 13 }, (_, i) => ({
        period_label: `Week ${i + 1}`,
        opening_balance: 1000 + i,
        total_receipts: 200,
        total_payments: 100,
        net_movement: 100,
        closing_balance: 1100 + i,
        scenario: "base" as const,
        runway_weeks: 20,
      }));
      const { doc } = illustrativeBudgetPack("2026-01");
      const actual = budgetActualFromFinancials(
        { revenue: 1000000, cogs: 600000, ebit: 150000, ebitda: 180000, fixedCosts: 200000, periodMonths: "12" },
        market,
      );
      const budget = buildBudgetPdfModel(doc, actual ? [actual] : [], market);

      const jobs: Array<[string, ReturnType<typeof createElement> | null]> = [
        ["scorecard", createElement(HealthScorecardPDF, { ...common, ratioResults: rows })],
        ["intervention", createElement(InterventionPriorityPDF, { ...common, interventions })],
        ["forecast", createElement(CashForecastPDF, { ...common, cashForecast: weeks, scenario: "base" })],
        ["cycle", wc ? createElement(CashCyclePDF, { ...common, workingCapitalData: wc, financials: fin }) : null],
        ["waterfall", profit ? createElement(ProfitabilityWaterfallPDF, { ...common, profitabilityData: profit }) : null],
        ["leverage", leverage ? createElement(LeverageSolvencyPDF, { ...common, data: leverage }) : null],
        ["assets", assets ? createElement(AssetProductivityPDF, { ...common, data: assets }) : null],
        ["labor", labor ? createElement(LaborProductivityPDF, { ...common, data: labor, financials: fin }) : null],
        ["movement", createElement(RatioMovementPDF, { ...common, ratios: movement.rows, financials: fin })],
        [
          "benchmark",
          shape === "pl"
            ? null
            : createElement(BenchmarkReportPDF, {
                ...common,
                industryCode: "6201",
                industryName: "Retail Trade",
                benchmarkRows: [
                  {
                    ratio_key: "gross_margin",
                    ratio_name: "Gross Margin",
                    pillar: "profit" as const,
                    current_value: 0.4,
                    formatted_current: "40%",
                    health_score: 70,
                    health_tier: "healthy" as const,
                    sector_median: 0.32,
                    sector_top_quartile: 0.45,
                    formatted_median: "32%",
                    formatted_top_quartile: "45%",
                  },
                ],
              }),
        ],
        ["budget", createElement(BudgetVariancePDF, { ...common, model: budget })],
      ];
      assert(jobs.length === 11, "the catalogue is eleven reports");

      if (shape === "pl" && jobs.find(([name]) => name === "benchmark")?.[1] != null) {
        leaks.push(`${market.currency}/pl benchmark still renders`);
      }

      for (const [name, element] of jobs) {
        if (!element) continue;
        try {
          const buf = await renderToBuffer(element);
          const text = await pageText(buf);
          if (shape === "pl") {
            const found = dayLeaks(text);
            if (found.length && DAY_ROW.test(text) || found.some((item) => item === "0d" || item === "0 days" || item === "It takes 0 days" || item === "is 0d" || item === "Generation failed")) {
              const interesting = found.filter((item) => item !== "0d" || DAY_ROW.test(text) || /\b0d\b/.test(text));
              if (interesting.length) leaks.push(`${market.currency}/pl/${name}: ${interesting.join(", ")}`);
            }
            if (name === "labor" && /\b0\b/.test(text) && /headcount|employees/i.test(text)) {
              const row = text.split("\n").find((line) => /current period/i.test(line));
              if (row && /\b0\b/.test(row)) leaks.push(`${market.currency}/pl/labor period ${row}`);
            }
          }
        } catch (err) {
          leaks.push(`Generation failed: ${(err as Error).message}`);
        }
      }
    }
  }

  if (leaks.length) {
    throw new Error(leaks.slice(0, 12).join("\n"));
  }
  console.log("report-missing-metrics: ok");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
