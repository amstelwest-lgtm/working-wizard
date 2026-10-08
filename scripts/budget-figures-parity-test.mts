/**
 * Budget figures parity: opening cash stays on this client, actuals are one
 * source, a 10× plan is not rebuilt on load, profit and cover agree, and
 * days follow Ratios.
 * Run: pnpm test:budget-figures-parity
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { computeBudgetMonths } from "../src/lib/budget.compute";
import {
  BUDGET_REBUILT_NOTE,
  alignBudgetOpeningCash,
  alignBudgetWorkingCapital,
  annualiseBudgetFinancials,
  budgetDaysNeedReview,
  budgetScaleBreak,
  budgetVersusStatement,
  publishBudgetDocument,
  seedBudgetFromFinancials,
} from "../src/lib/budget.bridges";
import { createBudgetDocument, fyMonths } from "../src/lib/budget.months";
import {
  budgetActualFromFinancials,
  budgetReviewLine,
  buildBudgetPdfModel,
} from "../src/lib/budget-pdf";
import type { BudgetDocument, BudgetQualification } from "../src/lib/budget.types";
import { varianceLine } from "../src/lib/budget.variance";
import {
  buildDeliverableInputDefinition,
  mergeDeliverableInputState,
} from "../src/lib/deliverable-input-config";
import { resolveMarket } from "../src/lib/market";

const US_MARKET = resolveMarket({ country: "US", regionCode: "NY" });
import { benchmarkPosition } from "../src/lib/ratios";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const read = (path: string) => readFileSync(resolve(path), "utf8");

const qualification: BudgetQualification = {
  payMotion: "time_delivery",
  volumeUnit: "billable_hours",
  driverKind: "hours_rate",
  costShape: "payroll_heavy",
  debtorDaysDefault: 30,
  capexMode: "none",
  confirmedAt: "2026-01-15T00:00:00.000Z",
};

function baseDoc(): BudgetDocument {
  return createBudgetDocument({
    templateId: "services_hours",
    qualification,
    fyStart: "2026-01",
    fyStartMonth: 1,
    ref: new Date("2026-10-05T12:00:00Z"),
    market: US_MARKET,
  });
}

const yankeesFin = {
  cash: "7430.22",
  revenue: "8633.6",
  cogs: "775.98",
  fixedCosts: "5356.5",
  ebit: "2501.12",
  ebitda: "2501.12",
  receivables: "9194.51",
  payables: "8386.76",
  periodMonths: "1",
  periodStart: "2026-09-01",
  periodEnd: "2026-09-21",
  periodLabel: "1 Sep 2026 – 21 Sep 2026",
};
const yankeesForecast = {
  openingBalance: "150877.6",
  revenue: [],
  expenses: [],
  note: "fddff",
};

const poisoned: BudgetDocument = {
  ...baseDoc(),
  openingCash: 128450,
  openingCashSource: "statement",
};
const switched = alignBudgetOpeningCash(poisoned, {
  financials: yankeesFin,
  cashflow: yankeesForecast,
});
assert(
  Math.abs(switched.openingCash - 7430.22) < 0.01,
  `Yankees opening cash is the statement ${switched.openingCash}, not QA US 128450 or the forecast 150877`,
);
assert(switched.openingCashSource === "statement", "Yankees cash is the statement, not a bank publish");
const back = alignBudgetOpeningCash(switched, {
  financials: { cash: "128450", revenue: "1" },
  cashflow: yankeesForecast,
});
assert(Math.abs(back.openingCash - 128450) < 0.01, "switching back restores that client's own cash");
const manual = alignBudgetOpeningCash(
  { ...poisoned, openingCashSource: "manual" },
  { financials: yankeesFin, cashflow: yankeesForecast },
);
assert(manual.openingCash === 128450, "a manual opening is not replaced on client switch");

const panel = read("src/components/budget/budget-panel.tsx");
assert(panel.includes("setDoc(null)"), "a client switch clears the budget document");
assert(panel.includes("loadedFor.current !== savedFor"), "autosave does not write onto the next client");
assert(panel.includes("Nothing is rebuilt on load"), "load does not rebuild a stored plan");

const us = {
  revenue: "700000",
  cogs: "280000",
  fixedCosts: "351000",
  ebit: "60000",
  ebitda: "69000",
  cash: "128450",
  receivables: "25000",
  payables: "37000",
  periodMonths: "9",
  periodStart: "2026-01-01",
  periodEnd: "2026-09-30",
};
const annual = annualiseBudgetFinancials(us);
assert(
  Math.abs(Number(annual.revenue) - 700000 * (12 / 9)) < 1,
  `a 9-month cover annualises, got ${annual.revenue}`,
);
const seeded = seedBudgetFromFinancials(baseDoc(), us).doc;
const untouched: BudgetDocument = {
  ...seeded,
  statementDepreciation: 0,
  notes: [],
  qualification: { ...seeded.qualification, confirmedAt: "1970-01-01T00:00:00.000Z" },
};
const published = publishBudgetDocument(untouched, us, {
  cashflow: { openingBalance: "1" },
});
assert(
  Math.abs((published.statementDepreciation ?? 0) - 12000) < 1,
  `annualised depreciation is 12000, got ${published.statementDepreciation}`,
);
const rows = computeBudgetMonths(published, published.activeScenario);
const cover = rows.filter((row) => row.month <= "2026-09");
const dep = cover.reduce((sum, row) => sum + row.depreciation, 0);
const profit = cover.reduce((sum, row) => sum + row.ebit, 0);
assert(Math.abs(dep - 9000) < 2, `9-month depreciation is 9000, got ${dep}`);
assert(Math.abs(profit - 60000) < 5, `9-month profit is EBIT 60000, got ${profit}`);
const versus = budgetVersusStatement(published, us);
assert(versus != null, "the 9-month statement is an actual");
assert(Math.abs(versus!.revenue - 700000) < 1, `statement revenue stays 700000, got ${versus!.revenue}`);
assert(
  Math.abs(versus!.budgetRevenue - 700000) < 50,
  `9 months of the plan match the cover, got ${versus!.budgetRevenue}`,
);
assert(versus!.chip === "Statement pace, prorated", versus!.chip);
const pdfActual = budgetActualFromFinancials(us);
const pdf = buildBudgetPdfModel(published, pdfActual ? [pdfActual] : [], US_MARKET);
const pdfRevenue = pdf.summary.find((row) => row.label === "Revenue");
const pdfProfit = pdf.summary.find((row) => row.label === "Profit");
assert(pdf.hasActuals, "the PDF does not say no month actuals when the statement has revenue");
assert(!/No month actuals/i.test(pdf.headline), pdf.headline);
assert(Math.abs((pdfRevenue?.actual ?? 0) - 700000) < 1, `PDF actual revenue ${pdfRevenue?.actual}`);
assert(Math.abs((pdfRevenue?.budget ?? 0) - 700000) < 50, `PDF budget revenue ${pdfRevenue?.budget}`);
assert(Math.abs((pdfProfit?.budget ?? 0) - 60000) < 50, `PDF budget profit ${pdfProfit?.budget}`);

const yankeesVersus = budgetVersusStatement(baseDoc(), yankeesFin);
assert(yankeesVersus != null, "Yankees statement compares");
assert(
  Math.abs(yankeesVersus!.revenue - 8633.6) < 0.05,
  `Yankees revenue actual matches Overview ${yankeesVersus!.revenue}, not the annualised pace`,
);
assert(yankeesVersus!.chip === "Statement pace, prorated", yankeesVersus!.chip);

const miss = varianceLine("revenue", "Revenue", 58333, 4167, true);
assert(miss.delta < 0 && miss.signal === "adverse", "a revenue miss is signed and adverse");

let huge = baseDoc();
const months = fyMonths(huge.fyStart);
huge = {
  ...huge,
  revenueLines: huge.revenueLines.map((line, index) =>
    index === 0
      ? {
          ...line,
          months: Object.fromEntries(months.map((month) => [month, { volume: 1, price: 100000 }])),
        }
      : line,
  ),
};
const tiny = { revenue: "10000", cogs: "1000", periodMonths: "12" };
const kept = publishBudgetDocument(huge, tiny);
assert(budgetScaleBreak(kept, tiny) === "revenue", "a 10× plan is still flagged");
assert(
  !(kept.notes ?? []).some((note) => (note.text ?? "").includes(BUDGET_REBUILT_NOTE.slice(0, 24))),
  "publish does not write the rebuild note",
);
assert(kept.revenueLines[0]?.months["2026-01"]?.price === 100000, "the stored plan is not replaced");

const daysDoc: BudgetDocument = {
  ...baseDoc(),
  wc: { ...baseDoc().wc, debtorDays: 22, creditorDays: 227 },
};
const days = alignBudgetWorkingCapital(daysDoc, yankeesFin);
assert(days.wc.debtorDays === 32, `Yankees Days AR follows Ratios, got ${days.wc.debtorDays}`);
assert(days.wc.creditorDays === 329, `Yankees Days AP follows Ratios, got ${days.wc.creditorDays}`);
assert(days.wcDaysSource === "ratios", "days are labelled from Ratios");
assert(budgetDaysNeedReview(days.wc.creditorDays), "329 days is flagged for review");
assert(!budgetDaysNeedReview(days.wc.debtorDays), "32 days is not flagged");
const typed = alignBudgetWorkingCapital({ ...daysDoc, wcDaysSource: "manual" }, yankeesFin);
assert(typed.wc.debtorDays === 22 && typed.wc.creditorDays === 227, "a typed pair is kept");

const cashDef = buildDeliverableInputDefinition("cash", { financials: yankeesFin });
assert(
  cashDef.assumptions.find((row) => row.id === "daysAr")?.engineBound === false,
  "cash Days AR does not drive the 13-week engine",
);
const cashMerged = mergeDeliverableInputState(
  cashDef,
  { checkedSources: {}, assumptionValues: { daysAr: 30, daysAp: 30 } },
  { financials: yankeesFin },
);
assert(cashMerged.assumptionValues.daysAr === 32, "cash shows the Ratios Days AR");
assert(cashMerged.assumptionValues.daysAp === 329, "cash shows the Ratios Days AP");
assert(
  cashDef.questions.some((q) => /over 180/.test(q.prompt)),
  "an implausible Days AP asks for review",
);

assert(
  benchmarkPosition({
    value: 37,
    median: 40,
    top: 30,
    direction: "sweet_spot",
    healthyMin: 30,
    healthyMax: 60,
  }) === "in_band",
  "37 creditor days versus a 40-day median is in band",
);

const signed = budgetReviewLine({
  name: "James Fleming",
  firmName: "Ben Accountants",
  signedOffAt: "2026-10-05T19:06:00Z",
  isStale: false,
  workflowStatus: "signed_off",
  market: US_MARKET,
});
assert(signed.unsigned === false, "a fresh sign-off is not a draft");
assert(
  signed.text.startsWith("Signed off by James Fleming · Ben Accountants ·"),
  signed.text,
);
assert(/ET|EDT|EST/.test(signed.text), `sign-off keeps a zone, got ${signed.text}`);
const stale = budgetReviewLine({
  name: "James Fleming",
  firmName: "Ben Accountants",
  signedOffAt: "2026-10-05T19:06:00Z",
  isStale: true,
  market: US_MARKET,
});
assert(stale.unsigned && stale.text.includes("inputs changed after sign-off"), stale.text);
const ready = budgetReviewLine({ isStale: false, workflowStatus: "ready_for_review" });
assert(ready.text === "Ready for review — not signed off" && ready.unsigned, ready.text);
const draft = budgetReviewLine({ isStale: false, workflowStatus: "draft" });
assert(draft.text === "Draft — not signed off", draft.text);

const watermark = read("src/components/pdf/watermark.tsx");
assert(watermark.includes("DRAFT — NOT SIGNED OFF"), "the draft mark is a full phrase");
assert(!watermark.includes("top: 400"), "the draft mark is not painted over the table header");
const signoffUi = read("src/components/review-signoff.tsx");
assert(signoffUi.includes("Submit for review"), "a preparer can still submit");
assert(signoffUi.includes("!canSignOff"), "a firm accountant does not submit a draft they can sign");

console.log("budget-figures-parity ok");
