/**
 * Prod retest of the two stored clients from #278.
 * Every surface reads assessClientMetrics, which is resolveThirteenWeekForecast
 * plus the runway that series implies.
 *
 * Run: pnpm exec vite-node --config scripts/vite-test.config.ts scripts/prod-retest-stored-paths-test.mts
 */
import { readFileSync } from "node:fs";
import { buildFinancialSnapshot } from "../src/lib/client-briefing";
import {
  assessClientMetrics,
  forecastInTheBlack,
  resolveThirteenWeekForecast,
} from "../src/lib/client-metrics";
import {
  ADVISORY_PACK_STALE_NOTE,
  advisoryPackFiguresChanged,
} from "../src/lib/advisory-pack";
import {
  budgetIsImplausible,
  budgetSeedIsUntouched,
  repairUntouchedSeededBudget,
} from "../src/lib/budget.bridges";
import { budgetCogsFollowsGpPct, computeBudgetMonths } from "../src/lib/budget.compute";
import type { BudgetDocument } from "../src/lib/budget.types";
import { displayedDataRequestReason } from "../src/lib/data-requests";
import { profitStepBand } from "../src/lib/health-score";
import { readTimeEquity } from "../src/lib/statement-financials";
import { reportDataPeriodLabel } from "../src/lib/statement-period";
import { defaultTargetDate, planTargetIsOverdue } from "../src/components/action-plan";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

type Row = {
  id: string;
  name: string;
  cash_runway_weeks: number;
  financials_updated_at: string;
  financials: Record<string, unknown>;
  cashflow: unknown;
  budget: BudgetDocument;
};

const rows = JSON.parse(readFileSync(new URL("./fixtures/prod-retest-278.json", import.meta.url), "utf8")) as Row[];
const yankees = rows.find((row) => row.name.startsWith("New York"));
const qa = rows.find((row) => row.name.startsWith("QA Test"));
if (!yankees || !qa) throw new Error("fixture is missing a client");

const now = new Date("2026-10-05T12:00:00Z");
const timeZone = "Africa/Johannesburg";

function story(row: Row) {
  const input = {
    financials: row.financials,
    cashflow: row.cashflow,
    financialsUpdatedAt: row.financials_updated_at,
    now,
    timeZone,
  };
  const assessed = assessClientMetrics(input);
  const again = resolveThirteenWeekForecast({
    financials: row.financials,
    cashflow: row.cashflow,
    openingCash: assessed.cash.amount,
    runway: assessed.runway.kind === "cash_generative"
      ? { weeks: null, kind: "cash_generative", label: "Cash generative" }
      : assessed.runway,
    now,
    timeZone,
    periodEnd: typeof row.financials.periodEnd === "string" ? row.financials.periodEnd : null,
  });
  return { assessed, again };
}

const qaStory = story(qa);
const yankeesStory = story(yankees);

const qaNet = qaStory.assessed.forecastNet ?? 0;
assert(qaStory.assessed.runway.label === "21 weeks", `QA runway ${qaStory.assessed.runway.label}`);
assert(qaStory.assessed.runway.weeks === 21, "QA weeks are 21, not the stored column 0");
assert(Math.abs(qaNet - -15160) < 1, `QA forecast net ${qaNet}`);
assert(Math.abs(qaStory.assessed.outlook.opening - 25000) < 1, `QA opening ${qaStory.assessed.outlook.opening}`);
assert(
  Math.abs((qaStory.assessed.outlook.closing.at(-1) ?? 0) - 9840) < 1,
  `QA ending cash ${qaStory.assessed.outlook.closing.at(-1)}`,
);
assert(qaStory.assessed.outlook.dipsBelowFloorWeek === 5, `QA dip week ${qaStory.assessed.outlook.dipsBelowFloorWeek}`);
assert(
  forecastInTheBlack(
    qaStory.assessed.outlook.totalInflow,
    qaStory.assessed.outlook.totalOutflow,
    qaStory.assessed.outlook.closing.at(-1) ?? 0,
  ) === false,
  "QA is not in the black",
);
assert(
  qaStory.again.opening === qaStory.assessed.outlook.opening &&
    qaStory.again.totalInflow === qaStory.assessed.outlook.totalInflow &&
    qaStory.again.totalOutflow === qaStory.assessed.outlook.totalOutflow,
  "QA forecast resolver and Overview share one series",
);
const qaSnap = buildFinancialSnapshot({
  chips: [],
  cashRunwayWeeks: qaStory.assessed.runway.weeks,
  runwayLabel: qaStory.assessed.runway.label,
  cash: {
    amount: qaStory.assessed.outlook.opening,
    floor: qaStory.assessed.outlook.floor,
    dipsBelowFloorWeek: qaStory.assessed.outlook.dipsBelowFloorWeek,
    note: qaStory.assessed.outlook.anchorNote,
  },
});
const qaRunway = qaSnap.find((row) => row.key === "runway");
const qaCash = qaSnap.find((row) => row.key === "cash");
assert(qaRunway?.value === "21 weeks", `snapshot runway ${qaRunway?.value}`);
assert(qaCash?.value.includes("week 5") === true, `snapshot cash ${qaCash?.value}`);
assert(qaCash?.value.includes("25.0k") === true, `snapshot opening ${qaCash?.value}`);

