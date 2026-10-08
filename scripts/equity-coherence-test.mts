/**
 * Equity coherence: pre-close trial-balance equity, the short-period ROE guard,
 * OCF with no cash-flow statement, and derived equity reaching report inputs.
 * Run: pnpm test:equity-coherence
 */
import {
  debtToEquityReading,
  presentReturn,
  presentScorecardRatio,
  PERIOD_TOO_SHORT,
  scoredReturnHealth,
} from "../src/lib/report-coherence";
import {
  coherentEquity,
  effectivePeriodMonths,
  equityCrossCheck,
  EQUITY_CROSSCHECK_WARNING,
  reportInputsFromFinancials,
} from "../src/lib/equity-coherence";
import { computeRatios, type RatioInputs } from "../src/lib/ratios";
import { applyBalanceSheetTotals, readTimeEquity } from "../src/lib/statement-financials";
import { isClean, validateFigures } from "../src/lib/validateFinancials";
import { defaultPeriodCoverage } from "../src/lib/statement-period";
import { pickCurrentSnapshot } from "../src/lib/financial-snapshots";
import type { BalanceSheet, ExtractionResult, IncomeStatement } from "../src/lib/financialSchema";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const qaUs = equityCrossCheck({
  equity: 90_000,
  totalAssets: 306_950,
  totalLiabilities: 156_950,
  profit: 60_000,
});
assert(qaUs.preClose && qaUs.equity === 150_000, `pre-close equity ${qaUs.equity}`);
assert(qaUs.plug === 150_000, "assets minus liabilities is the cross-check");
assert(qaUs.warning == null, "a sheet that ties does not warn");
assert(Math.abs(60_000 / (qaUs.equity ?? 1) - 0.4) < 1e-9, "unannualised ROE is 40% on corrected equity");

const stored = coherentEquity({
  equity: "90000",
  totalAssets: "306950",
  totalLiabilities: "156950",
  netIncome: "60000",
});
assert(stored.equity === "150000" && stored.preClose && !stored.derived, `stored pre-close ${stored.equity}`);
const again = coherentEquity({
  equity: stored.equity,
  totalAssets: "306950",
  totalLiabilities: "156950",
  netIncome: "60000",
});
assert(again.equity === "150000" && !again.preClose, "folding profit twice is a no-op");

const gap = equityCrossCheck({
  equity: 90_000,
  totalAssets: 320_000,
  totalLiabilities: 156_950,
  profit: 60_000,
});
assert(gap.preClose && gap.equity === 150_000, "lines plus profit stay the reporting figure");
assert(gap.warning === EQUITY_CROSSCHECK_WARNING, "a gap above 1% is a soft warning");

const yankees = coherentEquity({
  equity: "8266.73",
  totalAssets: "21323.01",
  payables: "8386.76",
  netIncome: "2501.12",
  currentLiabilities: "13056.28",
});
assert(yankees.equity === "8266.73" && !yankees.preClose, "typed equity that already balances is not rewritten");

const payablesOnly = coherentEquity({
  equity: "8266.73",
  totalAssets: "21323.01",
  payables: "8386.76",
  netIncome: "2501.12",
});
assert(payablesOnly.equity === "8266.73", "payables are not a liability total for a typed equity");

const plugged = readTimeEquity({
  totalAssets: "43000",
  payables: "10000",
  equity: "",
  netIncome: "33000",
});
assert(plugged.derived && plugged.equity === "33000", "blank equity still plugs assets minus liabilities");
assert(
  coherentEquity({
    equity: "33000",
    equityDerived: "1",
    totalAssets: "43000",
    totalLiabilities: "10000",
    netIncome: "33000",
  }).equity === "33000",
  "a derived plug is not increased by profit",
);

function moneyBag(): IncomeStatement {
  return {
    revenue: 120_000,
    cost_of_sales: 48_000,
    gross_profit: null,
    other_income: null,
    operating_expenses: 41_900,
    depreciation_amortisation: null,
    operating_profit: null,
    finance_income: null,
    finance_costs: null,
    profit_before_tax: null,
    income_tax: null,
    profit_after_tax: null,
  };
}

