/**
 * Data coherence. One profit reader, one period label, one status, one book.
 * Figures are the stored Chill Pepper, Karoo, and Woodwork statements.
 * Run: pnpm test:data-coherence
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SphereHero } from "../src/components/sphere-hero.tsx";
import { profitAnswerSentence } from "../src/components/profitability-waterfall.tsx";
import { createBudgetDocument } from "../src/lib/budget.months.ts";
import { statementBudgetRead } from "../src/lib/budget.bridges.ts";
import {
  CASH_BELOW_FLOOR_STATUS,
  NEEDS_DATA_OPENING,
  OPENING_BALANCE_MISSING,
  clientListStatusWord,
  forecastRunwayHeadlineShared,
  forecastStatusSentence,
} from "../src/lib/cash-forecast-parity.ts";
import { collapseDuplicateClientShells } from "../src/lib/client-display-name.ts";
import { assessClientMetrics, periodOperatingOutflows } from "../src/lib/client-metrics.ts";
import {
  IMPLAUSIBLE_SAMPLE_NOTE,
  operatingProfitColumnHeading,
  statementSampleImplausible,
} from "../src/lib/operating-profit-display.ts";
import { ownerAnswerTiles, ownerCardStatuses, type OwnerBooks } from "../src/lib/owner-answers.ts";
import { periodProfitBridge, statedNetIsUsable } from "../src/lib/period-profit.ts";
import { operatingCycleDays } from "../src/lib/ratios.ts";
import { FULL_YEAR_ON_FILE, figuresPeriodLabelFrom } from "../src/lib/statement-period.ts";
import { ZA_MARKET } from "../src/lib/market/index.ts";
import { buildOverviewBrief, overviewFactLines } from "../supabase/functions/ask-ai/overview-brief.ts";
import { resolveRatioRecord } from "../supabase/functions/ask-ai/derive-ratios.ts";
import { formatRatio } from "../supabase/functions/ask-ai/prompt.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const root = resolve(".");
const src = (path: string) => readFileSync(resolve(root, path), "utf8");

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
  cash: null,
};

const woodwork = {
  revenue: 1_000,
  cogs: 600,
  fixedCosts: 300,
  ebit: 220,
  ebitda: 240,
  ebt: 180,
  netIncome: 120,
  laborCost: 250,
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

const bridge = periodProfitBridge(chill);
const annualCost = bridge.cogs + bridge.operatingExpenses + bridge.depreciation;
const outflows = periodOperatingOutflows(chill);
assert(Math.abs(bridge.operatingExpenses - 1_102_200) < 1, `opex ${bridge.operatingExpenses}`);
assert(Math.abs(bridge.grossProfit / bridge.revenue - 0.954) < 0.01, "gross margin is the bridge");
assert(outflows != null && Math.abs(outflows - annualCost) < 1, `one cost source ${outflows} vs ${annualCost}`);
assert(Math.abs(annualCost / 12 - 96_516.67) < 1, `monthly cost ${annualCost / 12}`);

const budget = createBudgetDocument({
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
    confirmedAt: "2026-09-02T07:54:51.849Z",
  },
});
const stamped = budget.updatedAt;
const shown = statementBudgetRead(budget, chill);
assert(shown.fromStatement, "an untouched template reads the statement");
assert(Math.abs(shown.doc.gpPct - 95.4) < 0.2, `budget GM ${shown.doc.gpPct}`);
assert(shown.doc.updatedAt === stamped, "a display read does not stamp the budget");
const premises = shown.doc.overheads.find((row) => row.bucket === "premises");
const premisesAmount = premises ? Object.values(premises.months)[0] : 0;
assert(premisesAmount == null || Math.abs(Number(premisesAmount)) < 0.5, "rent is not invented");

assert(figuresPeriodLabelFrom(chill, "Sep 2026", ZA_MARKET) === FULL_YEAR_ON_FILE, "Sep 2026 is the save month");
assert(
  operatingProfitColumnHeading([{ financials: chill }]) === "Op. profit (year)",
  "the clients column is the year",
);
assert(
  !profitAnswerSentence({
    currency: "R",
    periodLabel: FULL_YEAR_ON_FILE,
    preferPeriod: true,
  }).includes("Month to date"),
  "a full year is not labelled month to date",
);

assert(!statedNetIsUsable(karoo.ebit, karoo.netIncome), "Karoo net is above operating profit");
const karooBrief = buildOverviewBrief({ financials: karoo, periodLabel: "Sep 2026", copyPack: "za" });
const karooFacts = overviewFactLines(karooBrief).join("\n");
assert(karooFacts.includes("Operating profit"), karooFacts);
assert(!karooFacts.includes("540,000") && !karooFacts.includes("540000"), karooFacts);
assert(karooBrief.netProfit == null, "the unusable net is not a fact");

const karooBooks: OwnerBooks = {
  hasBooks: true,
  ledger: "Xero",
  revenue: karoo.revenue,
  priorRevenue: null,
  cogs: karoo.cogs,
  priorCogs: null,
  grossProfit: karoo.revenue - karoo.cogs,
  operatingProfit: karoo.ebit,
  netIncome: karoo.netIncome,
  receivables: karoo.receivables,
  cashflow: { openingBalance: "0" },
  openingMissing: true,
  cashOutlook: { opening: 0, closing: [0], floor: 178_462, dipsBelowFloorWeek: 1 },
  openAction: null,
  actionsReady: true,
  signedBy: null,
  signedOn: null,
  market: ZA_MARKET,
};
const karooTiles = ownerAnswerTiles(karooBooks);
const karooCash = karooTiles.find((tile) => tile.id === "cash")?.sentence ?? "";
const karooProfit = karooTiles.find((tile) => tile.id === "profit")?.sentence ?? "";
assert(karooCash.startsWith(OPENING_BALANCE_MISSING), karooCash);
assert(!karooCash.includes("R0") && !karooCash.includes("0 under"), karooCash);
assert(karooProfit.includes("Operating profit"), karooProfit);
assert(!karooProfit.includes("540"), karooProfit);
assert(
  clientListStatusWord({
    healthLabel: "Healthy",
    healthOverall: 80,
    opening: 0,
    floor: 178_462,
    openingMissing: true,
    source: "derived",
    totalInflow: 1,
    totalOutflow: 1,
  }) === NEEDS_DATA_OPENING,
  "a missing opening is not Healthy",
);
assert(
  forecastStatusSentence({
    opening: 0,
    closings: [0],
    floor: 178_462,
    floorText: "R178,462",
    openingMissing: true,
  }) === OPENING_BALANCE_MISSING,
  "the cash sentence names the missing opening",
);

assert(
  clientListStatusWord({
    healthLabel: "Watch",
    healthOverall: 58,
    source: "stored",
    opening: 44_480,
    floor: 34_903,
    dipsBelowFloorWeek: 1,
    totalInflow: 100_000,
    totalOutflow: 80_000,
  }) === CASH_BELOW_FLOOR_STATUS,
  "cash under the floor explains itself",
);
assert(
  ownerCardStatuses({
    ...karooBooks,
    openingMissing: false,
    cashOutlook: { opening: 30_000, closing: [30_000], floor: 34_903, dipsBelowFloorWeek: null },
  }).financial_manager?.word === "Below your minimum",
  "the Financial Manager card is a floor alert and does not say Critical",
);
const score = renderToStaticMarkup(
  createElement(SphereHero, {
    overallHealth: 58,
    displayStatus: "critical",
    statusLabel: CASH_BELOW_FLOOR_STATUS,
    pillars: [],
  }),
);
assert(score.includes(CASH_BELOW_FLOOR_STATUS), "the score orb names the cash status");
assert(!score.includes(">Watch<"), score);

const shells = [
  { id: "theo-new", name: "Theo van der Westhuizen", created_at: "2026-10-04", financials: {}, cashflow: {} },
  { id: "theo-old", name: "Theo van der Westhuizen", created_at: "2026-09-07", financials: null, cashflow: null },
  { id: "chill", name: "Chill Pepper Boutique Hotel", created_at: "2026-08-24", financials: chill, cashflow: chillCash },
  { id: "karoo", name: "Karoo Traders", created_at: "2026-08-01", financials: karoo, cashflow: { openingBalance: "0" } },
  { id: "wood", name: "Woodwork", created_at: "2026-05-16", financials: woodwork, cashflow: { openingBalance: "0" } },
];
const book = collapseDuplicateClientShells(shells);
assert(book.length === 4, `the book is 4 rows (${book.length})`);
assert(book.some((row) => row.id === "theo-old"), "the oldest empty shell stays");
for (const file of [
  "src/lib/firm-client-cap.server.ts",
  "src/lib/portfolio.functions.ts",
  "src/lib/practice-access.functions.ts",
]) {
  assert(src(file).includes("collapseDuplicateClientShells"), `${file} counts the collapsed book`);
}

assert(statementSampleImplausible(woodwork), "Woodwork is an implausible sample");
assert(src("src/components/practice-board.tsx").includes("implausibleSampleNote"), "the list flags the sample");
assert(IMPLAUSIBLE_SAMPLE_NOTE.includes("too small"), IMPLAUSIBLE_SAMPLE_NOTE);
assert(!statementSampleImplausible(chill), "Chill Pepper is a real revenue");

const chillCycle = operatingCycleDays({
  revenue: chill.revenue,
  cogs: chill.cogs,
  receivables: chill.receivables,
  inventory: chill.inventory,
  payables: chill.payables,
});
assert(Number.isNaN(chillCycle.creditorDays), "Chill Pepper creditor days are not meaningful");
assert(Number.isNaN(chillCycle.workingCapitalDays), "Chill Pepper working-capital days are not meaningful");
assert(Number.isFinite(chillCycle.debtorDays), "debtor days still use revenue");
const woodCycle = operatingCycleDays({
  revenue: woodwork.revenue,
  cogs: woodwork.cogs,
  receivables: woodwork.receivables,
  inventory: woodwork.inventory,
  payables: woodwork.payables,
});
assert(woodCycle.creditorDays === 55, `Woodwork creditor days stay ${woodCycle.creditorDays}`);
const chillBrief = buildOverviewBrief({ financials: chill, periodLabel: "Sep 2026", copyPack: "za" });
const chillFacts = overviewFactLines(chillBrief).join("\n");
assert(chillFacts.includes("Creditor days: not meaningful"), chillFacts);
assert(chillFacts.includes("Working Capital Days: not meaningful"), chillFacts);
assert(!chillFacts.includes("248"), chillFacts);
const live = resolveRatioRecord({ "Creditor Days": -247.68, "Working Capital Days": 161.58 }, chill);
assert(Number.isNaN(live["Creditor Days"]), "a snapshot does not restore 248 days");
assert(
  formatRatio({
    key: "creditorDays",
    value: Number.NaN,
    format: "days",
    p25: null,
    p50: null,
    higher_is_better: null,
  }) === "Creditor Days: not meaningful",
  "chat prints not meaningful",
);
const plan = src("src/routes/_authenticated/reports-studio.tsx");
assert(plan.includes('formatted_value !== "not meaningful"'), "the plan looks for a not-meaningful day count");
assert(plan.includes("are not meaningful"), "the intervention plan names the blank days");

const assessed = assessClientMetrics({
  financials: chill,
  cashflow: chillCash,
  timeZone: "Africa/Johannesburg",
  fyStartMonth: 3,
});
assert(assessed.runway.label !== "Cash generative", assessed.runway.label);
assert(assessed.runway.label.includes("below"), assessed.runway.label);
const headline = forecastRunwayHeadlineShared({
  opening: assessed.outlook.opening,
  closings: assessed.outlook.closing,
  floor: assessed.outlook.floor,
  runwayLabel: "Cash generative",
  cashGenerative: true,
}).headline;
assert(headline === assessed.runway.label, `${headline} vs ${assessed.runway.label}`);
assert(headline.includes("below"), headline);

const ratiosSrc = src("src/lib/ratios.ts");
assert(ratiosSrc.includes('from "./period-profit.ts"'), "ratios imports the reader with a relative path");
assert(!ratiosSrc.includes("@/lib/period-profit"), "ratios does not use the alias");

console.log("data-coherence ok");
