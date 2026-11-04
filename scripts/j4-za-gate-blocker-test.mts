/**
 * Gate J4 ZA: Budget vs actual, P&L parentheses, cash interest, stale Analyst GM.
 * Run: pnpm test:j4-za-gate
 */
import { budgetStatementDisplayTotals, budgetRangeTotals, budgetMonthViews } from "../src/lib/budget-chart-table";
import { budgetVersusStatement } from "../src/lib/budget.bridges";
import { fiscalStatementSlice } from "../src/lib/budget-period";
import { budgetComparisonPeriodBasis } from "../src/lib/statement-cover";
import { yearMoneyFromFiscalSlice } from "../src/lib/budget-year-compare";
import { interestOfRevenueSentence } from "../src/lib/cash-interest-note";
import { FIGURES_CHANGED_REGENERATE } from "../src/lib/health-snapshot";
import { findingSentence } from "../src/lib/milon-team-activity";
import { formatReportAmount, formatMoney } from "../src/lib/market/format";
import { createBudgetDocument } from "../src/lib/budget.months";
import { ZA_MARKET } from "../src/lib/market/resolve";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const chill = {
  revenue: 1_215_000,
  cogs: -56_000,
  ebit: 56_800,
  netIncome: 27_010,
  interest: 19_800,
};

const doc = createBudgetDocument({
  templateId: "hospitality_rooms",
  fyStart: "2026-03",
  fyStartMonth: 3,
  qualification: {
    payMotion: "time_delivery",
    volumeUnit: "room_nights",
    driverKind: "volume_price",
    costShape: "payroll_heavy",
    debtorDaysDefault: 14,
    capexMode: "none",
    confirmedAt: "2026-09-01T00:00:00.000Z",
  },
});

assert(budgetComparisonPeriodBasis(chill).kind === "stored", "undated P&L gets a cover for budget");
const versus = budgetVersusStatement(doc, chill, ZA_MARKET);
assert(versus?.periodKnown === true, "budget scores the on-file year");
assert(Math.abs((versus?.revenue ?? 0) - 1_215_000) < 1, `actual revenue ${versus?.revenue}`);

const slice = fiscalStatementSlice(chill, 3);
assert(slice != null && Math.abs((slice.operatingProfit ?? 0) - 56_800) < 1, "operating profit on slice");
assert(slice.cogs === 56_000, `COGS uses cost magnitude like the P&L, got ${slice.cogs}`);
const year = yearMoneyFromFiscalSlice(slice);
assert(year?.cogs === 56_000, `year strip COGS ${year?.cogs}`);

const planZeros = budgetStatementDisplayTotals({
  periodKnown: false,
  planTotals: budgetRangeTotals(budgetMonthViews(doc, [])),
});
assert(planZeros.revenue == null, "unknown period does not print R 0 revenue");

const money = (n: number) => formatMoney(n, ZA_MARKET);
const interest = interestOfRevenueSentence(chill, money);
assert(interest != null && !interest.includes("("), `interest line has no debit parens: ${interest}`);

function pnlAmount(amount: number): string {
  if (amount < 0) return formatReportAmount(amount, ZA_MARKET, { sign: "parens" });
  return formatMoney(amount, ZA_MARKET);
}
assert(!pnlAmount(1_215_000).startsWith("("), "positive P&L lines are not parenthesised");
assert(pnlAmount(-56_000).startsWith("("), "negative costs stay in parentheses");

const live = {
  overall: 54,
  pillars: [
    { id: "profit", label: "Profit", score: 46 },
    { id: "assets", label: "Assets", score: 84 },
    { id: "financing", label: "Financing", score: 60 },
    { id: "cash", label: "Cash", score: 25 },
  ],
  weakestLabel: "Cash",
  weakestScore: 25,
  periodLabel: "Full year on file",
};

const stale = findingSentence({
  title: "Gross margin is 104.6%. Profit is the weakest pillar at 58.",
  liveHealth: live,
  canonicalRatios: { "Gross Margin": 95.4 },
});
assert(stale.includes(FIGURES_CHANGED_REGENERATE), stale);

console.log("j4-za-gate-blocker: ok");
