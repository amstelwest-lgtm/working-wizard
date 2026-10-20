/**
 * A printed currency that is not the client's reporting currency blocks import
 * on both review screens until the person says the label is wrong.
 * Run: pnpm test:statement-currency
 */
import { Window } from "happy-dom";
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { ExtractionResult } from "../src/lib/financialSchema";
import type { MergedExtractionResult } from "../src/lib/extraction-types";
import {
  currencyImportRefusal,
  currencyLabelConfirmFromGate,
  fileCurrencyFromExtraction,
  headerCurrency,
  printedCurrencyNote,
  reportingCurrencyFromStoredMarket,
  stampPrintedFields,
  statementCurrencyGate,
  withCurrencyLabelConfirm,
} from "../src/lib/statement-currency";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "test-anon-key";
process.env.VITE_SUPABASE_URL ??= process.env.SUPABASE_URL;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??= process.env.SUPABASE_PUBLISHABLE_KEY;

const ZA_MARKET = { country: "ZA" as const, regionCode: null };
const US_MARKET = { country: "US" as const, regionCode: "NY" as const };
const za = reportingCurrencyFromStoredMarket(ZA_MARKET);
const usd = "USD";
assert(za && za !== usd, "ZA reporting code");
const zaNotice = `This file is in ${usd}; this client reports in ${za}.`;
const zaOverride = `The figures are actually in ${za}, the label is wrong`;
const cancelLabel = "Cancel / upload a different file";

const zaGate = statementCurrencyGate({
  storedMarket: ZA_MARKET,
  extraction: { currency: usd },
});
assert(zaGate.blocked, "USD file on a ZA client blocks");
assert(zaGate.notice === zaNotice, zaGate.notice ?? "missing notice");
assert(zaGate.cancelLabel === cancelLabel, zaGate.cancelLabel);
assert(zaGate.overrideLabel === zaOverride, zaGate.overrideLabel ?? "missing override");

const matchingZa = statementCurrencyGate({
  storedMarket: ZA_MARKET,
  extraction: { currency: za },
});
assert(!matchingZa.blocked && matchingZa.notice == null, "ZAR file on a ZA client passes");

const matchingUs = statementCurrencyGate({
  storedMarket: US_MARKET,
  extraction: { currency: usd },
});
assert(!matchingUs.blocked && matchingUs.notice == null, "USD file on a US client passes");
assert(!JSON.stringify(matchingUs).includes(za!), "US gate copy names the other currency");

const nullAmbiguous = statementCurrencyGate({
  storedMarket: null,
  extraction: { currency: "other" },
});
assert(!nullAmbiguous.blocked && nullAmbiguous.clientCurrency == null, "null market and an ambiguous file do not block");

const nullUsd = statementCurrencyGate({
  storedMarket: null,
  extraction: { currency: usd },
});
assert(!nullUsd.blocked && nullUsd.notice == null, "null market does not block an explicit USD file");
assert(!JSON.stringify(nullUsd).includes(za!), "null market is not described as reporting in the ZA code");

const noted = fileCurrencyFromExtraction({
  currency: za,
  document_metadata: { functional_currency: za },
  extraction_notes: printedCurrencyNote(usd, za!),
});
assert(noted === usd, "a printed-currency note wins over the schema default");

const header = "Balance sheet\nAmount (USD)\nCash,46300\n";
assert(headerCurrency(header) === usd, "Amount (USD) is the file currency");
const cash = 46300;
const stamped = stampPrintedFields({
  currency: za,
  text: header,
  describedCurrency: za!,
});
assert(stamped.currency === usd, "the header stamps USD");
assert(stamped.notes?.includes("as printed"), stamped.notes ?? "no note");
assert(stamped.notes?.includes("South" + " African"), "the note names the described region");
assert(cash === 46300, "stamping the currency changed the cash figure");

const labelConfirm = currencyLabelConfirmFromGate(zaGate, "2026-10-20T00:00:00.000Z");
assert(labelConfirm?.choice === "label_wrong", "confirm records the label choice");
const logged = withCurrencyLabelConfirm({ cash: "46300", revenue: "100" }, labelConfirm);
assert(logged.cash === "46300" && logged.revenue === "100", "the log does not change amounts");
const parsedLog = JSON.parse(String(logged.currencyLabelConfirm));
assert(parsedLog.fileCurrency === usd && parsedLog.clientCurrency === za, "the log names both currencies");
assert(parsedLog.fx == null && parsedLog.rate == null, "the log has no conversion");

