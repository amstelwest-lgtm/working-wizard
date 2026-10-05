/**
 * Forecast anchoring, period scaling, and the shared health band table.
 * Run: pnpm exec vite-node --config scripts/vite-test.config.ts scripts/forecast-bands-test.mts
 */
import { buildFinancialSnapshot } from "../src/lib/client-briefing";
import {
  forecastAnchorDate,
  resolveThirteenWeekForecast,
  scoreCreditorDays,
  weeklyRunRate,
} from "../src/lib/client-metrics";
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
