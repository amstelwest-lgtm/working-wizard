/**
 * Forecast anchoring, period scaling, and the shared health band table.
 * Run: pnpm exec vite-node --config scripts/vite-test.config.ts scripts/forecast-bands-test.mts
 */
import { buildFinancialSnapshot } from "../src/lib/client-briefing";
import {
  forecastAnchorDate,
  plBankDisagreement,
  resolveThirteenWeekForecast,
  rollBankDraftOpening,
  scoreCreditorDays,
  weeklyRunRate,
} from "../src/lib/client-metrics";
import { formatCalendarDay } from "../src/lib/market/format";
import { openingCashReplaceNotice } from "../src/lib/cash-from-banks.publish";
import { healthMapFromRatios, scorePlaybookRatio } from "../src/lib/health-score";
import { HEALTH_BAND_TABLE, healthBandLabel, scoreTier } from "../src/lib/ratios";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const monday = new Date(2026, 9, 5);
const wednesday = new Date(2026, 9, 7);
assert(forecastAnchorDate({ now: monday }) === "2026-10-05", "Monday is the current week");
assert(
  forecastAnchorDate({ now: wednesday }) === "2026-10-05",
  "Wednesday stays in the week that started Monday",
);
assert(
  forecastAnchorDate({ now: monday, periodEnd: "2026-10-31" }) === "2026-11-01",
  "a later period end anchors the day after it",
);
assert(
  forecastAnchorDate({ now: monday, periodEnd: "2025-07-31" }) === "2026-10-05",
  "an older period end does not pull the forecast back",
);
const sundayNightInNewYork = new Date("2026-10-05T02:30:00Z");
assert(
  forecastAnchorDate({ now: sundayNightInNewYork, timeZone: "America/New_York" }) === "2026-09-28",
  "firm timezone: Sunday evening in New York is still the previous week",
);
assert(
  forecastAnchorDate({ now: new Date("2026-10-05T15:00:00Z"), timeZone: "America/New_York" }) ===
    "2026-10-05",
  "firm timezone: Monday afternoon in New York is this week",
);
const oct5 = formatCalendarDay("2026-10-05", { locale: "en-US" }, { day: "numeric", month: "short" });
const sep23 = formatCalendarDay("2026-09-23", { locale: "en-US" }, { day: "numeric", month: "short" });
assert(oct5.includes("Oct") && /\b5\b/.test(oct5) && !/\b4\b/.test(oct5), `Oct 5 label shifted: ${oct5}`);
assert(sep23.includes("Sep") && sep23.includes("23") && !sep23.includes("22"), `Sep 23 label shifted: ${sep23}`);

const rolled = rollBankDraftOpening({
  statementEnd: "2026-09-22",
  anchor: "2026-10-05",
  closing: -9150,
  lines: [
    { amount: 1000, cadence: "weekly", side: "inflow", status: "confirmed" },
    { amount: 200, cadence: "weekly", side: "outflow", status: "confirmed" },
  ],
});
assert(rolled.note?.includes("12 days") === true, `gap should be 12 days, got ${rolled.note}`);
assert(
  Math.abs(rolled.opening - (-9150 + (800 / 7) * 12)) < 0.02,
  `rolled opening ${rolled.opening}`,
);
const labelledGap = rollBankDraftOpening({
  statementEnd: "2026-09-22",
  anchor: "2026-10-05",
  closing: -9150,
  lines: [{ amount: 5000, cadence: "once_off", side: "inflow", status: "confirmed" }],
});
assert(labelledGap.opening === -9150, "no recurring lines leaves the bank closing in place");
assert(labelledGap.note?.includes("not in the 13 weeks") === true, labelledGap.note ?? "missing gap label");

const replaceNotice = openingCashReplaceNotice({
  currentOpening: 15000,
  bankClosing: -9150,
  bankDate: "2026-09-22",
  currency: "USD",
  locale: "en-US",
});
assert(
  replaceNotice ===
    "This replaces opening cash $15,000 → −$9,150 (bank closing balance on Sep 22, 2026)",
  replaceNotice ?? "missing replace notice",
);
assert(
  openingCashReplaceNotice({ currentOpening: 15000, bankClosing: 15000, bankDate: "2026-09-22" }) ===
    null,
  "matching opening cash needs no confirm",
);

const monthly = weeklyRunRate({
  revenue: 8633.6,
  operatingOutflows: 6132.48,
  periodMonths: 1,
});
const annual = weeklyRunRate({
  revenue: 8633.6 * 12,
  operatingOutflows: 6132.48 * 12,
  periodMonths: 12,
});
assert(
  Math.abs(monthly.weeklyInflow - annual.weeklyInflow) < 0.01,
  `monthly and annual inflows diverge: ${monthly.weeklyInflow} vs ${annual.weeklyInflow}`,
);
assert(
  Math.abs(monthly.weeklyOutflow - annual.weeklyOutflow) < 0.01,
  `monthly and annual outflows diverge: ${monthly.weeklyOutflow} vs ${annual.weeklyOutflow}`,
);
assert(monthly.weeklyOutflow < 2000, `weekly outflow should be a month/52 slice, got ${monthly.weeklyOutflow}`);