assert(currencyImportRefusal(zaGate, null)?.includes(zaNotice), "a missing confirmation is refused");
assert(
  currencyImportRefusal(zaGate, { ...labelConfirm!, fileCurrency: za! }) != null,
  "a confirmation for a different file currency is refused",
);
assert(currencyImportRefusal(zaGate, labelConfirm) == null, "an explicit label confirmation is accepted");
assert(currencyImportRefusal(matchingUs, null) == null, "a matching US file needs no confirmation");

const window = new Window({
  url: "http://127.0.0.1:5000/app",
  width: 1280,
  height: 900,
  settings: {
    disableJavaScriptEvaluation: true,
    disableJavaScriptFileLoading: true,
    disableCSSFileLoading: true,
  },
});
for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLButtonElement",
  "HTMLLabelElement",
  "HTMLSelectElement",
  "HTMLFormElement",
  "Element",
  "Node",
  "Document",
  "NodeFilter",
  "KeyboardEvent",
  "MouseEvent",
  "PointerEvent",
  "InputEvent",
  "Event",
  "CustomEvent",
  "FocusEvent",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "MutationObserver",
  "sessionStorage",
  "localStorage",
] as const) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value: window[key],
  });
}
if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
Object.defineProperty(globalThis, "ResizeObserver", {
  configurable: true,
  writable: true,
  value: window.ResizeObserver,
});
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  writable: true,
  value: true,
});
const warn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].includes("useRouter must be used inside")) return;
  warn(...args);
};

const { UploadFinancials } = await import("../src/components/upload-financials");
const { ExtractionReviewModal } = await import("../src/components/extraction-review-modal");
const { MarketProvider } = await import("../src/contexts/market");

async function tick() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mount(node: ReturnType<typeof createElement>) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(node);
  });
  await tick();
  return async () => {
    await act(async () => {
      root.unmount();
    });
    host.remove();
  };
}

function buttonNamed(text: string) {
  return [...document.querySelectorAll("button")].find((button) =>
    button.textContent?.includes(text),
  ) as HTMLButtonElement | undefined;
}

async function click(el: Element) {
  await act(async () => {
    (el as HTMLElement).click();
  });
  await tick();
}

function emptyIncome() {
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

function sheet(cash: number) {
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
      cash_and_cash_equivalents: cash,
      other: null,
      total: cash,
    },
    total_assets: cash,
    equity: { share_capital: null, retained_earnings: null, other_reserves: null, total: cash },
    non_current_liabilities: { borrowings: null, deferred_tax_liability: null, other: null, total: null },
    current_liabilities: {
      trade_and_other_payables: null,
      borrowings: null,
      current_tax: null,
      bank_overdraft: null,
      other: null,
      total: null,
    },
    total_liabilities: null,
    total_equity_and_liabilities: cash,
  };
}

function accountantFile(currency: string, notes: string | null): ExtractionResult {
  return {
    entity_name: "Harbour Co",
    registration_number: null,
    currency,
    units: "actual",
    statement_basis: "management_accounts",
    current_period: {
      period_start: null,
      period_end: "2026-09-30",
      period_months: null,
      figures: {
        income_statement: emptyIncome(),
        balance_sheet: sheet(46300),
        cash_flow: null,
      },
    },
    comparative_period: null,
    extraction_notes: notes,
  };
}

