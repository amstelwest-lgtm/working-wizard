/**
 * Shared metric layer: QA Test Co trial balance, runway, cash source,
 * forecast copy, creditor-day guards, and the workflow headline.
 *
 * Run: pnpm exec vite-node --config scripts/vite-test.config.ts scripts/client-metrics-test.mts
 */
import type { ExtractionResult } from "../src/lib/financialSchema";
import { periodFinancialsFromExtraction } from "../src/lib/statement-financials";
import { computeRatios } from "../src/lib/ratios";
import { derivePeriodWaterfallFallback } from "../src/lib/weekly-inputs";
import { healthFromFlatFinancials } from "../src/lib/health-score";
import {
  assessClientMetrics,
  cycleTimelineAxis,
  resolveThirteenWeekForecast,
  forecastMinimumCash,
  scoreCreditorDays,
  scoreWorkingCapitalDays,
  scoreWorkingCapitalFunding,
} from "../src/lib/client-metrics";
import { cashCycleNarrative, cashForecastNarrative } from "../src/reports/narrative";
import {
  sanitizeWorkflowText,
  workflowAgreesWithSnapshot,
  type WorkflowContext,
} from "../src/lib/client-briefing";
import { buildOverviewBrief } from "../supabase/functions/ask-ai/overview-brief";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function qaTrialBalance(): ExtractionResult {
  const nil = null;
  return {
    entity_name: "QA Test Co (delete me)",
    registration_number: nil,
    currency: "ZAR",
    units: "actual",
    statement_basis: "management_accounts",
    extraction_notes: nil,
    comparative_period: nil,
    current_period: {
      period_end: "2026-10-31",
      figures: {
        income_statement: {
          revenue: 120_000,
          cost_of_sales: 45_000,
          gross_profit: nil,
          other_income: nil,
          operating_expenses: 42_000,
          depreciation_amortisation: nil,
          operating_profit: nil,
          finance_income: nil,
          finance_costs: nil,
          profit_before_tax: nil,
          income_tax: nil,
          profit_after_tax: nil,
        },
        balance_sheet: {
          non_current_assets: {
            property_plant_equipment: nil,
            intangible_assets: nil,
            investments: nil,
            deferred_tax_asset: nil,
            other: nil,
            total: nil,
          },
          current_assets: {
            inventories: nil,
            trade_and_other_receivables: 18_000,
            cash_and_cash_equivalents: 25_000,
            other: nil,
            total: nil,
          },
          total_assets: nil,
          equity: { share_capital: nil, retained_earnings: nil, other_reserves: nil, total: nil },
          non_current_liabilities: {
            borrowings: nil,
            deferred_tax_liability: nil,
            other: nil,
            total: nil,
          },
          current_liabilities: {
            trade_and_other_payables: 10_000,
            borrowings: nil,
            current_tax: nil,
            bank_overdraft: nil,
            other: nil,
            total: nil,
          },
          total_liabilities: nil,
          total_equity_and_liabilities: nil,
        },
        cash_flow: nil,
      },
    },
  };
}

const mapped = periodFinancialsFromExtraction(qaTrialBalance());
assert(mapped.fixedCosts === "42000", `opex persisted, got ${mapped.fixedCosts}`);
assert(mapped.ebit === "33000", `EBIT derived, got ${mapped.ebit}`);
assert(mapped.ebt === "33000", `EBT derived, got ${mapped.ebt}`);
assert(mapped.netIncome === "33000", `net profit derived, got ${mapped.netIncome}`);
assert(mapped.cash === "25000", `bank cash persisted, got ${mapped.cash}`);
assert(mapped.receivables === "18000" && mapped.payables === "10000", "AR and AP kept");
assert(mapped.totalLiabilities === "10000", `summed liabilities persist, got ${mapped.totalLiabilities}`);

const ratios = computeRatios(mapped);
assert(Math.abs(ratios["Gross Margin"] - 0.625) < 0.0001, `GM 62.5%, got ${ratios["Gross Margin"]}`);
assert(
  Math.abs(ratios["Operating Margin"] - 0.275) < 0.0001,
  `OM 27.5%, got ${ratios["Operating Margin"]}`,
);
assert(Math.abs(ratios["Net Margin"] - 0.275) < 0.0001, `NM 27.5%, got ${ratios["Net Margin"]}`);

