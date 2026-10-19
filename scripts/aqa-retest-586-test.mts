/**
 * AQA retest of #586 and retest #3.
 * Symmetric single-month receipts, one floor, chat cache, P&L interest,
 * seeded budget headline, missing cash inputs, deliverable period,
 * intervention order, owner status, palette, plan badge, cash stamp.
 * Run: pnpm test:aqa-retest-586
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { hotelDriversOnFile } from "../src/lib/budget-industry.ts";
import { createBudgetDocument } from "../src/lib/budget.months.ts";
import {
  budgetSeededFromStatement,
  budgetVersusStatement,
  statementBudgetRead,
} from "../src/lib/budget.bridges.ts";
import { workflowInputsHash, type WorkflowContext } from "../src/lib/client-briefing.ts";
import {
  bankHistoryIsSingleMonth,
  displayForecastFrequency,
  forecastPlFingerprint,
  forecastRowLabel,
  groupSmallForecastRows,
  RECEIPT_ASSUMED_LABEL,
} from "../src/lib/cash-forecast-rows.ts";
import { suggestOnceOffRows } from "../src/lib/cash-once-off-suggest.ts";
import { projectForecastFrequency, recurringPayeeFrequency } from "../src/lib/cash-recurring-payees.ts";
import {
  assessClientMetrics,
  distributeForecastLine,
  forecastMinimumCash,
  weekDatesFrom,
} from "../src/lib/client-metrics.ts";
import {
  NEEDS_DATA_OPENING,
  cashForecastSnapshot,
  cashSignedFiguresChanged,
  clientListRunwayHeadline,
  clientListStatusWord,
  forecastLowestPoint,
  statusColumnNeedsAttention,
} from "../src/lib/cash-forecast-parity.ts";
import { searchClientSectionJumps, shortClientId } from "../src/lib/feature-finder-clients.ts";
import {
  CASH_FLOOR_ACTION,
  CASH_FLOOR_REASON,
  interventionPlanSteps,
  withCashFloorIntervention,
} from "../src/lib/intervention-grounding.ts";
import { ZA_MARKET } from "../src/lib/market/index.ts";
import { ownerAnswerTiles, ownerCardStatuses, type OwnerBooks } from "../src/lib/owner-answers.ts";
import { cashSignoffIsStale } from "../src/lib/signoff-status.ts";
import { alignBrainFigureCopy } from "../src/lib/statement-margin.ts";
import { FULL_YEAR_ON_FILE, rewriteDraftMonthStamp, rewriteSavedMonthStamp } from "../src/lib/statement-period.ts";
import { interventionNarrative } from "../src/reports/narrative.ts";
import {
  extractWaterfallFigures,
  summarizeCashForecast,
  summarizeWaterfall,
} from "../supabase/functions/ask-ai/deliverable-summaries.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const src = (path: string) => readFileSync(resolve(path), "utf8");

const line = (
  name: string,
  amount: number,
  frequency: "once-off" | "recurring-monthly",
  startWeek: number,
) => ({ name, amount: String(amount), frequency, startWeek });

/** Stored Chill Pepper figures. One published bank month, no second-month draft. */
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

assert(
  bankHistoryIsSingleMonth({ seededFromBanksAt: chillCash.seededFromBanksAt, bankDraft: null }),
  "a published bank seed with no draft is one month",
);
assert(
  !bankHistoryIsSingleMonth({
    seededFromBanksAt: chillCash.seededFromBanksAt,
    bankDraft: {
      extract: { transactions: [{ date: "2026-05-02" }, { date: "2026-07-02" }] },
    },
  }),
  "two statement months are not a single-month assumption",
);