function ownerFile(currency: string, notes: string | null): MergedExtractionResult {
  const blank = {
    revenue: null,
    cogs: null,
    gross_profit: null,
    other_income: null,
    fixed_costs: null,
    labor_cost: null,
    depreciation: null,
    amortisation: null,
    depreciation_amortisation_total: null,
    ebitda: null,
    ebit: null,
    interest_expense: null,
    interest_income: null,
    ebt: null,
    tax: null,
    net_income: null,
    director_remuneration: null,
    dividends_declared: null,
  };
  return {
    document_metadata: {
      company_name: "Harbour Co",
      registration_number: null,
      period_start_date: null,
      period_end_date: "2026-09-30",
      period_months: null,
      prior_period_start_date: null,
      prior_period_end_date: null,
      document_type: "balance_sheet",
      financial_statement_type: "management_accounts",
      prepared_by: null,
      auditor_firm: null,
      approval_date: null,
      industry_description: null,
      functional_currency: currency as MergedExtractionResult["document_metadata"]["functional_currency"],
      foreign_currency_exposure: null,
      headcount: null,
      accounting_basis: "accrual",
      values_appear_in_thousands: false,
      contains_income_statement: false,
      contains_balance_sheet: true,
      contains_cash_flow_statement: false,
      contains_notes: Boolean(notes),
    },
    current_period: {
      income_statement: blank,
      balance_sheet: {
        total_assets: 46300,
        fixed_assets: null,
        goodwill: null,
        intangible_assets: null,
        right_of_use_assets: null,
        current_assets: 46300,
        inventory: null,
        wip: null,
        debtors: null,
        provision_bad_debts: null,
        cash: 46300,
        other_current_assets: null,
        total_liabilities: null,
        current_liabilities: null,
        creditors: null,
        short_term_debt: null,
        lease_liabilities_current: null,
        other_current_liabilities: null,
        non_current_liabilities: null,
        long_term_debt: null,
        lease_liabilities_non_current: null,
        deferred_tax_liability: null,
        deferred_tax_asset: null,
        equity: 46300,
        share_capital: null,
        retained_earnings_opening: null,
        retained_earnings_closing: null,
        shareholder_loans_asset: null,
        shareholder_loans_liability: null,
        contingent_liabilities_notes: null,
      },
      cash_flow_statement: {
        operating_cash_flow: null,
        working_capital_movement_debtors: null,
        working_capital_movement_inventory: null,
        working_capital_movement_creditors: null,
        capex: null,
        asset_disposal_proceeds: null,
        investing_cash_flow: null,
        debt_drawdowns: null,
        debt_repayments: null,
        dividends_paid: null,
        financing_cash_flow: null,
        net_cash_movement: null,
        cash_opening_balance: null,
        cash_closing_balance: null,
      },
    },
    prior_period: {
      revenue: null,
      gross_profit: null,
      net_income: null,
      total_assets: null,
      equity: null,
      cash: null,
      debtors: null,
      inventory: null,
      creditors: null,
      operating_cash_flow: null,
    },
    top_expenses: [],
    top_income_sources: [],
    data_quality: {
      gross_profit_reconciles: null,
      net_income_reconciles: null,
      balance_sheet_balances: null,
      cash_flow_reconciles: null,
      retained_earnings_reconciles: null,
      prior_period_available: false,
      confidence_by_section: {
        income_statement: "not_found",
        balance_sheet: "high",
        cash_flow: "not_found",
        expenses_detail: "not_found",
        income_detail: "not_found",
        notes: notes ? "high" : "not_found",
      },
      overall_confidence: "high",
      extraction_notes: notes ?? "",
    },
    source_map: {},
    conflicts: [],
    normalisation_applied: false,
    document_count: 1,
    file_names: ["statement.pdf"],
  };
}

async function accept(id: string) {
  const box = document.getElementById(id);
  assert(box instanceof HTMLInputElement, `${id} checkbox`);
  await click(box);
}

function radio(choice: "cancel" | "label_wrong") {
  const el = document.querySelector(`[data-currency-choice="${choice}"]`);
  assert(el instanceof HTMLInputElement, `${choice} choice`);
  return el;
}

async function accountantPath(
  file: ExtractionResult,
  market: unknown,
  provider: { country: "ZA" | "US"; regionCode: "NY" | null } | null,
) {
  const seen: ExtractionResult[] = [];
  const node = createElement(UploadFinancials, {
    seedReview: file,
    booksHaveSpan: false,
    storedMarket: market,
    onConfirm: (result) => {
      seen.push(result);
      return { ok: true as const, message: "saved" };
    },
  });
  const unmount = await mount(
    provider ? createElement(MarketProvider, { selection: provider }, node) : node,
  );
  return { seen, unmount };
}

async function ownerPath(
  file: MergedExtractionResult,
  market: unknown,
  provider: { country: "ZA" | "US"; regionCode: "NY" | null } | null,
) {
  const seen: Array<Record<string, string | undefined>> = [];
  const node = createElement(ExtractionReviewModal, {
    result: file,
    open: true,
    booksHaveSpan: false,
    storedMarket: market,
    onClose: () => {},
    onConfirm: (mapped) => {
      seen.push(mapped);
      return { ok: true as const, message: "saved" };
    },
  });
  const unmount = await mount(
    provider ? createElement(MarketProvider, { selection: provider }, node) : node,
  );
  return { seen, unmount, file };
}

const usdOnZaNote = printedCurrencyNote(usd, za!);

const accountantBlocked = await accountantPath(
  accountantFile(za!, usdOnZaNote),
  ZA_MARKET,
  ZA_MARKET,
);
assert(document.querySelector("[data-currency-notice]")?.textContent === zaNotice, "accountant notice");
assert(document.querySelector("[data-currency-choice='cancel']:checked") == null, "cancel is not preselected");
assert(document.querySelector("[data-currency-choice='label_wrong']:checked") == null, "override is not preselected");
await accept("confirm-import-figures");
const accountantConfirm = buttonNamed("Confirm & import");
assert(accountantConfirm?.disabled, "accountant confirm stays disabled");
assert(accountantConfirm?.getAttribute("data-currency-block") === "1", "accountant confirm is blocked");
await click(radio("cancel"));
assert(accountantConfirm?.disabled, "cancel does not enable the accountant confirm");
await click(accountantConfirm!);
assert(accountantBlocked.seen.length === 0, "cancel imported the file");
await click(radio("label_wrong"));
assert(!accountantConfirm?.disabled, "the label confirmation enables the accountant confirm");
await click(accountantConfirm!);
assert(accountantBlocked.seen.length === 1, "accountant import did not run");
assert(
  accountantBlocked.seen[0]?.currency_label_confirm?.statement === zaOverride,
  "accountant import log",
);
assert(
  accountantBlocked.seen[0]?.current_period.figures.balance_sheet.current_assets.cash_and_cash_equivalents ===
    46300,
  "accountant import changed the cash figure",
);
await accountantBlocked.unmount();