const waterfall = derivePeriodWaterfallFallback(mapped);
assert(waterfall.fixedCosts === 42_000, `waterfall opex, got ${waterfall.fixedCosts}`);
const operatingProfit =
  waterfall.revenue - waterfall.cogs - waterfall.fixedCosts - (waterfall.depreciation ?? 0);
assert(operatingProfit === 33_000, `operating profit 33k, got ${operatingProfit}`);
assert((waterfall.depreciation ?? 0) === 0, "reconciled opex has no depreciation plug");

const onFile = assessClientMetrics({ financials: mapped });
assert(onFile.cash.amount === 25_000 && onFile.cash.source === "period", "TB cash is the cash source");
assert(
  onFile.runway.kind === "unknown" && onFile.runway.label === "Not enough data",
  `P&L cash without a cash-flow line is not cash generative, got ${onFile.runway.kind} ${onFile.runway.label}`,
);
assert(onFile.runway.weeks !== 0 && onFile.runway.label !== "0 weeks", "positive cash is not 0 weeks");

const bankOnly = assessClientMetrics({
  financials: { revenue: "120000", netIncome: "33000" },
  cashflow: { openingBalance: "29105", seededFromBanksAt: "2026-10-05T17:11:42.642Z" },
  financialsUpdatedAt: "2026-10-01T00:00:00.000Z",
});
assert(bankOnly.cash.amount === 29105 && bankOnly.cash.source === "bank", "published bank fills a blank cash line");
assert(bankOnly.runway.kind === "cash_generative", "bank cash with a profit is not 0 weeks");

const bankNewer = assessClientMetrics({
  financials: mapped,
  cashflow: { openingBalance: "29105", seededFromBanksAt: "2026-10-05T17:11:42.642Z" },
  financialsUpdatedAt: "2026-10-01T00:00:00.000Z",
});
assert(bankNewer.cash.source === "bank" && bankNewer.cash.amount === 29105, "newer bank publish wins");

const tbNewer = assessClientMetrics({
  financials: mapped,
  cashflow: { openingBalance: "29105", seededFromBanksAt: "2026-09-01T00:00:00.000Z" },
  financialsUpdatedAt: "2026-10-05T12:00:00.000Z",
});
assert(tbNewer.cash.source === "period" && tbNewer.cash.amount === 25000, "newer TB cash wins");

const staleForecast = assessClientMetrics({
  financials: { cash: "7430.22", netIncome: "2501.12", revenue: "8633.6", periodMonths: "1" },
  cashflow: { openingBalance: "150877.6", startDate: "2025-08-01" },
});
assert(staleForecast.cash.amount === 7430.22, "stale forecast opening is not Overview cash");
assert(
  staleForecast.runway.kind === "unknown" && staleForecast.runway.label === "Not enough data",
  "a stale forecast opening is not cash-flow evidence",
);

const burning = assessClientMetrics({
  financials: {
    cash: "10000",
    netIncome: "-12000",
    cogs: "8000",
    fixedCosts: "20000",
    periodMonths: "1",
  },
});
assert(burning.runway.kind === "weeks" && (burning.runway.weeks ?? 0) > 0, "a loss still has weeks, not zero");

const broke = assessClientMetrics({ financials: { cash: "0", netIncome: "-1000" } });
assert(broke.runway.kind === "zero" && broke.runway.weeks === 0, "zero cash is 0 weeks");

const floor = forecastMinimumCash({ weeklyOutflows: Array.from({ length: 13 }, () => 15_000 / 13) });
assert(floor !== 50_000 && floor > 0 && floor < 10_000, `scaled floor, got ${floor}`);
assert(forecastMinimumCash({ configured: 80_000, weeklyOutflows: [1_000] }) === 80_000, "configured floor wins");
assert(forecastMinimumCash({}) === 50_000, "R50k remains the fallback");

const forecastCopy = cashForecastNarrative({
  runwayWeeks: null,
  cashGenerative: true,
  minBalance: -7_500,
  threshold: floor,
  weeksBelow: 13,
  firstBreachWeek: 1,
});
assert(/cash generative/i.test(forecastCopy), forecastCopy);
assert(!/0 weeks/i.test(forecastCopy), forecastCopy);
assert(/week 1/.test(forecastCopy), forecastCopy);
assert(!/in 13 weeks/.test(forecastCopy), forecastCopy);
assert(/for 13 weeks/.test(forecastCopy), forecastCopy);

