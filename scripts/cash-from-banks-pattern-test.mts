/**
 * Smoke test for bank → cash forecast pattern engine.
 * Run: pnpm exec vite-node --config scripts/vite-test.config.ts scripts/cash-from-banks-pattern-test.mts
 */
import {
  buildDraftLinesFromExtract,
  nextForecastStartDate,
  resolveOpeningBalance,
} from "../src/lib/cash-from-banks.pattern";
import { buildCashflowPublishPayload } from "../src/lib/cash-from-banks.publish";
import type { CashBankExtract } from "../src/lib/cash-from-banks.types";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const extract: CashBankExtract = {
  period_start: "2026-05-01",
  period_end: "2026-07-31",
  opening_balance: 50000,
  closing_balance: 72500,
  currency: "ZAR",
  notes: null,
  transactions: [
    // Weekly salary-like outflows
    ...["2026-05-02", "2026-05-09", "2026-05-16", "2026-05-23", "2026-05-30", "2026-06-06"].map(
      (d) => ({
        txn_date: d,
        amount: 12000,
        direction: "out" as const,
        description: "PAYROLL SALARIES",
        counterparty: "Payroll",
        ai_bucket: "payroll" as const,
        excluded: false,
      }),
    ),
    // Monthly rent
    ...["2026-05-01", "2026-06-01", "2026-07-01"].map((d) => ({
      txn_date: d,
      amount: 8500,
      direction: "out" as const,
      description: "RENT OFFICE PARK",
      counterparty: "Office Park Pty",
      ai_bucket: "rent" as const,
      excluded: false,
    })),
    // Trading inflows monthly-ish
    ...["2026-05-15", "2026-06-14", "2026-07-16"].map((d) => ({
      txn_date: d,
      amount: 45000,
      direction: "in" as const,
      description: "CUSTOMER RECEIPT ACME",
      counterparty: "Acme Client",
      ai_bucket: "trading" as const,
      excluded: false,
    })),
    // Transfer should exclude
    {
      txn_date: "2026-06-10",
      amount: 20000,
      direction: "out" as const,
      description: "TRANSFER TO SAVINGS",
      counterparty: "Own Savings",
      ai_bucket: "transfer" as const,
      excluded: true,
    },
    // Once-off capex
    {
      txn_date: "2026-07-20",
      amount: 15000,
      direction: "out" as const,
      description: "LAPTOP PURCHASE",
      counterparty: "Takealot",
      ai_bucket: "capex" as const,
      excluded: false,
    },
  ],
};

const lines = buildDraftLinesFromExtract(extract);
assert(lines.length >= 4, "expected grouped lines");
const payroll = lines.find((l) => l.bucket === "payroll");
assert(payroll?.cadence === "weekly", `payroll should be weekly, got ${payroll?.cadence}`);
assert(payroll?.status === "proposed", "payroll should be proposed");
const rent = lines.find((l) => l.bucket === "rent");
assert(rent?.cadence === "monthly", `rent should be monthly, got ${rent?.cadence}`);
const transfer = lines.find((l) => l.bucket === "transfer");
assert(transfer?.status === "excluded", "transfer should be excluded");
const capex = lines.find((l) => l.bucket === "capex");
assert(capex?.cadence === "once_off", "capex once-off");

assert(resolveOpeningBalance(extract) === 72500, "prefer closing balance");
assert(nextForecastStartDate("2026-07-31") === "2026-08-01", "start day after period end");

const payload = buildCashflowPublishPayload({
  lines,
  startDate: "2026-08-01",
  openingBalance: 72500,
});
assert(payload.openingBalance === "72500", "opening balance string");
assert(payload.revenue.some((r) => r.name.toLowerCase().includes("acme")), "revenue seeded");
assert(payload.expenses.some((e) => e.frequency === "recurring-weekly"), "weekly expense");
assert(payload.other.some((o) => /laptop|takealot|capex/i.test(o.name)), "capex in other");

console.log(`ok — ${lines.length} draft lines from ${extract.transactions.length} txns`);
