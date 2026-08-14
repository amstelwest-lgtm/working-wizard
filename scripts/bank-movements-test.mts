/**
 * Unit tests for movements trial balance + bank balance tie-out.
 */
import {
  buildMovementsTrialBalance,
  checkBankBalanceTieOut,
} from "../src/lib/bank-movements.ts";
import type { CashBankExtract } from "../src/lib/cash-from-banks.types.ts";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed += 1;
  } else {
    console.log("ok:", msg);
  }
}

const extract: CashBankExtract = {
  period_start: "2026-01-01",
  period_end: "2026-03-31",
  opening_balance: 100_000,
  closing_balance: 120_000,
  currency: "ZAR",
  notes: null,
  transactions: [
    {
      txn_date: "2026-01-15",
      amount: 50_000,
      direction: "in",
      description: "Sales",
      counterparty: "Customer",
      ai_bucket: "trading",
      excluded: false,
      account_label: "Cheque",
    },
    {
      txn_date: "2026-02-01",
      amount: 30_000,
      direction: "out",
      description: "Payroll",
      counterparty: "Staff",
      ai_bucket: "payroll",
      excluded: false,
      account_label: "Cheque",
    },
  ],
  accounts: [
    {
      account_label: "Cheque",
      opening_balance: 100_000,
      closing_balance: 120_000,
      file_names: ["jan.pdf"],
    },
  ],
};

// 100k + 50k - 30k = 120k → ties
const check = checkBankBalanceTieOut(100_000, 120_000, extract.transactions, "Cheque");
assert(check.ok, "balance check ties when opening+in-out=closing");
assert(check.expectedClosing === 120_000, `expected closing ${check.expectedClosing}`);

const bad = checkBankBalanceTieOut(100_000, 999_000, extract.transactions, "Cheque");
assert(!bad.ok, "balance check fails on mismatch");

const tb = buildMovementsTrialBalance(extract, [
  {
    accountLabel: "Cheque",
    openingBalance: 100_000,
    closingBalance: 120_000,
    fileNames: ["jan.pdf"],
  },
]);
assert(tb.lines[0].key === "opening", "first line is opening");
assert(tb.lines.some((l) => l.key === "trading" && l.credit === 50_000), "trading credit");
assert(tb.lines.some((l) => l.key === "payroll" && l.debit === 30_000), "payroll debit");
assert(tb.lines.at(-1)?.key === "closing", "last line is closing");
assert(tb.allOk, "movements allOk when consolidated ties");

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall bank-movements checks passed");
