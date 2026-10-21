/**
 * One period on the Budget page and the profit waterfall.
 *
 * A ZA March year clips a January–September statement to March–September.
 * A US calendar year keeps January–September whole. The This year card,
 * This year vs last year, and the waterfall quote that same slice.
 * A missing line stays null.
 *
 * Other side? Owner (`src/routes/app.tsx`) and accountant
 * (`src/routes/_authenticated/clients.$clientId.tsx`) both draw
 * `fiscalWaterfallFallback`. Both portals read the slice from BudgetPanel.
 *
 * Run: pnpm test:budget-za-period
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BudgetVerdictStrip } from "../src/components/budget/budget-verdict";
import { BudgetYearStrip } from "../src/components/budget/budget-year-strip";
import { fmtBudgetMoney } from "../src/lib/budget.compute";
import { yearMoneyFromFiscalSlice } from "../src/lib/budget-year-compare";
import {
  budgetHeadlineFigures,
  fiscalStatementSlice,
  fiscalWaterfallFallback,
} from "../src/lib/budget-period";
import { budgetVersusStatement, seedBudgetFromFinancials } from "../src/lib/budget.bridges";
import { createBudgetDocument } from "../src/lib/budget.months";
import type { BudgetQualification } from "../src/lib/budget.types";
import { resolveMarket, type ResolvedMarket } from "../src/lib/market";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const ZA = resolveMarket({ country: "ZA" });
const US = resolveMarket({ country: "US", regionCode: "NY" });

const qualification: BudgetQualification = {
  payMotion: "time_delivery",
  volumeUnit: "billable_hours",
  driverKind: "hours_rate",
  costShape: "payroll_heavy",
  debtorDaysDefault: 30,
  capexMode: "none",
  confirmedAt: "2026-03-01T00:00:00.000Z",
};

function close(actual: number | null | undefined, expected: number, msg: string) {
  assert(actual != null && Math.abs(actual - expected) < 0.02, `${msg}: ${actual} vs ${expected}`);
}

/** Operating profit the waterfall draws: revenue − COGS − overheads − depreciation. */
function drawnOperating(fallback: {
  revenue: number;
  cogs: number;
  fixedCosts: number;
  depreciation?: number;
}): number {
  return fallback.revenue - fallback.cogs - fallback.fixedCosts - (fallback.depreciation ?? 0);
}

function cardsAgree(
  fin: Record<string, string>,
  fyStartMonth: number,
  market: ResolvedMarket,
  expectedRevenue: number,
  expectedOperating: number,
  labelParts: string[],
) {
  const slice = fiscalStatementSlice(fin, fyStartMonth);
  assert(slice != null, "statement has a firm-year slice");
  const year = yearMoneyFromFiscalSlice(slice);
  const waterfall = fiscalWaterfallFallback(fin, fyStartMonth);
  assert(waterfall != null, "waterfall uses the same slice");
  const headline = budgetHeadlineFigures(slice, { revenue: 1, operatingProfit: 2 });
  close(headline.revenue, expectedRevenue, "this year revenue");
  close(headline.operatingProfit, expectedOperating, "this year operating profit");
  close(year?.revenue, expectedRevenue, "year strip revenue");
  close(waterfall.operatingProfit, expectedOperating, "waterfall operating profit");
  close(drawnOperating(waterfall.fallback), expectedOperating, "waterfall step");
  close(slice.revenue, expectedRevenue, "slice revenue");
  assert(headline.label != null, "the card names its period");
  for (const part of labelParts) {
    assert(headline.label.includes(part), `${headline.label} should mention ${part}`);
  }
  assert(waterfall.slice.label === headline.label, "waterfall period matches the budget card");

  const revenueText = fmtBudgetMoney(expectedRevenue, market);
  const profitText = fmtBudgetMoney(expectedOperating, market);
  // The verdict keeps grouping spaces from wrapping. The year strip uses the plain formatter.
  const sticky = (text: string) => text.replace(/ /g, "\u00A0");
  const verdict = renderToStaticMarkup(
    createElement(BudgetVerdictStrip, {
      periodLabel: headline.label,
      revenueBudget: headline.revenue,
      revenueActual: null,
      profitBudget: headline.operatingProfit,
      profitActual: null,
      chip: "Estimated from statement pace",
      market,
    }),
  );
  const yearStrip = renderToStaticMarkup(
    createElement(BudgetYearStrip, {
      thisYear: year,
      thisMonths: slice.months,
      lastYear: null,
      market,
      periodLabel: headline.label,
    }),
  );
  assert(verdict.includes(headline.label), `verdict period: ${verdict}`);
  assert(verdict.includes(sticky(revenueText)), `verdict revenue ${revenueText}: ${verdict}`);
  assert(verdict.includes(sticky(profitText)), `verdict profit ${profitText}: ${verdict}`);
  assert(yearStrip.includes(headline.label), "year strip names the same period");
  assert(yearStrip.includes(revenueText), `year strip revenue ${revenueText}`);
  return { slice, headline, year, waterfall };
}