function sheet(): BalanceSheet {
  return {
    non_current_assets: {
      property_plant_equipment: 8_000,
      intangible_assets: null,
      investments: null,
      deferred_tax_asset: null,
      other: null,
      total: null,
    },
    current_assets: {
      inventories: null,
      trade_and_other_receivables: 15_000,
      cash_and_cash_equivalents: 20_000,
      other: null,
      total: null,
    },
    total_assets: null,
    equity: { share_capital: 1_000, retained_earnings: 2_900, other_reserves: null, total: null },
    non_current_liabilities: {
      borrowings: null,
      deferred_tax_liability: null,
      other: null,
      total: null,
    },
    current_liabilities: {
      trade_and_other_payables: 9_000,
      borrowings: null,
      current_tax: null,
      bank_overdraft: null,
      other: null,
      total: null,
    },
    total_liabilities: null,
    total_equity_and_liabilities: null,
  };
}

const extraction: ExtractionResult = {
  entity_name: "QA US Test LLC",
  registration_number: null,
  currency: "USD",
  units: "actual",
  statement_basis: "management_accounts",
  extraction_notes: null,
  comparative_period: null,
  current_period: {
    period_end: "2026-09-30",
    figures: { income_statement: moneyBag(), balance_sheet: sheet(), cash_flow: null },
  },
};
const folded = applyBalanceSheetTotals(extraction);
const foldedSheet = folded.current_period.figures.balance_sheet;
assert(foldedSheet.equity.retained_earnings === 2_900, "profit is not written into retained earnings");
assert(foldedSheet.equity.total === 34_000, `folded equity ${foldedSheet.equity.total}`);
assert(foldedSheet.total_equity_and_liabilities === 43_000, "equity and liabilities include unclosed profit");
assert(foldedSheet.period_profit_in_equity === 30_100, "the folded profit stays visible");
assert(isClean(validateFigures(folded.current_period.figures)), "a folded pre-close TB balances");

const short = presentReturn({
  ratioName: "Return on Equity",
  value: 3.631,
  equity: 8_267,
  currency: "USD",
  periodMonths: 1,
  partMonth: true,
});
assert(short.unscored && short.headline === "n/a", "part-month ROE is n/a");
assert(short.note === PERIOD_TOO_SHORT, "the note says the period is too short to annualise");
const shortRoa = presentScorecardRatio({
  name: "Return on Assets",
  value: 1.408,
  periodMonths: 1,
  partMonth: true,
});
assert(shortRoa.unscored && shortRoa.headline === "n/a", "part-month ROA uses the same guard");
const nineInputs: RatioInputs = {
  revenue: "240000",
  cogs: "90000",
  ebit: "70000",
  ebt: "65000",
  netIncome: "60000",
  ebitda: "70000",
  operatingCashflow: "",
  totalAssets: "306950",
  equity: "150000",
  receivables: "",
  inventory: "",
  payables: "",
  fixedCosts: "",
  variableCosts: "",
  top5Revenue: "",
  laborCost: "",
  employees: "",
  founderHours: "",
  periodMonths: "9",
  totalLiabilities: "156950",
};
const nineRatios = computeRatios(nineInputs);
const expectedRoe = (60_000 * 12) / 9 / 150_000;
assert(
  Math.abs(nineRatios["Return on Equity"] - expectedRoe) < 0.002,
  `9-month ROE annualises to ~53.3%, got ${nineRatios["Return on Equity"]}`,
);
const nineMonth = presentReturn({
  ratioName: "Return on Equity",
  value: nineRatios["Return on Equity"],
  equity: 150_000,
  currency: "USD",
  periodMonths: 9,
});
assert(
  !nineMonth.unscored && nineMonth.text.includes("53.3%") && nineMonth.text.includes("annualised"),
  `nine-month ROE is labelled annualised, got ${nineMonth.text}`,
);
const expectedRoa = (60_000 * 12) / 9 / 306_950;
assert(
  Math.abs(nineRatios["Return on Assets"] - expectedRoa) < 0.002,
  `9-month ROA annualises, got ${nineRatios["Return on Assets"]}`,
);
const nineDe = nineRatios["Debt-to-Equity"];
assert(Math.abs(nineDe - 156_950 / 150_000) < 0.0001, `D/E from total liabilities is ~1.05, got ${nineDe}`);
const deReading = debtToEquityReading({
  totalLiabilities: 156_950,
  facilityDebt: 0,
  facilitiesCaptured: false,
  equity: 150_000,
});
assert(
  deReading.source === "liabilities" && Math.abs(deReading.value - 156_950 / 150_000) < 1e-9,
  `facilities absent still uses extracted liabilities, got ${deReading.source} ${deReading.value}`,
);
assert(deReading.note.toLowerCase().includes("liabilit"), deReading.note);
const noDe = debtToEquityReading({ facilitiesCaptured: false, equity: 150_000, facilityDebt: 0 });
assert(noDe.source === "none" && noDe.note.includes("Capture facilities"), noDe.note);
const tooShortRoa = presentReturn({
  ratioName: "Return on Assets",
  value: 1.4,
  periodMonths: 1,
  partMonth: true,
});
assert(
  scoredReturnHealth(tooShortRoa, 100) == null,
  "Asset Productivity does not score ROA when the period is too short",
);