const single = { singleMonth: true as const };
assert(
  forecastRowLabel("Greeff Properties", "once-off", { side: "expenses" }).includes("rent (assumed monthly)"),
  "rent names its rule",
);
assert(
  forecastRowLabel("Santam", "once-off", { side: "expenses" }).includes("insurance (assumed monthly)"),
  "Santam is insurance",
);
assert(
  forecastRowLabel("R Dlamini", "once-off", { side: "expenses" }).includes("payroll (assumed monthly)"),
  "a staff name is payroll",
);
assert(
  forecastRowLabel("FNB debit order", "once-off", { side: "expenses" }).includes("debit order (assumed monthly)"),
  "a debit order names its rule",
);
assert(
  forecastRowLabel("Fuji SA", "once-off", { side: "expenses", ...single }).includes("purchase (one-off)"),
  "Fuji is a purchase",
);
assert(
  displayForecastFrequency("Fuji SA", "once-off", { side: "expenses", ...single }) === "once-off",
  "Fuji is not projected",
);
assert(
  forecastRowLabel("D Pillay", "once-off", { side: "revenue", ...single }) === `D Pillay · ${RECEIPT_ASSUMED_LABEL}`,
  "a single-month receipt names the assumption",
);
assert(
  displayForecastFrequency("D Pillay", "once-off", { side: "revenue", singleMonth: false }) === "once-off",
  "a receipt stays once-off once a second month is on file",
);
assert(
  !forecastRowLabel("City of Cape Town", "recurring-monthly", { side: "expenses" }).includes("assumed"),
  "a stored monthly line is not relabelled",
);
assert(
  !forecastRowLabel("FNB", "recurring-monthly", { side: "expenses" }).includes("assumed"),
  "stored FNB is not an assumption",
);

const fujiHistory = recurringPayeeFrequency({
  lines: [{ name: "Fuji SA", cadence: "monthly", status: "included" }],
});
assert(
  projectForecastFrequency("Fuji SA", "once-off", fujiHistory, { side: "expenses" }) === "recurring-monthly",
  "Fuji projects only when the history already shows it twice",
);

const weeks = 13;
const inflow = new Array<number>(weeks).fill(0);
const outflow = new Array<number>(weeks).fill(0);
const project = (
  rows: typeof chillCash.revenue,
  side: "revenue" | "expenses" | "other",
  target: number[],
) => {
  const dates = weekDatesFrom(chillCash.startDate, weeks);
  for (const row of rows) {
    const frequency = displayForecastFrequency(row.name, row.frequency, { side, ...single });
    distributeForecastLine({ amount: row.amount, frequency, startWeek: row.startWeek }, weeks, dates).forEach((n, i) => {
      target[i] += n;
    });
  }
};
project(chillCash.revenue, "revenue", inflow);
project(chillCash.expenses, "expenses", outflow);
project(chillCash.other, "other", outflow);
assert(outflow[0]! - outflow[4]! >= 9200, "week 1 carries Fuji and week 5 does not");
const rentWeeks = new Array<number>(weeks).fill(0);
rentWeeks[0] = rentWeeks[4] = rentWeeks[8] = rentWeeks[12] = 28000;
const grouped = groupSmallForecastRows([
  { name: "Greeff Properties · rent (assumed monthly)", onceOff: false, vals: rentWeeks },
  { name: "Fuji SA · purchase (one-off)", onceOff: true, vals: [9200, ...new Array<number>(12).fill(0)] },
  { name: "Dis-Chem · purchase (one-off)", onceOff: true, vals: [392, ...new Array<number>(12).fill(0)] },
]);
assert(
  grouped.some((row) => row.name.includes("Fuji SA") && row.name.includes("purchase (one-off)")),
  "Fuji stays on its own row with the purchase rule",
);
const pillayDates = weekDatesFrom(chillCash.startDate, 13);
const pillay = distributeForecastLine(
  {
    amount: "900",
    frequency: displayForecastFrequency("D Pillay", "once-off", { side: "revenue", ...single }),
    startWeek: 1,
  },
  13,
  pillayDates,
);
assert(
  pillay[0] === 900 && pillay[4] === 900 && pillay[8] === 900 && pillay[12] === 0,
  "a single-month receipt lands once a month and not a fourth time in week 13",
);
const pillayFallback = distributeForecastLine(
  {
    amount: "900",
    frequency: "recurring-monthly",
    startWeek: 1,
  },
  13,
);
assert(
  pillayFallback.filter((n) => n === 900).length === 3 && pillayFallback[12] === 0,
  "without week dates a monthly line still lands three times",
);
const closing: number[] = [];
let bal = Number(chillCash.openingBalance);
for (let i = 0; i < weeks; i++) {
  bal += inflow[i]! - outflow[i]!;
  closing.push(bal);
}
const screenFloor = forecastMinimumCash({ weeklyOutflows: outflow });
const screenBelow = closing.filter((n) => n < screenFloor).length;
const screenLow = forecastLowestPoint(Number(chillCash.openingBalance), closing);

