/**
 * Page 1 of a signed pack whose figures moved, and a regenerated QA-US-like USD pack.
 *
 *   pnpm exec vite-node --config scripts/vite-test.config.ts scripts/render-pack-stale-pages.mts
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createElement } from "react";
import { forecastRunwayHeadlineShared, forecastStatusSentence } from "../src/lib/cash-forecast-parity";
import { buildAdvisoryPack, livePackMetrics, packSectionsForPdf } from "../src/lib/advisory-pack";
import { formatMoneyCompact } from "../src/lib/market/format";
import { resolveMarket } from "../src/lib/market/resolve";
import { packDisplayedSignoffLine } from "../src/lib/review-signoff-stamp";

const OUT = "/opt/cursor/artifacts/pack-stale";
const market = resolveMarket({ country: "US", regionCode: "NY" });

const PROFILE = {
  firmName: "Ben Accountants",
  logoUrl: null,
  primaryColor: "#1a1a2e",
  secondaryColor: "#16213e",
  accentColor: "#0f3460",
  accountantName: "James Fleming",
  accountantEmail: "james@ben-accountants.example",
  tagline: null,
  signatureDataUrl: null,
};

const SIGNOFF = {
  signedOffByName: "James Fleming",
  signedOffByInitials: null,
  signedOffByTitle: null,
  firmName: "Ben Accountants",
  signedOffAt: "2026-10-07T23:01:31.000Z",
  signatureData: null,
};

function pagePng(pdfPath: string, pngPath: string) {
  const prefix = pngPath.replace(/\.png$/, "");
  execFileSync("pdftoppm", ["-png", "-f", "1", "-l", "1", "-r", "140", "-singlefile", pdfPath, prefix], {
    stdio: "inherit",
  });
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const { renderToBuffer } = await import("@react-pdf/renderer");
  const { AdvisoryPackPDF } = await import("../src/reports/advisory-pack");

  const staleLine = packDisplayedSignoffLine({
    signedOff: true,
    figuresChanged: true,
    reviewedByKind: "accountant",
    reviewedAt: SIGNOFF.signedOffAt,
    name: SIGNOFF.signedOffByName,
    firmName: SIGNOFF.firmName,
    market,
  });
  const stalePdf = createElement(AdvisoryPackPDF, {
    smeData: { name: "QA US", period: "v10 · Signed off · September 2026" },
    accountantProfile: PROFILE,
    reviewSignoff: SIGNOFF,
    staleNotice: staleLine,
    market,
    sections: [
      {
        title: "Where the business stands",
        body: "QA US scores 71 out of 100. Strongest pillar: Profitability. Weakest: Financing. The 13-week cash forecast stays above the R50 000 comfort line throughout (lowest R134 200 in week 1). Opening balance R128 450. Inventory days 61. Runway: add a cash-flow statement to estimate runway.",
      },
    ],
  });
  const stalePath = `${OUT}/signed-then-stale.pdf`;
  writeFileSync(stalePath, await renderToBuffer(stalePdf));
  pagePng(stalePath, `${OUT}/signed-then-stale-page1.png`);

  const financials = {
    revenue: "700000",
    cogs: "280000",
    fixedCosts: "351000",
    ebit: "60000",
    ebitda: "69000",
    ebt: "60000",
    netIncome: "60000",
    receivables: "48500",
    payables: "28500",
    inventory: "62000",
    cash: "128450",
    totalAssets: "230263",
    equity: "112323",
    periodMonths: "12",
    periodEnd: "2026-09-30",
  };
  const live = livePackMetrics({
    financials,
    cashflow: {
      openingBalance: "128450",
      seededFromBanksAt: "2026-10-01T00:00:00.000Z",
      forecastLinesSource: "qbo-bank-activity",
      startDate: "2026-10-12",
      revenue: [{ id: "in", name: "Collections", amount: "16175", frequency: "recurring-weekly", startWeek: 1 }],
      expenses: [{ id: "out", name: "Payments", amount: "16175", frequency: "recurring-weekly", startWeek: 1 }],
    },
    fyStartMonth: 1,
    market,
    now: new Date("2026-10-08T12:00:00.000Z"),
  });
  const pack = buildAdvisoryPack({
    clientName: "QA US",
    firmName: "Ben Accountants",
    hasFirm: true,
    periodLabel: "September 2026",
    priorPeriodLabel: null,
    figuresAsOf: "2026-09-30",
    health: live.health,
    ratios: live.ratios,
    priorRatios: null,
    openingBalance: live.openingBalance,
    closings: live.closings,
    floor: live.floor,
    cashRunwayWeeks: live.cashRunwayWeeks,
    runwayLabel: live.runwayLabel,
    recommendations: [],
    dataRequests: [],
    openActions: 0,
    overdueActions: 0,
    now: "2026-10-08T12:00:00.000Z",
    currency: "USD",
  });
  const floorText = formatMoneyCompact(live.floor, market);
  const status = forecastStatusSentence({
    opening: live.openingBalance ?? 0,
    closings: live.closings ?? [],
    floor: live.floor,
    floorText,
    runwayLabel: live.runwayLabel,
  });
  const story = forecastRunwayHeadlineShared({
    opening: live.openingBalance ?? 0,
    closings: live.closings ?? [],
    floor: live.floor,
    runwayLabel: live.runwayLabel,
  });
  const regenPdf = createElement(AdvisoryPackPDF, {
    smeData: { name: "QA US", period: "v11 · Draft · September 2026" },
    accountantProfile: PROFILE,
    market,
    sections: packSectionsForPdf(pack.sections, { signed: false, firmName: PROFILE.firmName }),
  });
  const regenPath = `${OUT}/regenerated-qa-us.pdf`;
  writeFileSync(regenPath, await renderToBuffer(regenPdf));
  pagePng(regenPath, `${OUT}/regenerated-qa-us-page1.png`);
  console.log(
    JSON.stringify(
      {
        health: live.health.overall,
        weakest: live.health.weakestPillar?.label,
        floor: live.floor,
        floorText,
        runway: story.headline,
        status,
        inventory: Math.round(live.ratios["Inventory Days"]),
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
