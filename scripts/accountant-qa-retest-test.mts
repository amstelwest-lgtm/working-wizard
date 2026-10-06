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
import type { ExtractionResult } from "../src/lib/financialSchema";
import { MILON_UNREACHABLE, friendlyReachMessage } from "../src/lib/reach-error";
import { periodFinancialsFromExtraction } from "../src/lib/statement-financials";
import { classify } from "../supabase/functions/ask-ai/classifier.ts";
import {
  buildOverviewBrief,
  formatOverviewForPrompt,
} from "../supabase/functions/ask-ai/overview-brief.ts";
import { buildPrompt, sealAskAiPrompt } from "../supabase/functions/ask-ai/prompt.ts";
import { BOT_SYSTEM } from "../supabase/functions/milon-bot/logic.ts";
import { buildMilonBotChatPayload } from "../supabase/functions/milon-bot/prompt.ts";
import { shapeSnapshot } from "../supabase/functions/milon-bot/tools.ts";

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
assert(!prompt.includes("(derived)"), "a stored liability total is not labelled derived");

/**
 * Prod retest fixture. Amounts vary, and Acme has two receipts in July, so the
 * 15% similar-amount gate and the 21–40 day gap both miss. Narrations are the
 * variants the statement parser emits. buildDraftLinesFromExtract is the
 * function cash-from-banks.server.ts calls; the review dialog only displays
 * the cadence on those lines.
 */
const varying: CashBankExtract = {
  period_start: "2026-07-01",
  period_end: "2026-09-30",
  opening_balance: 85_000,
  closing_balance: 128_450,
  currency: "USD",
  notes: null,
  transactions: [
    txn({
      txn_date: "2026-07-02",
      amount: 8_500,
      direction: "in",
      description: "Customer receipt Acme",
      counterparty: "Customer receipt Acme",
      ai_bucket: "trading",
    }),
    txn({
      txn_date: "2026-07-16",
      amount: 9_200,
      direction: "in",
      description: "ACME payment",
      counterparty: "ACME payment",
      ai_bucket: "other",
    }),
    txn({
      txn_date: "2026-08-03",
      amount: 10_200,
      direction: "in",
      description: "Acme Corp receipt",
      counterparty: "Acme Corp receipt",
      ai_bucket: "trading",
    }),
    txn({
      txn_date: "2026-09-02",
      amount: 7_500,
      direction: "in",
      description: "Acme LLC",
      counterparty: "Acme LLC",
      ai_bucket: "trading",
    }),
    txn({
      txn_date: "2026-07-09",
      amount: 11_000,
      direction: "in",
      description: "Customer receipt Northwind",
      counterparty: "Customer receipt Northwind",
      ai_bucket: "trading",
    }),
    txn({
      txn_date: "2026-08-10",
      amount: 7_800,
      direction: "in",
      description: "Northwind INV-1042",
      counterparty: "Northwind INV-1042",
      ai_bucket: "other",
    }),
    txn({
      txn_date: "2026-09-04",
      amount: 9_800,
      direction: "in",
      description: "Northwind",
      counterparty: "Northwind",
      ai_bucket: "trading",
    }),
    txn({
      txn_date: "2026-07-15",
      amount: 8_500,
      direction: "out",
      description: "Wholesale Supplier",
      counterparty: "Wholesale Supplier",
      ai_bucket: "cos",
    }),
    txn({
      txn_date: "2026-08-15",
      amount: 7_200,
      direction: "out",
      description: "Wholesale Supplier Pty",
      counterparty: "Wholesale Supplier Pty",
      ai_bucket: "cos",
    }),
    txn({
      txn_date: "2026-09-16",
      amount: 4_328.6,
      direction: "out",
      description: "WHOLESALE SUPPLIER invoice",
      counterparty: "WHOLESALE SUPPLIER invoice",
      ai_bucket: "cos",
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
      txn_date: "2026-07-01",
      amount: 4_500,
      direction: "out",
      description: "Rent",
      counterparty: "Rent",
      ai_bucket: "rent",
    }),
    txn({
      txn_date: "2026-08-01",
      amount: 4_500,
      direction: "out",
      description: "Rent",
      counterparty: "Rent",
      ai_bucket: "rent",
    }),
    txn({
      txn_date: "2026-09-01",
      amount: 4_500,
      direction: "out",
      description: "Rent",
      counterparty: "Rent",
      ai_bucket: "rent",
    }),
    txn({
      txn_date: "2026-07-10",
      amount: 640,
      direction: "out",
      description: "City Power",
      counterparty: "City Power",
      ai_bucket: "opex",
    }),
    txn({
      txn_date: "2026-08-10",
      amount: 640,
      direction: "out",
      description: "City Power",
      counterparty: "City Power",
      ai_bucket: "opex",
    }),
    txn({
      txn_date: "2026-09-10",
      amount: 640,
      direction: "out",
      description: "City Power",
      counterparty: "City Power",
      ai_bucket: "opex",
    }),
    txn({
      txn_date: "2026-07-18",
      amount: 900,
      direction: "out",
      description: "Pop-up stall",
      counterparty: "Pop-up stall",
      ai_bucket: "opex",
    }),
    txn({
      txn_date: "2026-07-22",
      amount: 1_400,
      direction: "out",
      description: "Pop-up stall",
      counterparty: "Pop-up stall",
      ai_bucket: "opex",
    }),
  ],
};