const assessed = assessClientMetrics({
  financials: chill,
  cashflow: chillCash,
  timeZone: "Africa/Johannesburg",
});
assert(assessed.outlook.floor === screenFloor, `Home floor ${assessed.outlook.floor} vs Cash ${screenFloor}`);
const outlookBelow = assessed.outlook.closing.filter((n) => n < assessed.outlook.floor).length;
assert(outlookBelow === screenBelow, `weeks below ${outlookBelow} vs ${screenBelow}`);
const outlookLow = forecastLowestPoint(assessed.outlook.opening, assessed.outlook.closing);
assert(outlookLow.amount === screenLow.amount && outlookLow.week === screenLow.week, "lowest point matches Cash");

const chat = summarizeCashForecast(chillCash, null, {
  financials: chill,
  timeZone: "Africa/Johannesburg",
});
assert(chat?.floor === screenFloor, `chat floor ${chat?.floor} vs Cash ${screenFloor}`);
assert(chat?.weeksBelowFloor === screenBelow, `chat weeks ${chat?.weeksBelowFloor} vs ${screenBelow}`);
assert(chat?.lowestCash === screenLow.amount, `chat low ${chat?.lowestCash} vs ${screenLow.amount}`);
assert(chat?.lowestCashWeek === screenLow.week, `chat low week ${chat?.lowestCashWeek}`);

const list = clientListRunwayHeadline({
  source: assessed.outlook.source,
  opening: assessed.outlook.opening,
  closings: assessed.outlook.closing,
  floor: assessed.outlook.floor,
  totalInflow: assessed.outlook.totalInflow,
  totalOutflow: assessed.outlook.totalOutflow,
  runwayLabel: assessed.runway.label,
  cashGenerative: assessed.runway.kind === "cash_generative",
});
const expectedWeeks = screenBelow === 1 ? "1 week below" : `${screenBelow} weeks below`;
if (screenBelow > 0) {
  const negativeNow = assessed.outlook.closing[0] != null && assessed.outlook.closing[0] < 0;
  assert(list === (negativeNow ? "Below zero now" : expectedWeeks), `clients runway ${list}`);
}

const staged = suggestOnceOffRows({
  bankDraft: null,
  existing: [],
  bankSourced: true,
  singleMonth: true,
  forecastLines: [
    { id: "fuji", name: "Fuji SA", amount: "9200", frequency: "once-off", startWeek: 1, side: "expenses" },
    { id: "guest", name: "D Pillay", amount: "900", frequency: "once-off", startWeek: 1, side: "revenue" },
    { id: "rent", name: "Greeff Properties", amount: "28000", frequency: "once-off", startWeek: 1, side: "expenses" },
  ],
});
const stagedNames = staged.lines.map((row) => row.name);
assert(stagedNames.includes("Fuji SA"), "Fuji can still be saved as a once-off");
assert(!stagedNames.includes("D Pillay"), "an assumed receipt is not staged as a once-off");
assert(!stagedNames.includes("Greeff Properties"), "assumed rent is not staged as a once-off");

const interest = summarizeWaterfall(extractWaterfallFigures(chill))?.steps.find((step) => step.label === "Interest");
assert(interest?.pctOfRevenue != null && interest.pctOfRevenue > 1.5 && interest.pctOfRevenue < 1.8, `interest ${interest?.pctOfRevenue}`);
assert(Math.abs((interest?.pctOfRevenue ?? 0) - 20) > 1, "interest is not 20% of revenue");

const finger = forecastPlFingerprint(chillCash, chill);
const moved = forecastPlFingerprint(
  { ...chillCash, expenses: chillCash.expenses.map((row) => (row.name === "Fuji SA" ? { ...row, amount: "1" } : row)) },
  chill,
);
const plMoved = forecastPlFingerprint(chillCash, { ...chill, ebit: chill.ebit + 1 });
assert(finger !== moved && finger !== plMoved, "a forecast or P&L change misses the cache");