const yankees = {
  revenue: 8633.6,
  cogs: 775.98,
  fixedCosts: 5356.5,
  netIncome: 2501.12,
  payables: 8386.76,
  receivables: 9194.51,
  cash: 7430.22,
  periodMonths: "1",
};
const cashGenerative = { weeks: null, kind: "cash_generative" as const, label: "Cash generative" };
const stale = {
  startDate: "2025-08-01",
  openingBalance: "150877.6",
  revenue: [{ amount: "14846", frequency: "recurring-weekly", startWeek: 1 }],
  expenses: [{ amount: "42615", frequency: "recurring-weekly", startWeek: 1 }],
};
const outlook = resolveThirteenWeekForecast({
  financials: yankees,
  cashflow: stale,
  openingCash: 7430.22,
  runway: cashGenerative,
  now: monday,
});
assert(outlook.source === "derived" && outlook.replaceStored, "stale 2025 forecast is replaced");
assert(outlook.startDate === "2026-10-05", `start ${outlook.startDate}`);
assert(outlook.weekDates[0] === "2026-10-05" && outlook.weekDates.length === 13, "13 weeks from the anchor");
assert(outlook.opening === 7430.22, `opening ${outlook.opening}`);
assert(outlook.shortfall === false, "cash-generative forecast has no structural shortfall");
assert(outlook.totalOutflow < 40_000, `outflows inflated: ${outlook.totalOutflow}`);
assert(outlook.totalInflow < 40_000, `inflows inflated: ${outlook.totalInflow}`);
assert(outlook.totalInflow > outlook.totalOutflow, "profitable monthly run-rate stays cash generative");
assert(outlook.dipsBelowFloorWeek == null, "Yankees cash stays above the floor");
assert(
  Math.abs(outlook.totalOutflow - monthly.weeklyOutflow * 13) < 1,
  "derived outflows are the weekly run-rate times 13",
);

const datedButInflated = {
  startDate: "2026-10-05",
  openingBalance: "7430.22",
  revenue: [{ amount: "14846", frequency: "recurring-weekly", startWeek: 1 }],
  expenses: [{ amount: "42615", frequency: "recurring-weekly", startWeek: 1 }],
};
const ignored = resolveThirteenWeekForecast({
  financials: yankees,
  cashflow: datedButInflated,
  openingCash: 7430.22,
  runway: cashGenerative,
  now: monday,
});
assert(ignored.source === "derived" && ignored.shortfall === false, "structural shortfall is not shown");
assert(ignored.totalOutflow < 40_000, "inflated current-dated lines are ignored");
assert(ignored.floor < 20_000 && ignored.floor > 4_000, `floor is four corrected weeks, got ${ignored.floor}`);

const inflatedWithTiming = resolveThirteenWeekForecast({
  financials: yankees,
  cashflow: { ...datedButInflated, collectDelay: 2 },
  openingCash: 7430.22,
  runway: cashGenerative,
  now: monday,
});
assert(
  inflatedWithTiming.source === "derived",
  "a timing note does not keep outflows an order of magnitude above the run-rate",
);
assert(
  inflatedWithTiming.floor < 20_000 && inflatedWithTiming.floor > 4_000,
  `PDF floor follows corrected outflows, got ${inflatedWithTiming.floor}`,
);

const kept = resolveThirteenWeekForecast({
  financials: yankees,
  cashflow: {
    startDate: "2026-10-05",
    openingBalance: "7430.22",
    collectDelay: 2,
    revenue: [{ amount: "1000", frequency: "recurring-weekly", startWeek: 1 }],
    expenses: [{ amount: "400", frequency: "recurring-weekly", startWeek: 1 }],
  },
  openingCash: 7430.22,
  runway: cashGenerative,
  now: monday,
});
assert(kept.source === "stored" && kept.replaceStored === false, "a current forecast is kept");
assert(kept.timingNote == null || kept.shortfall === false, "a surplus needs no shortfall note");

