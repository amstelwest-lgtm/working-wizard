/**
 * Demo P&L and balance sheet CSVs must not cross-write fields.
 * Run: pnpm test:statement-parse
 */
import { readFileSync } from "node:fs";
import { computeOverallHealth } from "../src/lib/health-score";
import { periodProfitBridge } from "../src/lib/period-profit";
import {
  mergeStatementFields,
  parseStatementText,
} from "../src/lib/statement-parse";
import {
  buildAutoPopulateWrites,
  defaultAutoPopulatePrefs,
  prefsToRemember,
  statementAutoPopulatePrefs,
} from "../src/lib/auto-populate";
import { ZA_MARKET } from "../src/lib/market";
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

console.log("statement-parse: ok");