const briefCtx = {
  clientName: "Chill Pepper Boutique Hotel",
  profile: null,
  businessType: "service",
  healthScore: 58,
  healthLabel: "Watch",
  snapshot: [],
  chips: [],
  cashRunwayWeeks: null,
  whatMatters: null,
  forecastKey: finger,
} as WorkflowContext;
assert(workflowInputsHash(briefCtx) !== workflowInputsHash({ ...briefCtx, forecastKey: moved }), "the briefing cache key follows the forecast");

assert(src("supabase/functions/ask-ai/index.ts").includes("forecastPlFingerprint"), "ask-ai keys the cache on the forecast and P&L");
assert(src("supabase/functions/ask-ai/index.ts").includes("figureKey"), "the cache hash includes that key");
const widget = src("src/lib/ask-ai.js");
assert(widget.includes("data-forecast-key") && widget.includes("parsed.key !== forecastKey"), "the chat thread drops when the key changes");
assert(!src("supabase/functions/ask-ai/context-builder.ts").includes('endsWith("Burden")'), "interest burden is not printed as a percent of revenue");

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
const raw = budgetVersusStatement(storedBudget, chill);
const shown = statementBudgetRead(storedBudget, chill);
const seededCompare = budgetVersusStatement(shown.doc, chill);
assert(raw != null && raw.budgetEbit < 0, `unseeded budget ebit ${raw?.budgetEbit}`);
assert(seededCompare != null && seededCompare.budgetEbit > 0, `seeded budget ebit ${seededCompare?.budgetEbit}`);
assert(budgetSeededFromStatement(seededCompare) === true, "headline uses the seeded budget");
assert(
  hotelDriversOnFile("day_labour", "hospitality_rooms", storedBudget.revenueLines[0]) === false,
  "a volume of 1 is not room-nights",
);
assert(
  hotelDriversOnFile("hospitality_rooms", "hospitality_rooms", {
    months: { "2026-03": { volume: 40, price: 1800 } },
  }) === true,
  "a real room-night count stays",
);
assert(src("src/components/budget/budget-panel.tsx").includes("statementBudgetRead(doc, figureSource).doc"), "panel headline is seeded");
assert(
  src("src/routes/_authenticated/clients.$clientId.tsx").includes("statementBudgetRead(budgetDoc"),
  "client budget tile is seeded",
);
assert(src("src/components/budget/budget-simple-view.tsx").includes('data-hotel-driver="missing"'), "hollow drivers print a dash");

assert(
  clientListStatusWord({
    healthLabel: "Healthy",
    healthOverall: 80,
    opening: 0,
    floor: 50_000,
    openingMissing: true,
  }) === NEEDS_DATA_OPENING,
  "a missing opening is not Healthy",
);
assert(statusColumnNeedsAttention("Healthy") === false, "Healthy is not attention");
assert(statusColumnNeedsAttention(NEEDS_DATA_OPENING) === true, "needs data is attention");
assert(statusColumnNeedsAttention("Critical: cash below floor") === true, "critical is attention");
const board = src("src/components/practice-board.tsx");
assert(board.includes("statusColumnNeedsAttention"), "home counts the status column");
assert(board.includes('statusWord.startsWith("Needs data")'), "the list prints the needs-data word");

const draft = alignBrainFigureCopy("See the full Sep 2026 statement and the Sep 2026 books.", {});
assert(draft.includes(FULL_YEAR_ON_FILE), draft);
assert(!/Sep 2026 (books|statement)/.test(draft), draft);
assert(alignBrainFigureCopy("due 8 Sep 2026", {}) === "due 8 Sep 2026", "a due date stays");
assert(src("src/lib/milon-team-feed.ts").includes("rewriteDraftMonthStamp"), "team jobs rewrite the draft");
assert(src("supabase/functions/brain-deliverable-draft/index.ts").includes("rewriteSavedMonthStamp"), "generation rewrites the draft");

