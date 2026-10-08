/**
 * Demo P&L and balance sheet CSVs must not cross-write fields.
 * Run: pnpm test:statement-parse
 */
import { readFileSync } from "node:fs";
import { computeOverallHealth } from "../src/lib/health-score";
import { periodProfitBridge } from "../src/lib/period-profit";
import {
  balanceSheetCashAsOf,
  mergeStatementFields,
  mergeStatementFinancials,
  parseStatementText,
} from "../src/lib/statement-parse";
import {
  buildAutoPopulateWrites,
  defaultAutoPopulatePrefs,
  prefsToRemember,
  statementAutoPopulatePrefs,
  summariseAutoPopulate,
} from "../src/lib/auto-populate";
import { ZA_MARKET } from "../src/lib/market";
import { formatCalendarDay } from "../src/lib/market/format";
import { rankStrategicMoves } from "../src/lib/strategic-moves";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const pl = readFileSync(
  new URL("./fixtures/demo-pl-sep-2026.csv", import.meta.url),
  "utf8",
);
const bs = readFileSync(
  new URL("./fixtures/demo-bs-30sep-2026.csv", import.meta.url),
  "utf8",
);

const income = parseStatementText(pl);
assert(income.kind === "income_statement", `P&L kind ${income.kind}`);
assert(income.companyName === "Practice Demo Client", `company ${income.companyName}`);
assert(income.periodLabel === "Jan–Sep 2026", `period ${income.periodLabel}`);
assert(income.periodMonths === 9, `months ${income.periodMonths}`);
assert(income.periodStart === "2026-01-01", `start ${income.periodStart}`);
assert(income.periodEnd === "2026-09-30", `end ${income.periodEnd}`);
assert(income.fields.interestExpense === "3600", `interest ${income.fields.interestExpense}`);
assert(income.fields.tax === "10200", `tax ${income.fields.tax}`);
assert(income.fields.ebt === "48400", `ebt ${income.fields.ebt}`);
assert(income.fields.revenue === "412000", `revenue ${income.fields.revenue}`);
assert(income.fields.cogs === "171000", `cogs ${income.fields.cogs}`);
assert(income.fields.grossProfit === "241000", `gp ${income.fields.grossProfit}`);
assert(income.fields.ebit === "52000", `oi ${income.fields.ebit}`);
assert(income.fields.netIncome === "38200", `ni ${income.fields.netIncome}`);
assert(income.fields.depreciation === "7500", `dep ${income.fields.depreciation}`);
assert(income.fields.ebitda === "59500", `ebitda ${income.fields.ebitda}`);
assert(income.derived.includes("ebitda"), "EBITDA is labelled derived");
assert(income.fields.laborCost === "118000", `labour ${income.fields.laborCost}`);
assert(income.fields.fixedCosts == null, "fixed costs are not synthesised from rent + salaries + insurance");
assert(income.fields.cash == null, "P&L does not invent cash");
assert(income.fields.totalAssets == null, "P&L does not invent assets");

const balance = parseStatementText(bs);
assert(balance.kind === "balance_sheet", `BS kind ${balance.kind}`);
assert(balance.companyName === "Practice Demo Client", `BS company ${balance.companyName}`);
assert(balance.fields.cash === "46300", `cash ${balance.fields.cash}`);
assert(balance.fields.receivables === "38900", `ar ${balance.fields.receivables}`);
assert(balance.fields.inventory === "29400", `inv ${balance.fields.inventory}`);
assert(balance.fields.totalAssets === "179200", `ta ${balance.fields.totalAssets}`);
assert(balance.fields.shortTermDebt === "8000", `current ltd ${balance.fields.shortTermDebt}`);
assert(balance.fields.ebt == null, "current portion of long-term debt is not EBT");
assert(balance.fields.revenue == null, "BS has no revenue");
assert(balance.fields.interestExpense == null, "BS has no interest");
assert(balance.fields.tax == null, "BS has no tax");
assert(balance.fields.netIncome == null, "BS has no net income");
assert(balance.fields.ebit == null, "BS has no EBIT");

const poisoned = mergeStatementFields(balance, { ebt: "8000", cash: "1", revenue: "999" }, bs);
assert(poisoned.ebt == null, "AI cannot put EBT on a balance sheet");
assert(poisoned.revenue == null, "AI cannot put revenue on a balance sheet");
assert(poisoned.cash === "46300", `parser cash wins, got ${poisoned.cash}`);