const blankOcf = presentScorecardRatio({ name: "OCF / EBITDA", value: 0, cashFlowKnown: false });
assert(!blankOcf.include && blankOcf.unscored && blankOcf.scoredValue == null, "OCF 0 without a cash-flow statement is omitted");
const realZero = presentScorecardRatio({ name: "OCF / EBITDA", value: 0, cashFlowKnown: true });
assert(!realZero.unscored && realZero.scoredValue === 0, "a genuine zero from a cash-flow statement still scores");
const missingOcf = presentScorecardRatio({ name: "OCF / EBITDA", value: Number.NaN });
assert(!missingOcf.include && missingOcf.unscored, "a blank cash flow is omitted");

const qa = reportInputsFromFinancials({
  revenue: "120000",
  cogs: "45000",
  netIncome: "33000",
  ebit: "33000",
  totalAssets: "43000",
  payables: "10000",
  equity: "",
  operatingCashflow: "0",
});
assert(qa.equity === 33000 && qa.leverageReady, "derived equity reaches leverage inputs");
assert(qa.assetReady, "derived equity makes asset turnover, equity multiplier, and net margin finite");
assert(qa.unavailable.leverage == null && qa.unavailable.assets == null, "the cards are not blocked once equity is derived");
assert(qa.scalars.operatingCashflow === "", "a stored 0 cash flow without a statement is blank");

const sepYtd = defaultPeriodCoverage({ periodEnd: "2026-09-30", preClose: true });
assert(sepYtd.months === 9 && sepYtd.periodStart === "2026-01-01", `Sep YTD is 9 months, got ${sepYtd.months}`);
const part = defaultPeriodCoverage({ periodStart: "2026-09-01", periodEnd: "2026-09-21", preClose: true });
assert(part.months === 1, "1-21 Sep is one month, not calendar YTD");
const sepClosed = defaultPeriodCoverage({ periodEnd: "2026-09-30", preClose: false, fyStartMonth: 1 });
assert(
  sepClosed.months === 9 && sepClosed.periodStart === "2026-01-01",
  `a US September month-end is 9 months, got ${sepClosed.months} from ${sepClosed.periodStart}`,
);
const zaFeb = defaultPeriodCoverage({ periodEnd: "2026-02-28", fyStartMonth: 3 });
assert(
  zaFeb.months === 12 && zaFeb.periodStart === "2025-03-01",
  `a ZA February year-end stays 12 months, got ${zaFeb.months}`,
);
const explicitYear = defaultPeriodCoverage({
  periodStart: "2025-10-01",
  periodEnd: "2026-09-30",
  fyStartMonth: 1,
});
assert(explicitYear.months === 12, "an explicit October-to-September span stays 12 months");
const unlocked = effectivePeriodMonths(
  { periodMonths: "12", periodEnd: "2026-09-30" },
  { fyStartMonth: 1 },
);
assert(unlocked === 9, `an unlocked stored 12 follows September year-to-date, got ${unlocked}`);
const locked = effectivePeriodMonths(
  { periodMonths: "12", periodMonthsChosen: "1", periodEnd: "2026-09-30" },
  { fyStartMonth: 1 },
);
assert(locked === 12, "a chosen 12-month cover stays annual");
assert(
  defaultPeriodCoverage({ periodEnd: "2026-09-30", preClose: false }).months === 9,
  "a September month-end counts from January when no year start is passed",
);

const current = pickCurrentSnapshot([
  { period_label: "Oct 2026", period_date: "2026-10-31", created_at: "2026-08-01T00:00:00Z", source: "manual" },
  { period_label: "Sep 2026", period_date: "2026-09-30", created_at: "2026-10-02T00:00:00Z", source: "pdf_upload" },
]);
assert(current?.period_label === "Sep 2026", "the newest created snapshot wins over a later period label");
const pinned = pickCurrentSnapshot([
  { period_label: "Oct 2026", period_date: "2026-10-31", created_at: "2026-08-01T00:00:00Z", pinned: true },
  { period_label: "Sep 2026", period_date: "2026-09-30", created_at: "2026-10-02T00:00:00Z" },
]);
assert(pinned?.period_label === "Oct 2026", "a pin would win if one existed");

console.log("equity-coherence-test: ok");