const yankeesNet = yankeesStory.assessed.forecastNet ?? 0;
assert(
  yankeesStory.assessed.runway.label === "Cash generative",
  `Yankees runway ${yankeesStory.assessed.runway.label}, not the stored 4 weeks`,
);
assert(yankeesNet > 7000 && yankeesNet < 8000, `Yankees net ${yankeesNet}`);
assert(
  forecastInTheBlack(
    yankeesStory.assessed.outlook.totalInflow,
    yankeesStory.assessed.outlook.totalOutflow,
    yankeesStory.assessed.outlook.closing.at(-1) ?? 0,
  ),
  "Yankees forecast is in the black",
);
assert(
  yankeesStory.again.opening === yankeesStory.assessed.outlook.opening &&
    Math.abs((yankeesStory.again.totalInflow - yankeesStory.again.totalOutflow) - yankeesNet) < 1,
  "Yankees forecast and Overview share one series",
);

const qaBudget = repairUntouchedSeededBudget(qa.budget, qa.financials as Record<string, string>);
assert(budgetSeedIsUntouched(qa.budget), "QA budget is still an untouched seed");
assert(qaBudget.openingCash === 25000, `QA opening cash ${qaBudget.openingCash}`);
const qaMonths = computeBudgetMonths(qaBudget);
const qaOverheads = qaMonths.reduce((sum, row) => sum + row.overheads, 0);
const qaEbit = qaMonths.reduce((sum, row) => sum + row.ebit, 0);
assert(Math.abs(qaOverheads - 42000) < 1, `QA FY overheads ${qaOverheads}`);
assert(Math.abs(qaEbit - 33000) < 1, `QA FY EBIT ${qaEbit}`);

assert(!budgetSeedIsUntouched(yankees.budget), "Yankees has a note, so the seed is left for the rebuild banner");
assert(budgetCogsFollowsGpPct(yankees.budget), "zero per-unit costs follow the GP% input");
const yankeesMonths = computeBudgetMonths(yankees.budget);
const yankeesRev = yankeesMonths.reduce((sum, row) => sum + row.revenue, 0);
const yankeesCogs = yankeesMonths.reduce((sum, row) => sum + row.cogs, 0);
const gp = yankeesRev > 0 ? (1 - yankeesCogs / yankeesRev) * 100 : 0;
assert(Math.abs(gp - 70.9) < 0.2, `Yankees GP ${gp} next to a 70.9 input`);
assert(
  budgetIsImplausible(yankees.budget, yankees.financials as Record<string, string>),
  "Yankees revenue is still far above the statement, so the rebuild banner stays",
);

const qaEquity = readTimeEquity(qa.financials);
assert(qaEquity.derived && qaEquity.equity === "33000", `QA equity ${qaEquity.equity}`);
const yankeesEquity = readTimeEquity(yankees.financials);
assert(!yankeesEquity.derived && yankeesEquity.equity === "8266.73", "typed Yankees equity stays");

assert(profitStepBand("Net Margin", 0.16).label === "Healthy", "waterfall chips are title case");
const fixedCost = 5356.5 / 8633.6;
const opexBand = profitStepBand("Fixed Cost Ratio", fixedCost);
assert(opexBand.label !== "Healthy", `Yankees operating expenses are ${opexBand.label}`);

const stale = advisoryPackFiguresChanged(
  {
    health: { overall: 79 },
    forecast: { openingBalance: 7430 },
    sections: [{ key: "forecast", body: "Runway 4 weeks." }],
  },
  { runwayLabel: "Cash generative", cash: yankeesStory.assessed.outlook.opening, healthScore: 79 },
);
assert(stale, "a pack that still says 4 weeks is stale");
assert(ADVISORY_PACK_STALE_NOTE.includes("regenerate"), "the note tells the accountant to regenerate");
const fresh = advisoryPackFiguresChanged(
  {
    health: { overall: 70 },
    forecast: { openingBalance: qaStory.assessed.outlook.opening },
    sections: [{ key: "forecast", body: "Runway 21 weeks." }],
  },
  { runwayLabel: "21 weeks", cash: qaStory.assessed.outlook.opening, healthScore: 70 },
);
assert(!fresh, "a pack that matches the current series is not flagged");

const reason = displayedDataRequestReason(
  "Debtor days are 55 against a 45-day benchmark. Statement totals show the problem.",
);
assert(reason.includes("40-day benchmark") && !reason.includes("45-day"), reason);

assert(planTargetIsOverdue("2026-09-28", now), "28 Sep 2026 is overdue on 5 Oct");
assert(defaultTargetDate(now) > "2026-10-05", `new targets land in the future, got ${defaultTargetDate(now)}`);

const period = reportDataPeriodLabel(yankees.financials);
assert(period != null && period.includes("Sep 2026") && period.includes("part month"), `statement period ${period}`);
assert(reportDataPeriodLabel(qa.financials) == null, "QA has no statement dates to prefer");

console.log("prod retest stored paths ok");
