/**
 * Accountant QA retest (#279): bank-file routing, statement footer,
 * customer recurrence, opening-cash roll-forward, and overview grounding.
 * Run: pnpm test:accountant-qa-retest
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildDraftLinesFromExtract,
  isStatementBalanceRow,
  reviewCashTotals,
} from "../src/lib/cash-from-banks.pattern";
import { buildCashflowPublishPayload } from "../src/lib/cash-from-banks.publish";
import { splitDraftLine } from "../src/lib/cash-from-banks.workspace";
import { closingBalancesFromCashflow } from "../src/lib/cash-runway";
import { rollBankDraftOpening } from "../src/lib/client-metrics";
import type { CashBankExtract, CashBucket, CashStatementTransaction } from "../src/lib/cash-from-banks.types";
import {
  buildOverviewBrief,
  formatOverviewForPrompt,
} from "../supabase/functions/ask-ai/overview-brief.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function read(path: string) {
  return readFileSync(resolve(path), "utf8");
}

function txn(partial: {
  txn_date: string;
  amount: number;
  direction: "in" | "out";
  description: string;
  counterparty?: string | null;
  ai_bucket: CashBucket;
  excluded?: boolean;
}): CashStatementTransaction {
  return {
    counterparty: partial.counterparty ?? null,
    excluded: partial.excluded ?? false,
    ...partial,
  };
}

/**
 * Reproduces the Jul–Sep QA footer: median × count is In 172,900 / Out 130,011
 * while the transactions sum to 171,900 / 128,450.
 * In +1,000 is Northwind 8,800 + 9,800 + 9,800 (median 9,800 × 3).
 * Out +1,561 is Wholesale 7,200 × 2 + 6,120 and Utilities 2,726 + 3,207 × 2.
 */
const extract: CashBankExtract = {
  period_start: "2026-07-01",
  period_end: "2026-09-30",
  opening_balance: 85_000,
  closing_balance: 128_450,
  currency: "USD",
  notes: null,
  transactions: [
    txn({
      txn_date: "2026-07-01",
      amount: 85_000,
      direction: "in",
      description: "Opening balance",
      ai_bucket: "other",
    }),
    txn({
      txn_date: "2026-07-12",
      amount: 8_800,
      direction: "in",
      description: "Customer receipt Northwind",
      counterparty: "Customer receipt Northwind",
      ai_bucket: "trading",
    }),
    txn({
      txn_date: "2026-08-11",
      amount: 9_800,
      direction: "in",
      description: "Northwind INV-1042",
      counterparty: "Northwind INV-1042",
      ai_bucket: "other",
    }),
    txn({
      txn_date: "2026-09-10",
      amount: 9_800,
      direction: "in",
      description: "Northwind",
      counterparty: "Northwind",
      ai_bucket: "trading",
    }),
    txn({
      txn_date: "2026-07-09",
      amount: 8_850,
      direction: "in",
      description: "Acme Corp receipt",
      counterparty: "Acme Corp receipt",
      ai_bucket: "trading",
    }),
    txn({
      txn_date: "2026-08-08",
      amount: 8_850,
      direction: "in",
      description: "ACME payment",
      counterparty: "ACME payment",
      ai_bucket: "other",
    }),
    txn({
      txn_date: "2026-09-08",
      amount: 8_850,
      direction: "in",
      description: "Acme",
      counterparty: "Acme",
      ai_bucket: "trading",
    }),
    txn({
      txn_date: "2026-07-02",
      amount: 116_950,
      direction: "in",
      description: "Equipment sale",
      counterparty: "Equipment sale",
      ai_bucket: "other",
    }),
    txn({
      txn_date: "2026-07-28",
      amount: 30_000,
      direction: "out",
      description: "Salaries Payroll",
      counterparty: "Salaries Payroll",
      ai_bucket: "payroll",
    }),
    txn({
      txn_date: "2026-08-28",
      amount: 30_000,
      direction: "out",
      description: "Salaries Payroll",
      counterparty: "Salaries Payroll",
      ai_bucket: "payroll",
    }),
    txn({
      txn_date: "2026-09-28",
      amount: 30_000,
      direction: "out",
      description: "Salaries Payroll",
      counterparty: "Salaries Payroll",
      ai_bucket: "payroll",
    }),
    txn({
      txn_date: "2026-07-15",
      amount: 7_200,
      direction: "out",
      description: "Wholesale Supplier",
      counterparty: "Wholesale Supplier",
      ai_bucket: "cos",
    }),
    txn({
      txn_date: "2026-08-15",
      amount: 7_200,
      direction: "out",
      description: "Wholesale Supplier",
      counterparty: "Wholesale Supplier",
      ai_bucket: "cos",
    }),
    txn({
      txn_date: "2026-09-15",
      amount: 6_120,
      direction: "out",
      description: "Wholesale Supplier",
      counterparty: "Wholesale Supplier",
      ai_bucket: "cos",
    }),
    txn({
      txn_date: "2026-07-20",
      amount: 2_726,
      direction: "out",
      description: "City Utilities",
      counterparty: "City Utilities",
      ai_bucket: "opex",
    }),
    txn({
      txn_date: "2026-08-20",
      amount: 3_207,
      direction: "out",
      description: "City Utilities",
      counterparty: "City Utilities",
      ai_bucket: "opex",
    }),
    txn({
      txn_date: "2026-09-20",
      amount: 3_207,
      direction: "out",
      description: "City Utilities",
      counterparty: "City Utilities",
      ai_bucket: "opex",
    }),
    txn({
      txn_date: "2026-07-03",
      amount: 199,
      direction: "out",
      description: "Software",
      counterparty: "Software",
      ai_bucket: "opex",
    }),
    txn({
      txn_date: "2026-08-03",
      amount: 199,
      direction: "out",
      description: "Software",
      counterparty: "Software",
      ai_bucket: "opex",
    }),
    txn({
      txn_date: "2026-09-03",
      amount: 199,
      direction: "out",
      description: "Software",
      counterparty: "Software",
      ai_bucket: "opex",
    }),
    txn({
      txn_date: "2026-07-06",
      amount: 8_193,
      direction: "out",
      description: "Insurance",
      counterparty: "Insurance",
      ai_bucket: "opex",
    }),
    txn({
      txn_date: "2026-09-30",
      amount: 128_450,
      direction: "in",
      description: "Closing balance",
      ai_bucket: "other",
    }),
    txn({
      txn_date: "2026-08-01",
      amount: 2_500,
      direction: "out",
      description: "Transfer to savings",
      counterparty: "Internal transfer",
      ai_bucket: "transfer",
      excluded: false,
    }),
  ],
};

