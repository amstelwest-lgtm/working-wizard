/**
 * AQA retest of #574. The cash figures are the ones the Financial Manager
 * answer is supposed to read: 6 weeks below a R34,903 floor, lowest −R35,100 in week 2.
 * Run: pnpm test:aqa-retest-574
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BudgetVerdictStrip } from "../src/components/budget/budget-verdict.tsx";
import { resolveMarket } from "../src/lib/market/index.ts";
import { buildContext } from "../supabase/functions/ask-ai/context-builder.ts";
import { buildPrompt } from "../supabase/functions/ask-ai/prompt.ts";
import { summarizeCashForecast } from "../supabase/functions/ask-ai/deliverable-summaries.ts";
import { shapeCash } from "../supabase/functions/milon-bot/tools.ts";
import { plainBudgetWindowHeading } from "../src/lib/budget.months.ts";
import { budgetVolumeLabel, industryBudgetTemplate } from "../src/lib/budget-industry.ts";
import { formatVariancePct, varianceLine } from "../src/lib/budget.variance.ts";
import { workflowInputsHash, workflowPrompt } from "../src/lib/client-briefing.ts";
import { forecastAnchorDate } from "../src/lib/client-metrics.ts";
import type { ClientOperatingProfile } from "../src/lib/client-profile.ts";
import { ZA_MARKET } from "../src/lib/market/index.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const now = new Date();
const start = forecastAnchorDate({ now, timeZone: "Africa/Johannesburg" });
const opening = 44_480;
const closings = [60_000, -35_100, 70_000, 80_000, 90_000, 100_000, 110_000, 120_000, 30_000, 20_000, 10_000, 5_000, 4_000];
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
    floor: 34_903,
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

const summary = summarizeCashForecast(cashflow, null, {
  cashGenerative: true,
  openingCash: opening,
  financials,
  runway: { weeks: null, kind: "cash_generative", label: "Cash generative" },
  now,
  financialsUpdatedAt: null,
  timeZone: "Africa/Johannesburg",
});
assert(summary != null, "ask-ai summarizeCashForecast returned nothing");
assert(summary?.weeksBelowFloor === 6, `weeks below ${summary?.weeksBelowFloor}`);
assert(summary?.floor === 34_903, `floor ${summary?.floor}`);
assert(summary?.lowestCash === -35_100, `lowest ${summary?.lowestCash}`);
assert(summary?.lowestCashWeek === 2, `lowest week ${summary?.lowestCashWeek}`);
assert(summary?.cashGenerative === false, "a dipped series is not cash generative");
assert((summary?.negativeWeeks ?? 0) > 0, "week 2 is a negative close");

function emptyQuery(table: string, row: Record<string, unknown> | null) {
  const payload = () => {
    if (table === "advisory_packs") {
      return { data: null, error: { message: "relation advisory_packs does not exist" } };
    }
    if (table === "clients") return { data: row, error: null };
    return { data: [] as unknown[], error: null };
  };
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = chain;
  builder.eq = chain;
  builder.in = chain;
  builder.order = chain;
  builder.limit = chain;
  builder.maybeSingle = () => {
    if (table === "clients") return Promise.resolve({ data: row, error: null });
    if (table === "advisory_packs") return Promise.resolve(payload());
    return Promise.resolve({ data: null, error: null });
  };
  builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(payload()).then(resolve, reject);
  return builder;
}

const clientId = "79c4c485-9fa7-4499-9139-e1bb7cb40649";
const ctx = await buildContext(
  {
    from(table: string) {
      return emptyQuery(
        table,
        table === "clients"
          ? {
              id: clientId,
              name: "Chill Pepper Boutique Hotel",
              business_type: "service",
              financials,
              operating_profile: null,
              market: { country: "ZA" },
              cashflow,
              cash_runway_weeks: null,
              financials_updated_at: null,
              brain_summary: null,
            }
          : null,
      );
    },
  } as never,
  clientId,
  "full",
  "Is Chill Pepper cash generative, and how many weeks are below the floor?",
);
assert(ctx.cashForecast?.weeksBelowFloor === 6, `buildContext weeks ${ctx.cashForecast?.weeksBelowFloor}`);
assert(ctx.cashForecast?.floor === 34_903, `buildContext floor ${ctx.cashForecast?.floor}`);
assert(ctx.cashForecast?.lowestCash === -35_100, `buildContext lowest ${ctx.cashForecast?.lowestCash}`);
assert(ctx.cashForecast?.lowestCashWeek === 2, `buildContext week ${ctx.cashForecast?.lowestCashWeek}`);

const prompt = buildPrompt(
  "Is Chill Pepper cash generative, and how many weeks are below the floor?",
  ctx,
  "full",
  "accountant",
  "financial_manager",
);
assert(prompt.user.includes("Weeks below the floor: 6 of 13"), prompt.user);
assert(prompt.user.includes("Floor: 34903"), prompt.user);
assert(prompt.user.includes("Lowest cash point: -35100 in week 2"), prompt.user);
assert(!prompt.user.includes("Negative weeks: 0"), prompt.user);
assert(!prompt.user.includes("Cash runway: cash generative"), prompt.user);
assert(!/not stored/i.test(prompt.user), prompt.user);

const tool = shapeCash(cashflow, null, {
  financials,
  openingCash: opening,
  runway: { weeks: null, kind: "cash_generative", label: "Cash generative" },
  financialsUpdatedAt: null,
  timeZone: "Africa/Johannesburg",
});
assert(tool.weeksBelowFloor === 6, `get_cash_flow weeks ${tool.weeksBelowFloor}`);
assert(tool.floor === 34_903, `get_cash_flow floor ${tool.floor}`);
assert(tool.lowestCash === -35_100, `get_cash_flow lowest ${tool.lowestCash}`);
assert(tool.lowestCashWeek === 2, `get_cash_flow week ${tool.lowestCashWeek}`);

const hotel = {
  version: 1,
  payMotion: "time_delivery",
  volumeUnit: "day_shift",
  secondaryVolumeUnits: [],
  templateId: "day_labour",
  debtorDaysDefault: 45,
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

const workflow = workflowPrompt({
  clientName: "Chill Pepper Boutique Hotel",
  profile: hotel,
  businessType: "service",
  healthScore: 70,
  healthLabel: "Watch",
  snapshot: [],
  chips: [],
  cashRunwayWeeks: null,
  whatMatters: null,
  debtorDays: 6,
});
assert(workflow.includes("6 days"), workflow);
assert(!workflow.includes("45"), workflow);
assert(workflow.includes("Hotels & accommodation"), workflow);
assert(!workflow.includes("Labour & staffing"), workflow);
const workflowBase = {
  clientName: "Chill Pepper Boutique Hotel",
  profile: hotel,
  businessType: "service",
  healthScore: 70,
  healthLabel: "Watch",
  snapshot: [],
  chips: [],
  cashRunwayWeeks: null,
  whatMatters: null,
};
assert(
  workflowInputsHash({ ...workflowBase, debtorDays: 6 }) !==
    workflowInputsHash({ ...workflowBase, debtorDays: 45 }),
  "debtor days bust the cached workflow",
);
const workflowFn = readFileSync(resolve("src/lib/client-briefing.functions.ts"), "utf8");
assert(workflowFn.includes("debtorDays: z.number()"), "the workflow server keeps debtor days");

const template = industryBudgetTemplate("Chill Pepper Boutique Hotel", hotel, "service");
assert(template === "hospitality_rooms", `template ${template}`);
assert(
  budgetVolumeLabel("day_labour", "hospitality_rooms", "Days / shifts") === "Room-nights",
  "hotel volume is room-nights",
);
const heading = plainBudgetWindowHeading("Hotels / accommodation", { fyStart: "2026-03" }, ZA_MARKET);
assert(heading.startsWith("Hotels budget"), heading);
assert(!/day/i.test(heading), heading);

const profit = varianceLine("ebit", "Profit", -750, 56_800, true);
assert(profit.deltaPct == null, `percent stayed ${profit.deltaPct}`);
assert(profit.deltaPctNote === "budget is negative", profit.deltaPctNote ?? "");
assert(!formatVariancePct(profit.deltaPct, profit.deltaPctNote).includes("7673"), "the percent is not shown");
assert(formatVariancePct(profit.deltaPct, profit.deltaPctNote) === "budget is negative", formatVariancePct(profit.deltaPct, profit.deltaPctNote));
const strip = renderToStaticMarkup(
  createElement(BudgetVerdictStrip, {
    periodLabel: "This year",
    revenueBudget: 100_000,
    revenueActual: 120_000,
    profitBudget: -750,
    profitActual: 56_800,
    chip: "From this month's actuals",
    market: resolveMarket({ country: "ZA", regionCode: null }),
  }),
);
assert(strip.includes("budget is negative"), strip);
assert(!strip.includes("7673"), strip);

console.log("aqa-retest-574: ok");
