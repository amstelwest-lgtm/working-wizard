/**
 * AQA retest #3. Seeded budget headline, missing cash inputs, deliverable
 * period, intervention order, owner status, palette, plan badge, cash stamp.
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
import {
  NEEDS_DATA_OPENING,
  cashForecastSnapshot,
  cashSignedFiguresChanged,
  clientListStatusWord,
  statusColumnNeedsAttention,
} from "../src/lib/cash-forecast-parity.ts";
import { searchClientSectionJumps } from "../src/lib/feature-finder-clients.ts";
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
import { FULL_YEAR_ON_FILE } from "../src/lib/statement-period.ts";
import { interventionNarrative } from "../src/reports/narrative.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const src = (path: string) => readFileSync(resolve(path), "utf8");

const chill = {
  revenue: 1_215_000,
  cogs: -56_000,
  ebit: 56_800,
  laborCost: 426_000,
  fixedCosts: "",
};

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
assert(src("src/lib/milon-team-feed.ts").includes("rewriteSavedMonthStamp"), "team jobs rewrite the draft");
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
assert(watch.financial_manager == null, "Watch does not say below the minimum");
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
const collections = jumps.filter((row) => row.label === "Collections for Theo");
assert(collections.length === 1, `collections ${collections.length}`);
assert(jumps.some((row) => row.label === "Collections") === false, "the bare label stays a different row");

const picker = src("src/components/firm-band-upgrade.tsx");
assert(picker.includes("currentBand == null && selected === \"solo\""), "Start here waits for no current plan");
assert(picker.includes("Start here"), "the badge copy stays");

const homeCss = src("src/components/owner-door/owner-door.css");
assert(homeCss.includes("flex: 0 1 auto"), "home sizes to its content");
assert(!homeCss.includes("min-height: calc(100dvh - 96px)"), "the viewport gap is gone");
assert(homeCss.includes("position: static"), "the handoff sentence stays in flow");