/** January–September statement. Revenue and operating profit reconcile. */
const JAN_SEP = {
  revenue: "412000",
  cogs: "171000",
  fixedCosts: "189000",
  ebit: "52000",
  netIncome: "38200",
  periodMonths: "9",
  periodStart: "2026-01-01",
  periodEnd: "2026-09-30",
};

const ZA_CLIP_REVENUE = (412_000 * 7) / 9;
const ZA_CLIP_OPERATING = (52_000 * 7) / 9;

// ZA firm year starts in March. January and February sit in the prior year.
const zaClip = cardsAgree(JAN_SEP, 3, ZA, ZA_CLIP_REVENUE, ZA_CLIP_OPERATING, [
  "Mar 2026",
  "Sep 2026",
  "prorated",
]);
assert(zaClip.year?.revenue !== 412_000, "year strip must not keep the 9-month statement revenue");
assert(
  zaClip.waterfall.operatingProfit !== 52_000,
  "waterfall must not keep the 9-month operating profit",
);
assert(!zaClip.headline.label?.includes("Jan"), zaClip.headline.label ?? "");

const zaSeed = seedBudgetFromFinancials(
  createBudgetDocument({
    templateId: "services_hours",
    qualification,
    fyStart: "2026-03",
    fyStartMonth: 3,
    ref: new Date("2026-09-15T12:00:00Z"),
    market: ZA,
  }),
  JAN_SEP,
).doc;
const zaVersus = budgetVersusStatement(zaSeed, JAN_SEP, ZA);
assert(zaVersus != null, "plan still compares");
assert(zaVersus!.revenue === 412_000, "versus actuals stay the full statement");
assert(
  Math.abs((zaVersus!.budgetEbit ?? 0) - ZA_CLIP_OPERATING) > 1,
  `seeded plan operating profit ${zaVersus!.budgetEbit} should drift off the straight slice`,
);
const zaHeadline = budgetHeadlineFigures(zaClip.slice, {
  revenue: zaVersus!.budgetRevenue,
  operatingProfit: zaVersus!.budgetEbit,
});
close(zaHeadline.revenue, ZA_CLIP_REVENUE, "card ignores the plan revenue");
close(zaHeadline.operatingProfit, ZA_CLIP_OPERATING, "card ignores the seeded operating profit");

// A statement that already sits in the March year is not scaled again.
const MAR_SEP = {
  revenue: "320444",
  cogs: "133000",
  fixedCosts: "146984",
  ebit: "40460",
  netIncome: "29711",
  periodMonths: "7",
  periodStart: "2026-03-01",
  periodEnd: "2026-09-30",
};
cardsAgree(MAR_SEP, 3, ZA, 320_444, 40_460, ["Mar 2026", "Sep 2026", "prorated"]);
const marSeed = seedBudgetFromFinancials(
  createBudgetDocument({
    templateId: "services_hours",
    qualification,
    fyStart: "2026-03",
    fyStartMonth: 3,
    ref: new Date("2026-09-15T12:00:00Z"),
    market: ZA,
  }),
  MAR_SEP,
).doc;
const marVersus = budgetVersusStatement(marSeed, MAR_SEP, ZA);
assert(marVersus != null, "March statement compares");
assert(
  Math.abs((marVersus!.budgetEbit ?? 0) - 40_460) > 1,
  `plan ${marVersus!.budgetEbit} must not be what the card prints`,
);

// US firm year starts in January. The same January–September statement stays whole.
const us = cardsAgree(JAN_SEP, 1, US, 412_000, 52_000, ["Jan 2026", "Sep 2026"]);
assert(!us.headline.label?.includes("Mar"), us.headline.label ?? "");
assert(us.slice.months === 9, `US period is 9 months, got ${us.slice.months}`);
const usSeed = seedBudgetFromFinancials(
  createBudgetDocument({
    templateId: "services_hours",
    qualification,
    fyStart: "2026-01",
    fyStartMonth: 1,
    ref: new Date("2026-09-15T12:00:00Z"),
    market: US,
  }),
  JAN_SEP,
).doc;
const usVersus = budgetVersusStatement(usSeed, JAN_SEP, US);
assert(usVersus != null, "US statement compares");
close(
  budgetHeadlineFigures(us.slice, {
    revenue: usVersus!.budgetRevenue,
    operatingProfit: usVersus!.budgetEbit,
  }).operatingProfit,
  52_000,
  "US card keeps the statement operating profit",
);

