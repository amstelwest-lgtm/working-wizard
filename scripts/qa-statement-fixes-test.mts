/**
 * QA fixes: unclosed trial-balance profit, bank payee grouping,
 * bank-ledger upload guard, and invite-link error copy.
 * Run: pnpm test:qa-statement-fixes
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isClean, validateFigures } from "../src/lib/validateFinancials";
import { balanceSheetCheck, currentPeriodProfit } from "../src/lib/statement-balance";
import { fillBalanceSheetTotals } from "../src/lib/statement-financials";
import { BANK_LEDGER_MESSAGE, looksLikeBankLedger } from "../src/lib/bank-ledger";
import {
  buildDraftLinesFromExtract,
  normalisePayeeLabel,
  recurringReviewLabel,
} from "../src/lib/cash-from-banks.pattern";
import {
  INVITE_LINK_INVALID,
  inviteTokenShapeOk,
  sanitizeInviteError,
} from "../src/lib/invite-link-error";
import type { CashBankExtract, CashStatementTransaction } from "../src/lib/cash-from-banks.types";
import type { BalanceSheet, FinancialFigures, IncomeStatement } from "../src/lib/financialSchema";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function read(path: string) {
  return readFileSync(resolve(path), "utf8");
}

function income(partial: Partial<IncomeStatement>): IncomeStatement {
  return {
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
    ...partial,
  };
}

function sheet(partial: {
  assets?: number | null;
  equity?: number | null;
  share?: number | null;
  retained?: number | null;
  liabilities?: number | null;
  tel?: number | null;
}): BalanceSheet {
  const empty = null;
  return {
    non_current_assets: {
      property_plant_equipment: empty,
      intangible_assets: empty,
      investments: empty,
      deferred_tax_asset: empty,
      other: empty,
      total: empty,
    },
    current_assets: {
      inventories: empty,
      trade_and_other_receivables: empty,
      cash_and_cash_equivalents: empty,
      other: empty,
      total: empty,
    },
    total_assets: partial.assets ?? null,
    equity: {
      share_capital: partial.share ?? null,
      retained_earnings: partial.retained ?? null,
      other_reserves: empty,
      total: partial.equity ?? null,
    },
    non_current_liabilities: {
      borrowings: empty,
      deferred_tax_liability: empty,
      other: empty,
      total: empty,
    },
    current_liabilities: {
      trade_and_other_payables: empty,
      borrowings: empty,
      current_tax: empty,
      bank_overdraft: empty,
      other: empty,
      total: empty,
    },
    total_liabilities: partial.liabilities ?? null,
    total_equity_and_liabilities: partial.tel ?? null,
  };
}

function figures(balance: BalanceSheet, pnl: Partial<IncomeStatement>): FinancialFigures {
  return { income_statement: income(pnl), balance_sheet: balance, cash_flow: null };
}

// Mid-year TB: debits = credits = 132,900.
// Assets 43,000 = liabilities 9,000 + equity 3,900 + profit 30,100.
// Profit = 120,000 − 48,000 − 41,900.
const openTb = figures(
  sheet({
    assets: 43_000,
    equity: 3_900,
    share: 1_000,
    retained: 2_900,
    liabilities: 9_000,
    tel: 12_900,
  }),
  { revenue: 120_000, cost_of_sales: 48_000, operating_expenses: 41_900 },
);

assert(currentPeriodProfit(openTb.income_statement) === 30_100, "current-period profit is 30,100");
const openCheck = balanceSheetCheck(openTb);
assert(openCheck.currentPeriodProfit === 30_100, "unclosed profit is added to equity for the check");
assert(openCheck.gap === 0, `balanced TB gap is 0, got ${openCheck.gap}`);
const openIssues = validateFigures(openTb);
assert(isClean(openIssues), `balanced TB must pass, got ${openIssues.map((i) => i.check).join(",")}`);
assert(
  openTb.balance_sheet.equity.retained_earnings === 2_900,
  "profit is not stored as a fake retained-earnings line",
);

const filled = fillBalanceSheetTotals({
  ...sheet({ share: 1_000, retained: 2_900 }),
  non_current_assets: {
    ...sheet({}).non_current_assets,
    property_plant_equipment: 8_000,
  },
  current_assets: {
    ...sheet({}).current_assets,
    trade_and_other_receivables: 15_000,
    cash_and_cash_equivalents: 20_000,
  },
  current_liabilities: {
    ...sheet({}).current_liabilities,
    trade_and_other_payables: 9_000,
  },
});
assert(filled.sheet.total_assets === 43_000, "filled assets");
assert(filled.sheet.equity.total === 3_900, "filled equity stays share capital plus retained earnings");
assert(filled.sheet.total_liabilities === 9_000, "filled liabilities");
assert(filled.sheet.total_equity_and_liabilities === 12_900, "filled equity and liabilities omit unclosed profit");
const filledFigures = figures(filled.sheet, {
  revenue: 120_000,
  cost_of_sales: 48_000,
  operating_expenses: 41_900,
});
assert(isClean(validateFigures(filledFigures)), "filled balanced TB passes validation");

const unbalanced = figures(
  sheet({
    assets: 50_000,
    equity: 3_900,
    share: 1_000,
    retained: 2_900,
    liabilities: 9_000,
    tel: 12_900,
  }),
  { revenue: 120_000, cost_of_sales: 48_000, operating_expenses: 41_900 },
);
const unbalancedCheck = balanceSheetCheck(unbalanced);
assert(unbalancedCheck.currentPeriodProfit === 30_100, "unbalanced TB still shows the profit line");
assert(unbalancedCheck.gap === -7_000, `residual gap is -7,000, got ${unbalancedCheck.gap}`);
assert(!isClean(validateFigures(unbalanced)), "a genuinely unbalanced TB still warns");

const closed = figures(
  sheet({ assets: 43_000, equity: 34_000, share: 1_000, retained: 33_000, liabilities: 9_000, tel: 43_000 }),
  { revenue: 120_000, cost_of_sales: 48_000, operating_expenses: 41_900, profit_after_tax: 30_100 },
);
const closedCheck = balanceSheetCheck(closed);
assert(closedCheck.gap === 0, "a closed balance sheet still balances");
assert(closedCheck.currentPeriodProfit == null, "closed profit is not added a second time");
assert(isClean(validateFigures(closed)), "a closed statement passes");

const closedOff = figures(
  sheet({ assets: 50_000, equity: 34_000, liabilities: 9_000, tel: 43_000 }),
  { profit_after_tax: 30_100 },
);
assert(balanceSheetCheck(closedOff).gap === -7_000, "a closed sheet that does not balance still warns");
assert(!isClean(validateFigures(closedOff)), "closed imbalance is an error");

const uploadUi = read("src/components/upload-financials.tsx");
assert(uploadUi.includes("Current period profit"), "review shows the current period profit line");
assert(uploadUi.includes("balanceSheetCheck"), "review uses the unclosed-profit check");
assert(!uploadUi.includes("retained_earnings ="), "review does not write a fake retained earnings line");

// Bank payee grouping
assert(normalisePayeeLabel("Salaries July") === "salaries", "July drops out of the payee key");
assert(normalisePayeeLabel("Salaries August") === "salaries", "August drops out of the payee key");
assert(normalisePayeeLabel("Salaries September") === "salaries", "September drops out of the payee key");
assert(normalisePayeeLabel("Salarisse Julie") === "salarisse", "Afrikaans month drops out");
assert(normalisePayeeLabel("Salarisse Augustus") === "salarisse", "Afrikaans Augustus drops out");
assert(normalisePayeeLabel("  ACME  INV-1042 ") === "acme", "invoice number drops out");
assert(normalisePayeeLabel("ACME INV-2099") === "acme", "a later invoice is the same payee");
assert(normalisePayeeLabel("Office Park Pty") === "office park pty", "rent payee stays intact");
assert(normalisePayeeLabel("Printing") === "printing", "once-off printing stays itself");
assert(normalisePayeeLabel("Xero") === "xero", "Xero stays itself");
assert(normalisePayeeLabel("Mayfair Properties") === "mayfair properties", "Mayfair is not the month May");

function txn(
  partial: Pick<CashStatementTransaction, "txn_date" | "description" | "amount"> &
    Partial<CashStatementTransaction>,
): CashStatementTransaction {
  return {
    direction: "out",
    counterparty: partial.description,
    ai_bucket: "payroll",
    excluded: false,
    ...partial,
  };
}

const grouped: CashBankExtract = {
  period_start: "2026-07-01",
  period_end: "2026-09-30",
  opening_balance: 40_000,
  closing_balance: 10_000,
  currency: "ZAR",
  notes: null,
  transactions: [
    txn({ txn_date: "2026-07-05", description: "Salaries July", amount: 30_000 }),
    txn({ txn_date: "2026-08-05", description: "Salaries August", amount: 30_000 }),
    txn({ txn_date: "2026-09-05", description: "Salaries September", amount: 30_000 }),
    txn({
      txn_date: "2026-07-01",
      description: "RENT OFFICE PARK",
      counterparty: "Office Park Pty",
      amount: 8_500,
      ai_bucket: "rent",
    }),
    txn({
      txn_date: "2026-08-01",
      description: "RENT OFFICE PARK",
      counterparty: "Office Park Pty",
      amount: 8_500,
      ai_bucket: "rent",
    }),
    txn({
      txn_date: "2026-09-01",
      description: "RENT OFFICE PARK",
      counterparty: "Office Park Pty",
      amount: 8_500,
      ai_bucket: "rent",
    }),
    txn({
      txn_date: "2026-07-15",
      description: "CUSTOMER RECEIPT ACME",
      counterparty: "Acme Client",
      amount: 45_000,
      direction: "in",
      ai_bucket: "trading",
    }),
    txn({
      txn_date: "2026-08-14",
      description: "CUSTOMER RECEIPT ACME",
      counterparty: "Acme Client",
      amount: 45_000,
      direction: "in",
      ai_bucket: "trading",
    }),
    txn({
      txn_date: "2026-09-16",
      description: "CUSTOMER RECEIPT ACME INV-2099",
      counterparty: "Acme Client",
      amount: 45_000,
      direction: "in",
      ai_bucket: "trading",
    }),
    txn({
      txn_date: "2026-07-20",
      description: "GAMMA TRADING",
      counterparty: "Gamma",
      amount: 12_000,
      direction: "in",
      ai_bucket: "trading",
    }),
    txn({
      txn_date: "2026-08-20",
      description: "GAMMA TRADING",
      counterparty: "Gamma",
      amount: 12_000,
      direction: "in",
      ai_bucket: "trading",
    }),
    txn({
      txn_date: "2026-09-20",
      description: "GAMMA TRADING",
      counterparty: "Gamma",
      amount: 12_000,
      direction: "in",
      ai_bucket: "trading",
    }),
    txn({
      txn_date: "2026-07-02",
      description: "Xero subscription July",
      counterparty: "Xero July",
      amount: 400,
      ai_bucket: "opex",
    }),
    txn({
      txn_date: "2026-08-02",
      description: "Xero subscription August",
      counterparty: "Xero August",
      amount: 400,
      ai_bucket: "opex",
    }),
    txn({
      txn_date: "2026-09-02",
      description: "Xero subscription September",
      counterparty: "Xero September",
      amount: 400,
      ai_bucket: "opex",
    }),
    txn({
      txn_date: "2026-07-18",
      description: "Printing",
      counterparty: "Printing",
      amount: 450,
      ai_bucket: "opex",
    }),
  ],
};

const lines = buildDraftLinesFromExtract(grouped);
const salaries = lines.filter((line) => line.bucket === "payroll");
assert(salaries.length === 1, `salaries group into one line, got ${salaries.length}`);
assert(salaries[0]?.txn_count === 3, "three salary months are one line");
assert(salaries[0]?.cadence === "monthly", `salaries are monthly, got ${salaries[0]?.cadence}`);
assert(recurringReviewLabel(salaries[0]!) === "Recurring · monthly", "salary line is Recurring · monthly");

const rent = lines.find((line) => line.bucket === "rent");
assert(rent?.cadence === "monthly" && rent.txn_count === 3, "Office Park rent stays one monthly line");
const trading = lines.filter((line) => line.bucket === "trading");
assert(trading.length === 2, `Acme and Gamma stay separate, got ${trading.length}`);
assert(trading.every((line) => line.cadence === "monthly"), "Acme and Gamma stay monthly");
const xero = lines.find((line) => /xero/i.test(line.name));
assert(xero?.cadence === "monthly" && xero.txn_count === 3, "Xero months group into one monthly line");
const printing = lines.find((line) => /printing/i.test(line.name));
assert(printing?.cadence === "once_off" && printing.txn_count === 1, "Printing stays a once-off");

// Bank ledger vs financial statement
const bankCsv = [
  "Date,Description,Amount,Balance",
  "2026-09-01,Opening balance,0,-1000",
  "2026-09-02,Client receipt,5000,4000",
  "2026-09-03,Rent,-8500,-4500",
  "2026-09-04,Supplies,-1200,-5700",
  "2026-09-05,Salaries,-30000,-35700",
  "2026-09-08,Invoice payment,26550,-9150",
].join("\n");
assert(looksLikeBankLedger(bankCsv), "dated bank CSV is a bank ledger");
assert(bankCsv.includes("-9150"), "sample closes on the overdraft that must not be saved as cash");

const bankDebitCredit = [
  "Date;Description;Debit;Credit;Balance",
  "2026-07-05;Salaries July;30000;;70000",
  "2026-07-12;Printing;450;;69550",
  "2026-08-05;Salaries August;30000;;39550",
  "2026-08-18;Gamma; ;12000;51550",
  "2026-09-05;Salaries September;30000;;21550",
  "2026-09-20;Xero;400;;21150",
].join("\n");
assert(looksLikeBankLedger(bankDebitCredit), "semicolon debit/credit bank export is a bank ledger");

const trialBalance = [
  "Account code,Account name,Debit,Credit",
  "1000,Share capital,,1000",
  "3100,Retained earnings,,2900",
  "4000,Revenue,,120000",
  "5000,Cost of sales,48000,",
  "6000,Operating expenses,41900,",
  "1200,Cash,20000,",
  "2000,Trade payables,,9000",
].join("\n");
assert(!looksLikeBankLedger(trialBalance), "a trial balance is not a bank ledger");

const pnl = ["Description,Amount", "Revenue,120000", "Cost of sales,48000", "Operating expenses,41900"].join(
  "\n",
);
assert(!looksLikeBankLedger(pnl), "a P&L is not a bank ledger");

const owner = read("src/routes/app.tsx");
const uploadFn = owner.slice(owner.indexOf("const handleStatementUpload"), owner.indexOf("const [actingClientId"));
assert(uploadFn.includes("looksLikeBankLedger"), "owner financial upload detects a bank ledger");
assert(
  uploadFn.indexOf("looksLikeBankLedger") < uploadFn.indexOf("setExtractionForReview"),
  "a bank ledger is stopped before the financial review",
);
assert(owner.includes("Go to bank statement upload"), "owner upload offers the bank statement button");
assert(owner.includes(BANK_LEDGER_MESSAGE) || owner.includes("BANK_LEDGER_MESSAGE"), "owner upload uses the bank message");

const accountantUpload = read("src/components/upload-financials.tsx");
assert(accountantUpload.includes("looksLikeBankLedger"), "statement upload detects a bank ledger");
assert(accountantUpload.includes("Go to bank statement upload"), "statement upload links to the bank upload");
assert(accountantUpload.includes('setStatus("bank")'), "a bank file never reaches the review screen");
const studio = read("src/routes/_authenticated/clients.$clientId.tsx");
assert(studio.includes("onOpenBankUpload"), "accountant upload can open the bank statement flow");

assert(read("src/lib/extract-financials.functions.ts").includes("looksLikeBankLedger"), "CSV extract refuses a bank ledger");
assert(read("src/lib/extractFinancials.server.ts").includes("looksLikeBankLedger"), "statement extract refuses a bank ledger");

// Invite link
const zod = '[{"code":"too_small","minimum":8,"type":"string","inclusive":true,"exact":false,"message":"Too small: expected string to have >=8 characters","path":["token"]}]';
assert(sanitizeInviteError(zod) === INVITE_LINK_INVALID, "zod JSON becomes Invite link is invalid");
assert(sanitizeInviteError("Invite link is invalid.") === INVITE_LINK_INVALID, "resolver copy is unchanged");
assert(
  sanitizeInviteError("This invite has already been used.") === "This invite has already been used.",
  "a real invite error is kept",
);
assert(!inviteTokenShapeOk("test"), "a short token is not sent to the validator");
assert(inviteTokenShapeOk("long-enough-token"), "a normal token is previewed");

const join = read("src/routes/join.$token.tsx");
assert(join.includes("inviteTokenShapeOk"), "short tokens are handled on the page");
assert(join.includes("sanitizeInviteError(previewError)"), "the page never renders a raw preview error");
assert(!join.includes("setPreviewError(err instanceof Error ? err.message"), "preview does not store a raw thrown message");
assert(
  /text-foreground">\s*Accountant invitation/.test(join),
  "Accountant invitation uses the foreground token",
);
assert(join.includes('el.classList.add("dark")'), "join page keeps the dark canvas so the heading stays readable");

const ask = read("src/lib/ask-ai.js");
const submit = ask.slice(ask.indexOf("async function submit"));
assert(submit.includes('question = ""'), "successful submit clears the composer");
assert(
  submit.indexOf('question = ""') > submit.indexOf("answer = data.answer"),
  "the composer clears after the send succeeds",
);
assert(ask.includes("compositionstart"), "IME composition guard stays");
assert(!ask.includes("e.isComposing"), "Enter does not trust the intermittent isComposing flag");

console.log("qa-statement-fixes: ok");
