/**
 * Accountant QA medium batch: report numbers, budget seed, labor ZIP,
 * action-plan PDF, recurring bank lines, download vs sent, Enter-to-send,
 * and trial-balance equity totals.
 *
 * Run: pnpm test:accountant-qa-deliverables
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { REPORT_CATALOG, reportKicker } from "../src/lib/report-catalog";
import {
  annualiseBudgetFinancials,
  budgetIsImplausible,
  budgetScaleBreak,
  budgetWasRebuiltFromActuals,
  reseedBudgetIfScaleBroken,
  seedBudgetFromFinancials,
} from "../src/lib/budget.bridges";
import { laborProductivityFileStem, laborProductivityTitle } from "../src/lib/market/copy";
import { formatDateTime } from "../src/lib/market/format";
import { createBudgetDocument } from "../src/lib/budget.months";
import { computeBudgetMonths } from "../src/lib/budget.compute";
import { buildBudgetPdfModel } from "../src/lib/budget-pdf";
import { completeDeliverablePdfItems } from "../src/lib/action-plan-pdf";
import { channelHonestyLabel } from "../src/lib/advisory-deliveries";
import {
  amountsSimilar,
  buildDraftLinesFromExtract,
  recurringReviewLabel,
} from "../src/lib/cash-from-banks.pattern";
import type { CashBankExtract } from "../src/lib/cash-from-banks.types";
import type { ExtractionResult } from "../src/lib/financialSchema";
import {
  applyBalanceSheetTotals,
  DERIVED_EQUITY_LABEL,
  periodFinancialsFromExtraction,
  preserveHandEnteredEquity,
} from "../src/lib/statement-financials";
import { statementNoteSections } from "../src/lib/statement-notes";
import {
  needsTrialBalanceRefresh,
  TRIAL_BALANCE_REFRESH_COPY,
} from "../src/lib/trial-balance-refresh";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function read(path: string): string {
  return readFileSync(resolve(path), "utf8");
}

assert(reportKicker("intervention") === "Advisory Report 02", "intervention PDF matches card 02");
assert(reportKicker("waterfall") === "Advisory Report 05", "waterfall PDF matches card 05");
assert(reportKicker("budget") === "Advisory Report 11", "budget PDF matches card 11");
assert(reportKicker("forecast", "Base") === "Advisory Report 03 · Base", "forecast keeps its scenario tail");
assert(REPORT_CATALOG.map((row) => row.number).join(",") === "1,2,3,4,5,6,7,8,9,10,11", "catalog is 1–11");

const reportsSrc = read("src/routes/_authenticated/reports.index.tsx");
for (const row of REPORT_CATALOG) {
  assert(
    reportsSrc.includes(`reportNumber("${row.key}")`),
    `report card ${row.key} takes its number from the catalog`,
  );
}
const kickerFiles: Record<string, string> = {
  scorecard: "src/reports/health-scorecard.tsx",
  intervention: "src/reports/intervention-priority.tsx",
  forecast: "src/reports/cash-forecast.tsx",
  cycle: "src/reports/cash-cycle.tsx",
  waterfall: "src/reports/profitability-waterfall.tsx",
  leverage: "src/reports/leverage-solvency.tsx",
  assets: "src/reports/asset-productivity.tsx",
  labor: "src/reports/labor-productivity.tsx",
  movement: "src/reports/ratio-movement.tsx",
  benchmark: "src/reports/benchmark-report.tsx",
  budget: "src/reports/budget-variance.tsx",
};
for (const [key, path] of Object.entries(kickerFiles)) {
  const src = read(path);
  assert(src.includes(`reportKicker("${key}"`), `${path} uses the shared kicker`);
  assert(!src.includes("Advisory Report · Budget"), `${path} does not hardcode an unnumbered budget kicker`);
}
assert(!read(kickerFiles.waterfall).includes('kicker="Advisory Report 02"'), "waterfall is no longer numbered 02");
assert(!read(kickerFiles.intervention).includes('kicker="Advisory Report 05"'), "intervention is no longer numbered 05");

assert(reportsSrc.includes("cd && !cd.labor"), "labor ZIP renders when headcount is missing");
assert(reportsSrc.includes("unavailableReason"), "missing labor is an explicit gap, not a skipped file");
assert(read(kickerFiles.labor).includes("unavailableReason"), "labor PDF has a gap state");

function budgetDoc() {
  return createBudgetDocument({
    templateId: "services_hours",
    fyStart: "2026-01",
    fyStartMonth: 1,
    qualification: {
      payMotion: "time_delivery",
      volumeUnit: "billable_hours",
      driverKind: "hours_rate",
      costShape: "payroll_heavy",
      debtorDaysDefault: 30,
      capexMode: "none",
      confirmedAt: "2026-01-15T00:00:00.000Z",
    },
  });
}

const blankCogs = seedBudgetFromFinancials(budgetDoc(), {
  revenue: "1550000",
  cogs: "",
  fixedCosts: "620000",
});
assert(blankCogs.doc.gpPct === budgetDoc().gpPct, "a blank COGS line does not become 100% GP");
assert(
  !blankCogs.changes.some((change) => /GP% set to 100/.test(change)),
  "missing COGS is not seeded as zero",
);

const seeded = seedBudgetFromFinancials(budgetDoc(), {
  revenue: "1550000",
  cogs: "451000",
  fixedCosts: "620000",
  laborCost: "280000",
});
assert(seeded.doc.cogsMode === "gp_pct", "present COGS drives GP%");
assert(Math.abs(seeded.doc.gpPct - 70.9) < 0.15, `GP% from 1.55M and 451k, got ${seeded.doc.gpPct}`);
const months = computeBudgetMonths(seeded.doc, seeded.doc.activeScenario);
const revenue = months.reduce((sum, row) => sum + row.revenue, 0);
const cogs = months.reduce((sum, row) => sum + row.cogs, 0);
const overheads = months.reduce((sum, row) => sum + row.overheads, 0);
assert(Math.abs(revenue - 1_550_000) < 2, `revenue seeded from the P&L, got ${revenue}`);
assert(Math.abs(cogs - 451_000) < 2_000, `COGS seeded from the P&L, got ${cogs}`);
assert(Math.abs(overheads - 620_000) < 2, `opex seeded into overheads, got ${overheads}`);

const fromOpex = seedBudgetFromFinancials(budgetDoc(), {
  revenue: "1200000",
  cost_of_sales: "480000",
  operating_expenses: "360000",
});
assert(Math.abs(fromOpex.doc.gpPct - 60) < 0.15, "cost_of_sales seeds GP%");
assert(
  fromOpex.changes.some((change) => /Overheads seeded/.test(change)),
  "operating expenses seed overheads",
);

const yankeesPeriod = {
  revenue: "8633.6",
  cogs: "775.98",
  fixedCosts: "5356.5",
  periodMonths: "1",
  periodStart: "2026-09-01",
  periodEnd: "2026-09-21",
};
const shortPeriod = seedBudgetFromFinancials(budgetDoc(), yankeesPeriod);
const shortRows = computeBudgetMonths(shortPeriod.doc, shortPeriod.doc.activeScenario);
const shortRevenue = shortRows.reduce((sum, row) => sum + row.revenue, 0);
const shortCogs = shortRows.reduce((sum, row) => sum + row.cogs, 0);
assert(
  Math.abs(shortRevenue - 150_060) < 50,
  `a 21-day period annualises near $150k, got ${shortRevenue}`,
);
assert(shortCogs > 12_000 && shortCogs < 15_000, `COGS scales with the same days, got ${shortCogs}`);
assert(Math.abs(shortPeriod.doc.gpPct - 91) < 0.2, `GP% from the same pair, got ${shortPeriod.doc.gpPct}`);
assert(shortPeriod.doc.cogsMode === "gp_pct", "COGS and GP% share gp_pct mode");
assert(
  shortRows.every((row) => Math.abs(row.gpPct - shortPeriod.doc.gpPct) < 0.2),
  "month engine GP% matches the seeded input",
);
assert(!budgetIsImplausible(shortPeriod.doc, yankeesPeriod), "a corrected seed is not flagged");

const statedMonth = seedBudgetFromFinancials(budgetDoc(), {
  revenue: "8633.6",
  cogs: "775.98",
  periodMonths: "1",
});
const statedMonthRevenue = computeBudgetMonths(statedMonth.doc, statedMonth.doc.activeScenario).reduce(
  (sum, row) => sum + row.revenue,
  0,
);
assert(
  Math.abs(statedMonthRevenue - 8633.6 * 12) < 5,
  `periodMonths 1 with no dates still scales by 12, got ${statedMonthRevenue}`,
);

const staleBudget = budgetDoc();
staleBudget.gpPct = 70.9;
staleBudget.cogsMode = "per_unit";
staleBudget.revenueLines = staleBudget.revenueLines.map((line, index) =>
  index === 0
    ? {
        ...line,
        months: Object.fromEntries(
          Object.keys(line.months).map((month) => [month, { volume: 1, price: 1_552_600 / 12 }]),
        ),
      }
    : line,
);
assert(
  budgetIsImplausible(staleBudget, yankeesPeriod),
  "COGS 0 with actual COGS, or revenue about 15x the annualised period, is implausible",
);

const edited = seedBudgetFromFinancials(budgetDoc(), yankeesPeriod).doc;
edited.revenueLines = edited.revenueLines.map((line, index) =>
  index === 0
    ? {
        ...line,
        months: Object.fromEntries(
          Object.entries(line.months).map(([month, cell]) => [month, { ...cell, price: cell.price * 2 }]),
        ),
      }
    : line,
);
assert(!budgetIsImplausible(edited, yankeesPeriod), "an edited budget under 3x is not replaced");
assert(budgetScaleBreak(edited, yankeesPeriod) == null, "a 2× plan is not an order-of-magnitude break");
assert(
  reseedBudgetIfScaleBroken(edited, yankeesPeriod).revenueLines[0]?.months["2026-01"]?.price ===
    edited.revenueLines[0]?.months["2026-01"]?.price,
  "a plan under 10× is left alone",
);

const staleRevenue = computeBudgetMonths(staleBudget, staleBudget.activeScenario).reduce(
  (sum, row) => sum + row.revenue,
  0,
);
const rebuilt = reseedBudgetIfScaleBroken(staleBudget, yankeesPeriod);
const rebuiltRows = computeBudgetMonths(rebuilt, rebuilt.activeScenario);
const rebuiltRevenue = rebuiltRows.reduce((sum, row) => sum + row.revenue, 0);
const rebuiltCogs = rebuiltRows.reduce((sum, row) => sum + row.cogs, 0);
assert(budgetScaleBreak(staleBudget, yankeesPeriod) === "revenue", "about 15× revenue is a broken scale");
assert(staleRevenue > rebuiltRevenue * 10, `stored plan ${staleRevenue} is more than 10× the reseed ${rebuiltRevenue}`);
assert(
  Math.abs(rebuiltRevenue - 150_060) < 50,
  `reseed annualises the 21-day period near $150k, got ${rebuiltRevenue}`,
);
assert(rebuiltCogs > 12_000 && rebuiltCogs < 15_000, `reseeded COGS stays with the period, got ${rebuiltCogs}`);
assert(budgetWasRebuiltFromActuals(rebuilt), "the rebuild is a file note");
assert(budgetScaleBreak(rebuilt, yankeesPeriod) == null, "the rebuilt plan matches the annualised actuals");
const rebuiltAgain = reseedBudgetIfScaleBroken(rebuilt, yankeesPeriod);
const rebuildNotes = (rebuiltAgain.notes ?? []).filter((note) =>
  (note.text ?? "").startsWith("Rebuilt from the latest actuals."),
);
assert(rebuildNotes.length === 1, "reseed does not stack a second rebuild note");

const cogsBlow = seedBudgetFromFinancials(budgetDoc(), yankeesPeriod).doc;
cogsBlow.cogsMode = "per_unit";
cogsBlow.gpPct = 0;
const primaryId = cogsBlow.revenueLines[0]?.id ?? "";
cogsBlow.cogsPerUnit = { ...cogsBlow.cogsPerUnit, [primaryId]: 200_000 };
assert(budgetScaleBreak(cogsBlow, yankeesPeriod) === "cogs", "COGS an order of magnitude above actuals is a break");
const cogsFixed = reseedBudgetIfScaleBroken(cogsBlow, yankeesPeriod);
const cogsFixedTotal = computeBudgetMonths(cogsFixed, cogsFixed.activeScenario).reduce(
  (sum, row) => sum + row.cogs,
  0,
);
assert(cogsFixedTotal > 12_000 && cogsFixedTotal < 15_000, `COGS blow-up reseeds, got ${cogsFixedTotal}`);
assert(budgetWasRebuiltFromActuals(cogsFixed), "a COGS blow-up leaves the same rebuild note");

const twoDay = annualiseBudgetFinancials({
  revenue: "10000",
  cogs: "4000",
  periodMonths: "1",
  periodStart: "2026-09-01",
  periodEnd: "2026-09-02",
});
assert(
  Math.abs(Number(twoDay.revenue) - 120_000) < 1,
  `a 2-day label on a stated month stays ×12, got ${twoDay.revenue}`,
);
assert(Number(twoDay.revenue) < 100_000 * 10, "day scale must not turn one month into ~180×");

const lockedYear = annualiseBudgetFinancials({
  revenue: "150000",
  cogs: "13500",
  periodMonths: "12",
  periodMonthsChosen: "1",
  periodStart: "2026-09-01",
  periodEnd: "2026-09-21",
});
assert(Number(lockedYear.revenue) === 150_000, "a locked 12-month cover is not multiplied by 365/21");
assert(Number(lockedYear.cogs) === 13_500, "locked-year COGS is not scaled again");

const budgetPanel = read("src/components/budget/budget-panel.tsx");
assert(
  budgetPanel.includes("Rebuild budget from latest actuals"),
  "implausible budgets offer a rebuild",
);
assert(
  budgetPanel.includes("budgetIsImplausible"),
  "a stored budget inside 10× is checked instead of overwritten on load",
);
assert(
  budgetPanel.includes("reseedBudgetIfScaleBroken"),
  "the accountant can accept a rebuild",
);
assert(
  budgetPanel.includes("Nothing is rebuilt on load"),
  "an order-of-magnitude plan is not replaced on load",
);
assert(
  budgetPanel.includes("This budget was rebuilt from the latest actuals"),
  "the rebuild is visible on the budget tab",
);
const reportsIndex = read("src/routes/_authenticated/reports.index.tsx");
assert(
  reportsIndex.includes("publishBudgetDocument") && !reportsIndex.includes("reseedBudgetIfScaleBroken"),
  "budget reports publish the stored plan and do not rebuild it",
);

assert(laborProductivityTitle({ copyPack: "us" }) === "Labor Productivity", "US card title");
assert(laborProductivityFileStem({ copyPack: "us" }) === "LaborProductivity", "US ZIP stem");
assert(laborProductivityTitle({ copyPack: "za" }) === "Labour Productivity", "SA card title");
assert(laborProductivityFileStem({ copyPack: "za" }) === "LabourProductivity", "SA ZIP stem");
assert(read("src/reports/labor-productivity.tsx").includes("laborProductivityTitle"), "PDF title uses the locale helper");
assert(reportsSrc.includes("laborProductivityFileStem"), "ZIP filename uses the locale helper");

const nyTime = formatDateTime(
  new Date("2026-10-05T19:06:00Z"),
  { locale: "en-US", timezone: "America/New_York" },
  { hour: "numeric", minute: "2-digit", timeZoneName: "shortGeneric" },
);
assert(nyTime.includes("3:06") && nyTime.includes("ET"), `New York time keeps a zone label, got ${nyTime}`);
assert(
  read("src/components/advisory-sent-history.tsx").includes('timeZoneName: "shortGeneric"'),
  "delivery history shows the firm zone",
);

const messy = budgetDoc();
messy.revenueLines = messy.revenueLines.map((line, index) =>
  index === 0 ? { ...line, name: "fddff", months: Object.fromEntries(Object.keys(line.months).map((month) => [month, { volume: 1, price: 1000 }])) } : line,
);
messy.notes = [
  { id: "n1", at: "2026-02-01T00:00:00.000Z", by: "QA", text: "fddff", kind: "note" },
  { id: "n2", at: "2026-03-01T00:00:00.000Z", by: "QA", text: "Watch debtor days", kind: "note" },
];
const pdf = buildBudgetPdfModel(messy, []);
const printed = JSON.stringify(pdf);
assert(!/fddff/i.test(printed), "budget PDF model drops the fddff placeholder");
assert(pdf.notes.some((note) => note.text === "Watch debtor days"), "real partner notes stay");
assert(
  pdf.sections.some((section) => section.rows.some((row) => row.label === "Revenue line")),
  "a placeholder driver name is replaced",
);

const items = completeDeliverablePdfItems(
  [
    { title: "Collect debtors", status: "in_progress", ownerName: "Ada", outcomeWhy: "Cash" },
    { title: "Cut rent", status: "not_started" },
  ],
  [{ title: "Cut rent", outcomeWhy: "just created" }],
);
assert(items.length === 2, "PDF keeps the full plan, not only the new row");
assert(items[0]?.ownerName === "Ada" && items[0]?.outcomeWhy === "Cash", "existing item detail is kept");
const withNew = completeDeliverablePdfItems([{ title: "Collect debtors" }], [{ title: "Hire a bookkeeper", outcomeWhy: "Close" }]);
assert(withNew.map((item) => item.title).join("|") === "Collect debtors|Hire a bookkeeper", "a title missing from the plan read is still included");
const createdOnly = completeDeliverablePdfItems([], [{ title: "Hire a bookkeeper", outcomeWhy: "Close" }]);
assert(createdOnly.length === 1, "an empty plan read falls back to the created rows");
const clientSrc = read("src/routes/_authenticated/clients.$clientId.tsx");
assert(clientSrc.includes("completeDeliverablePdfItems"), "bot PDF builds the full deliverable");
assert(clientSrc.includes('from("action_items_v")'), "bot PDF reads the active plan items");

const subscription: CashBankExtract = {
  period_start: "2026-05-01",
  period_end: "2026-07-31",
  opening_balance: 1000,
  closing_balance: 1000,
  currency: "ZAR",
  notes: null,
  transactions: [
    ...["2026-05-03", "2026-06-03", "2026-07-03"].map((txn_date) => ({
      txn_date,
      amount: 199,
      direction: "out" as const,
      description: "NETFLIX.COM SUBSCRIPTION",
      counterparty: "Netflix",
      ai_bucket: "opex" as const,
      excluded: false,
    })),
    ...["2026-05-01", "2026-06-01"].map((txn_date, index) => ({
      txn_date,
      amount: index === 0 ? 100 : 8_000,
      direction: "out" as const,
      description: "ACME SUPPLIES",
      counterparty: "Acme Supplies",
      ai_bucket: "opex" as const,
      excluded: false,
    })),
  ],
};
const bankLines = buildDraftLinesFromExtract(subscription);
const netflix = bankLines.find((line) => /netflix/i.test(line.name));
const acme = bankLines.find((line) => /acme/i.test(line.name));
assert(netflix?.cadence === "monthly", `subscription is monthly, got ${netflix?.cadence}`);
assert(recurringReviewLabel(netflix!) === "Recurring · monthly", "review surface names the monthly recurrence");
assert(acme?.cadence === "once_off", `dissimilar amounts are not recurring, got ${acme?.cadence}`);
assert(recurringReviewLabel({ cadence: "once_off", txn_count: 2 }) == null, "once-off pairs are not badged");
assert(amountsSimilar([199, 205, 190]), "amounts within 15% match");
assert(!amountsSimilar([100, 8000]), "a hundred and eight thousand do not match");
assert(read("src/components/cash-classification-workspace.tsx").includes("recurringReviewLabel"), "bank review shows the recurring badge");

assert(channelHonestyLabel("pdf_download", false) === "Downloaded", "a download says Downloaded");
assert(channelHonestyLabel("email", false) === "Sent", "a real email send says Sent");
assert(!channelHonestyLabel("copy", false).includes("Sent"), "a copy is not a send");
assert(!channelHonestyLabel("mailto", false).includes("Sent"), "opening a share sheet is not a send");
assert(!channelHonestyLabel("pdf_download", false).includes("Sent"), "a download is not Sent");
const history = read("src/components/advisory-sent-history.tsx");
assert(history.includes("Delivery history"), "the drafter list is not titled Sent");
assert(!history.includes(">Sent history<") && !history.includes("Sent history\n"), "downloads are not listed under Sent");

const ask = read("src/lib/ask-ai.js");
assert(ask.includes("compositionstart"), "composer tracks IME composition");
assert(ask.includes("e.keyCode === 229"), "IME commit key does not send");
assert(!ask.includes("e.isComposing"), "Enter does not trust the intermittent isComposing flag");
assert(ask.includes("e.shiftKey"), "Shift+Enter still adds a newline");
assert(ask.includes('e.key !== "Enter"'), "Enter sends");
assert(ask.includes("question = ta.value"), "Enter reads the textarea, not a stale closed-over value");
assert((ask.match(/addEventListener\("keydown"/g) ?? []).length === 1, "one keydown listener");

function emptyMoney() {
  return null;
}
function sheet(): ExtractionResult["current_period"]["figures"]["balance_sheet"] {
  return {
    non_current_assets: {
      property_plant_equipment: emptyMoney(),
      intangible_assets: emptyMoney(),
      investments: emptyMoney(),
      deferred_tax_asset: emptyMoney(),
      other: emptyMoney(),
      total: emptyMoney(),
    },
    current_assets: {
      inventories: emptyMoney(),
      trade_and_other_receivables: emptyMoney(),
      cash_and_cash_equivalents: emptyMoney(),
      other: emptyMoney(),
      total: emptyMoney(),
    },
    total_assets: emptyMoney(),
    equity: {
      share_capital: 1_000,
      retained_earnings: 2_900,
      other_reserves: emptyMoney(),
      total: emptyMoney(),
    },
    non_current_liabilities: {
      borrowings: emptyMoney(),
      deferred_tax_liability: emptyMoney(),
      other: emptyMoney(),
      total: emptyMoney(),
    },
    current_liabilities: {
      trade_and_other_payables: emptyMoney(),
      borrowings: emptyMoney(),
      current_tax: emptyMoney(),
      bank_overdraft: emptyMoney(),
      other: emptyMoney(),
      total: emptyMoney(),
    },
    total_liabilities: emptyMoney(),
    total_equity_and_liabilities: emptyMoney(),
  };
}

const tb: ExtractionResult = {
  entity_name: "QA Test Co",
  registration_number: null,
  currency: "ZAR",
  units: "actual",
  statement_basis: "management_accounts",
  extraction_notes: "Balance sheet totals were not computed.",
  comparative_period: null,
  current_period: {
    period_end: null,
    figures: {
      income_statement: {
        revenue: null,
        cost_of_sales: null,
        gross_profit: null,
        other_income: null,
        operating_expenses: null,
        depreciation_amortisation: null,
        operating_profit: null,
        finance_income: null,
        finance_costs: null,
        profit_before_tax: null,
        income_tax: null,
        profit_after_tax: null,
      },
      balance_sheet: sheet(),
      cash_flow: null,
    },
  },
};

const filled = applyBalanceSheetTotals(tb);
assert(filled.current_period.period_end == null, "a missing period date stays missing");
assert(filled.current_period.figures.balance_sheet.equity.total === 3_900, "equity is share capital plus retained earnings");
assert(filled.current_period.figures.balance_sheet.total_assets == null, "asset total stays blank when no asset lines exist");
assert(filled.current_period.figures.balance_sheet.total_liabilities == null, "liability total stays blank when no liability lines exist");
assert(filled.extraction_notes == null, "the not-computed note is dropped once equity is filled");
assert(periodFinancialsFromExtraction(tb).equity === "3900", "period financials read the filled equity total");

const withSides = applyBalanceSheetTotals({
  ...tb,
  extraction_notes: "Turnover mapped to revenue.\nBalance sheet totals were not computed.",
  current_period: {
    period_end: null,
    figures: {
      ...tb.current_period.figures,
      balance_sheet: {
        ...sheet(),
        non_current_assets: { ...sheet().non_current_assets, property_plant_equipment: 2_000 },
        current_assets: { ...sheet().current_assets, cash_and_cash_equivalents: 1_500 },
        current_liabilities: { ...sheet().current_liabilities, trade_and_other_payables: 600 },
        equity: { share_capital: 1_000, retained_earnings: 2_900, other_reserves: null, total: null },
      },
    },
  },
});
const bs = withSides.current_period.figures.balance_sheet;
assert(bs.total_assets === 3_500, `assets 3,500, got ${bs.total_assets}`);
assert(bs.total_liabilities === 600, `liabilities 600, got ${bs.total_liabilities}`);
assert(bs.equity.total === 3_900, "equity still 3,900");
assert(bs.total_equity_and_liabilities === 4_500, "equity plus liabilities");
assert(withSides.extraction_notes === "Turnover mapped to revenue.", "only the not-computed bullet is removed");

const printedTotal = applyBalanceSheetTotals({
  ...tb,
  current_period: {
    ...tb.current_period,
    figures: {
      ...tb.current_period.figures,
      balance_sheet: {
        ...sheet(),
        equity: { share_capital: 1_000, retained_earnings: 2_900, other_reserves: null, total: 9_999 },
      },
    },
  },
});
assert(
  printedTotal.current_period.figures.balance_sheet.equity.total === 9_999,
  "a printed equity total is not overwritten",
);
assert(
  printedTotal.current_period.figures.balance_sheet.equity_derived !== true,
  "a printed equity total is not labelled derived",
);

const noEquityLines = applyBalanceSheetTotals({
  ...tb,
  current_period: {
    period_end: null,
    figures: {
      ...tb.current_period.figures,
      balance_sheet: {
        ...sheet(),
        total_assets: 43_000,
        total_liabilities: 10_000,
        equity: { share_capital: null, retained_earnings: null, other_reserves: null, total: null },
      },
    },
  },
});
const plugged = noEquityLines.current_period.figures.balance_sheet;
assert(plugged.equity.total === 33_000, `assets 43k minus liabilities 10k is 33k, got ${plugged.equity.total}`);
assert(plugged.equity_derived === true, "plugged equity is marked derived");
assert(plugged.equity.share_capital == null, "no equity lines were invented");
const pluggedFigures = periodFinancialsFromExtraction({
  ...tb,
  current_period: noEquityLines.current_period,
});
assert(pluggedFigures.equity === "33000", `period equity ${pluggedFigures.equity}`);
assert(pluggedFigures.equityDerived === "1", "period financials flag the plug");
const pluggedNotes = statementNoteSections(
  { ...tb, current_period: noEquityLines.current_period },
  (n) => n.toLocaleString("en-US"),
);
const pluggedKeyFigures = pluggedNotes.find((section) => section.title === "Key figures")?.items.join("\n") ?? "";
assert(
  pluggedKeyFigures.includes(`${DERIVED_EQUITY_LABEL}: 33,000`),
  `notes label the plug, got ${pluggedKeyFigures}`,
);
assert(!pluggedKeyFigures.includes("Total equity"), "notes do not call the plug reported equity");

const fromLines = applyBalanceSheetTotals({
  ...tb,
  current_period: {
    period_end: null,
    figures: {
      ...tb.current_period.figures,
      balance_sheet: {
        ...sheet(),
        non_current_assets: { ...sheet().non_current_assets, property_plant_equipment: 43_000 },
        current_liabilities: { ...sheet().current_liabilities, trade_and_other_payables: 10_000 },
        equity: { share_capital: null, retained_earnings: null, other_reserves: null, total: null },
      },
    },
  },
});
assert(
  fromLines.current_period.figures.balance_sheet.equity.total === 33_000,
  "component asset and liability lines still plug equity",
);
assert(fromLines.current_period.figures.balance_sheet.equity_derived === true, "line-built plug is derived");

const zeroEquityLine = applyBalanceSheetTotals({
  ...tb,
  current_period: {
    period_end: null,
    figures: {
      ...tb.current_period.figures,
      balance_sheet: {
        ...sheet(),
        total_assets: 43_000,
        total_liabilities: 10_000,
        equity: { share_capital: 0, retained_earnings: null, other_reserves: null, total: null },
      },
    },
  },
});
assert(
  zeroEquityLine.current_period.figures.balance_sheet.equity.total === 0,
  "a zero equity line is real and is not replaced by the plug",
);
assert(
  zeroEquityLine.current_period.figures.balance_sheet.equity_derived !== true,
  "a real equity line is not labelled derived",
);

const typedTotal = applyBalanceSheetTotals({
  ...tb,
  current_period: {
    period_end: null,
    figures: {
      ...tb.current_period.figures,
      balance_sheet: {
        ...sheet(),
        total_assets: 43_000,
        total_liabilities: 10_000,
        equity: { share_capital: null, retained_earnings: null, other_reserves: null, total: 12_000 },
      },
    },
  },
});
assert(
  typedTotal.current_period.figures.balance_sheet.equity.total === 12_000,
  "a typed equity total is not replaced by the plug",
);
assert(typedTotal.current_period.figures.balance_sheet.equity_derived !== true, "a typed total stays unlabelled");

const keptHand = preserveHandEnteredEquity(
  { equity: "12000" },
  { equity: "33000", equityDerived: "1" },
);
assert(keptHand.equity === "12000" && keptHand.equityDerived === "", "a hand-entered equity survives a plug import");
const refreshedPlug = preserveHandEnteredEquity(
  { equity: "33000", equityDerived: "1" },
  { equity: "40000", equityDerived: "1" },
);
assert(refreshedPlug.equity === "40000" && refreshedPlug.equityDerived === "1", "a previous plug can be refreshed");
const reportedWins = preserveHandEnteredEquity(
  { equity: "12000" },
  { equity: "5000", equityDerived: "" },
);
assert(reportedWins.equity === "5000" && reportedWins.equityDerived === "", "reported equity replaces a hand figure");

const notes = statementNoteSections(tb, (n) => n.toLocaleString("en-US"));
const figures = notes.find((section) => section.title === "Key figures")?.items.join("\n") ?? "";
const gaps = notes.find((section) => section.title === "Gaps")?.items.join("\n") ?? "";
assert(figures.includes("Total equity: 3,900"), "statement notes show the computed equity");
assert(/Period end not in the file/.test(gaps), "missing period stays a gap");
assert(!/not computed/i.test(gaps), "statement notes do not repeat that totals were not computed");

const extractServer = read("src/lib/extractFinancials.server.ts");
assert(extractServer.includes("applyBalanceSheetTotals"), "import fills totals before validation");
assert(extractServer.includes("short bullets"), "extraction prompt still asks for short bullets");

const qaLive = { revenue: "1550000", cogs: "451000", fixedCosts: "", cash: "" };
const qaSnapshot = {
  source: "pdf_upload",
  period_date: "2026-10-31",
  financials: { revenue: "1550000", cogs: "451000", fixedCosts: "", cash: "" },
};
assert(
  needsTrialBalanceRefresh({ live: qaLive, snapshots: [qaSnapshot] }),
  "a pre-metric trial balance with blank opex and cash asks for a re-import",
);
assert(
  !needsTrialBalanceRefresh({
    live: { ...qaLive, fixedCosts: "620000", cash: "25000" },
    snapshots: [qaSnapshot],
  }),
  "hand-entered opex and cash are left alone",
);
assert(
  !needsTrialBalanceRefresh({
    live: qaLive,
    snapshots: [{ ...qaSnapshot, source: "manual" }],
  }),
  "a hand-saved snapshot is not treated as a trial-balance import",
);
assert(
  !needsTrialBalanceRefresh({
    live: { revenue: "1550000", cogs: "451000", fixedCosts: "620000", cash: "25000" },
    snapshots: [
      {
        source: "pdf_upload",
        period_date: "2026-10-31",
        financials: { revenue: "1550000", fixedCosts: "620000", cash: "25000" },
      },
    ],
  }),
  "an import that already has opex and cash does not ask again",
);
assert(
  !needsTrialBalanceRefresh({
    live: { revenue: "1550000", fixedCosts: "620000", cash: "25000" },
    snapshots: [
      qaSnapshot,
      {
        source: "pdf_upload",
        period_date: "2026-11-30",
        financials: { revenue: "1550000", fixedCosts: "620000", cash: "25000" },
      },
    ],
  }),
  "the latest statement import wins over an older incomplete snapshot",
);
assert(
  TRIAL_BALANCE_REFRESH_COPY ===
    "Re-import the trial balance to refresh operating profit and runway",
  "refresh copy is the agreed sentence",
);
const refreshUi = read("src/components/trial-balance-refresh-prompt.tsx");
assert(refreshUi.includes("TRIAL_BALANCE_REFRESH_COPY"), "prompt uses the shared sentence");
assert(refreshUi.includes("Re-import trial balance"), "prompt has an import button");
assert(clientSrc.includes("needsTrialBalanceRefresh"), "client file detects a stale trial balance");
assert(
  (clientSrc.match(/TrialBalanceRefreshPrompt/g) ?? []).length >= 3,
  "Overview and Health both offer the re-import",
);
const ownerSrc = read("src/routes/app.tsx");
assert(ownerSrc.includes("needsTrialBalanceRefresh"), "owner health detects a stale trial balance");
assert(ownerSrc.includes('setFirstRunStep("first-data")'), "owner re-import opens the statement upload");
assert(
  !read("src/lib/trial-balance-refresh.ts").includes("apply_migration"),
  "stale imports are not rewritten from missing lines",
);

console.log("accountant-qa-deliverables-test: ok");
