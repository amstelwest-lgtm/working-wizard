/**
 * AQA retest of #573. One check per finding. Figures are the ones AQA quoted.
 * Run: pnpm test:aqa-retest-573
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { summarizeCashForecast } from "../supabase/functions/ask-ai/deliverable-summaries.ts";
import { buildOverviewBrief } from "../supabase/functions/ask-ai/overview-brief.ts";
import { budgetPlanFiguresChanged } from "../src/lib/budget.bridges.ts";
import {
  clientListRunwayHeadline,
  clientListStatusWord,
  forecastOpeningColumnTotal,
} from "../src/lib/cash-forecast-parity.ts";
import { describeBusiness } from "../src/lib/client-briefing.ts";
import {
  assessClientMetrics,
  cashScreenFloor,
  forecastAnchorDate,
  plBankDisagreement,
  resolveCashScreenForecast,
} from "../src/lib/client-metrics.ts";
import type { ClientOperatingProfile } from "../src/lib/client-profile.ts";
import { scorecardHealthFromFinancials } from "../src/lib/health-score.ts";
import { clientIndustryDisplay, profileDisplayRows } from "../src/lib/profile-signals.ts";
import { budgetSignoffIsStale } from "../src/lib/signoff-status.ts";
import type { BudgetDocument } from "../src/lib/budget.types.ts";
import { ZA_MARKET } from "../src/lib/market/index.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

// 1. Chat context uses the cash screen's 13-week series, not a P&L sketch.
const now = new Date("2026-10-12T12:00:00Z");
const start = forecastAnchorDate({ now });
const opening = 44_480;
const closings = [60_000, -35_100, 70_000, 80_000, 90_000, 100_000, 110_000, 120_000, 40_000, 30_000, 20_000, 10_000, 5_000];
let prev = opening;
const inflow: Record<string, number> = {};
const outflow: Record<string, number> = {};
closings.forEach((close, index) => {
  const net = close - prev;
  inflow[String(index)] = net > 0 ? net : 0;
  outflow[String(index)] = net < 0 ? -net : 0;
  prev = close;
});
const financials = {
  revenue: 5_000_000,
  cogs: 200_000,
  fixedCosts: 200_000,
  netIncome: 1_000_000,
  cash: opening,
  periodMonths: "12",
};
const cashflow = {
  openingBalance: String(opening),
  openingBalanceSource: "xero",
  startDate: start,
  suggestionConfirm: {
    floor: 50_000,
    opening: null,
    fixedMonthly: null,
    at: "2026-01-01T00:00:00.000Z",
  },
  revenue: [
    {
      id: "in",
      name: "Receipts",
      amount: "1",
      frequency: "recurring-weekly",
      startWeek: 1,
      splitCount: 1,
      weekOverrides: inflow,
    },
  ],
  expenses: [
    {
      id: "out",
      name: "Payments",
      amount: "1",
      frequency: "recurring-weekly",
      startWeek: 1,
      splitCount: 1,
      weekOverrides: outflow,
    },
  ],
};
const metrics = assessClientMetrics({ financials, cashflow, financialsUpdatedAt: null });
assert(metrics.runway.kind === "cash_generative", `ledger opening made runway ${metrics.runway.kind}`);
assert(metrics.outlook.source === "derived", "the P&L runway still replaces the stored series");
const screen = resolveCashScreenForecast({ financials, cashflow, now });
const floor = cashScreenFloor(cashflow, screen.outflow);
const screenBelow = screen.closing.filter((value) => value < floor).length;
assert(screen.source === "stored", `cash screen kept ${screen.source}`);
assert(screenBelow === 6, `cash screen weeks below ${screenBelow}`);
assert(screen.closing[1] === -35_100, `week 2 close ${screen.closing[1]}`);
const summary = summarizeCashForecast(cashflow, metrics.runway.weeks, {
  cashGenerative: metrics.runway.kind === "cash_generative",
  openingCash: metrics.cash.amount,
  financials,
  runway: metrics.runway,
  now,
  financialsUpdatedAt: null,
});
assert(summary?.weeksBelowFloor === 6, `chat context weeks below ${summary?.weeksBelowFloor}`);
assert((summary?.negativeWeeks ?? 0) > 0, "a negative close is not zero negative weeks");
assert(summary?.cashGenerative === false, "a dipped forecast is not cash generative");

// 2. Budget staleness ignores key order and a rewritten document clock.
const signed = { signed_off_at: "2026-10-01T00:00:00.000Z" };
assert(budgetSignoffIsStale(signed, null) === false, "no budget column is not stale");
const plan = {
  fyStart: "2026-03",
  fyStartMonth: 3,
  activeScenario: "base",
  openingCash: 44_480,
  openingCashSource: "statement",
  gpPct: 60,
  cogsMode: "gp_pct",
  cogsPerUnit: { a: 0 },
  statementDepreciation: 0,
  wc: { debtorDays: 6, creditorDays: 30, inventoryDays: 0 },
  wcDaysSource: "ratios",
  revenueLines: [{ name: "Rooms", months: { "2026-03": { volume: 1, price: 100 } } }],
  overheads: [],
  capex: [],
  updatedAt: "2026-09-01T00:00:00.000Z",
  notes: [{ id: "n", at: "2026-10-20T00:00:00.000Z", by: "A", text: "later note", kind: "note" }],
} as unknown as BudgetDocument;
const reordered = {
  updatedAt: "2026-10-20T00:00:00.000Z",
  notes: plan.notes,
  capex: [],
  overheads: [],
  revenueLines: [{ months: { "2026-03": { price: 100, volume: 1 } }, name: "Rooms" }],
  wcDaysSource: "manual",
  wc: { inventoryDays: 0, creditorDays: 30, debtorDays: 6 },
  statementDepreciation: 0,
  cogsPerUnit: { a: 0 },
  cogsMode: "gp_pct",
  gpPct: 60,
  openingCashSource: "bank",
  openingCash: 44_480,
  activeScenario: "base",
  fyStartMonth: 3,
  fyStart: "2026-03",
} as unknown as BudgetDocument;
assert(budgetPlanFiguresChanged(plan, reordered) === false, "key order and clocks are not a figure change");
assert(
  budgetPlanFiguresChanged(plan, { ...plan, gpPct: 40 }) === true,
  "a different gross-profit percent is a figure change",
);
const reports = read("src/routes/_authenticated/reports-studio.tsx");
assert(!reports.includes("storedBudget?.updatedAt"), "Budget & Variance does not use the document clock");
const pdfExport = read("src/components/budget/budget-pdf-export.tsx");
assert(!pdfExport.includes("doc.updatedAt"), "the variance PDF does not stale off the document clock");

// 3. A near-empty placeholder is not a forecast.
const dustClosings = Array.from({ length: 13 }, () => -10);
const dust = clientListRunwayHeadline({
  source: "stored",
  opening: 0,
  closings: dustClosings,
  floor: 69,
  totalInflow: 20,
  totalOutflow: 224,
  healthOverall: 67,
});
assert(dust === "—", `placeholder runway ${dust}`);
const dustStatus = clientListStatusWord({
  healthLabel: "Watch",
  healthOverall: 67,
  source: "stored",
  opening: 0,
  floor: 69,
  dipsBelowFloorWeek: 1,
  totalInflow: 20,
  totalOutflow: 224,
});
assert(dustStatus === "Watch", `placeholder status ${dustStatus}`);
const realBurn = clientListRunwayHeadline({
  source: "stored",
  opening: 0,
  closings: Array.from({ length: 13 }, () => -1_000),
  floor: 15_000,
  totalOutflow: 12_000,
  healthOverall: 67,
});
assert(realBurn === "13 weeks below", `a real zero-opening burn stays ${realBurn}`);

// 4. Cash Flow pillar: chat uses the same scorecard as Where it hurts.
const pillarFinancials = {
  revenue: 120_000,
  cogs: 40_000,
  receivables: 20_000,
  payables: 10_000,
  periodMonths: "3",
};
const pageHealth = scorecardHealthFromFinancials({
  financials: pillarFinancials,
  fyStartMonth: 3,
  periodMonths: 3,
  cashRunwayWeeks: 2,
  cashBalance: null,
});
const brief = buildOverviewBrief({
  financials: pillarFinancials,
  cash: null,
  runwayWeeks: 2,
  fyStartMonth: 3,
});
const pageCash = pageHealth.pillars.find((pillar) => pillar.id === "cash")?.score;
const briefCash = brief.pillars.find((pillar) => pillar.id === "cash")?.score;
assert(briefCash === pageCash, `chat cash pillar ${briefCash} vs page ${pageCash}`);
const blended = scorecardHealthFromFinancials({
  financials: pillarFinancials,
  fyStartMonth: 3,
  periodMonths: 3,
  cashRunwayWeeks: 2,
});
const blendedCash = blended.pillars.find((pillar) => pillar.id === "cash")?.score;
assert(blendedCash !== pageCash, "omitting the cash balance changes the pillar");

// 5. Opening-cash total is week 1, not week 13.
assert(forecastOpeningColumnTotal([44_480, 71_628]) === 44_480, "total opening is week 1");
const grid = read("src/components/cash-thirteen-week.tsx");
assert(grid.includes("forecastOpeningColumnTotal(openings, opening)"), "the grid total uses week 1");

// 6. Health uses the same industry as the Clients list.
const labourHotel = {
  version: 1,
  payMotion: "time_delivery",
  volumeUnit: "day_shift",
  secondaryVolumeUnits: [],
  templateId: "day_labour",
  debtorDaysDefault: 30,
  costShape: "payroll_heavy",
  seasonality: "mild",
  inventoryIntensity: "none",
  customerConcentration: "moderate",
  debtPosition: "light",
  ownerGoal: "grow_revenue",
  primaryPressure: "growth",
  businessTypeId: "services",
  fyStartMonth: 3,
  depth: "full",
  confirmedAt: "2026-01-01T00:00:00.000Z",
} as ClientOperatingProfile;
const industry = clientIndustryDisplay("Karoo Lodge", labourHotel, "service");
assert(industry === "Hotels & accommodation", industry);
const about = describeBusiness(labourHotel, "service", null, {
  name: "Karoo Lodge",
  businessType: "service",
});
assert(about?.includes("Hotels & accommodation") === true, about ?? "");
assert(!about?.includes("Labour"), about ?? "");
assert(!/sells time/i.test(about ?? ""), about ?? "");
const rows = profileDisplayRows(labourHotel, ZA_MARKET, null, industry);
assert(rows.find((row) => row.label === "Model")?.value === "Hotels & accommodation", "profile model uses the client industry");

// 7. P&L revenue and bank receipts stay visible, and are named as different figures.
const weeklyReceipts = (47_458 * 12) / 52;
const gap = plBankDisagreement({
  financials: { revenue: 101_250, cogs: 40_000, fixedCosts: 10_000, periodMonths: "1" },
  cashflow: {
    seededFromBanksAt: "2026-10-01T00:00:00.000Z",
    revenue: [{ amount: String(weeklyReceipts), frequency: "recurring-weekly", startWeek: 1, name: "Receipts" }],
    expenses: [{ amount: String((20_000 * 12) / 52), frequency: "recurring-weekly", startWeek: 1, name: "Payments" }],
  },
});
assert(gap != null, "the invoiced-versus-collected gap stays on screen");
assert(Math.round(gap?.plRevenueMonthly ?? 0) === 101_250, `P&L revenue ${gap?.plRevenueMonthly}`);
assert(Math.round(gap?.bankInflowMonthly ?? 0) === 47_458, `bank receipts ${gap?.bankInflowMonthly}`);
const notice = read("src/components/pl-bank-disagree-notice.tsx");
assert(notice.includes("Invoiced sales and cash collected are different figures"), notice);
assert(notice.includes("invoiced sales"), notice);
assert(notice.includes("cash collected"), notice);
assert(!notice.includes("P&L and bank data disagree"), "the banner does not call the gap a data error");

console.log("aqa-retest-573: ok");