const varyingLines = buildDraftLinesFromExtract(varying);
function varyingLine(pattern: RegExp) {
  const matches = varyingLines.filter((row) => pattern.test(row.name) && row.status !== "excluded");
  assert(matches.length === 1, `${pattern} grouped to ${matches.length} lines`);
  return matches[0]!;
}

const varyingAcme = varyingLine(/^acme$/i);
assert(varyingAcme.cadence === "monthly", `Acme is monthly, got ${varyingAcme.cadence}`);
assert(varyingAcme.side === "inflow", "Acme is an inflow");
assert(varyingAcme.txn_count === 4, `Acme keeps four receipts, got ${varyingAcme.txn_count}`);
assert(varyingAcme.amount === 10_200, `Acme forecast is the median monthly total, got ${varyingAcme.amount}`);
assert(varyingAcme.start_week === 1, `Acme week ${varyingAcme.start_week}, expected week 1`);
assert(varyingAcme.period_total === 35_400, `Acme period total stays the sum, got ${varyingAcme.period_total}`);
assert(
  varyingAcme.confidence >= 0.35 && varyingAcme.confidence < 0.85,
  `Acme confidence is shown and lower than an equal series, got ${varyingAcme.confidence}`,
);

const varyingNorth = varyingLine(/^northwind$/i);
assert(varyingNorth.cadence === "monthly", `Northwind is monthly, got ${varyingNorth.cadence}`);
assert(varyingNorth.txn_count === 3, "Northwind keeps three receipts");
assert(varyingNorth.amount === 9_800, `Northwind amount ${varyingNorth.amount}`);
assert(varyingNorth.start_week === 2, `Northwind week ${varyingNorth.start_week}, expected week 2`);

const varyingWholesale = varyingLine(/^wholesale supplier$/i);
assert(varyingWholesale.cadence === "monthly", `Wholesale is monthly, got ${varyingWholesale.cadence}`);
assert(varyingWholesale.side === "outflow", "Wholesale stays an outflow");
assert(varyingWholesale.txn_count === 3, "Wholesale keeps three payments");
assert(varyingWholesale.amount === 7_200, `Wholesale amount ${varyingWholesale.amount}`);
assert(varyingWholesale.start_week === 3, `Wholesale week ${varyingWholesale.start_week}, expected week 3`);
assert(
  varyingWholesale.confidence >= 0.35 && varyingWholesale.confidence < 0.85,
  `Wholesale confidence follows amount variation, got ${varyingWholesale.confidence}`,
);

const varyingSalaries = varyingLine(/salaries payroll/i);
assert(varyingSalaries.cadence === "monthly", `salaries cadence ${varyingSalaries.cadence}`);
assert(varyingSalaries.amount === 30_000, `salaries amount ${varyingSalaries.amount}`);
assert(varyingSalaries.start_week === 4, `salaries week ${varyingSalaries.start_week}, expected week 4`);
assert(varyingSalaries.confidence >= 0.85, `salaries confidence ${varyingSalaries.confidence}`);

const varyingRent = varyingLine(/^rent$/i);
assert(varyingRent.cadence === "monthly" && varyingRent.start_week === 1, "rent stays monthly in week 1");
assert(varyingRent.amount === 4_500, `rent amount ${varyingRent.amount}`);

const cityPower = varyingLine(/^city power$/i);
assert(cityPower.cadence === "monthly" && cityPower.start_week === 2, "City Power stays monthly in week 2");
assert(cityPower.amount === 640, `City Power amount ${cityPower.amount}`);
assert(cityPower.confidence >= 0.85, `City Power confidence ${cityPower.confidence}`);

const popup = varyingLine(/pop up stall/i);
assert(popup.cadence === "once_off", `a single-month payee stays once-off, got ${popup.cadence}`);