const stored = defaultAutoPopulatePrefs();
const bsPrefs = statementAutoPopulatePrefs(stored, "balance_sheet");
assert(bsPrefs.profitability === false && bsPrefs.budget === false, "BS cross-statement toggles default off");
assert(bsPrefs.cash_forecast === true, "BS still offers the cash forecast");
const remembered = prefsToRemember(bsPrefs, "balance_sheet", stored);
assert(remembered.profitability === true && remembered.budget === true, "forced-off toggles are not stored");
const plPrefs = statementAutoPopulatePrefs(stored, "income_statement");
assert(plPrefs.cash_forecast === false && plPrefs.profitability === true, "P&L does not default the cash forecast on");

const broken = periodProfitBridge({ ebit: "52000", ebt: "8000", netIncome: "38200" });
assert(broken.interestIsFact === false && broken.taxIsFact === false, "negative derived tax is not a fact");
assert(broken.interest === 0 && broken.tax === 0, "untrusted derived interest and tax are not emitted");
assert(broken.interestBurdenUsable === false, "Next Moves cannot use the broken interest bridge");
const moves = rankStrategicMoves({
  healthByKey: { interestBurden: 15, operatingMargin: 70 },
  suppressKeys: broken.interestBurdenUsable ? undefined : ["interestBurden"],
});
assert(!moves.some((move) => move.key === "interestBurden"), "debt drag is dropped when interest is not a fact");

const sound = periodProfitBridge({ ebit: "52000", ebt: "48400", netIncome: "38200" });
assert(sound.interest === 3600 && sound.tax === 10200, `sound bridge ${sound.interest}/${sound.tax}`);
assert(sound.interestIsFact && sound.taxIsFact && sound.interestBurdenUsable, "a tying bridge stays a fact");

const unscored = computeOverallHealth({ cashRunwayWeeks: 13, cashBalance: null });
const cashPillar = unscored.pillars.find((pillar) => pillar.id === "cash");
assert(cashPillar?.score == null, `cash pillar without cash scored ${cashPillar?.score}`);
const scored = computeOverallHealth({ cashRunwayWeeks: 13, cashBalance: 46300 });
const now = "2026-10-08T00:00:00.000Z";
const cashPatch = buildAutoPopulateWrites(
  { profitability: false, cash_forecast: true, budget: false },
  {
    fields: { cash: balance.fields.cash },
    existingCashflow: {
      openingBalance: "0",
      startDate: "2026-10-05",
      revenue: [],
      expenses: [],
    },
    market: ZA_MARKET,
    now,
  },
);
assert(cashPatch.applied.includes("cash_forecast"), "balance-sheet cash refreshes the forecast");
assert(
  !cashPatch.applied.includes("profitability") && !cashPatch.applied.includes("budget"),
  "balance-sheet cash does not refresh profitability or the budget",
);
assert(
  (cashPatch.update.cashflow as { openingBalance?: string }).openingBalance === "46300",
  `forecast opening ${String((cashPatch.update.cashflow as { openingBalance?: string } | undefined)?.openingBalance)}`,
);
const typedOpening = buildAutoPopulateWrites(
  { profitability: false, cash_forecast: true, budget: false },
  {
    fields: { cash: "46300" },
    existingCashflow: { openingBalance: "12000", startDate: "2026-10-05", revenue: [], expenses: [] },
    market: ZA_MARKET,
    now,
  },
);
assert(!("cashflow" in typedOpening.update), "a typed opening is left alone");
assert(scored.pillars.find((pillar) => pillar.id === "cash")?.score === 85, "known cash still scores runway");

function blankedImport(
  parsed: Record<string, string | undefined>,
  kind: "income_statement" | "balance_sheet",
): Record<string, string> {
  const incomeKeys = ["revenue", "cogs", "netIncome", "ebit", "ebitda", "ebt", "grossProfit", "fixedCosts", "laborCost"];
  const balanceKeys = ["cash", "receivables", "inventory", "payables", "totalAssets", "equity", "currentAssets", "currentLiabilities", "totalLiabilities"];
  const incoming: Record<string, string> = {};
  for (const key of [...incomeKeys, ...balanceKeys]) incoming[key] = "";
  const own = kind === "income_statement" ? incomeKeys : balanceKeys;
  for (const key of own) {
    const value = parsed[key];
    if (value) incoming[key] = value;
  }
  return incoming;
}