const blankWithRevenue = resolveThirteenWeekForecast({
  financials: { revenue: 50000, cogs: 20000, fixedCosts: 22000, cash: 15000, periodMonths: "1" },
  cashflow: {
    startDate: "2026-10-05",
    openingBalance: "15000",
    revenue: [{ amount: "0", frequency: "recurring-weekly", startWeek: 1 }],
    expenses: [{ amount: "0", frequency: "recurring-monthly", startWeek: 1 }],
  },
  openingCash: 15000,
  now: monday,
});
assert(blankWithRevenue.source === "derived", "zero lines with P&L revenue are seeded");
assert(blankWithRevenue.estimateLabel === "Estimated from the P&L", blankWithRevenue.estimateLabel ?? "missing estimate label");
assert(parseFloat(blankWithRevenue.lines.revenue[0]?.amount ?? "0") > 0, "seeded inflow is the weekly run-rate");
assert(blankWithRevenue.totalInflow > 0 && blankWithRevenue.totalOutflow > 0, "seeded series is not $0 in and $0 out");

const pastBank = resolveThirteenWeekForecast({
  financials: { revenue: 50000, cogs: 20000, cash: 15000, periodMonths: "1" },
  cashflow: {
    startDate: "2026-09-23",
    openingBalance: "-9150",
    seededFromBanksAt: "2026-10-01T00:00:00.000Z",
    revenue: [{ amount: "7730.77", frequency: "recurring-weekly", startWeek: 1, name: "Receipts" }],
    expenses: [{ amount: "9692.31", frequency: "recurring-weekly", startWeek: 1, name: "Payments" }],
  },
  openingCash: -9150,
  now: monday,
});
assert(pastBank.source === "stored" && pastBank.replaceStored === false, "bank lines are kept");
assert(pastBank.startDate === "2026-10-05", `bank week 1 should be this week, got ${pastBank.startDate}`);
assert(pastBank.reanchored === true, "past bank start is reanchored");
assert(pastBank.weekDates[0] === "2026-10-05", "reanchored week label date is the week start");
assert(pastBank.opening !== -9150, "opening was rolled across the gap");
assert(pastBank.anchorNote?.includes("12 days") === true, pastBank.anchorNote ?? "missing roll note");

const disagree = plBankDisagreement({
  financials: { revenue: 50000, cogs: 20000, fixedCosts: 0, periodMonths: "1" },
  cashflow: pastBank.source === "stored"
    ? {
        seededFromBanksAt: "2026-10-01T00:00:00.000Z",
        revenue: [{ amount: String((33500 * 12) / 52), frequency: "recurring-weekly", startWeek: 1 }],
        expenses: [{ amount: String((42000 * 12) / 52), frequency: "recurring-weekly", startWeek: 1 }],
      }
    : null,
});
assert(disagree != null, "P&L and bank monthly figures disagree");
assert(disagree?.plRevenueMonthly === 50000, `P&L revenue ${disagree?.plRevenueMonthly}`);
assert(Math.round(disagree?.bankInflowMonthly ?? 0) === 33500, `bank receipts ${disagree?.bankInflowMonthly}`);
assert(Math.round(disagree?.bankOutflowMonthly ?? 0) === 42000, `bank payments ${disagree?.bankOutflowMonthly}`);
assert(disagree?.plCostMonthly === 20000, `P&L costs ${disagree?.plCostMonthly}`);

const snap = buildFinancialSnapshot({
  chips: [],
  cashRunwayWeeks: null,
  runwayLabel: "Cash generative",
  cash: { amount: 7430.22, floor: outlook.floor, dipsBelowFloorWeek: null },
});
const cashRow = snap.find((row) => row.key === "cash");
assert(Boolean(cashRow), "overview snapshot includes cash");
assert(cashRow?.value.includes("stays above floor") === true, cashRow?.value ?? "missing cash copy");
const dip = buildFinancialSnapshot({
  chips: [],
  cash: { amount: 1000, floor: 4000, dipsBelowFloorWeek: 6 },
});
assert(
  dip.find((row) => row.key === "cash")?.value.includes("dips below floor in week 6") === true,
  "dip copy names the week",
);

assert(HEALTH_BAND_TABLE.watchMin === 40 && HEALTH_BAND_TABLE.healthyMin === 80, "band table");
assert(scoreTier(71) === "at_risk" && healthBandLabel(scoreTier(71)) === "Watch", "71 is Watch");
assert(scoreTier(80) === "healthy" && healthBandLabel("healthy") === "Healthy", "80 is Healthy");
assert(scoreTier(39) === "critical" && healthBandLabel("critical") === "Critical", "39 is Critical");
assert(scoreTier(65) === "at_risk", "65 is Watch, not Healthy");

assert(scoreCreditorDays(329) === 0, "329 creditor days score 0");
const map = healthMapFromRatios({ "Creditor Days": 329 });
const playbook = scorePlaybookRatio("creditorDays", map);
assert(
  playbook?.health_score === 0 && playbook.health_tier === "critical" && playbook.unscored === false,
  `playbook creditor days ${JSON.stringify(playbook)}`,
);
const missing = scorePlaybookRatio("directCostsRatio", map);
assert(missing?.unscored === true, "unscored catalogue ratios are not a fake healthy score");

console.log("forecast-bands-test ok");