assert(
  server.includes("buildDraftLinesFromExtract(extract)"),
  "the upload path classifies with the same function this fixture calls",
);
assert(
  workspace.includes("CADENCE_LABEL"),
  "the review dialog shows the draft cadence",
);
assert(
  workspace.includes("flex-col") && workspace.includes("sm:w-auto") && workspace.includes("Publish to Cash Forecast"),
  "the publish footer stacks on a narrow dialog",
);

const nil = null;
const storedExtraction = {
  entity_name: "QA US Test LLC",
  registration_number: nil,
  currency: "USD",
  units: "actual",
  statement_basis: "management_accounts",
  extraction_notes: nil,
  comparative_period: nil,
  current_period: {
    period_end: "2026-09-30",
    figures: {
      income_statement: {
        revenue: nil,
        cost_of_sales: nil,
        gross_profit: nil,
        other_income: nil,
        operating_expenses: nil,
        depreciation_amortisation: nil,
        operating_profit: nil,
        finance_income: nil,
        finance_costs: nil,
        profit_before_tax: nil,
        income_tax: nil,
        profit_after_tax: nil,
      },
      balance_sheet: {
        non_current_assets: { total: nil },
        current_assets: { total: nil },
        total_assets: 306_950,
        equity: { share_capital: 90_000, retained_earnings: nil, other_reserves: nil, total: 90_000 },
        non_current_liabilities: { total: nil },
        current_liabilities: { trade_and_other_payables: 40_000, total: nil },
        total_liabilities: 156_950,
        total_equity_and_liabilities: nil,
      },
      cash_flow: nil,
    },
  },
} as ExtractionResult;
const storedFigures = periodFinancialsFromExtraction(storedExtraction);
assert(storedFigures.totalLiabilities === "156950", `stored liabilities ${storedFigures.totalLiabilities}`);
assert(storedFigures.equity === "90000", `equity stays the reported total, got ${storedFigures.equity}`);
assert(storedFigures.totalAssets === "306950", `assets ${storedFigures.totalAssets}`);

const qaFinancials = {
  equity: "90000",
  totalAssets: "306950",
  totalLiabilities: storedFigures.totalLiabilities,
  payables: "40000",
  revenue: "100000",
  cogs: "40000",
};
const storedOverview = buildOverviewBrief({
  financials: qaFinancials,
  runwayLabel: "Cash generative",
  copyPack: "us",
  clientName: "QA US Test LLC",
});
const storedBlock = formatOverviewForPrompt(storedOverview, "accountant");
assert(storedBlock.includes("Total liabilities: $156,950"), storedBlock);
assert(!storedBlock.includes("(derived)"), "stored liabilities are not labelled derived");
assert(!storedBlock.includes("216,950"), "assets minus equity is not the liability total");
assert(storedBlock.includes("Gross margin: 60.0%"), storedBlock);
assert(storedBlock.includes("Cash runway: Cash generative"), storedBlock);
assert(storedOverview.totalLiabilitiesDerived === false, "stored liabilities keep their source");

const derivedOverview = buildOverviewBrief({
  financials: { equity: "90000", totalAssets: "306950", payables: "40000", revenue: "100000", cogs: "40000" },
  runwayLabel: "Cash generative",
  copyPack: "us",
  clientName: "QA US Test LLC",
});
const derivedBlock = formatOverviewForPrompt(derivedOverview, "accountant");
assert(derivedBlock.includes("Total liabilities (derived): $216,950"), derivedBlock);
assert(!derivedBlock.includes("Total liabilities: $216,950"), "a derived total is labelled");
assert(!derivedBlock.includes("$40,000"), "payables are not quoted as total liabilities");

const snapshot = shapeSnapshot({
  periodLabel: "Jul–Sep 2026",
  periodDate: "2026-09-30",
  ratios: {},
  financials: qaFinancials,
  cashRunwayWeeks: null,
});
const snapshotTotals = snapshot.statement_totals as { totalLiabilities?: number };
assert(snapshotTotals.totalLiabilities === 156_950, `snapshot liabilities ${snapshotTotals.totalLiabilities}`);
assert(snapshot.total_liabilities_source === "stored", "snapshot names the stored source");
const derivedSnapshot = shapeSnapshot({
  periodLabel: null,
  periodDate: null,
  ratios: {},
  financials: { equity: "90000", totalAssets: 306_950 },
  cashRunwayWeeks: null,
});
assert(derivedSnapshot.total_liabilities === 216_950, "snapshot derives only when the total is absent");
assert(derivedSnapshot.total_liabilities_source === "derived", "snapshot labels the derived total");