assert(
  extract.transactions.some((row) => isStatementBalanceRow(row) && row.amount === 85_000),
  "opening balance row is recognised",
);
assert(
  extract.transactions.some((row) => isStatementBalanceRow(row) && row.amount === 128_450),
  "closing balance row is recognised",
);

const lines = buildDraftLinesFromExtract(extract);
assert(
  !lines.some((line) => line.amount === 85_000 || line.amount === 128_450),
  "opening and closing balance rows are not draft lines",
);

function naiveTotals(rows: typeof lines) {
  let inflow = 0;
  let outflow = 0;
  for (const line of rows) {
    if (line.status === "excluded") continue;
    const period = Math.abs(line.amount) * Math.max(1, line.txn_count || 1);
    if (line.side === "inflow") inflow += period;
    else outflow += period;
  }
  return { inflow, outflow };
}

const naive = naiveTotals(lines);
assert(naive.inflow === 172_900, `median × count inflows are 172900, got ${naive.inflow}`);
assert(naive.outflow === 130_011, `median × count outflows are 130011, got ${naive.outflow}`);

const totals = reviewCashTotals(lines);
assert(totals.inflow === 171_900, `footer inflows are the transaction sum, got ${totals.inflow}`);
assert(totals.outflow === 128_450, `footer outflows are the transaction sum, got ${totals.outflow}`);

const transfer = lines.find((line) => line.bucket === "transfer");
assert(transfer?.status === "excluded", "a transfer is not added on top of the movement total");

const northwind = lines.find((line) => /northwind/i.test(line.name));
assert(northwind, "Northwind is one line");
const split = splitDraftLine(lines, northwind!.id);
const splitTotals = reviewCashTotals(split);
assert(splitTotals.inflow === totals.inflow, "splitting a line does not double the inflow footer");
assert(splitTotals.outflow === totals.outflow, "splitting a line does not double the outflow footer");

function findLine(pattern: RegExp) {
  const line = lines.find((row) => pattern.test(row.name) && row.status !== "excluded");
  assert(line, `missing ${pattern}`);
  return line!;
}

const customers = [findLine(/northwind/i), findLine(/acme/i)];
for (const line of customers) {
  assert(line.side === "inflow", `${line.name} is an inflow`);
  assert(line.cadence === "monthly", `${line.name} is monthly, got ${line.cadence}`);
  assert(line.txn_count === 3, `${line.name} keeps its three receipts`);
  assert(line.start_week === 2, `${line.name} lands in week ${line.start_week}, expected week 2`);
}

const salaries = findLine(/salaries payroll/i);
assert(salaries.cadence === "monthly", `salaries cadence ${salaries.cadence}`);
assert(salaries.side === "outflow", "salaries stay an outflow");
assert(salaries.amount === 30_000, `salaries amount ${salaries.amount}`);
assert(salaries.start_week === 4, `salaries week ${salaries.start_week}, expected week 4`);
assert(salaries.txn_count === 3, "three salary months");
assert(salaries.confidence >= 0.85, `salaries confidence ${salaries.confidence}`);

const wholesale = findLine(/wholesale/i);
assert(wholesale.cadence === "monthly" && wholesale.start_week === 3, "supplier is monthly in week 3");
const utilities = findLine(/utilities/i);
assert(utilities.cadence === "monthly", "utilities are monthly");
const software = findLine(/^software$/i);
assert(software.cadence === "monthly" && software.amount === 199, "software subscription is monthly");
assert(software.start_week === 1, "a 3rd-of-month payment stays in week 1");

