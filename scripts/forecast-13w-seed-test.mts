/**
 * 13-week forecast seeds from the same actuals Budget uses.
 * A client with imported months and no manual lines gets a forecast.
 * Run: pnpm test:forecast-13w-seed
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { buildAdvisoryPack, livePackMetrics } from "../src/lib/advisory-pack.ts";
import { OPENING_CASH_UNKNOWN, SEEDED_FROM_ACTUALS_LABEL } from "../src/lib/budget.bridges.ts";
import { cashEmptyPresentation, cashForecastWeeksFromOutlook } from "../src/lib/cash-forecast-parity.ts";
import { forecastClosingTile, forecastScreenTiles } from "../src/lib/cash-forecast-view.ts";
import {
  assessClientMetrics,
  resolveCashScreenForecast,
  resolveThirteenWeekForecast,
  runwayDisplayLabel,
  RUNWAY_INSUFFICIENT_LABEL,
} from "../src/lib/client-metrics.ts";
import { liveHealthFromBooks } from "../src/lib/health-score.ts";
import { ownerAnswerTiles, type OwnerBooks } from "../src/lib/owner-answers.ts";
import { FORECAST_PREVIEW_EMPTY, forecastPreviewGap } from "../src/lib/report-preview.ts";
import { buildOverviewBrief, overviewFactLines } from "../supabase/functions/ask-ai/overview-brief.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const monday = new Date(2026, 9, 5);
const nineMonths = {
  revenue: 412000,
  cogs: 171000,
  fixedCosts: 90000,
  periodMonths: 9,
};

const seeded = resolveCashScreenForecast({
  financials: nineMonths,
  cashflow: { revenue: [], expenses: [] },
  now: monday,
});
assert(seeded.seededFromActuals === true, "nine months of actuals seed a baseline");
assert(seeded.estimateLabel === SEEDED_FROM_ACTUALS_LABEL, seeded.estimateLabel ?? "missing label");
assert(/estimat/i.test(SEEDED_FROM_ACTUALS_LABEL), SEEDED_FROM_ACTUALS_LABEL);
assert(
  !SEEDED_FROM_ACTUALS_LABEL.includes("Monthly totals"),
  "a day-paced partial month is not a monthly total",
);
assert(seeded.openingCash === null, "no balance sheet does not become opening 0");
assert(seeded.openingNote === OPENING_CASH_UNKNOWN, seeded.openingNote ?? "missing opening note");
assert(seeded.floor === 0, `a missing opening does not mint a floor (${seeded.floor})`);
assert(seeded.dipsBelowFloorWeek == null, "a missing opening does not dip");
assert(seeded.cashOnFile === false, "cash stays off file");
const weeks = cashForecastWeeksFromOutlook(seeded);
assert(weeks != null && weeks.length === 13, "the 13-week forecast is not empty");
const receipt = weeks[0]?.total_receipts;
const payment = weeks[0]?.total_payments;
assert(receipt != null && receipt > 0, `receipts were not seeded (${receipt})`);
assert(payment != null && payment > 0, `payments were not seeded (${payment})`);
assert(
  weeks.every((week) => week.total_receipts === receipt && week.total_payments === payment),
  "monthly actuals are spread evenly across each week",
);
assert(
  weeks.every((week) => week.opening_balance == null && week.closing_balance == null),
  "a missing opening is not printed as 0",
);
assert(weeks.seedLabel === SEEDED_FROM_ACTUALS_LABEL, weeks.seedLabel ?? "missing seed label");

const withCash = resolveCashScreenForecast({
  financials: { ...nineMonths, cash: 25000 },
  cashflow: null,
  now: monday,
});
assert(withCash.openingCash === 25000, `balance-sheet cash was dropped (${withCash.openingCash})`);
assert(withCash.openingNote == null, "a known opening does not say it is unknown");
const cashWeeks = cashForecastWeeksFromOutlook(withCash);
assert(
  cashWeeks != null && cashWeeks[0]?.opening_balance === 25000,
  "week 1 opens on the balance sheet",
);
assert(
  cashWeeks.every((week) => week.closing_balance != null),
  "closings roll once opening cash is on file",
);

const revenueOnly = resolveThirteenWeekForecast({
  financials: { revenue: 90000, periodMonths: 9 },
  openingCash: null,
  now: monday,
});
assert(revenueOnly.receiptsWeekly != null && revenueOnly.receiptsWeekly > 0, "revenue still seeds");
assert(revenueOnly.paymentsWeekly === null, "missing costs stay null");
const revenueWeeks = cashForecastWeeksFromOutlook(revenueOnly);
assert(revenueWeeks != null && revenueWeeks.length === 13, "revenue-only actuals still forecast");
assert(
  revenueWeeks.every((week) => week.total_payments == null && week.total_payments !== 0),
  "missing payments are not coerced to 0",
);
assert(
  revenueWeeks.every((week) => week.total_receipts != null && week.closing_balance == null),
  "one missing side does not invent a closing",
);

const manual = resolveThirteenWeekForecast({
  financials: { ...nineMonths, cash: 25000 },
  openingCash: 25000,
  now: monday,
  cashflow: {
    startDate: "2026-10-05",
    openingBalance: "25000",
    revenue: [
      { id: "manual", name: "Invoice", amount: "100", frequency: "recurring-weekly", startWeek: 1 },
    ],
    expenses: [
      { id: "rent", name: "Rent", amount: "40", frequency: "recurring-weekly", startWeek: 1 },
    ],
  },
});
assert(manual.source === "stored", `a manual line was replaced (${manual.source})`);
assert(manual.seededFromActuals !== true, "a manual line is not labelled as the actuals seed");
assert(
  manual.inflow.every((n) => Math.round(n) === 100),
  `manual receipts were overwritten (${manual.inflow[0]})`,
);
assert(
  manual.outflow.every((n) => Math.round(n) === 40),
  `manual payments were overwritten (${manual.outflow[0]})`,
);

const noMonths = resolveCashScreenForecast({
  financials: { revenue: 412000 },
  cashflow: { revenue: [], expenses: [] },
  now: monday,
});
const noWeeks = cashForecastWeeksFromOutlook(noMonths);
assert(noWeeks == null, "zero months of actuals do not invent a forecast");
const gap = forecastPreviewGap(noWeeks);
assert(gap === FORECAST_PREVIEW_EMPTY && gap.includes("Not enough data"), gap ?? "missing gap");

const plain = (amount: number) => String(Math.round(amount));
const aboveFloor = forecastScreenTiles({
  empty: false,
  opening: 46300,
  closings: Array.from({ length: 13 }, () => 46300),
  floor: 36923,
  format: plain,
});
assert(aboveFloor.lowestValue === "46300", aboveFloor.lowestValue);
assert(
  aboveFloor.lowestSub === "Opening · 9377 above the floor",
  aboveFloor.lowestSub,
);
assert(!aboveFloor.lowestSub.includes("under"), "a point above the floor does not say under");
assert(aboveFloor.weeksValue === "0 of 13", aboveFloor.weeksValue);
assert(aboveFloor.weeksSub === "stays above the floor", aboveFloor.weeksSub);
assert(aboveFloor.weeksAlert === false, "weeks-below agrees the series stays clear");

const onTheFloor = forecastScreenTiles({
  empty: false,
  opening: 36923,
  closings: Array.from({ length: 13 }, () => 36923),
  floor: 36923,
  format: (amount) => `$${amount}`,
});
assert(onTheFloor.lowestSub === "Opening · at the floor", onTheFloor.lowestSub);
assert(!onTheFloor.lowestSub.includes("above"), onTheFloor.lowestSub);
assert(!onTheFloor.lowestSub.includes("$0"), onTheFloor.lowestSub);

const costsOnly = assessClientMetrics({
  financials: { cash: 46300, cogs: 90000, fixedCosts: 40000, periodMonths: 9 },
  cashflow: { revenue: [], expenses: [] },
  now: monday,
});
assert(costsOnly.outlook.openingCash === 46300, "opening cash is on file");
assert(costsOnly.outlook.receiptsWeekly == null, "missing revenue stays null");
assert(costsOnly.outlook.paymentsWeekly != null, "costs still seed weekly payments");
assert(
  costsOnly.runway.weeks === null && costsOnly.runway.label === RUNWAY_INSUFFICIENT_LABEL,
  `a missing receipt side must not become a burn (${costsOnly.runway.label})`,
);

const dippedClosings = [40000, 35000, 30000, 36923, ...Array.from({ length: 9 }, () => 42000)];
const dipped = forecastScreenTiles({
  empty: false,
  opening: 46300,
  closings: dippedClosings,
  floor: 36923,
  format: plain,
});
const weeksUnder = dippedClosings.filter((balance) => balance < 36923).length;
assert(dipped.lowestSub === "Week 3 · 6923 under the floor", dipped.lowestSub);
assert(dipped.weeksValue === `${weeksUnder} of 13`, `weeks-below ${dipped.weeksValue} vs ${weeksUnder}`);
assert(dipped.weeksAlert === true, "a dip in the series marks weeks-below");
assert(!dipped.weeksSub.includes("stays above"), dipped.weeksSub);

const emptyTiles = forecastScreenTiles({
  empty: true,
  opening: 46300,
  closings: Array.from({ length: 13 }, () => 46300),
  floor: 50000,
  format: plain,
});
const emptyText = `${emptyTiles.lowestValue} ${emptyTiles.lowestSub} ${emptyTiles.weeksValue} ${emptyTiles.weeksSub}`;
assert(emptyTiles.lowestValue === "—" && emptyTiles.weeksValue === "—", emptyText);
assert(emptyTiles.lowestSub === "Not enough data" && emptyTiles.weeksSub === "Not enough data", emptyText);
assert(!/under|above|floor|\$0|\b0\b/.test(emptyText), `empty series made a floor claim (${emptyText})`);
assert(
  cashEmptyPresentation({ opening: 46300, linesBlank: true }).lowestBlank === true,
  "an opening does not keep a lowest point when the series is empty",
);

const owner = readFileSync(resolve("src/routes/app.tsx"), "utf8");
const accountant = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
assert(owner.includes("<CashForecastPanel"), "the owner cash screen renders the shared panel");
assert(
  accountant.includes("<CashForecastPanel"),
  "the accountant cash screen renders the shared panel",
);
const panelSrc = readFileSync(resolve("src/components/cash-forecast.tsx"), "utf8");
const seedAt = panelSrc.indexOf("data-forecast-seed");
assert(seedAt > 0, "the shared panel shows the seed label");
assert(
  !panelSrc.slice(Math.max(0, seedAt - 500), seedAt).includes("simplified ?"),
  "the seed label is on the owner and accountant screens",
);
assert(panelSrc.includes("forecastClosingTile"), "the closing tile uses the shared readout");
const pdfSrc = readFileSync(resolve("src/reports/cash-forecast.tsx"), "utf8");
assert(pdfSrc.includes("seedLabel?.trim()"), "the PDF prints the seed label with the assumptions");

const us = { currency: "USD" as const, locale: "en-US", country: "US" as const, copyPack: "us" as const };
const assessed = assessClientMetrics({ financials: nineMonths, cashflow: null, now: monday });
assert(assessed.outlook.openingCash === null && assessed.outlook.cashOnFile === false, "1020E opening is unknown");
assert(assessed.outlook.seededFromActuals === true, "1020E weeks are seeded");
assert(assessed.outlook.opening === 0, "the legacy opening field is still 0");
assert(assessed.runway.weeks == null && assessed.runway.label !== "0 weeks", assessed.runway.label);
assert(assessed.cash.amount == null, "P&L revenue is not cash");

const health = liveHealthFromBooks({
  financials: nineMonths,
  cashflow: null,
  market: us,
  now: monday,
});
const cashPillar = health.pillars.find((pillar) => pillar.id === "cash");
assert(cashPillar?.score == null, `health scored missing cash (${cashPillar?.score})`);
assert(
  cashPillar?.note === OPENING_CASH_UNKNOWN || cashPillar?.note === "Not enough data",
  cashPillar?.note ?? "missing cash note",
);
assert(!/\$0|under the floor|above the floor/.test(cashPillar?.note ?? ""), cashPillar?.note ?? "");

const live = livePackMetrics({
  financials: nineMonths,
  cashflow: null,
  market: us,
  now: monday,
});
assert(live.openingUnknown === true, "the pack knows the opening is missing");
assert(live.figures.cash === null, `pack cash was ${live.figures.cash}`);
assert(live.openingBalance === null, "pack opening is not 0");
assert(live.closings == null, "zero closings are not a series");
assert(live.cashRunwayWeeks == null, "runway weeks are not computed from 0");
const pack = buildAdvisoryPack({
  clientName: "AQA J2 US 1020E",
  firmName: null,
  hasFirm: false,
  periodLabel: "Sep 2026",
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
  openingUnknown: live.openingUnknown,
  recommendations: [],
  dataRequests: [],
  openActions: 0,
  overdueActions: 0,
  now: "2026-10-05",
});
const packText = pack.sections.map((section) => `${section.body} ${(section.bullets ?? []).join(" ")}`).join("\n");
assert(
  packText.includes(OPENING_CASH_UNKNOWN) || packText.includes("Not enough data"),
  packText,
);
assert(!packText.includes("$0"), packText);
assert(!/under the floor|above the floor|starts from zero|0 weeks/.test(packText), packText);

const books = {
  hasBooks: true,
  ledger: null,
  revenue: 412000,
  priorRevenue: null,
  cogs: 171000,
  receivables: null,
  cashflow: null,
  hasEvidence: true,
  cashOnFile: false,
  openingMissing: false,
  cashOutlook: null,
  cashPillarStatus: null,
  openAction: null,
  actionsReady: true,
  signedBy: null,
  signedOn: null,
  market: us,
} satisfies OwnerBooks;
const ownerSentence = ownerAnswerTiles(books).find((tile) => tile.id === "cash")?.sentence ?? "";
assert(
  ownerSentence === OPENING_CASH_UNKNOWN || ownerSentence === "Not enough data",
  ownerSentence,
);
assert(!/\$0|under the floor|above the floor/.test(ownerSentence), ownerSentence);

const brief = buildOverviewBrief({
  financials: nineMonths,
  cash: assessed.cash.amount,
  runwayWeeks: assessed.runway.weeks,
  runwayLabel: runwayDisplayLabel(assessed.runway),
  copyPack: "us",
  cashflow: null,
  clientName: "AQA J2 US 1020E",
  openingMissing: false,
  cashOpening: assessed.outlook.opening,
  cashClosings: assessed.outlook.closing,
  cashFloor: assessed.outlook.floor,
  now: monday,
});
const facts = overviewFactLines(brief).join("\n");
assert(brief.cash == null, `brief cash was ${brief.cash}`);
assert(brief.runwayWeeks == null, `brief runway was ${brief.runwayWeeks}`);
assert(facts.includes(OPENING_CASH_UNKNOWN) || facts.includes("Not enough data"), facts);
assert(!facts.includes("$0"), facts);
assert(!/0 weeks|under the floor|above the floor/.test(facts), facts);
const cashPillarOnBrief = brief.pillars.find((pillar) => pillar.id === "cash");
assert(cashPillarOnBrief?.score == null, `brief scored cash from 0 (${cashPillarOnBrief?.score})`);

const unknownTiles = forecastScreenTiles({
  empty: false,
  opening: assessed.outlook.openingCash ?? null,
  closings: assessed.outlook.closing,
  floor: assessed.outlook.floor,
  format: (amount) => `$${amount}`,
});
const closingTile = forecastClosingTile({
  empty: false,
  opening: assessed.outlook.openingCash ?? null,
  closing: null,
  format: (amount) => `$${amount}`,
});
const tileText = `${unknownTiles.lowestValue} ${unknownTiles.lowestSub} ${unknownTiles.weeksValue} ${unknownTiles.weeksSub} ${closingTile.value} ${closingTile.sub}`;
assert(unknownTiles.lowestValue === "—" && closingTile.value === "—", tileText);
assert(
  (unknownTiles.lowestSub === OPENING_CASH_UNKNOWN || unknownTiles.lowestSub === "Not enough data") &&
    (closingTile.sub === OPENING_CASH_UNKNOWN || closingTile.sub === "Not enough data"),
  tileText,
);
assert(!/under the floor|above the floor|\$0/.test(tileText), tileText);

const { renderToBuffer } = await import("@react-pdf/renderer");
const { getDocumentProxy } = await import("unpdf");
const { CashForecastPDF } = await import("../src/reports/cash-forecast.tsx");
const seededWeeks = cashForecastWeeksFromOutlook(assessed.outlook);
assert(seededWeeks != null, "seeded weeks reach the PDF");
const pdfBuf = await renderToBuffer(
  createElement(CashForecastPDF, {
    smeData: { name: "AQA J2 US 1020E", period: "September 2026" },
    accountantProfile: {
      firmName: "Test Accounting Co",
      logoUrl: null,
      primaryColor: "#1a1a2e",
      secondaryColor: "#16213e",
      accentColor: "#0f3460",
      accountantName: "Jane Doe",
      accountantEmail: "jane@testfirm.co.za",
      tagline: null,
    },
    market: { currency: "USD", locale: "en-US", country: "US", copyPack: "us", regionCode: "NY", timezone: "America/New_York" },
    cashForecast: seededWeeks,
    scenario: "base",
    seedLabel: seededWeeks.seedLabel,
    assumptions: ["Forecast starts 5 October 2026. Opening cash unknown."],
  }),
);
const pdf = await getDocumentProxy(new Uint8Array(pdfBuf));
const pdfLines: string[] = [];
for (let n = 1; n <= pdf.numPages; n += 1) {
  const page = await pdf.getPage(n);
  const content = await page.getTextContent();
  for (const item of content.items as Array<{ str?: string }>) {
    if (item.str?.trim()) pdfLines.push(item.str);
  }
}
const pdfText = pdfLines.join(" ").replace(/\s+/g, " ");
assert(pdfText.includes(SEEDED_FROM_ACTUALS_LABEL), "the PDF shows the estimate label");
assert(!pdfText.includes("Monthly totals"), pdfText);
assert(
  pdfText.includes(OPENING_CASH_UNKNOWN) || pdfText.includes("Not enough data"),
  pdfText,
);
assert(!pdfText.includes("$0"), pdfText);

console.log("forecast 13w seed ok");