const marginQuestion = "What is the gross margin and runway?";
assert(classify("What is a gross margin?") === "none", "a definition still gets no client figures");
assert(classify("What is the formula for gross margin?") === "none", "a formula question stays definitional");
assert(classify(marginQuestion) !== "none", "the client's margin and runway keep their figures");
const turnPrompt = sealAskAiPrompt(
  buildPrompt(
    marginQuestion,
    {
      profile: null,
      profileQuestions: [],
      scores: null,
      ratios: [],
      playbook: [],
      copyPack: "us",
      waterfall: null,
      cashForecast: null,
      productLines: [],
      nextSteps: [],
      actionPlan: null,
      deliverables: [],
      overview: storedOverview,
      clientName: "QA US Test LLC",
    },
    classify(marginQuestion),
    "accountant",
  ),
  { clientName: "QA US Test LLC" },
);
assert(turnPrompt.user.includes("OVERVIEW FIGURES"), "ask-ai still sends the figures block");
assert(turnPrompt.user.includes("Gross margin: 60.0%"), turnPrompt.user);
assert(turnPrompt.user.includes("Cash runway: Cash generative"), turnPrompt.user);
assert(turnPrompt.user.includes("Total liabilities: $156,950"), turnPrompt.user);
assert(turnPrompt.system.includes("Cash generative"), "the bot is told cash generative is a runway");
assert(turnPrompt.system.includes("assets minus equity"), "the bot is told not to recompute liabilities");
assert(BOT_SYSTEM.includes("Cash generative"), "milon-bot reports cash generative");
assert(BOT_SYSTEM.includes("(derived)"), "milon-bot labels a derived liability total");

const priorTurns = [
  { role: "user" as const, content: "What is total equity?" },
  { role: "assistant" as const, content: "Total equity is $90,000." },
  { role: "user" as const, content: "What are total assets?" },
  { role: "assistant" as const, content: "Total assets are $306,950." },
  { role: "user" as const, content: "Older question that must be truncated" },
  { role: "assistant" as const, content: "Older answer" },
  { role: "user" as const, content: "Another older question" },
  { role: "assistant" as const, content: "Another older answer" },
  { role: "user" as const, content: "And one more" },
  { role: "assistant" as const, content: "Still no figures in history" },
];
const thirdTurn = buildMilonBotChatPayload({
  system: BOT_SYSTEM,
  overviewBlock: storedBlock,
  history: priorTurns.slice(-8),
  message: marginQuestion,
  audience: "accountant",
  subject: { clientName: "QA US Test LLC" },
});
const currentTurn = thirdTurn.messages[thirdTurn.messages.length - 1]!;
assert(currentTurn.role === "user", "the current turn is the user message");
assert(thirdTurn.system.includes("OVERVIEW FIGURES"), "the system prompt still carries Overview Figures");
assert(currentTurn.content.includes("OVERVIEW FIGURES"), "turn 3+ still carries Overview Figures");
assert(currentTurn.content.includes("Gross margin: 60.0%"), currentTurn.content);
assert(currentTurn.content.includes("Cash runway: Cash generative"), currentTurn.content);
assert(currentTurn.content.includes("Total liabilities: $156,950"), currentTurn.content);
assert(currentTurn.content.includes(marginQuestion), "the current question stays on the turn");
assert(
  thirdTurn.messages.slice(0, -1).every((turn) => !turn.content.includes("OVERVIEW FIGURES")),
  "history itself does not have to contain the block",
);
assert(thirdTurn.messages.length === 9, `history is capped and the current turn is kept, got ${thirdTurn.messages.length}`);

const botSrc = read("supabase/functions/milon-bot/index.ts");
assert(botSrc.includes("buildMilonBotChatPayload"), "milon-bot attaches the figures on every turn");
assert(botSrc.includes("overviewBlock"), "the live brief is passed into that payload");
const askWidget = read("src/lib/ask-ai.js");
assert(askWidget.includes("friendlyReachMessage"), "bot send errors are formatted");
const budgetPanel = read("src/components/budget/budget-panel.tsx");
assert(budgetPanel.includes("budgetDirty"), "budget autosave runs only after a dirty edit");
assert(budgetPanel.includes("budgetSaveErrorMessage"), "budget save failures use the friendly message");
assert(
  !budgetPanel.includes("Budget save failed: ${"),
  "the budget toast does not interpolate the raw error",
);

assert(
  friendlyReachMessage(new TypeError("Failed to fetch (jxclnsbsqpixxqlbcapl.supabase.co)")) === MILON_UNREACHABLE,
  "a fetch failure does not name the host",
);
assert(!friendlyReachMessage("TypeError: Failed to fetch").includes("fetch"), "the raw fetch error is replaced");
assert(
  friendlyReachMessage("column missing on db.example.com") === "column missing on",
  "other errors drop the host and stay specific",
);

console.log("accountant-qa-retest: ok");