const cycleCopy = cashCycleNarrative({
  ccc: -3556,
  cashTrapped: 0,
  dailyRevenue: 24,
});
assert(!/efficient cycle/.test(cycleCopy), cycleCopy);
assert(/beyond normal terms/.test(cycleCopy), cycleCopy);

const axis = cycleTimelineAxis(389, 3945);
assert(axis.capped && axis.total === 360, `axis ${axis.total}`);
assert(axis.ticks.length <= 6, `ticks overlap risk: ${axis.ticks.join(",")}`);
assert(axis.ticks[axis.ticks.length - 1] === 360, "axis ends at the cap");

assert(Math.round(scoreCreditorDays(81)) === 65, `81 creditor days ~65, got ${scoreCreditorDays(81)}`);
assert(scoreCreditorDays(90) === 50, "90 creditor days is watch");
assert(scoreCreditorDays(120) === 0 && scoreCreditorDays(329) === 0, "stretched creditors are not healthy");
assert(scoreWorkingCapitalDays(-3556) === 0, "extreme negative CCC is not a perfect score");
assert(scoreWorkingCapitalFunding(-3556 / 365) === 0, "absurd funding intensity is not healthy");

const monthly = computeRatios({
  revenue: "8633.6",
  cogs: "775.98",
  ebit: "2501.12",
  ebt: "2501.12",
  netIncome: "2501.12",
  ebitda: "2501.12",
  operatingCashflow: "0",
  totalAssets: "21323.01",
  equity: "8266.73",
  receivables: "9194.51",
  inventory: "",
  payables: "8386.76",
  fixedCosts: "5356.5",
  variableCosts: "",
  top5Revenue: "",
  laborCost: "",
  employees: "",
  founderHours: "",
  periodMonths: "1",
});
assert(Math.round(monthly["Creditor Days"]) === 329, `annualised DPO 329, got ${monthly["Creditor Days"]}`);
assert(Math.round(monthly["Debtor Days"]) === 32, `annualised DSO 32, got ${monthly["Debtor Days"]}`);

const kept = sanitizeWorkflowText(
  "The gross margin is 62.5%. Use the Health report to build on it. A third sentence is dropped.",
);
assert(kept?.startsWith("The gross margin is 62.5%."), `decimal kept, got ${kept}`);
assert(!kept?.includes("third"), "still two sentences");

const sliced = sanitizeWorkflowText(
  "62.5% gross margin — likely a collections or timing issue. Then use the Advisory Drafter.",
);
assert(sliced?.startsWith("62.5%"), `must not resume at 5%, got ${sliced}`);

const workflowCtx = {
  clientName: "QA Test Co",
  profile: null,
  businessType: null,
  healthScore: 75,
  healthLabel: "Healthy",
  snapshot: [{ key: "gm" as const, label: "Gross margin", value: "62.5%" }],
  chips: [],
  cashRunwayWeeks: null,
  whatMatters: null,
} satisfies WorkflowContext;
assert(
  workflowAgreesWithSnapshot(
    "5% gross margin — likely a collections or timing issue.",
    workflowCtx,
  ) === false,
  "5% headline disagrees with 62.5%",
);
assert(
  workflowAgreesWithSnapshot(
    "62.5% gross margin — likely a collections or timing issue.",
    workflowCtx,
  ) === false,
  "a healthy gross margin is not a collections problem",
);
assert(
  workflowAgreesWithSnapshot("Use the Health report to build on the 62.5% gross margin.", workflowCtx),
  "matching margin is accepted",
);

const yankees = {
  cash: "7430.22",
  revenue: "8633.6",
  cogs: "775.98",
  ebit: "2501.12",
  ebt: "2501.12",
  netIncome: "2501.12",
  ebitda: "2501.12",
  operatingCashflow: "0",
  totalAssets: "21323.01",
  equity: "8266.73",
  payables: "8386.76",
  receivables: "9194.51",
  fixedCosts: "5356.5",
  periodMonths: "1",
};
const yankeesMetrics = assessClientMetrics({ financials: yankees });
const yankeesHealth = healthFromFlatFinancials(yankees, yankeesMetrics.runway.weeks, {
  country: "US",
  copyPack: "us",
});
const yankeesBrief = buildOverviewBrief({
  financials: yankees,
  cash: yankeesMetrics.cash.amount,
  runwayWeeks: yankeesMetrics.runway.weeks,
  runwayLabel: yankeesMetrics.runway.label,
  copyPack: "us",
});
assert(yankeesMetrics.runway.kind === "cash_generative", "Yankees operating cash flow keeps cash generative");