const plan = interventionNarrative({ critical: 2, atRisk: 1, total: 3, cashBelowFloor: true });
assert(plan.includes(CASH_FLOOR_REASON), plan);
assert(!plan.includes("no ratio is in critical territory"), plan);
const steps = withCashFloorIntervention(
  [
    { step_title: "Bring debt to equity inside the band", health_tier: "critical" },
    { step_title: "Collect the aged debtors", health_tier: "at_risk" },
  ],
  true,
);
assert(steps[0]?.step_title === CASH_FLOOR_ACTION, steps.map((step) => step.step_title).join(" | "));
assert(steps[0]?.step_title.includes("cash") || steps[0]?.step_title === CASH_FLOOR_ACTION, "cash leads");
const onScreen = interventionPlanSteps(["Bring debt to equity inside the band", "Collections"], true);
assert(onScreen[0] === CASH_FLOOR_ACTION, onScreen.join(" | "));
assert(src("src/components/action-plan.tsx").includes("Critical reason:"), "the plan names the reason");

const books = (patch: Partial<OwnerBooks>): OwnerBooks => ({
  hasBooks: true,
  ledger: null,
  revenue: 1000,
  priorRevenue: null,
  cogs: 400,
  receivables: null,
  cashflow: { openingBalance: "4335" },
  cashOutlook: { opening: 4335, closing: [4335], floor: 50_000, dipsBelowFloorWeek: 1 },
  openAction: null,
  actionsReady: true,
  signedBy: null,
  signedOn: null,
  market: { ...ZA_MARKET, currency: "USD", copyPack: "us" },
  ...patch,
});
const watch = ownerCardStatuses(books({ cashPillarStatus: "at_risk" }));
assert(watch.financial_manager?.word === "Watch", "the chip follows a Watch pillar");
assert(watch.financial_manager?.word !== "Below your minimum", "Watch is not the floor chip");
const missingWatch = ownerCardStatuses(
  books({ cashPillarStatus: "at_risk", openingMissing: true }),
);
assert(missingWatch.financial_manager?.word === "Watch", "a missing opening still shows Watch");
const missingCash = ownerAnswerTiles(
  books({ cashPillarStatus: "at_risk", openingMissing: true }),
).find((tile) => tile.id === "cash");
assert(missingCash?.sentence === "Opening balance missing.", missingCash?.sentence ?? "");
const critical = ownerCardStatuses(books({ cashPillarStatus: "critical" }));
assert(critical.financial_manager?.word === "Critical", "a Critical pillar names Critical");
const watchCash = ownerAnswerTiles(books({ cashPillarStatus: "at_risk" })).find((tile) => tile.id === "cash");
assert(watchCash?.sentence.startsWith("Cash is "), watchCash?.sentence ?? "");
assert(!/below your minimum/i.test(watchCash?.sentence ?? ""), watchCash?.sentence ?? "");
assert(/4[,.]?335|4\s335/.test(watchCash?.sentence ?? ""), watchCash?.sentence ?? "");
assert(
  ownerCardStatuses(books({})).financial_manager?.word === "Below your minimum",
  "omitting the pillar keeps the floor chip",
);

const cash = {
  openingBalance: "0",
  openingBalanceSource: null,
  forecastLinesSource: "pl-estimate",
  startDate: "2026-10-05",
  last_forecast_at: "2026-10-08T05:35:23.016Z",
  revenue: [{ id: "r1", name: "Collections (monthly revenue)", amount: "80769.23", frequency: "recurring-weekly", startWeek: 1 }],
  expenses: [
    {
      id: "e1",
      name: "Operating payments (monthly costs)",
      amount: "44615.38",
      frequency: "recurring-weekly",
      startWeek: 1,
      weekOverrides: { "1": 44615.38 },
    },
  ],
};
const signed = { cashFigures: cashForecastSnapshot(cash) };
assert(cashSignedFiguresChanged(null, cash) === false, "no snapshot is not a change");
assert(cashSignedFiguresChanged(signed, { ...cash, startDate: "2026-11-01" }) === false, "a start date is not a figure");
assert(
  cashSignedFiguresChanged(signed, {
    ...cash,
    revenue: [{ ...cash.revenue[0], amount: "90000" }],
  }) === true,
  "a changed amount is a change",
);
const stamp = { signed_off_at: "2026-09-01T14:27:09.175Z" };
assert(cashSignoffIsStale(stamp, "2026-10-08T05:35:23.016Z", false) === false, "the clock is not the cash stamp");
assert(cashSignoffIsStale(stamp, "2026-10-08T05:35:23.016Z", true) === true, "changed cash figures are stale");