const published = buildCashflowPublishPayload({
  lines,
  startDate: "2026-10-05",
  openingBalance: 128_450,
  policy: "replace",
});
const publishedNorth = published.revenue.find((row) => /northwind/i.test(row.name));
assert(publishedNorth?.frequency === "recurring-monthly", "Northwind publishes as monthly");
assert(publishedNorth?.startWeek === 2, "Northwind publishes into week 2");

const northClosings = closingBalancesFromCashflow({
  openingBalance: "0",
  revenue: publishedNorth ? [publishedNorth] : [],
  expenses: [],
  other: [],
});
const northWeeks = northClosings!.map((closing, index) => {
  const prev = index === 0 ? 0 : northClosings![index - 1]!;
  return Math.round(closing - prev);
});
assert(northWeeks[0] === 0, `week 1 does not take the Northwind receipts, got ${northWeeks[0]}`);
assert(northWeeks[1] === 9_800, `week 2 is one Northwind receipt, got ${northWeeks[1]}`);
assert(!northWeeks.some((value) => value === 28_400), "week 1 does not take the whole customer series");

const stay = rollBankDraftOpening({
  statementEnd: "2026-09-30",
  anchor: "2026-10-05",
  closing: 128_450,
  lines: [
    { name: "Salaries Payroll", amount: 30_000, cadence: "monthly", side: "outflow", status: "proposed" },
  ],
});
assert(stay.opening === 128_450, `opening stays the bank closing, got ${stay.opening}`);
assert(stay.gapDays === 4, `gap is 4 days, got ${stay.gapDays}`);
assert(stay.adjustment === 0, "the default path applies no adjustment");
assert(!/rolled forward/i.test(stay.note ?? ""), stay.note ?? "missing stay note");

const opted = rollBankDraftOpening({
  statementEnd: "2026-09-30",
  anchor: "2026-10-05",
  closing: 128_450,
  rollForward: true,
  lines: [
    { name: "Salaries Payroll", amount: 30_000, cadence: "monthly", side: "outflow", status: "proposed" },
  ],
});
assert(opted.opening < 128_450, "opt-in roll-forward moves opening cash");
assert(opted.items.some((item) => /salaries/i.test(item.name) && item.contribution < 0), "the salary deduction is listed");
assert(
  Math.abs(opted.opening - (128_450 + opted.adjustment)) < 0.02,
  `opening is closing plus the listed adjustment, got ${opted.opening}`,
);
assert(/rolled forward 4 days/i.test(opted.note ?? ""), opted.note ?? "missing roll note");

const studio = read("src/routes/_authenticated/clients.$clientId.tsx");
const handler = studio.slice(
  studio.indexOf("onOpenBankUpload={(file)"),
  studio.indexOf("autoPopulate=", studio.indexOf("onOpenBankUpload={(file)")),
);
assert(handler.includes('setActiveTab("cash")'), "a bank file opens 13-week cash");
assert(handler.includes("setCashBankUploadToken"), "a bank file opens Upload bank statements");
assert(handler.includes("setPendingBankFile(file)"), "the same file is pre-loaded");
assert(!handler.includes("setShowBankDrafter(true)"), "a bank file does not open a P&L draft");

const owner = read("src/routes/app.tsx");
const dialog = owner.slice(
  owner.indexOf("open={bankLedgerBlocked}"),
  owner.indexOf("Bank statement → draft financials"),
);
assert(dialog.includes("setShowCashFromBanks(true)"), "owner bank card opens the cash upload");
assert(dialog.includes('setActiveTab("cash")'), "owner bank card opens Cash Forecast");
assert(dialog.includes("setPendingCashBankFile"), "owner pre-loads the rejected file");
assert(!dialog.includes("setShowBankDrafter(true)"), "owner bank card does not open a P&L draft");

const server = read("src/lib/cash-from-banks.server.ts");
const rollBlock = server.slice(
  server.indexOf("const rolledOpening"),
  server.indexOf("openingBalance: rolledOpening.opening"),
);
assert(!rollBlock.includes("warnings.push"), "the draft does not warn that it rolled the opening");

const workspace = read("src/components/cash-classification-workspace.tsx");
assert(workspace.includes("Roll those days forward from recurring lines"), "roll-forward is opt-in");
assert(workspace.includes("not a bank transaction"), "roll-forward lists why each figure moved");

const brief = buildOverviewBrief({
  financials: {
    equity: "90000",
    totalAssets: 250_000,
    totalLiabilities: 160_000,
    revenue: 200_000,
    cogs: 80_000,
    periodMonths: "3",
  },
  runwayWeeks: 18,
  runwayLabel: "18 weeks",
  copyPack: "us",
  clientName: "QA US Test LLC",
});
const prompt = formatOverviewForPrompt(brief, "accountant");
assert(prompt.includes("Total equity: $90,000"), prompt);
assert(prompt.includes("Total assets: $250,000"), prompt);
assert(prompt.includes("Total liabilities: $160,000"), prompt);
assert(prompt.includes("Gross margin:"), "gross margin stays in Overview Figures");
assert(prompt.includes("Cash runway: 18 weeks"), prompt);

console.log("accountant-qa-retest: ok");