// Budget lines parked on the FY start must not be rolled into Overview cash.
// Bot reads cash.amount; Overview reads outlook.opening. Both stay on the statement.
const wednesday = new Date("2026-10-07T15:00:00Z");
const budgetRolled = assessClientMetrics({
  financials: yankees,
  financialsUpdatedAt: "2026-09-21T21:27:35.406Z",
  now: wednesday,
  cashflow: {
    startDate: "2026-09-01",
    openingBalance: "7430.22",
    seededFromBanksAt: "2026-10-06T00:00:00.000Z",
    revenue: [{ name: "Primary revenue (from budget)", amount: "8000", frequency: "recurring-monthly", startWeek: 1 }],
    expenses: [
      { name: "COGS (from budget)", amount: "700", frequency: "recurring-monthly", startWeek: 1 },
      { name: "People / salaries (from budget)", amount: "4000", frequency: "recurring-monthly", startWeek: 1 },
    ],
  },
});
assert(
  budgetRolled.cash.amount === 7430.22 && budgetRolled.cash.source === "period",
  `budget seed is not a bank balance, got ${budgetRolled.cash.source} ${budgetRolled.cash.amount}`,
);
assert(
  budgetRolled.outlook.opening === 7430.22,
  `Overview cash stays the statement, got ${budgetRolled.outlook.opening}`,
);
assert(
  !/rolled forward/i.test(budgetRolled.outlook.anchorNote ?? ""),
  budgetRolled.outlook.anchorNote ?? "budget roll banner should be absent",
);

// No bank publish at all: same rule. QA US Test LLC was $128,450 on the Bot
// and ~$181k on Overview after the gap was filled with budget P&L.
const statementOnly = assessClientMetrics({
  financials: {
    cash: "128450",
    revenue: "50000",
    cogs: "20000",
    fixedCosts: "22000",
    netIncome: "8000",
    periodMonths: "1",
  },
  now: wednesday,
  cashflow: {
    startDate: "2026-09-01",
    openingBalance: "128450",
    revenue: [{ name: "Sales", amount: "40000", frequency: "recurring-monthly", startWeek: 1 }],
    expenses: [{ name: "Payroll", amount: "25000", frequency: "recurring-monthly", startWeek: 1 }],
  },
});
assert(statementOnly.cash.amount === 128450, `Bot cash ${statementOnly.cash.amount}`);
assert(
  statementOnly.outlook.opening === 128450,
  `Overview invented cash, got ${statementOnly.outlook.opening}`,
);
assert(
  !/rolled forward/i.test(statementOnly.outlook.anchorNote ?? ""),
  statementOnly.outlook.anchorNote ?? "statement roll banner should be absent",
);

const plOnly = assessClientMetrics({
  financials: {
    revenue: "50000",
    cogs: "20000",
    ebit: "8000",
    receivables: "6000",
    payables: "4000",
    cash: "15000",
  },
});
assert(
  plOnly.runway.kind === "unknown" && plOnly.runway.label === "Not enough data",
  `hand-entered P&L is not cash generative, got ${plOnly.runway.label}`,
);
assert(yankeesHealth.overall === 71 && yankeesHealth.displayLabel === "Watch", `Yankees health ${yankeesHealth.overall} ${yankeesHealth.displayLabel}`);
assert(yankeesBrief.health === 71 && yankeesBrief.healthLabel === "Watch", "bot brief matches Overview");
assert(Math.round(yankeesBrief.creditorDays ?? 0) === 329, "bot creditor days stay annualised");

const qaCycle = resolveThirteenWeekForecast({
  financials: {
    cash: "128450",
    revenue: "700000",
    cogs: "280000",
    receivables: "82192",
    payables: "48658",
    periodMonths: "12",
    periodEnd: "2026-07-31",
  },
  openingCash: 128450,
  fyStartMonth: 1,
});
assert(
  qaCycle.cycleNote === "Debtor days are 25. Collections use the same monthly revenue run-rate.",
  qaCycle.cycleNote ?? "missing cycle note",
);

console.log("client-metrics-test: all assertions passed");