const theo = { id: "theo", name: "Theo" };
const jumps = searchClientSectionJumps(
  "debt",
  [theo, { ...theo }, { id: "theo-2", name: "Theo" }, { id: "theo-3", name: "Theo" }, { id: "theo-4", name: "Theo" }],
);
const collections = jumps.filter((row) => row.label.startsWith("Collections for Theo"));
assert(collections.length === 4, `collections ${collections.length}`);
assert(
  collections.filter((row) => row.id === "collections:theo").length === 1,
  "a repeated client id is one collections jump",
);
assert(
  collections.some((row) => row.label === `Collections for Theo · ${shortClientId("theo-2")}`),
  "a second Theo with the same name keeps its own jump",
);
assert(jumps.some((row) => row.label === "Collections") === false, "the bare label stays a different row");

const picker = src("src/components/firm-band-upgrade.tsx");
assert(
  picker.includes('currentBand ?? (starterLeads ? "starter" : null)'),
  "Start here sits on the current plan, and a practice with no plan leads with Starter",
);
assert(picker.includes("startHerePlanId"), "no current plan still leads with Starter");
assert(picker.includes("FirmStartHereLoader"), "home loads the current plan for the badge");
assert(picker.includes("Start here"), "the badge copy stays");
assert(src("src/components/owner-door/owner-home.tsx").includes("FirmStartHereLoader"), "client home shows Start here");
assert(src("src/components/practice-board.tsx").includes("FirmStartHereBadge"), "practice shows Start here");
assert(src("src/routes/_authenticated/dashboard.tsx").includes("PracticeBoard"), "dashboard is the practice home");

const homeCss = src("src/components/owner-door/owner-door.css");
assert(homeCss.includes("flex: 0 1 auto"), "home sizes to its content");
assert(!homeCss.includes("min-height: calc(100dvh - 96px)"), "the viewport gap is gone");
assert(homeCss.includes("position: static"), "the handoff sentence stays in flow");
const phone = src("src/styles/owner-premium.css");
assert(phone.includes("max-width: 767px"), "the phone home has its own layout");
assert(phone.includes("padding-inline: 0"), "the phone home has no side gutter");
assert(phone.includes("flex: 1 1 100%"), "the company chip takes a full row");
assert(src("src/components/owner-door/owner-home.tsx").includes('!== "done"'), "a finished run does not print Done");
assert(src("src/components/cash-forecast.tsx").includes("data-forecast-updated"), "the forecast prints its updated stamp");
assert(src("src/components/cash-forecast.tsx").includes("lastForecastAt"), "the stamp uses the saved forecast time");
assert(
  rewriteDraftMonthStamp("Sep 2026 accounts") === "Full year on file accounts",
  "a bare month stamp is rewritten",
);
assert(
  rewriteDraftMonthStamp("Based on Sep 2026 snapshot") === `Based on ${FULL_YEAR_ON_FILE}`,
  "a snapshot phrase is the full-year stamp",
);
assert(rewriteDraftMonthStamp("due 8 Sep 2026") === "due 8 Sep 2026", "a dated day stays");
assert(
  rewriteSavedMonthStamp("Sep 2026 books look healthy") === "Full year on file looks healthy",
  "a full-year stamp agrees the verb",
);
assert(rewriteSavedMonthStamp("Sep 2026") === "Sep 2026", "a cited period stays on the narrow stamp");
assert(
  src("src/components/recommendations-panel.tsx").includes("rewriteDraftMonthStamp"),
  "stored recommendations show the stamp",
);
assert(
  src("src/components/advisory-pack-panel.tsx").includes("rewriteDraftMonthStamp"),
  "stored packs show the stamp",
);
assert(
  src("src/components/advisory-drafter.tsx").includes("rewriteDraftMonthStamp"),
  "the drafter shows the stamp",
);
assert(
  src("src/components/client-brain-drafts.tsx").includes("rewriteDraftMonthStamp"),
  "stored brain drafts show the stamp",
);

console.log("aqa-retest-586 ok");
