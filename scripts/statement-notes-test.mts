/**
 * Accountant statement-notes: structured, no vendor wording, no invented figures.
 * Run: pnpm test:statement-notes
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sanitiseExtractionNote, statementNoteSections } from "../src/lib/statement-notes";
import type {
  BalanceSheet,
  ExtractionResult,
  IncomeStatement,
  PeriodBlock,
} from "../src/lib/financialSchema";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function emptyIncome(): IncomeStatement {
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
  };
}

function emptyBalance(): BalanceSheet {
  return {
    non_current_assets: {
      property_plant_equipment: null,
      intangible_assets: null,
      investments: null,
      deferred_tax_asset: null,
      other: null,
      total: null,
    },
    current_assets: {
      inventories: null,
      trade_and_other_receivables: null,
      cash_and_cash_equivalents: null,
      other: null,
      total: null,
    },
    total_assets: null,
    equity: { share_capital: null, retained_earnings: null, other_reserves: null, total: null },
    non_current_liabilities: {
      borrowings: null,
      deferred_tax_liability: null,
      other: null,
      total: null,
    },
    current_liabilities: {
      trade_and_other_payables: null,
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

function period(
  partial: Partial<PeriodBlock["figures"]> & { period_end?: string | null },
): PeriodBlock {
  return {
    period_end: partial.period_end ?? null,
    figures: {
      income_statement: partial.income_statement ?? emptyIncome(),
      balance_sheet: partial.balance_sheet ?? emptyBalance(),
      cash_flow: partial.cash_flow ?? null,
    },
  };
}

function result(over: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    entity_name: "Example Pty",
    registration_number: null,
    currency: "ZAR",
    units: "thousands",
    statement_basis: "independently_reviewed",
    current_period: period({
      period_end: "2025-02-28",
      income_statement: { ...emptyIncome(), revenue: 1_200, profit_after_tax: 80 },
      balance_sheet: {
        ...emptyBalance(),
        total_assets: 900,
        equity: { ...emptyBalance().equity, total: 400 },
      },
    }),
    comparative_period: null,
    extraction_notes: null,
    ...over,
  };
}

const fmt = (n: number) => n.toLocaleString("en-ZA");

const uploadUi = readFileSync(resolve("src/components/upload-financials.tsx"), "utf8");
const clientPage = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
const extractServer = readFileSync(resolve("src/lib/extractFinancials.server.ts"), "utf8");

assert(!/Claude|Anthropic|Sending to/i.test(uploadUi), "upload UI has no vendor wording");
assert(uploadUi.includes("Uploading"), "upload progress says Uploading");
assert(uploadUi.includes("Reading the statement"), "second phase says Reading the statement");
assert(uploadUi.includes("Statement notes"), "note heading is Statement notes");
assert(!/note from/i.test(uploadUi), "note is not labelled from a vendor");

assert(!/Claude|Anthropic/i.test(clientPage), "client upload copy has no vendor wording");
assert(
  clientPage.includes("Figures are read from the"),
  "modal describes reading figures, not a vendor",
);

assert(!/Failed to parse Claude/i.test(extractServer), "parse errors are not vendor-named");
assert(
  extractServer.includes("short bullets"),
  "extraction prompt asks for short bullets, not a paragraph",
);

const cleaned = sanitiseExtractionNote(
  "Note from Claude: turnover maps to revenue. Anthropic guessed the rest.",
);
assert(!/claude|anthropic/i.test(cleaned), "vendor names stripped from model notes");
assert(/turnover maps to revenue/i.test(cleaned), "real note content kept");

const sections = statementNoteSections(result(), fmt);
const titles = sections.map((s) => s.title);
assert(titles.includes("Period"), "period section present");
assert(titles.includes("What was read"), "what-was-read section present");
assert(titles.includes("Key figures"), "key figures section present");
assert(titles.includes("Gaps"), "gaps section present");

const periodItems = sections.find((s) => s.title === "Period")!.items.join("\n");
assert(periodItems.includes("Period end: 2025-02-28"), "period end from extraction");
assert(periodItems.includes("Independently reviewed"), "basis labelled professionally");
assert(periodItems.includes("ZAR"), "currency shown when present");
assert(periodItems.includes("in thousands"), "scale shown when present");

const read = sections.find((s) => s.title === "What was read")!.items;
assert(read.includes("Income statement"), "income statement listed when figures exist");
assert(read.includes("Balance sheet"), "balance sheet listed when figures exist");
assert(!read.includes("Cash flow statement"), "cash flow omitted when absent");

const figures = sections.find((s) => s.title === "Key figures")!.items.join("\n");
assert(figures.includes("Revenue:"), "revenue shown because it was extracted");
assert(figures.includes("Profit after tax:"), "PAT shown because it was extracted");
assert(!figures.includes("Gross profit:"), "null gross profit is not invented");
assert(!figures.includes("Operating profit:"), "null operating profit is not invented");
assert(!/Revenue: 0\b/.test(figures), "missing lines are not filled with zero");

const gaps = sections.find((s) => s.title === "Gaps")!.items.join("\n");
assert(gaps.includes("Cash flow statement not in the file."), "missing cash flow is a gap");
assert(gaps.includes("Comparative period not in the file."), "missing comparative is a gap");

const wall = statementNoteSections(
  result({
    extraction_notes:
      "Turnover mapped to revenue. Note from Claude: cash line was a judgement call. Cost of sales was not printed.",
  }),
  fmt,
);
const gapText = wall.find((s) => s.title === "Gaps")!.items.join(" | ");
assert(!/claude/i.test(gapText), "gaps do not name a vendor");
assert(wall.find((s) => s.title === "Gaps")!.items.length >= 4, "prose note is split into bullets");
assert(
  wall.find((s) => s.title === "Gaps")!.items.some((i) => /turnover mapped to revenue/i.test(i)),
  "judgement call from the file is kept",
);

const empty = statementNoteSections(
  result({
    currency: null,
    units: null,
    statement_basis: null,
    current_period: period({ period_end: null }),
    extraction_notes: null,
  }),
  fmt,
);
const emptyFigures = empty.find((s) => s.title === "Key figures");
assert(!emptyFigures, "no key-figures section when nothing was read");
assert(
  empty.find((s) => s.title === "Gaps")!.items.some((i) => /Period end not in the file/i.test(i)),
  "missing period is a gap, not a made-up date",
);

console.log("statement-notes tests passed");