// No dates: do not invent a March clip. Missing lines stay null, never 0.
const stored = fiscalStatementSlice({ revenue: "412000", ebit: "52000", periodMonths: "9" }, 3);
assert(stored?.revenue === 412_000, `stored cover revenue ${stored?.revenue}`);
assert(
  stored?.operatingProfit === 52_000,
  `stored cover operating profit ${stored?.operatingProfit}`,
);
assert(stored?.label == null, "an undated cover has no invented month label");
assert(stored?.cogs == null, "missing COGS stays null");
assert(stored?.netProfit == null, "missing net profit stays null");

const blankProfit = fiscalStatementSlice(
  {
    revenue: "1000",
    periodMonths: "7",
    periodStart: "2026-03-01",
    periodEnd: "2026-09-30",
  },
  3,
);
assert(blankProfit?.operatingProfit == null, "missing operating profit stays null");
assert(blankProfit?.operatingProfit !== 0, "missing operating profit is not 0");
const blankYear = yearMoneyFromFiscalSlice(blankProfit);
assert(blankYear?.netProfit == null, "year strip does not invent net profit");
assert(blankYear?.expenses == null, "year strip does not invent expenses");
assert(blankYear?.cogs == null, "year strip does not invent COGS");
const blankFall = fiscalWaterfallFallback(
  {
    revenue: "1000",
    periodMonths: "7",
    periodStart: "2026-03-01",
    periodEnd: "2026-09-30",
  },
  3,
);
assert(blankFall?.operatingProfit == null, "waterfall operating profit stays null without EBIT");
const blankHeadline = budgetHeadlineFigures(blankProfit, { revenue: 0, operatingProfit: 0 });
assert(blankHeadline.revenue === 1000, "a present revenue is not replaced by 0");
assert(
  blankHeadline.operatingProfit == null,
  "a missing operating profit is not replaced by the plan's 0",
);

const blankRevenue = fiscalStatementSlice(
  {
    ebit: "10",
    periodMonths: "7",
    periodStart: "2026-03-01",
    periodEnd: "2026-09-30",
  },
  3,
);
assert(blankRevenue?.revenue == null, "missing revenue stays null");
assert(blankRevenue?.revenue !== 0, "missing revenue is not 0");

// Month engine uses the shared formatter: thousands separator, whole rands.
const price = fmtBudgetMoney(45777.78, ZA);
assert(price === "R 45 778", `month price ${price}`);
assert(!price.includes("."), "whole rands");
const simple = readFileSync("src/components/budget/budget-simple-view.tsx", "utf8");
assert(simple.includes('data-month-engine-price=""'), "read-only price is marked");
assert(simple.includes("{money(cell.price)}"), "read-only price goes through fmtBudgetMoney");
assert(!/>\s*\{cell\.price\}\s*</.test(simple), "raw price is not printed");
assert(simple.includes("yearMoneyFromFiscalSlice"), "simple year strip uses the slice");
assert(simple.includes("budgetHeadlineFigures"), "simple verdict uses the slice");

const workspace = readFileSync("src/components/budget/budget-workspace.tsx", "utf8");
assert(workspace.includes("budgetHeadlineFigures"), "complex verdict uses the slice");
const panel = readFileSync("src/components/budget/budget-panel.tsx", "utf8");
assert(panel.includes("fiscalStatementSlice"), "both portals attach the slice in BudgetPanel");

const owner = readFileSync("src/routes/app.tsx", "utf8");
const accountant = readFileSync("src/routes/_authenticated/clients.$clientId.tsx", "utf8");
assert(owner.includes("fiscalWaterfallFallback("), "owner waterfall uses the firm-year slice");
assert(
  accountant.includes("fiscalWaterfallFallback("),
  "accountant waterfall uses the firm-year slice",
);
assert(!/^export (?!const Route\b)/m.test(owner), "owner route exports only Route");
assert(!/^export (?!const Route\b)/m.test(accountant), "accountant route exports only Route");

console.log("budget-za-period: ok");
