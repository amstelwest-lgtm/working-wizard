/**
 * AQA retest of #586 on the stored Chill Pepper forecast.
 * One floor, symmetric single-month receipts, Fuji stays a purchase.
 * Run: pnpm test:aqa-retest-586
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { workflowInputsHash, type WorkflowContext } from "../src/lib/client-briefing";
import {
  bankHistoryIsSingleMonth,
  displayForecastFrequency,
  forecastPlFingerprint,
  forecastRowLabel,
  groupSmallForecastRows,
  RECEIPT_ASSUMED_LABEL,
} from "../src/lib/cash-forecast-rows";
import { suggestOnceOffRows } from "../src/lib/cash-once-off-suggest";
import { projectForecastFrequency, recurringPayeeFrequency } from "../src/lib/cash-recurring-payees";
import {
  assessClientMetrics,
  distributeForecastLine,
  forecastMinimumCash,
} from "../src/lib/client-metrics";
import {
  clientListRunwayHeadline,
  forecastLowestPoint,
} from "../src/lib/cash-forecast-parity";
import {
  extractWaterfallFigures,
  summarizeCashForecast,
  summarizeWaterfall,
} from "../supabase/functions/ask-ai/deliverable-summaries";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const line = (
  name: string,
  amount: number,
  frequency: "once-off" | "recurring-monthly",
  startWeek: number,
) => ({ name, amount: String(amount), frequency, startWeek });

/** Stored Chill Pepper lines. One published bank month, no second-month draft. */
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
  for (const row of rows) {
    const frequency = displayForecastFrequency(row.name, row.frequency, { side, ...single });
    distributeForecastLine({ amount: row.amount, frequency, startWeek: row.startWeek }, weeks).forEach((n, i) => {
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
const pillay = distributeForecastLine(
  {
    amount: "900",
    frequency: displayForecastFrequency("D Pillay", "once-off", { side: "revenue", ...single }),
    startWeek: 1,
  },
  13,
);
assert(
  pillay[0] === 900 && pillay[4] === 900 && pillay[8] === 900 && pillay[12] === 900,
  "a single-month receipt repeats on weeks 1, 5, 9 and 13",
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
if (screenBelow > 0) assert(list === expectedWeeks, `clients runway ${list}`);

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

const root = resolve(".");
const askIndex = readFileSync(resolve(root, "supabase/functions/ask-ai/index.ts"), "utf8");
assert(askIndex.includes("forecastPlFingerprint"), "ask-ai keys the cache on the forecast and P&L");
assert(askIndex.includes("figureKey"), "the cache hash includes that key");
const widget = readFileSync(resolve(root, "src/lib/ask-ai.js"), "utf8");
assert(widget.includes("data-forecast-key") && widget.includes("parsed.key !== forecastKey"), "the chat thread drops when the key changes");
const builder = readFileSync(resolve(root, "supabase/functions/ask-ai/context-builder.ts"), "utf8");
assert(!builder.includes('endsWith("Burden")'), "interest burden is not printed as a percent of revenue");

console.log("aqa-retest-586 ok");