const plImport = blankedImport(income.fields, "income_statement");
const bsImport = blankedImport(balance.fields, "balance_sheet");
const afterPl = mergeStatementFinancials(null, plImport, "income_statement");
const plThenBs = mergeStatementFinancials(afterPl, bsImport, "balance_sheet");
for (const key of ["revenue", "cogs", "netIncome", "ebit", "ebitda", "ebt"] as const) {
  assert(plThenBs[key] === income.fields[key], `P&L then BS keeps ${key} (${String(plThenBs[key])})`);
}
assert(plThenBs.cash === "46300", `P&L then BS adds cash (${String(plThenBs.cash)})`);
assert(plThenBs.totalAssets === "179200", `P&L then BS adds assets (${String(plThenBs.totalAssets)})`);
assert(plThenBs.receivables === "38900", "P&L then BS adds receivables");
assert(String(plThenBs.revenue) !== "", "P&L then BS does not blank revenue");

const afterBs = mergeStatementFinancials(null, bsImport, "balance_sheet");
const bsThenPl = mergeStatementFinancials(afterBs, plImport, "income_statement");
assert(bsThenPl.cash === "46300", "BS then P&L keeps cash");
assert(bsThenPl.totalAssets === "179200", "BS then P&L keeps total assets");
assert(bsThenPl.equity === balance.fields.equity, "BS then P&L keeps equity");
assert(bsThenPl.revenue === "412000", "BS then P&L adds revenue");
assert(bsThenPl.netIncome === "38200", "BS then P&L adds net income");

const replUpload = mergeStatementFinancials(
  plThenBs,
  { ...plImport, revenue: "500000", netIncome: "40000" },
  "income_statement",
);
assert(replUpload.revenue === "500000", "re-uploading a P&L updates revenue");
assert(replUpload.netIncome === "40000", "re-uploading a P&L updates net income");
assert(replUpload.cash === "46300", "re-uploading a P&L keeps cash");
const rebsUpload = mergeStatementFinancials(plThenBs, { ...bsImport, cash: "50000" }, "balance_sheet");
assert(rebsUpload.cash === "50000", "re-uploading a balance sheet updates cash");
assert(rebsUpload.revenue === "412000", "re-uploading a balance sheet keeps revenue");
assert(rebsUpload.cogs === "171000", "re-uploading a balance sheet keeps cogs");

const poisonedSnapshot = mergeStatementFinancials(
  { revenue: "412000", cash: "1", fieldSources: { revenue: "income_statement" } },
  { revenue: "999", cash: "46300", cogs: "", fieldSources: { revenue: "balance_sheet", cash: "balance_sheet" } },
  "balance_sheet",
);
assert(poisonedSnapshot.revenue === "412000", "a balance sheet cannot overwrite revenue");
const sources = poisonedSnapshot.fieldSources as Record<string, string>;
assert(sources.revenue === "income_statement", "untouched revenue keeps its source");
assert(sources.cash === "balance_sheet", "rewritten cash takes the new source");

const datedOpening = buildAutoPopulateWrites(
  { profitability: false, cash_forecast: true, budget: false },
  {
    fields: { cash: "46300", revenue: "412000", netIncome: "38200" },
    existingCashflow: {
      openingBalance: "0",
      startDate: "2026-10-05",
      revenue: [],
      expenses: [],
    },
    market: ZA_MARKET,
    now,
    statementKind: "balance_sheet",
    cashOpeningDate: "2026-09-30",
  },
);
const datedCash = datedOpening.update.cashflow as { openingBalance?: string; startDate?: string } | undefined;
assert(datedCash?.openingBalance === "46300", "balance-sheet cash still sets the opening");
assert(datedCash?.startDate === "2026-09-30", `opening is dated on the balance sheet (${datedCash?.startDate})`);
assert(!("budget" in datedOpening.update), "balance-sheet cash does not rewrite the budget");
assert(
  summariseAutoPopulate(datedOpening, false).includes("cash forecast"),
  `ticked cash forecast is named in the toast (${summariseAutoPopulate(datedOpening, false)})`,
);