const accountantZa = await accountantPath(accountantFile(za!, null), ZA_MARKET, ZA_MARKET);
assert(document.querySelector("[data-currency-gate]") == null, "a ZAR file shows no block");
await accept("confirm-import-figures");
const zaConfirm = buttonNamed("Confirm & import");
assert(zaConfirm && !zaConfirm.disabled, "a ZAR file on a ZA client can confirm");
await click(zaConfirm);
assert(accountantZa.seen[0]?.currency_label_confirm == null, "a matching file writes no label log");
await accountantZa.unmount();

const accountantUs = await accountantPath(accountantFile(usd, null), US_MARKET, US_MARKET);
assert(document.querySelector("[data-currency-gate]") == null, "a USD file on a US client shows no block");
assert(!document.body.textContent?.includes(za!), "accountant US review names the ZA code");
await accept("confirm-import-figures");
const usConfirm = buttonNamed("Confirm & import");
assert(usConfirm && !usConfirm.disabled, "a USD file on a US client can confirm");
await click(usConfirm);
assert(accountantUs.seen.length === 1, "US accountant import did not run");
await accountantUs.unmount();

const ownerBlocked = await ownerPath(
  ownerFile(za!, usdOnZaNote),
  ZA_MARKET,
  ZA_MARKET,
);
assert(document.querySelector("[data-currency-notice]")?.textContent === zaNotice, "owner notice");
await click(buttonNamed("Balance Sheet")!);
assert(document.body.textContent?.includes("$46,300"), document.body.textContent ?? "no owner review");
assert(!document.body.textContent?.includes("R 46"), "owner review relabelled the USD cash");
await accept("upload-quality-confirm");
const ownerConfirm = buttonNamed("Confirm & import figures");
assert(ownerConfirm?.disabled, "owner confirm stays disabled");
assert(ownerConfirm?.getAttribute("data-currency-block") === "1", "owner confirm is blocked");
await click(radio("cancel"));
assert(ownerConfirm?.disabled, "cancel does not enable the owner confirm");
await click(ownerConfirm!);
assert(ownerBlocked.seen.length === 0, "cancel imported the owner file");
await click(radio("label_wrong"));
assert(!ownerConfirm?.disabled, "the label confirmation enables the owner confirm");
await click(ownerConfirm!);
assert(ownerBlocked.seen[0]?.cash === "46300", `owner cash ${ownerBlocked.seen[0]?.cash}`);
assert(ownerBlocked.file.currency_label_confirm?.statement === zaOverride, "owner import log");
assert(ownerBlocked.file.currency_label_confirm?.choice === "label_wrong", "owner choice");
await ownerBlocked.unmount();

const ownerZa = await ownerPath(ownerFile(za!, null), ZA_MARKET, ZA_MARKET);
assert(document.querySelector("[data-currency-gate]") == null, "owner ZAR file shows no block");
await accept("upload-quality-confirm");
const ownerZaConfirm = buttonNamed("Confirm & import figures");
assert(ownerZaConfirm && !ownerZaConfirm.disabled, "a ZAR file on a ZA client can confirm on the owner path");
await click(ownerZaConfirm);
assert(ownerZa.seen.length === 1, "owner ZA import did not run");
await ownerZa.unmount();

const ownerUs = await ownerPath(ownerFile(usd, null), US_MARKET, US_MARKET);
assert(document.querySelector("[data-currency-gate]") == null, "owner USD file shows no block");
await click(buttonNamed("Balance Sheet")!);
assert(!document.body.textContent?.includes(za!), "owner US review names the ZA code");
assert(document.body.textContent?.includes("$46,300"), "owner US review dropped the cash");
await accept("upload-quality-confirm");
const ownerUsConfirm = buttonNamed("Confirm & import figures");
assert(ownerUsConfirm && !ownerUsConfirm.disabled, "a USD file on a US client can confirm on the owner path");
await click(ownerUsConfirm);
assert(ownerUs.seen[0]?.cash === "46300", `owner US cash ${ownerUs.seen[0]?.cash}`);
await ownerUs.unmount();

console.log("statement currency gate ok");
