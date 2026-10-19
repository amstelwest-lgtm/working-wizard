/**
 * AQA retest of #580. Waterfall, budget, Score, and the Clients list
 * read the stored Chill Pepper, Karoo, and Woodwork figures.
 * Run: pnpm test:aqa-retest-580
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createBudgetDocument } from "../src/lib/budget.months.ts";
import { computeBudgetMonths } from "../src/lib/budget.compute.ts";
import {
  budgetPlanSnapshot,
  budgetSignedFiguresChanged,
  statementBudgetRead,
} from "../src/lib/budget.bridges.ts";
import {
  CASH_BELOW_FLOOR_STATUS,
  NEEDS_DATA_OPENING,
  OPENING_BALANCE_MISSING,
  clientListRunwayHeadline,
  clientListStatusWord,
} from "../src/lib/cash-forecast-parity.ts";
import { assessClientMetrics, storedOpeningIsMissing } from "../src/lib/client-metrics.ts";
import {
  cashPillarFollowsForecast,
  PILLAR_SHORT_LABELS,
  scorecardHealthFromFinancials,
} from "../src/lib/health-score.ts";
import { formatFindingProse } from "../src/lib/milon-team-activity.ts";
import { ZA_MARKET } from "../src/lib/market/index.ts";
import { healthAnswerSentence } from "../src/lib/overview-insights.ts";
import { statementSampleImplausible } from "../src/lib/operating-profit-display.ts";
import { interventionNarrative } from "../src/reports/narrative.ts";
import { budgetSignoffIsStale } from "../src/lib/signoff-status.ts";
import { rewriteSavedMonthStamp, FULL_YEAR_ON_FILE } from "../src/lib/statement-period.ts";
import {
  derivePeriodWaterfallFallback,
  parseWeeklyInputs,
  resolveWaterfallFigures,
  waterfallPrefersStatement,
} from "../src/lib/weekly-inputs.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const src = (path: string) => readFileSync(resolve(path), "utf8");

const chill = {
  revenue: 1_215_000,
  cogs: -56_000,
  ebit: 56_800,
  ebitda: 126_800,
  ebt: 37_000,
  netIncome: 27_010,
  laborCost: 426_000,
  fixedCosts: "",
  payables: 38_000,
  receivables: 21_500,
  inventory: 14_200,
  equity: 54_600,
  totalAssets: 331_600,
  cash: null,
};

const karoo = {
  revenue: 4_200_000,
  cogs: 2_100_000,
  fixedCosts: 220_000,
  ebit: 120_000,
  ebt: 45_000,
  netIncome: 540_000,
  payables: 260_000,
  receivables: 380_000,
  inventory: 210_000,
  equity: 1_550_000,
  totalAssets: 2_110_000,
};

const woodwork = {
  revenue: 1_000,
  cogs: 600,
  fixedCosts: 300,
  ebit: 220,
  ebitda: 240,
  ebt: 180,
  netIncome: 120,
  receivables: 150,
  payables: 90,
  inventory: 120,
  equity: 400,
  totalAssets: 800,
};

const line = (
  name: string,
  amount: number,
  frequency: "once-off" | "recurring-monthly",
  startWeek: number,
) => ({ name, amount: String(amount), frequency, startWeek });

const chillCash = {
  openingBalance: "44480",
  openingBalanceSource: null,
  seededFromBanksAt: "2026-08-24T20:07:05.368Z",
  startDate: "2026-05-30",
  revenue: [
    line("Netcash", 36360, "recurring-monthly", 3),
    line("Andre Galvao Seminar", 16800, "once-off", 1),
    line("Netcash", 5760, "once-off", 1),
    line("Yoco", 2250, "recurring-monthly", 5),
    line("D Pillay", 900, "once-off", 1),
    line("L Ferreira", 900, "once-off", 1),
    line("J Botha", 795, "once-off", 1),
    line("M Adams", 795, "once-off", 1),
    line("S Naidoo", 595, "once-off", 1),
  ],
  expenses: [
    line("Greeff Properties", 28000, "once-off", 1),
    line("Fuji SA", 9200, "once-off", 1),
    line("Seminar Guest Instructor Fee", 7200, "once-off", 1),
    line("R Dlamini", 6000, "once-off", 1),
    line("B Petersen", 4500, "once-off", 1),
    line("Sparkle Cleaning", 3500, "once-off", 1),
    line("SARS", 3480, "once-off", 1),
    line("City of Cape Town", 2947.5, "recurring-monthly", 2),
    line("Meta", 2800, "once-off", 1),
    line("Ledger & Co", 2500, "once-off", 1),
    line("Santam", 2200, "once-off", 1),
    line("Webafrica", 899, "once-off", 1),
    line("Netcash", 748, "once-off", 1),
    line("Dis-Chem", 392, "once-off", 1),
    line("FNB", 458, "recurring-monthly", 5),
  ],
  other: [line("T Mokoena", 25000, "once-off", 1), line("FNB", 6800, "once-off", 1)],
};

const now = new Date("2026-10-12T12:00:00.000Z");
const chillOutlook = assessClientMetrics({
  financials: chill,
  cashflow: chillCash,
  now,
  timeZone: "Africa/Johannesburg",
}).outlook;

const weekly = parseWeeklyInputs({
  weeks: {
    "2026-W32": {
      revenue: 10_000,
      costOfSales: 4_000,
      fixedCosts: 2_000,
      interest: 2_000,
      tax: 1_500,
      cashMovements: 500,
    },
  },
});
const fallback = derivePeriodWaterfallFallback(chill);
const chart = resolveWaterfallFigures(weekly, fallback, {
  preferPeriod: waterfallPrefersStatement(fallback, false),
});
assert(chart.revenue === 1_215_000, `waterfall revenue ${chart.revenue}`);
assert(chart.costOfSales === 56_000, `waterfall cogs ${chart.costOfSales}`);
const chartGm = (chart.revenue - chart.costOfSales) / chart.revenue;
assert(Math.abs(chartGm - 0.9539) < 0.002, `waterfall GM ${chartGm}`);
assert(chart.fixedCosts !== 2_000, "weekly opex does not draw the bars");
assert(
  src("src/components/profitability-waterfall.tsx").includes("waterfallPrefersStatement"),
  "the chart calls the statement preference",
);

const seeded = createBudgetDocument({
  templateId: "day_labour",
  fyStart: "2026-03",
  fyStartMonth: 3,
  qualification: {
    payMotion: "time_delivery",
    volumeUnit: "jobs",
    driverKind: "hours_rate",
    costShape: "payroll_heavy",
    debtorDaysDefault: 14,
    capexMode: "none",
    confirmedAt: "2026-08-24T20:07:05.368Z",
  },
});
const months = Object.keys(seeded.overheads[0]?.months ?? {});
const storedBudget = {
  ...seeded,
  gpPct: 35,
  cogsMode: "gp_pct" as const,
  updatedAt: "2026-10-12T11:49:29.397Z",
  revenueLines: seeded.revenueLines.map((row, index) =>
    index === 0
      ? {
          ...row,
          months: Object.fromEntries(months.map((month) => [month, { volume: 1, price: 101_250 }])),
        }
      : row,
  ),
  overheads: seeded.overheads.map((row) => ({
    ...row,
    months: Object.fromEntries(months.map((month) => [month, row.bucket === "people" ? 35_500 : 0])),
  })),
};
const shown = statementBudgetRead(storedBudget, chill);
assert(shown.fromStatement, "an untouched people seed reads the statement");
assert(Math.abs(shown.doc.gpPct - 95.4) < 0.2, `budget GM ${shown.doc.gpPct}`);
assert(shown.doc.updatedAt === storedBudget.updatedAt, "the display read does not move the clock");
const people = shown.doc.overheads.find((row) => row.bucket === "people");
const ops = shown.doc.overheads.find((row) => row.bucket === "ops");
const premises = shown.doc.overheads.find((row) => row.bucket === "premises");
const peopleAmount = Number(Object.values(people?.months ?? {})[0] ?? 0);
const opsAmount = Number(Object.values(ops?.months ?? {})[0] ?? 0);
const premisesAmount = Number(Object.values(premises?.months ?? {})[0] ?? 0);
assert(Math.abs(peopleAmount - 35_500) < 1, `people ${peopleAmount}`);
assert(opsAmount > 10_000, `ops absorbs the rest of opex ${opsAmount}`);
assert(Math.abs(premisesAmount) < 0.5, "rent stays off the statement");
const month = computeBudgetMonths(shown.doc, shown.doc.activeScenario)[0];
assert(month != null && month.cogs < 10_000, `monthly cogs ${month?.cogs}`);
assert(month != null && month.grossProfit > 90_000, `monthly GP ${month?.grossProfit}`);
assert(month != null && month.ebitda > 0, `EBITDA ${month?.ebitda}`);

const belowFloor = chillOutlook.closing.some((n) => n < chillOutlook.floor) || chillOutlook.opening < chillOutlook.floor;
assert(belowFloor, "Chill Pepper's stored series goes under the floor");
const score = cashPillarFollowsForecast(
  scorecardHealthFromFinancials({
    financials: chill,
    cashRunwayWeeks: null,
    market: ZA_MARKET,
  }),
  {
    openingMissing: storedOpeningIsMissing(chillCash),
    opening: chillOutlook.opening,
    closings: chillOutlook.closing,
    floor: chillOutlook.floor,
  },
);
const cashPillar = score.pillars.find((pillar) => pillar.id === "cash");
assert(cashPillar?.status === "critical", `cash pillar ${cashPillar?.status}`);
assert(cashPillar?.score != null && cashPillar.score <= 25, `cash score ${cashPillar?.score}`);
const sentence = healthAnswerSentence({
  score: score.overall,
  bandLabel: CASH_BELOW_FLOOR_STATUS,
  pillars: score.pillars.map((pillar) => ({
    label: PILLAR_SHORT_LABELS[pillar.id],
    score: pillar.score ?? Number.NaN,
    status: pillar.status,
  })),
});
assert(!/cash is strong/i.test(sentence), sentence);
const listStatus = clientListStatusWord({
  healthLabel: "Healthy",
  healthOverall: score.overall,
  source: chillOutlook.source,
  opening: chillOutlook.opening,
  floor: chillOutlook.floor,
  dipsBelowFloorWeek: chillOutlook.dipsBelowFloorWeek,
  totalInflow: chillOutlook.totalInflow,
  totalOutflow: chillOutlook.totalOutflow,
  openingMissing: false,
});
const listRunway = clientListRunwayHeadline({
  source: chillOutlook.source,
  opening: chillOutlook.opening,
  closings: chillOutlook.closing,
  floor: chillOutlook.floor,
  totalInflow: chillOutlook.totalInflow,
  totalOutflow: chillOutlook.totalOutflow,
  healthOverall: score.overall,
  openingMissing: false,
});
assert(listStatus === CASH_BELOW_FLOOR_STATUS, listStatus);
assert(listRunway.includes("below"), listRunway);

const karooCash = { openingBalance: "0", forecastLinesSource: "pl-estimate" };
assert(storedOpeningIsMissing(karooCash), "Karoo opening is missing");
const karooOutlook = assessClientMetrics({
  financials: karoo,
  cashflow: karooCash,
  now,
  timeZone: "Africa/Johannesburg",
}).outlook;
const karooHealth = cashPillarFollowsForecast(
  scorecardHealthFromFinancials({ financials: karoo, market: ZA_MARKET }),
  {
    openingMissing: true,
    opening: karooOutlook.opening,
    closings: karooOutlook.closing,
    floor: karooOutlook.floor,
  },
);
const karooCashPillar = karooHealth.pillars.find((pillar) => pillar.id === "cash");
assert(karooCashPillar?.status !== "critical" || (karooCashPillar.score ?? 0) > 25, "a missing opening does not cap cash");
const karooStatus = clientListStatusWord({
  healthLabel: "Healthy",
  healthOverall: 80,
  source: karooOutlook.source,
  opening: karooOutlook.opening,
  floor: karooOutlook.floor,
  dipsBelowFloorWeek: karooOutlook.dipsBelowFloorWeek,
  totalInflow: karooOutlook.totalInflow,
  totalOutflow: karooOutlook.totalOutflow,
  openingMissing: true,
});
const karooRunway = clientListRunwayHeadline({
  source: karooOutlook.source,
  opening: karooOutlook.opening,
  closings: karooOutlook.closing,
  floor: karooOutlook.floor,
  totalInflow: karooOutlook.totalInflow,
  totalOutflow: karooOutlook.totalOutflow,
  healthOverall: 80,
  openingMissing: true,
});
assert(karooStatus === NEEDS_DATA_OPENING, karooStatus);
assert(!karooStatus.includes("Healthy"), karooStatus);
assert(karooRunway === OPENING_BALANCE_MISSING, karooRunway);
assert(!karooRunway.includes("weeks below"), karooRunway);

assert(rewriteSavedMonthStamp("full Sep 2026 statement") === FULL_YEAR_ON_FILE, "full statement");
assert(rewriteSavedMonthStamp("the Sep 2026 books on file") === `the ${FULL_YEAR_ON_FILE}`, "books on file");
assert(rewriteSavedMonthStamp("Sep 2026 books") === FULL_YEAR_ON_FILE, "books");
assert(rewriteSavedMonthStamp("Sep 2026 snapshot") === FULL_YEAR_ON_FILE, "snapshot");
assert(rewriteSavedMonthStamp("due 8 Sep 2026") === "due 8 Sep 2026", "a due date stays");
assert(formatFindingProse("See the full Sep 2026 statement.").includes(FULL_YEAR_ON_FILE), "draft prose");
assert(
  src("src/components/cash-forecast.tsx").includes('openingTilesMissing ? "—"'),
  "opening and lowest tiles blank a missing balance",
);

assert(statementSampleImplausible(woodwork), "Woodwork is an implausible sample");
assert(!statementSampleImplausible(chill), "Chill Pepper is not a sample");
const home = src("src/routes/_authenticated/clients.$clientId.tsx");
const homeAt = home.indexOf('data-client-home="true"');
assert(homeAt >= 0 && home.slice(homeAt, homeAt + 700).includes("IMPLAUSIBLE_SAMPLE_NOTE"), "the note is on client Home");
const profit = src("src/routes/app.tsx");
const profitAt = profit.indexOf('data-owner-page="profit"');
assert(
  profitAt >= 0 && profit.slice(profitAt, profitAt + 700).includes("statementSampleImplausible"),
  "the owner profit page carries the same note",
);

const plan = interventionNarrative({ critical: 0, atRisk: 2, total: 2, cashBelowFloor: true });
assert(!plan.includes("no ratio is in critical territory"), plan);
assert(/below the floor/i.test(plan), plan);
const prevention = interventionNarrative({ critical: 0, atRisk: 2, total: 2 });
assert(prevention.includes("no ratio is in critical territory"), "a watch-only plan stays prevention");

const signed = { signed_off_at: "2026-09-02T07:54:51.849Z" };
const bumped = "2026-10-12T11:49:29.397Z";
assert(budgetSignoffIsStale(signed, bumped) === false, "an autosave clock is not stale");
assert(budgetSignoffIsStale(signed, bumped, false) === false, "unchanged figures are not stale");
assert(budgetSignoffIsStale(signed, bumped, true) === true, "changed figures are stale");
const snapshot = { budgetFigures: budgetPlanSnapshot(storedBudget) };
assert(budgetSignedFiguresChanged(snapshot, storedBudget) === false, "the signed plan matches");
assert(budgetSignedFiguresChanged(null, storedBudget) === false, "no snapshot is not a change");
assert(
  budgetSignedFiguresChanged(snapshot, { ...storedBudget, gpPct: 40 }) === true,
  "a real GP edit is a change",
);
assert(
  src("src/lib/review-signoffs.functions.ts").includes("budgetFigures"),
  "a budget sign-off stores the figure snapshot",
);

console.log("aqa-retest-580 ok");
