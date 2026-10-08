/**
 * Render page 1 of the outreach sample Scorecard and Roadmap, plus a USD
 * Advisory Pack. Fixture figures are the published QA US statement; scores
 * come from the same builders Overview and the pack use.
 *
 *   pnpm exec vite-node --config scripts/vite-test.config.ts scripts/render-outreach-samples.mts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createElement } from "react";
import { scorecardHealthFromFinancials } from "../src/lib/health-score";
import { buildScorecardRatioResults, scorecardRatiosFromFinancials } from "../src/lib/scorecard-rows";
import { resolveMarket } from "../src/lib/market/resolve";
import {
  buildAdvisoryPack,
  livePackMetrics,
  packNarrativeRatios,
  packSectionsForPdf,
} from "../src/lib/advisory-pack";
import { cashFlowKnown } from "../src/lib/equity-coherence";

const OUT = "/opt/cursor/artifacts/outreach-pdf";
const market = resolveMarket({ country: "US", regionCode: "NY" });

/** Published QA US statement (advisory-pack-test "live QA US file"). */
const financials = {
  revenue: "700000",
  cogs: "280000",
  ebit: "60000",
  receivables: "48500",
  payables: "28500",
  inventory: "62000",
  cash: "128450",
  periodMonths: "12",
  periodEnd: "2026-09-30",
};

const PROFILE = {
  firmName: "Northwind Advisory (Sample)",
  logoUrl: null,
  primaryColor: "#1a1a2e",
  secondaryColor: "#16213e",
  accentColor: "#0f3460",
  accountantName: "Alex Rivera, CPA (fictional)",
  accountantEmail: "alex.rivera@northwind-advisory.example",
  tagline: null,
  signatureDataUrl: null,
};

const SIGNOFF = {
  signedOffByName: "Alex Rivera, CPA (fictional)",
  signedOffByInitials: "AR",
  signedOffByTitle: null,
  firmName: "Northwind Advisory (Sample)",
  signedOffAt: "2026-10-07T23:01:00.000Z",
  signatureData: null,
};

const SME = { name: "Harbor & Pine Supply Co.", period: "September 2026" };

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
  fixed_cost_ratio: "fixedCostRatio",
  interest_burden: "interestBurden",
};

async function interventions(ratioResults: Array<{
  ratio_key: string;
  ratio_name: string;
  health_tier: string;
  unscored?: boolean;
}>) {
  const raw = await import("../src/lib/playbook-data.json");
  const steps = (raw.default ?? raw) as Array<{
    ratio_key: string;
    health_tier: string;
    step_number: number;
    step_title: string;
    step_description: string;
    timeframe: string;
    effort: string;
    impact: string;
    category: string;
    ratio_name: string;
  }>;
  const out = [];
  for (const row of ratioResults) {
    if (row.unscored || (row.health_tier !== "critical" && row.health_tier !== "at_risk")) continue;
    const key = KEY_MAP[row.ratio_key] ?? row.ratio_key;
    const step = steps.find(
      (s) => s.ratio_key === key && s.health_tier === row.health_tier && s.step_number === 1,
    );
    if (!step) continue;
    out.push({ ...step, ratio_key: key, ratio_name: row.ratio_name, health_tier: row.health_tier });
  }
  return out;
}