// A non-zero opening used to be treated as typed, so a ticked Cash forecast
// box saved the balance sheet and then said nothing else was updated.
const typedSheet = buildAutoPopulateWrites(
  { profitability: false, cash_forecast: true, budget: false },
  {
    fields: { cash: "46300" },
    existingCashflow: { openingBalance: "12000", startDate: "2026-10-05", revenue: [], expenses: [] },
    market: ZA_MARKET,
    now,
    statementKind: "balance_sheet",
    cashOpeningDate: "2026-09-30",
  },
);
const typedCash = typedSheet.update.cashflow as { openingBalance?: string; startDate?: string } | undefined;
assert(typedSheet.applied.includes("cash_forecast"), "a ticked balance-sheet cash forecast is applied");
assert(typedCash?.openingBalance === "46300" && typedCash?.startDate === "2026-09-30", "typed opening takes the statement cash and date");
assert(
  summariseAutoPopulate(typedSheet, false).startsWith("Updated cash forecast"),
  summariseAutoPopulate(typedSheet, false),
);

const already = buildAutoPopulateWrites(
  { profitability: false, cash_forecast: true, budget: false },
  {
    fields: { cash: "46300" },
    existingCashflow: { openingBalance: "46300", startDate: "2026-09-30", revenue: [], expenses: [] },
    market: ZA_MARKET,
    now,
    statementKind: "balance_sheet",
    cashOpeningDate: "2026-09-30",
  },
);
assert(!already.applied.includes("cash_forecast"), "an opening that already matches is not rewritten");
assert(
  summariseAutoPopulate(already, false) ===
    "Figures saved. Cash forecast already matched this balance sheet.",
  summariseAutoPopulate(already, false),
);

const bsDated = mergeStatementFinancials(
  { revenue: "412000", periodEnd: "2026-08-31" },
  { cash: "46300", periodEnd: "2026-09-30", receivables: "38900" },
  "balance_sheet",
);
assert(bsDated.cashAsOf === "2026-09-30", `cash keeps the balance-sheet date (${String(bsDated.cashAsOf)})`);
assert(bsDated.revenue === "412000", "dating cash does not drop revenue");
const plAfterDated = mergeStatementFinancials(
  bsDated,
  { revenue: "500000", periodEnd: "2026-10-31" },
  "income_statement",
);
assert(plAfterDated.cashAsOf === "2026-09-30", "a later P&L does not move the cash date");
assert(plAfterDated.periodEnd === "2026-10-31", "a later P&L still updates its own period end");
const weekLabel = formatCalendarDay("2026-10-05", { locale: "en-US" }, { day: "2-digit", month: "short" });
const sheetLabel = formatCalendarDay(
  balanceSheetCashAsOf({ cash: "46300", cashAsOf: "2026-09-30" }, 46300) ?? "",
  { locale: "en-US" },
  { day: "2-digit", month: "short" },
);
assert(weekLabel.includes("Oct") && weekLabel.includes("05"), `week label ${weekLabel}`);
assert(sheetLabel.includes("Sep") && sheetLabel.includes("30"), `opening label ${sheetLabel}`);
assert(
  balanceSheetCashAsOf({ cash: "46300", cashAsOf: "2026-09-30" }, 12000) === null,
  "a different opening keeps the week label",
);
assert(
  balanceSheetCashAsOf({ cash: "46300", periodEnd: "2026-09-30" }, 46300) === "2026-09-30",
  "older snapshots fall back to the period end when cashAsOf was never stored",
);
assert(
  balanceSheetCashAsOf({ cash: "46300", cashAsOf: "2026-09-30", periodEnd: "2026-10-31" }, 46300) ===
    "2026-09-30",
  "a stored cash date wins over a later period end",
);
assert(
  balanceSheetCashAsOf({ cash: "46300", periodEnd: "2026-09-30" }, 12000) === null,
  "a period end does not label a different opening",
);

const uploadCard = readFileSync(new URL("../src/components/upload-financials.tsx", import.meta.url), "utf8");
assert(uploadCard.includes('result.statement_basis !== "unknown"'), "unknown basis chip is hidden");
assert(uploadCard.includes("clientName"), "import card shows the client name");
assert(uploadCard.includes("File header:"), "parsed header name stays secondary");
assert(uploadCard.includes("statementAutoPopulatePrefs"), "toggles are set once the statement type is known");
const signupCopy = readFileSync(new URL("../src/lib/firm-signup-copy.ts", import.meta.url), "utf8");
assert(signupCopy.includes("Required. Your practice's state."), "state hint says the field is required");

console.log("statement-parse: ok");
