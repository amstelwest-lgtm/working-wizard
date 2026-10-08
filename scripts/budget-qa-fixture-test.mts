/**
 * QA Test Co (SA): revenue R120k, GM 62.5%, opex R42k, operating profit R33k, cash R25k.
 * The budget year, the cash line, and the month comparison have to tell the same story.
 * Run: pnpm test:budget-qa-fixture
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ZA_MARKET, laborCostLabel } from "../src/lib/market";
import {
  alignBudgetToFirmFy,
  budgetWindowLabel,
  createBudgetDocument,
  fyMonths,
} from "../src/lib/budget.months";
import { computeBudgetMonths, normalizeBudgetDocument } from "../src/lib/budget.compute";
import {
  budgetActualsBadge,
  budgetToCashForecastPayload,
  mergeMonthActuals,
  repairUntouchedSeededBudget,
  seedBudgetFromFinancials,
  statementMonthActuals,
} from "../src/lib/budget.bridges";
import { periodProfitBridge } from "../src/lib/period-profit";
import { derivePeriodWaterfallFallback } from "../src/lib/weekly-inputs";
import {
  assessClientMetrics,
  forecastInTheBlack,
  forecastScenarioLabel,
  runwayFromForecastNet,
} from "../src/lib/client-metrics";
import { DEBTOR_DAYS_AGEING_THRESHOLD } from "../src/lib/data-requests";
import { peerMedian } from "../src/lib/ratios";
import { estimatedTaxNote } from "../src/lib/estimated-tax-note";
import type { BudgetQualification } from "../src/lib/budget.types";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const read = (path: string) => readFileSync(resolve(path), "utf8");

const REF = new Date("2026-10-05T12:00:00Z");
const QA = {
  revenue: "120000",
  cogs: "45000",
  fixedCosts: "42000",
  ebit: "33000",
  netIncome: "33000",
  cash: "25000",
};

const qualification: BudgetQualification = {
  payMotion: "mix",
  volumeUnit: "units_sku",
  driverKind: "units_price",
  costShape: "balanced",
  debtorDaysDefault: 30,
  capexMode: "none",
  confirmedAt: "2026-10-05T00:00:00.000Z",
};

const fresh = createBudgetDocument({
  templateId: "hybrid_primary",
  qualification,
  fyStartMonth: 3,
  ref: REF,
  market: ZA_MARKET,
});
assert(fresh.fyStart === "2026-03", `new budget starts on the firm FY, got ${fresh.fyStart}`);
assert(
  fyMonths(fresh.fyStart)[0] === "2026-03" && fyMonths(fresh.fyStart)[11] === "2027-02",
  "months run Mar→Feb",
);

const sliced = createBudgetDocument({
  templateId: "hybrid_primary",
  qualification,
  fyStartMonth: 3,
  fyStart: "2026-10",
  market: ZA_MARKET,
});
const seededSlice = seedBudgetFromFinancials(sliced, QA);
const aligned = normalizeBudgetDocument(seededSlice.doc);
assert(aligned.fyStart === "2026-03", `stored Oct start realigns to March, got ${aligned.fyStart}`);
const label = budgetWindowLabel(aligned, ZA_MARKET);
assert(label.startsWith("FY Mar"), `label names the firm FY: ${label}`);
assert(!/Oct/.test(label), `label does not say the year starts in October: ${label}`);
assert(alignBudgetToFirmFy(aligned).fyStart === "2026-03", "an aligned year stays put");

const seeded = seedBudgetFromFinancials(fresh, QA);
assert(seeded.doc.openingCash === 25000, `opening cash seeds the cash line, got ${seeded.doc.openingCash}`);
const rows = computeBudgetMonths(seeded.doc, "base");
assert(rows[0].month === "2026-03", `first month is March, got ${rows[0].month}`);
assert(
  Math.abs(rows[0].closingCash - (25000 + rows[0].netCash)) < 0.02,
  "month-end cash starts from opening cash",
);
const october = rows.find((row) => row.month === "2026-10");
assert(october != null && october.closingCash > 0, `October cash stays positive, got ${october?.closingCash}`);
const ebit = rows.reduce((sum, row) => sum + row.ebit, 0);
const overheads = rows.reduce((sum, row) => sum + row.overheads, 0);
assert(Math.abs(overheads - 42000) < 1, `FY overheads match opex, got ${overheads}`);
assert(Math.abs(ebit - 33000) < 1, `FY EBIT matches operating profit, got ${ebit}`);
assert(Math.abs(rows[0].revenue - 10000) < 0.02, `monthly revenue ${rows[0].revenue}`);
assert(Math.abs(rows[0].cogs - 3750) < 0.02, `monthly COGS ${rows[0].cogs}`);
assert((seeded.doc.statementDepreciation ?? 0) === 0, "a reconciled P&L does not invent depreciation");

// QA US Test LLC: revenue 700k, COGS 280k, operating expenses 351k, EBITDA 69k, EBIT 60k.
// Budget overheads, the waterfall operating-expense step, and FY EBIT have to match.
const US = {
  revenue: "700000",
  cogs: "280000",
  fixedCosts: "351000",
  ebit: "60000",
  ebitda: "69000",
  ebt: "60000",
  netIncome: "60000",
};
const usBridge = periodProfitBridge(US);
assert(usBridge.operatingExpenses === 351_000, `bridge opex ${usBridge.operatingExpenses}`);
assert(usBridge.depreciation === 9_000, `bridge depreciation ${usBridge.depreciation}`);
assert(usBridge.ebit === 60_000, `bridge EBIT ${usBridge.ebit}`);
assert(
  Math.abs(usBridge.ebit / usBridge.revenue - 0.085714) < 0.0001,
  "operating margin stays on the EBIT path (8.6%)",
);
const usFall = derivePeriodWaterfallFallback(US);
assert(
  usFall.fixedCosts === usBridge.operatingExpenses && usFall.depreciation === usBridge.depreciation,
  "waterfall reads the same bridge as the budget seed",
);
const usSeeded = seedBudgetFromFinancials(fresh, US);
assert(usSeeded.doc.statementDepreciation === 9_000, "seed stores statement depreciation");
const usRows = computeBudgetMonths(usSeeded.doc, "base");
const usOverheads = usRows.reduce((sum, row) => sum + row.overheads, 0);
const usEbit = usRows.reduce((sum, row) => sum + row.ebit, 0);
const usEbitda = usRows.reduce((sum, row) => sum + row.ebitda, 0);
const usDep = usRows.reduce((sum, row) => sum + row.depreciation, 0);
assert(Math.abs(usOverheads - 351_000) < 1, `FY overheads stay 351k, got ${usOverheads}`);
assert(Math.abs(usDep - 9_000) < 1, `FY depreciation is 9k, got ${usDep}`);
assert(Math.abs(usEbitda - 69_000) < 1, `FY EBITDA is 69k, got ${usEbitda}`);
assert(Math.abs(usEbit - 60_000) < 1, `FY EBIT matches operating profit, got ${usEbit}`);
const withoutDep = computeBudgetMonths({ ...usSeeded.doc, statementDepreciation: 0 }, "base");
assert(
  Math.abs(withoutDep[withoutDep.length - 1].closingCash - usRows[usRows.length - 1].closingCash) < 0.05,
  "statement depreciation does not move cash",
);
const covered = computeBudgetMonths(
  {
    ...usSeeded.doc,
    capex: [
      {
        id: "cx-da",
        name: "Existing assets",
        month: usRows[0].month,
        amount: 9_000,
        funding: "finance",
        usefulLifeMonths: 12,
        residual: 0,
      },
    ],
  },
  "base",
);
const coveredDep = covered.reduce((sum, row) => sum + row.depreciation, 0);
assert(Math.abs(coveredDep - 9_000) < 1, `capex depreciation counts toward statement D&A, got ${coveredDep}`);
const untouched = {
  ...usSeeded.doc,
  statementDepreciation: 0,
  notes: [],
  qualification: { ...usSeeded.doc.qualification, confirmedAt: "1970-01-01T00:00:00.000Z" },
};
const repaired = repairUntouchedSeededBudget(untouched, US);
assert(repaired.statementDepreciation === 9_000, "an untouched seed picks up statement depreciation");
const edited = repairUntouchedSeededBudget(
  {
    ...untouched,
    qualification: { ...untouched.qualification, confirmedAt: "2026-10-06T00:00:00.000Z" },
  },
  US,
);
assert((edited.statementDepreciation ?? 0) === 0, "an edited budget is not reseeded");

const month = statementMonthActuals(
  { revenue: "120000", cogs: "45000", operating_expenses: "42000" },
  "TB",
);
assert(month != null, "statement has a monthly pace");
assert(month!.revenue === 10000 && month!.cogs === 3750 && month!.fixedCosts === 3500, `monthly actuals ${JSON.stringify(month)}`);
const hiddenOpex = mergeMonthActuals(
  { label: "Snapshot", revenue: 10000, cogs: 3750, fixedCosts: 0 },
  { label: "Live", revenue: 10000, cogs: 3750, fixedCosts: 3500 },
);
assert(hiddenOpex?.fixedCosts === 3500, "a snapshot with no opex does not zero the live overheads");
assert(
  budgetActualsBadge(0, true) === "Statement pace, prorated",
  "statement pace is not 'no actuals'",
);
assert(budgetActualsBadge(0, false) === "None", "empty variance card still says so");

const pushed = budgetToCashForecastPayload(
  { ...seeded.doc, wc: { ...seeded.doc.wc, debtorDays: 56 } },
  new Date("2026-10-07T15:00:00Z"),
);
assert(pushed.collectDelay === 0, `budget push leaves the collection scenario off, got ${pushed.collectDelay}`);
assert(
  pushed.startDate === "2026-10-05",
  `budget cash starts Monday of this week, got ${pushed.startDate}`,
);
assert(pushed.startDate !== `${seeded.doc.fyStart}-01`, "budget cash does not start on the first day of the FY");
assert(pushed.openingBalance === "25000", `opening stays statement cash, got ${pushed.openingBalance}`);
assert(
  !("seededFromBanksAt" in pushed),
  "a budget publish must not look like a bank seed",
);
assert(
  pushed.revenue.every((line) => line.name.includes("(from budget)")),
  "budget lines stay labelled",
);

const base = { weeks: null, kind: "cash_generative" as const, label: "Cash generative" };
const direction = runwayFromForecastNet({
  base,
  opening: 25000,
  totalInflow: 0,
  totalOutflow: 15200,
});
assert(direction.kind === "weeks" && direction.weeks === 21, `shared runway is 21 weeks, got ${direction.label}`);
assert(forecastInTheBlack(0, 15200, 9800) === false, "negative net is not in the black");
assert(
  forecastScenarioLabel({ collectDelay: 8 }) === "Scenario: collection delay +8w",
  "an on scenario is named",
);
assert(forecastScenarioLabel({ collectDelay: 0 }) === null, "the base forecast has no scenario label");

const assessed = assessClientMetrics({
  financials: QA,
  cashflow: {
    openingBalance: "25000",
    revenue: [],
    expenses: [{ amount: "15200", frequency: "once-off", startWeek: 1 }],
    collectDelay: 8,
  },
});
assert(assessed.runway.label === "21 weeks", `overview runway follows the forecast, got ${assessed.runway.label}`);
assert(assessed.forecastNet != null && assessed.forecastNet < 0, "forecast net is cash out");
assert(assessed.runway.kind !== "cash_generative", "a negative forecast is not cash generative");

assert(peerMedian("debtorDays") === 40, "debtor peer median is 40");
assert(DEBTOR_DAYS_AGEING_THRESHOLD === 40, "overview debtor benchmark uses the shared median");
assert(laborCostLabel(ZA_MARKET) === "Labour cost", "ZA health input says Labour");
assert(laborCostLabel({ copyPack: "us" }) === "Labor cost", "US health input says Labor");
assert(
  estimatedTaxNote({ clientName: "QA Test Co (Pty) Ltd", tax: 0, operatingProfit: 33000 }) ===
    "estimated tax not included",
  "zero tax on a (Pty) company is labelled",
);
assert(
  estimatedTaxNote({ clientName: "QA Test Co", tax: 0, operatingProfit: 33000 }) === null,
  "the note is for a (Pty) company",
);

const forecastSrc = read("src/components/cash-forecast.tsx");
assert(forecastSrc.includes("storedCollectDelay"), "a stored collection delay reloads with the series");
assert(forecastSrc.includes("forecastInTheBlack"), "the badge uses the shared in-the-black test");
assert(forecastSrc.includes("scenarioLabel"), "an active scenario is labelled on the forecast");
const sphere = read("src/components/sphere-hero.tsx");
assert(sphere.includes('healthy: healthBandLabel("healthy")'), "health orb uses the shared band label");
assert(!sphere.includes("GOOD"), "health orb does not say GOOD");
const brief = read("supabase/functions/ask-ai/overview-brief.ts");
assert(brief.includes("brief.runwayLabel"), "advisory quotes the shared runway label");
assert(!brief.includes("brief.debtorDays >= 45"), "bot debtor move is not a private 45");

console.log("budget qa fixture ok");