function pagePng(pdfPath: string, pngPath: string) {
  const prefix = pngPath.replace(/\.png$/, "");
  execFileSync("pdftoppm", ["-png", "-f", "1", "-l", "1", "-r", "140", "-singlefile", pdfPath, prefix], {
    stdio: "inherit",
  });
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const { renderToBuffer } = await import("@react-pdf/renderer");
  const { HealthScorecardPDF } = await import("../src/reports/health-scorecard");
  const { InterventionPriorityPDF } = await import("../src/reports/intervention-priority");
  const { AdvisoryPackPDF } = await import("../src/reports/advisory-pack");

  const rawRatios = scorecardRatiosFromFinancials(financials, { fyStartMonth: 1 });
  const live = livePackMetrics({
    financials,
    fyStartMonth: 1,
    market,
    timeZone: market.timezone,
    financialsUpdatedAt: "2026-09-30T12:00:00.000Z",
  });
  const overallHealth = scorecardHealthFromFinancials({
    financials,
    fyStartMonth: 1,
    periodMonths: 12,
    cashRunwayWeeks: live.cashRunwayWeeks,
    market,
    shortfallWeek: null,
  });
  if (live.health.overall !== overallHealth.overall) {
    throw new Error(`score split: pack ${live.health.overall} vs scorecard ${overallHealth.overall}`);
  }
  for (const pillar of overallHealth.pillars) {
    const packed = live.health.pillars.find((row) => row.id === pillar.id);
    if (packed?.score !== pillar.score || packed?.label !== pillar.label) {
      throw new Error(
        `pillar split ${pillar.id}: pack ${packed?.label} ${packed?.score} vs scorecard ${pillar.label} ${pillar.score}`,
      );
    }
  }
  const ratioResults = buildScorecardRatioResults(rawRatios, market, {
    cashFlowKnown: cashFlowKnown(financials),
    periodMonths: 12,
  });
  console.log(
    "shared score",
    overallHealth.overall,
    overallHealth.pillars.map((pillar) => `${pillar.label} ${pillar.score ?? "unscored"}`).join(", "),
  );

  const scorecard = createElement(HealthScorecardPDF, {
    smeData: SME,
    ratioResults,
    accountantProfile: PROFILE,
    isDemo: false,
    sample: true,
    reviewSignoff: SIGNOFF,
    cashRunwayWeeks: live.cashRunwayWeeks,
    overallHealth,
    market,
  });
  const scorePdf = await renderToBuffer(scorecard);
  const scorePath = `${OUT}/sample-scorecard.pdf`;
  writeFileSync(scorePath, scorePdf);
  pagePng(scorePath, `${OUT}/sample-scorecard-page1.png`);

  const steps = await interventions(ratioResults);
  const roadmap = createElement(InterventionPriorityPDF, {
    smeData: SME,
    interventions: steps,
    accountantProfile: PROFILE,
    isDemo: false,
    sample: true,
    reviewSignoff: SIGNOFF,
    market,
  });
  const roadPdf = await renderToBuffer(roadmap);
  const roadPath = `${OUT}/sample-roadmap.pdf`;
  writeFileSync(roadPath, roadPdf);
  pagePng(roadPath, `${OUT}/sample-roadmap-page1.png`);

  const pack = buildAdvisoryPack({
    clientName: SME.name,
    firmName: PROFILE.firmName,
    hasFirm: true,
    periodLabel: "September 2026",
    priorPeriodLabel: null,
    figuresAsOf: "2026-09-30",
    health: overallHealth,
    ratios: live.ratios,
    narrativeRatios: packNarrativeRatios(financials, live.ratios),
    priorRatios: null,
    openingBalance: 128450,
    closings: Array.from({ length: 13 }, () => 134200),
    cashRunwayWeeks: live.cashRunwayWeeks,
    runwayLabel: live.runwayLabel,
    recommendations: [],
    dataRequests: [],
    openActions: 0,
    overdueActions: 0,
    now: SIGNOFF.signedOffAt,
    currency: "USD",
  });
  const packPdf = createElement(AdvisoryPackPDF, {
    smeData: { name: SME.name, period: "v1 · Signed off · September 2026" },
    accountantProfile: PROFILE,
    sections: packSectionsForPdf(pack.sections, { signed: true, firmName: PROFILE.firmName }),
    reviewSignoff: SIGNOFF,
    sample: true,
    market,
  });
  const packPath = `${OUT}/usd-advisory-pack.pdf`;
  writeFileSync(packPath, await renderToBuffer(packPdf));
  pagePng(packPath, `${OUT}/usd-advisory-pack-page1.png`);

  console.log("wrote", OUT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
