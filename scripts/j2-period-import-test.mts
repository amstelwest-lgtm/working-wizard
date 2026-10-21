/**
 * YTD P&L, then a balance sheet, through the confirm each page actually calls.
 * Covers the accountant upload and the owner review: a same-day sheet, a sheet
 * dated before the P&L end, Add as Q3, Replace, and an unknown P&L range.
 * Run: pnpm test:j2-period-import
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Window } from "happy-dom";
import type { ExtractionResult } from "../src/lib/financialSchema";
import { liveHealthFromBooks } from "../src/lib/health-score";
import { ZA_MARKET, resolveMarket } from "../src/lib/market";
import {
  periodFinancialsFromExtraction,
  statementKindFromExtraction,
} from "../src/lib/statement-financials";
import {
  SET_PERIOD_DATES,
  confirmUploadedStatement,
  passStatementChoice,
  snapshotCoveringSpan,
  statementSpan,
  type ConfirmedStatement,
  type PeriodChoice,
} from "../src/lib/statement-import-plan";
import {
  mergeStatementFinancials,
  parseStatementText,
  statementKindFromMetadata,
} from "../src/lib/statement-parse";
import type { ConfirmedImportPeriod } from "../src/lib/import-period";
import type { MergedExtractionResult } from "../src/lib/extraction-types";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const US = resolveMarket({ country: "US", regionCode: "NY" });

process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "test-anon-key";
process.env.VITE_SUPABASE_URL ??= process.env.SUPABASE_URL;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??= process.env.SUPABASE_PUBLISHABLE_KEY;

const plText = readFileSync(new URL("./fixtures/demo-pl-sep-2026.csv", import.meta.url), "utf8");
const bsText = readFileSync(new URL("./fixtures/demo-bs-30sep-2026.csv", import.meta.url), "utf8");
const income = parseStatementText(plText);
const balance = parseStatementText(bsText);
assert(income.periodStart === "2026-01-01" && income.periodEnd === "2026-09-30", "YTD span");
assert(balance.kind === "balance_sheet", balance.kind);
assert(balance.periodStart == null && balance.periodEnd === "2026-09-30", "BS is an as-of date");
assert(balance.fields.cash === "46300", balance.fields.cash ?? "no cash");
assert(balance.fields.totalAssets === "179200", balance.fields.totalAssets ?? "no assets");

const ytdBooks = mergeStatementFinancials(
  {
    periodStart: income.periodStart,
    periodEnd: income.periodEnd,
    periodMonths: String(income.periodMonths),
  },
  income.fields,
  "income_statement",
);
const booksWithSheet = mergeStatementFinancials(
  ytdBooks,
  { ...balance.fields, periodEnd: balance.periodEnd },
  "balance_sheet",
);

const Q3 = `Profit and Loss,Jul 1 - Sep 30 2026
Account,Amount
Sales revenue,182000
Cost of sales,76000
Gross profit,106000
`;
const quarter = parseStatementText(Q3);
assert(quarter.periodStart === "2026-07-01" && quarter.periodEnd === "2026-09-30", "Q3 span");

const zaSlash = parseStatementText(
  "Profit and Loss,01/07/2026-30/09/2026\nAccount,Amount\nSales revenue,100000\n",
  ZA_MARKET,
);
assert(zaSlash.periodStart === "2026-07-01", zaSlash.periodStart ?? "ZA start");
assert(zaSlash.periodEnd === "2026-09-30", zaSlash.periodEnd ?? "ZA end");
assert(zaSlash.periodMonths === 3, `ZA months ${zaSlash.periodMonths}`);
const q3Label = parseStatementText(
  "Profit and Loss,Q3 2026\nAccount,Amount\nSales revenue,100000\n",
  US,
);
assert(q3Label.periodStart === "2026-07-01" && q3Label.periodEnd === "2026-09-30", "Q3 2026");
assert(q3Label.periodMonths === 3, `Q3 months ${q3Label.periodMonths}`);

function num(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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

function emptySheet() {
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
    total_equity_and_liabilities: null,
  };
}

function extraction(input: {
  periodStart?: string | null;
  periodEnd?: string | null;
  periodMonths?: number | null;
  income?: Partial<ReturnType<typeof emptyIncome>>;
  sheet?: Partial<ReturnType<typeof emptySheet>> & {
    current_assets?: Partial<ReturnType<typeof emptySheet>["current_assets"]>;
    equity?: Partial<ReturnType<typeof emptySheet>["equity"]>;
    current_liabilities?: Partial<ReturnType<typeof emptySheet>["current_liabilities"]>;
  };
}): ExtractionResult {
  const sheet = emptySheet();
  const patch = input.sheet ?? {};
  return {
    entity_name: "Practice Demo Client",
    registration_number: null,
    currency: "USD",
    units: "actual",
    statement_basis: "management_accounts",
    current_period: {
      period_start: input.periodStart ?? null,
      period_end: input.periodEnd ?? null,
      period_months: input.periodMonths ?? null,
      figures: {
        income_statement: { ...emptyIncome(), ...input.income },
        balance_sheet: {
          ...sheet,
          ...patch,
          current_assets: { ...sheet.current_assets, ...patch.current_assets },
          equity: { ...sheet.equity, ...patch.equity },
          current_liabilities: { ...sheet.current_liabilities, ...patch.current_liabilities },
        },
        cash_flow: null,
      },
    },
    comparative_period: null,
    extraction_notes: null,
  };
}

const bsReview = extraction({
  periodEnd: balance.periodEnd,
  sheet: {
    total_assets: num(balance.fields.totalAssets),
    total_liabilities: num(balance.fields.totalLiabilities),
    current_assets: {
      cash_and_cash_equivalents: num(balance.fields.cash),
      inventories: num(balance.fields.inventory),
      trade_and_other_receivables: num(balance.fields.receivables),
      total: num(balance.fields.currentAssets),
    },
    equity: { total: num(balance.fields.equity) },
    current_liabilities: {
      trade_and_other_payables: num(balance.fields.payables),
      total: num(balance.fields.currentLiabilities),
    },
  },
});
assert(statementKindFromExtraction(bsReview) === "balance_sheet", "review is a balance sheet");
const bsFlat = periodFinancialsFromExtraction(bsReview);
assert(bsFlat.cash === "46300", bsFlat.cash);
assert(bsFlat.totalAssets === "179200", bsFlat.totalAssets);

const earlyReview = extraction({
  periodEnd: "2026-06-30",
  sheet: {
    total_assets: 90000,
    total_liabilities: 40000,
    current_assets: { cash_and_cash_equivalents: 12000, total: 40000 },
    equity: { total: 50000 },
    current_liabilities: { trade_and_other_payables: 8000, total: 20000 },
  },
});
assert(statementKindFromExtraction(earlyReview) === "balance_sheet", "June sheet is a balance sheet");
assert(earlyReview.current_period.period_start == null, "June sheet has no start");

const q3Review = extraction({
  periodStart: quarter.periodStart,
  periodEnd: quarter.periodEnd,
  periodMonths: quarter.periodMonths,
  income: {
    revenue: num(quarter.fields.revenue),
    cost_of_sales: num(quarter.fields.cogs),
    gross_profit: num(quarter.fields.grossProfit),
  },
});

const unknownReview = extraction({
  income: { revenue: 100000, cost_of_sales: 40000, gross_profit: 60000 },
});

function ownerReview(
  source: ExtractionResult,
  documentType: "income_statement" | "balance_sheet",
): MergedExtractionResult {
  const income = source.current_period.figures.income_statement;
  const sheet = source.current_period.figures.balance_sheet;
  const blank = (n: number | null | undefined) => n ?? null;
  return {
    document_metadata: {
      company_name: source.entity_name,
      registration_number: null,
      period_start_date: source.current_period.period_start ?? null,
      period_end_date: source.current_period.period_end,
      period_months: source.current_period.period_months ?? null,
      prior_period_start_date: null,
      prior_period_end_date: null,
      document_type: documentType,
      financial_statement_type: "management_accounts",
      prepared_by: null,
      auditor_firm: null,
      approval_date: null,
      industry_description: null,
      functional_currency: "USD",
      foreign_currency_exposure: null,
      headcount: null,
      accounting_basis: "accrual",
      values_appear_in_thousands: false,
      contains_income_statement: documentType === "income_statement",
      contains_balance_sheet: documentType === "balance_sheet",
      contains_cash_flow_statement: false,
      contains_notes: false,
    },
    current_period: {
      income_statement: {
        revenue: blank(income.revenue),
        cogs: blank(income.cost_of_sales),
        gross_profit: blank(income.gross_profit),
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
        net_income: blank(income.profit_after_tax),
        director_remuneration: null,
        dividends_declared: null,
      },
      balance_sheet: {
        total_assets: blank(sheet.total_assets),
        fixed_assets: null,
        goodwill: null,
        intangible_assets: null,
        right_of_use_assets: null,
        current_assets: blank(sheet.current_assets.total),
        inventory: blank(sheet.current_assets.inventories),
        wip: null,
        debtors: blank(sheet.current_assets.trade_and_other_receivables),
        provision_bad_debts: null,
        cash: blank(sheet.current_assets.cash_and_cash_equivalents),
        other_current_assets: null,
        total_liabilities: blank(sheet.total_liabilities),
        current_liabilities: blank(sheet.current_liabilities.total),
        creditors: blank(sheet.current_liabilities.trade_and_other_payables),
        short_term_debt: null,
        lease_liabilities_current: null,
        other_current_liabilities: null,
        non_current_liabilities: null,
        long_term_debt: null,
        lease_liabilities_non_current: null,
        deferred_tax_liability: null,
        deferred_tax_asset: null,
        equity: blank(sheet.equity.total),
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
        income_statement: "high",
        balance_sheet: "high",
        cash_flow: "not_found",
        expenses_detail: "not_found",
        income_detail: "not_found",
        notes: "not_found",
      },
      overall_confidence: "high",
      extraction_notes: "",
    },
    source_map: {},
    conflicts: [],
    normalisation_applied: false,
    document_count: 1,
    file_names: ["upload.csv"],
  };
}

const window = new Window({
  url: "http://127.0.0.1:5000/clients/demo",
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

const { createElement } = await import("react");
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { UploadFinancials } = await import("../src/components/upload-financials");
const { ExtractionReviewModal } = await import("../src/components/extraction-review-modal");

async function tick() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mount(node: ReturnType<typeof createElement>) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const render = async (next: ReturnType<typeof createElement>) => {
    await act(async () => {
      root.render(next);
    });
    await tick();
  };
  await render(node);
  const unmount = Object.assign(
    async () => {
      await act(async () => {
        root.unmount();
      });
      host.remove();
    },
    { rerender: render },
  );
  return unmount;
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

async function setDate(id: string, value: string) {
  const el = document.getElementById(id);
  assert(el instanceof HTMLInputElement, `${id} is a date input`);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await tick();
}

function matchQuarterSnapshot(fileSpan: { periodStart: string; periodEnd: string } | null) {
  assert(typeof snapshotCoveringSpan === "function", "snapshotCoveringSpan is not a function");
  const rows = [
    { financials: { periodStart: "2026-01-01", periodEnd: "2026-09-30", revenue: "900" } },
    { financials: { periodStart: "2026-07-01", periodEnd: "2026-09-30", revenue: "182000" } },
  ];
  const match = snapshotCoveringSpan(rows, fileSpan);
  assert(match?.financials.revenue === "182000", "Add as Q3 did not match the quarter snapshot");
}

function pageConfirm(existing: Record<string, unknown>) {
  const calls: Array<{ choice: PeriodChoice | null; periodStart: string | null; periodEnd: string }> = [];
  let planned: ConfirmedStatement | null = null;
  const confirm = passStatementChoice(
    (
      result: ExtractionResult,
      _prefs: unknown,
      period: ConfirmedImportPeriod,
      choice?: PeriodChoice | null,
    ) => {
      calls.push({
        choice: choice ?? null,
        periodStart: period.periodStart ?? null,
        periodEnd: period.periodEnd,
      });
      planned = confirmUploadedStatement({
        existing,
        incoming: { ...periodFinancialsFromExtraction(result) },
        kind: statementKindFromExtraction(result),
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        periodMonths: period.periodMonths,
        choice: choice ?? null,
        market: US,
        fyStartMonth: 1,
        pillarsBefore: liveHealthFromBooks({
          financials: existing,
          fyStartMonth: 1,
          market: US,
        }).pillars,
      });
      if (planned.action === "choose") {
        return {
          ok: false as const,
          message: planned.message,
          choice: { replaceLabel: planned.replaceLabel, addLabel: planned.addLabel },
        };
      }
      if (planned.action === "block") {
        return { ok: false as const, message: planned.message };
      }
      if (planned.action === "history") matchQuarterSnapshot(planned.span);
      return { ok: true as const, message: planned.message };
    },
  );
  return {
    confirm,
    calls,
    last: () => planned,
  };
}

const bsPage = pageConfirm(ytdBooks as Record<string, unknown>);
const unmountBs = await mount(
  createElement(UploadFinancials, {
    seedReview: bsReview,
    booksHaveSpan: true,
    onConfirm: bsPage.confirm,
  }),
);
assert(
  document.body.textContent?.includes("Importing as Sep 2026 (period end 2026-09-30)"),
  document.body.textContent?.slice(0, 500) ?? "no review",
);
assert(document.getElementById("import-period-start") == null, "a balance sheet does not ask for a start date");
assert(document.getElementById("import-period-month") instanceof HTMLSelectElement, "month stays for the as-of date");
const bsConfirm = buttonNamed("Confirm & import");
assert(bsConfirm?.disabled, "confirm waits for the quality checkbox");
const bsCheck = document.getElementById("confirm-import-figures");
assert(bsCheck instanceof HTMLInputElement, "quality checkbox");
await click(bsCheck);
assert(!bsConfirm?.disabled, "a detected balance-sheet date can confirm");
await click(bsConfirm!);
const bsCall = bsPage.calls[0];
assert(bsCall?.periodEnd === "2026-09-30", bsCall?.periodEnd ?? "no end");
assert(bsCall?.periodStart == null, `balance sheet invented a start (${bsCall?.periodStart})`);
const bsPlanned = bsPage.last();
assert(bsPlanned?.action === "live", bsPlanned?.action ?? "no plan");
assert(!bsPlanned?.message.includes("Couldn't read"), bsPlanned?.message ?? "no message");
assert(bsPlanned?.live?.cash === "46300", `cash ${bsPlanned?.live?.cash}`);
assert(bsPlanned?.live?.totalAssets === "179200", `assets ${bsPlanned?.live?.totalAssets}`);
assert(bsPlanned?.live?.periodStart === "2026-01-01", `span start ${bsPlanned?.live?.periodStart}`);
assert(bsPlanned?.live?.periodEnd === "2026-09-30", `span end ${bsPlanned?.live?.periodEnd}`);
assert(bsPlanned?.live?.sheetPillarsHeld == null, "the new balance sheet is allowed to rescore");
const health = liveHealthFromBooks({
  financials: bsPlanned?.live ?? {},
  fyStartMonth: 1,
  market: US,
});
const scores = Object.fromEntries(health.pillars.map((pillar) => [pillar.id, pillar.score]));
for (const id of ["profit", "assets", "financing", "cash"]) {
  assert(typeof scores[id] === "number", `${id} is not scored (${JSON.stringify(scores)})`);
}
await unmountBs();

const earlyPage = pageConfirm(ytdBooks as Record<string, unknown>);
const unmountEarly = await mount(
  createElement(UploadFinancials, {
    seedReview: earlyReview,
    booksHaveSpan: true,
    onConfirm: earlyPage.confirm,
  }),
);
assert(
  document.body.textContent?.includes("Importing as Jun 2026 (period end 2026-06-30)"),
  "June sheet shows its own as-of date",
);
assert(document.getElementById("import-period-start") == null, "an earlier balance sheet does not ask for a range");
const earlyCheck = document.getElementById("confirm-import-figures");
assert(earlyCheck instanceof HTMLInputElement, "June quality checkbox");
await click(earlyCheck);
const earlyConfirm = buttonNamed("Confirm & import");
assert(earlyConfirm && !earlyConfirm.disabled, "an earlier as-of date can confirm");
await click(earlyConfirm);
assert(earlyPage.calls[0]?.periodEnd === "2026-06-30", earlyPage.calls[0]?.periodEnd ?? "no June end");
assert(earlyPage.calls[0]?.periodStart == null, "June sheet invented a start");
const earlyPlanned = earlyPage.last();
assert(earlyPlanned?.action === "live", earlyPlanned?.action ?? earlyPlanned?.message ?? "June blocked");
assert(!earlyPlanned?.message.includes("Couldn't read"), earlyPlanned?.message ?? "no June message");
assert(earlyPlanned?.live?.cash === "12000", `June cash ${earlyPlanned?.live?.cash}`);
assert(earlyPlanned?.live?.totalAssets === "90000", `June assets ${earlyPlanned?.live?.totalAssets}`);
assert(earlyPlanned?.live?.periodStart === "2026-01-01", `June moved the start to ${earlyPlanned?.live?.periodStart}`);
assert(earlyPlanned?.live?.periodEnd === "2026-09-30", `June moved the end to ${earlyPlanned?.live?.periodEnd}`);
assert(earlyPlanned?.live?.periodMonths === "9", `June moved the months to ${earlyPlanned?.live?.periodMonths}`);
assert(earlyPlanned?.live?.revenue === ytdBooks.revenue, `June changed revenue to ${earlyPlanned?.live?.revenue}`);
assert(ytdBooks.periodStart === "2026-01-01" && ytdBooks.periodEnd === "2026-09-30", "June import rewrote the stored books");
await unmountEarly();

const q3Page = pageConfirm(booksWithSheet as Record<string, unknown>);
const unmountQ3 = await mount(
  createElement(UploadFinancials, {
    seedReview: q3Review,
    booksHaveSpan: true,
    onConfirm: q3Page.confirm,
  }),
);
const q3Check = document.getElementById("confirm-import-figures");
assert(q3Check instanceof HTMLInputElement, "Q3 quality checkbox");
await click(q3Check);
const q3Confirm = buttonNamed("Confirm & import");
assert(q3Confirm && !q3Confirm.disabled, "Q3 confirm is enabled");
await click(q3Confirm);
assert(q3Page.calls[0]?.choice == null, "the first confirm has not chosen yet");
const asked = q3Page.last();
assert(asked?.action === "choose", asked?.action ?? "no choice");
assert(asked?.addLabel === "Add as Q3", asked?.addLabel ?? "no add label");
assert(
  asked?.message ===
    "This file covers Jul 1 – Sep 30, 2026 (3 months). The books show Jan 1 – Sep 30, 2026 (9 months). Replace the year-to-date figures, or add this as Q3?",
  asked?.message ?? "no question",
);
assert(document.body.textContent?.includes(asked?.message ?? "missing"), "the question is on the page");
const addQ3 = document.querySelector("[data-import-choice='add_period']");
assert(addQ3 instanceof HTMLButtonElement, "Add as Q3 is a button");
assert(addQ3.textContent?.includes("Add as Q3"), addQ3.textContent ?? "label");
await click(addQ3);
assert(q3Page.calls[1]?.choice === "add_period", `second call choice ${q3Page.calls[1]?.choice}`);
const added = q3Page.last();
assert(added?.action === "history", added?.action ?? "looped");
assert(!document.body.textContent?.includes("is not a function"), document.body.textContent ?? "add failed");
assert(!document.body.textContent?.includes("Import failed"), document.body.textContent ?? "add failed");
assert(added?.live == null, "add as Q3 does not replace the year-to-date books");
assert(added?.history?.revenue === "182000", `history revenue ${added?.history?.revenue}`);
assert(booksWithSheet.periodStart === "2026-01-01" && booksWithSheet.periodEnd === "2026-09-30", "live span unchanged");
await unmountQ3();

const replacePage = pageConfirm(booksWithSheet as Record<string, unknown>);
const unmountReplace = await mount(
  createElement(UploadFinancials, {
    seedReview: q3Review,
    booksHaveSpan: true,
    onConfirm: replacePage.confirm,
  }),
);
const replaceCheck = document.getElementById("confirm-import-figures");
assert(replaceCheck instanceof HTMLInputElement, "replace quality checkbox");
await click(replaceCheck);
const replaceConfirm = buttonNamed("Confirm & import");
assert(replaceConfirm, "replace confirm");
await click(replaceConfirm);
const replaceButton = document.querySelector("[data-import-choice='replace_ytd']");
assert(replaceButton instanceof HTMLButtonElement, "Replace is a button");
await click(replaceButton);
assert(replacePage.calls[1]?.choice === "replace_ytd", `replace choice ${replacePage.calls[1]?.choice}`);
const replaced = replacePage.last();
assert(replaced?.action === "live", replaced?.action ?? "replace looped");
assert(replaced?.live?.periodStart === "2026-07-01", String(replaced?.live?.periodStart));
assert(replaced?.live?.periodEnd === "2026-09-30", String(replaced?.live?.periodEnd));
assert(replaced?.live?.revenue === "182000", `replaced revenue ${replaced?.live?.revenue}`);
assert(replaced?.live?.cash === "46300", `replaced cash ${replaced?.live?.cash}`);
await unmountReplace();

const unknownPage = pageConfirm(ytdBooks as Record<string, unknown>);
const unmountUnknown = await mount(
  createElement(UploadFinancials, {
    seedReview: unknownReview,
    booksHaveSpan: true,
    onConfirm: unknownPage.confirm,
  }),
);
const start = document.getElementById("import-period-start");
const end = document.getElementById("import-period-end");
assert(start instanceof HTMLInputElement && start.type === "date", "accountant start date");
assert(end instanceof HTMLInputElement && end.type === "date", "accountant end date");
assert(document.body.textContent?.includes(SET_PERIOD_DATES), "the screen uses the server sentence");
assert(document.getElementById("import-period-month") == null, "month is not a stand-in for the range");
const unknownCheck = document.getElementById("confirm-import-figures");
assert(unknownCheck instanceof HTMLInputElement, "unknown quality checkbox");
await click(unknownCheck);
const unknownConfirm = buttonNamed("Confirm & import");
assert(unknownConfirm?.disabled, "confirm stays off until both dates are set");
await setDate("import-period-start", "2026-09-30");
await setDate("import-period-end", "2026-07-01");
assert(unknownConfirm?.disabled, "an end before the start does not enable confirm");
await setDate("import-period-start", "2026-07-01");
await setDate("import-period-end", "2026-09-30");
assert(!unknownConfirm?.disabled, "both dates enable confirm");
await click(unknownConfirm!);
assert(unknownPage.calls[0]?.periodStart === "2026-07-01", unknownPage.calls[0]?.periodStart ?? "no start");
assert(unknownPage.calls[0]?.periodEnd === "2026-09-30", unknownPage.calls[0]?.periodEnd ?? "no end");
const ranged = unknownPage.last();
assert(ranged?.action === "choose", ranged?.action ?? ranged?.message ?? "no plan");
await unmountUnknown();

function ownerConfirm(existing: Record<string, unknown>, review: MergedExtractionResult) {
  const calls: Array<{ choice: PeriodChoice | null; periodStart: string | null; periodEnd: string | null }> = [];
  let planned: ConfirmedStatement | null = null;
  const onConfirm = (
    mapped: Record<string, string | undefined>,
    _prefs: unknown,
    choice?: PeriodChoice | null,
    periodOverride?: { periodStart: string; periodEnd: string; periodMonths: number } | null,
  ) => {
    const meta = review.document_metadata;
    const resolvedStart = periodOverride?.periodStart ?? meta.period_start_date ?? null;
    const resolvedEnd = periodOverride?.periodEnd ?? meta.period_end_date ?? null;
    const resolvedMonths = periodOverride?.periodMonths ?? meta.period_months ?? null;
    const incoming: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(mapped)) {
      if (typeof val === "string" && val.trim()) incoming[key] = val;
    }
    if (resolvedMonths) incoming.periodMonths = String(resolvedMonths);
    if (resolvedStart) incoming.periodStart = resolvedStart;
    if (resolvedEnd) incoming.periodEnd = resolvedEnd;
    calls.push({ choice: choice ?? null, periodStart: resolvedStart, periodEnd: resolvedEnd });
    planned = confirmUploadedStatement({
      existing,
      incoming,
      kind: statementKindFromMetadata(meta),
      periodStart: resolvedStart,
      periodEnd: resolvedEnd,
      periodMonths: resolvedMonths,
      choice: choice ?? null,
      market: US,
      fyStartMonth: 1,
      pillarsBefore: liveHealthFromBooks({
        financials: existing,
        fyStartMonth: 1,
        market: US,
      }).pillars,
    });
    if (planned.action === "choose") {
      return {
        ok: false as const,
        message: planned.message,
        choice: { replaceLabel: planned.replaceLabel, addLabel: planned.addLabel },
      };
    }
    if (planned.action === "block") return { ok: false as const, message: planned.message };
    if (planned.action === "history") matchQuarterSnapshot(planned.span);
    return { ok: true as const, message: planned.message };
  };
  return { onConfirm, calls, last: () => planned };
}

async function acceptOwner() {
  const box = document.getElementById("upload-quality-confirm");
  assert(box instanceof HTMLInputElement, "owner quality checkbox");
  await click(box);
  const button = buttonNamed("Confirm & import figures");
  assert(button, "owner confirm button");
  return button;
}

const ownerBs = ownerConfirm(ytdBooks as Record<string, unknown>, ownerReview(bsReview, "balance_sheet"));
const unmountOwnerBs = await mount(
  createElement(ExtractionReviewModal, {
    result: ownerReview(bsReview, "balance_sheet"),
    open: true,
    booksHaveSpan: true,
    onClose: () => {},
    onConfirm: ownerBs.onConfirm,
  }),
);
assert(document.getElementById("import-period-start") == null, "owner balance sheet has no start field");
const ownerBsConfirm = await acceptOwner();
assert(!ownerBsConfirm.disabled, "owner balance sheet can confirm from its as-of date");
await click(ownerBsConfirm);
assert(ownerBs.calls[0]?.periodEnd === "2026-09-30", ownerBs.calls[0]?.periodEnd ?? "owner BS dropped the end");
assert(ownerBs.calls[0]?.periodStart == null, "owner balance sheet invented a start");
const ownerBsPlanned = ownerBs.last();
assert(ownerBsPlanned?.action === "live", ownerBsPlanned?.action ?? "owner BS blocked");
assert(ownerBsPlanned?.live?.cash === "46300", `owner cash ${ownerBsPlanned?.live?.cash}`);
assert(ownerBsPlanned?.live?.totalAssets === "179200", `owner assets ${ownerBsPlanned?.live?.totalAssets}`);
assert(ownerBsPlanned?.live?.periodStart === "2026-01-01", `owner BS start ${ownerBsPlanned?.live?.periodStart}`);
assert(ownerBsPlanned?.live?.periodEnd === "2026-09-30", `owner BS end ${ownerBsPlanned?.live?.periodEnd}`);
await unmountOwnerBs();

const ownerEarly = ownerConfirm(
  ytdBooks as Record<string, unknown>,
  ownerReview(earlyReview, "balance_sheet"),
);
const unmountOwnerEarly = await mount(
  createElement(ExtractionReviewModal, {
    result: ownerReview(earlyReview, "balance_sheet"),
    open: true,
    booksHaveSpan: true,
    onClose: () => {},
    onConfirm: ownerEarly.onConfirm,
  }),
);
const ownerEarlyConfirm = await acceptOwner();
await click(ownerEarlyConfirm);
assert(ownerEarly.calls[0]?.periodEnd === "2026-06-30", ownerEarly.calls[0]?.periodEnd ?? "owner June end");
const ownerEarlyPlanned = ownerEarly.last();
assert(ownerEarlyPlanned?.action === "live", ownerEarlyPlanned?.action ?? "owner June blocked");
assert(ownerEarlyPlanned?.live?.cash === "12000", `owner June cash ${ownerEarlyPlanned?.live?.cash}`);
assert(ownerEarlyPlanned?.live?.totalAssets === "90000", `owner June assets ${ownerEarlyPlanned?.live?.totalAssets}`);
assert(ownerEarlyPlanned?.live?.periodStart === "2026-01-01", `owner June start ${ownerEarlyPlanned?.live?.periodStart}`);
assert(ownerEarlyPlanned?.live?.periodEnd === "2026-09-30", `owner June end ${ownerEarlyPlanned?.live?.periodEnd}`);
assert(ownerEarlyPlanned?.live?.revenue === ytdBooks.revenue, "owner June changed the P&L");
await unmountOwnerEarly();

const ownerQ3Review = ownerReview(q3Review, "income_statement");
const ownerQ3 = ownerConfirm(booksWithSheet as Record<string, unknown>, ownerQ3Review);
const unmountOwnerQ3 = await mount(
  createElement(ExtractionReviewModal, {
    result: ownerQ3Review,
    open: true,
    booksHaveSpan: true,
    onClose: () => {},
    onConfirm: ownerQ3.onConfirm,
  }),
);
await click(await acceptOwner());
assert(ownerQ3.calls[0]?.choice == null, "owner Q3 has not chosen yet");
const ownerAsked = ownerQ3.last();
assert(ownerAsked?.action === "choose", ownerAsked?.action ?? "owner Q3 skipped the question");
assert(ownerAsked?.addLabel === "Add as Q3", ownerAsked?.addLabel ?? "owner add label");
const ownerAdd = document.querySelector("[data-import-choice='add_period']");
assert(ownerAdd instanceof HTMLButtonElement, "owner Add as Q3 is a button");
await click(ownerAdd);
assert(ownerQ3.calls[1]?.choice === "add_period", `owner second choice ${ownerQ3.calls[1]?.choice}`);
const ownerAdded = ownerQ3.last();
assert(ownerAdded?.action === "history", ownerAdded?.action ?? "owner Add as Q3 looped");
assert(!document.body.textContent?.includes("is not a function"), document.body.textContent ?? "owner add failed");
assert(!document.body.textContent?.includes("Import failed"), document.body.textContent ?? "owner add failed");
assert(ownerAdded?.live == null, "owner Add as Q3 rewrote the live books");
assert(ownerAdded?.history?.revenue === "182000", `owner history revenue ${ownerAdded?.history?.revenue}`);
await unmountOwnerQ3();

const ownerReplaceReview = ownerReview(q3Review, "income_statement");
const ownerReplace = ownerConfirm(booksWithSheet as Record<string, unknown>, ownerReplaceReview);
const unmountOwnerReplace = await mount(
  createElement(ExtractionReviewModal, {
    result: ownerReplaceReview,
    open: true,
    booksHaveSpan: true,
    onClose: () => {},
    onConfirm: ownerReplace.onConfirm,
  }),
);
await click(await acceptOwner());
const ownerReplaceButton = document.querySelector("[data-import-choice='replace_ytd']");
assert(ownerReplaceButton instanceof HTMLButtonElement, "owner Replace is a button");
await click(ownerReplaceButton);
assert(ownerReplace.calls[1]?.choice === "replace_ytd", `owner replace choice ${ownerReplace.calls[1]?.choice}`);
const ownerReplaced = ownerReplace.last();
assert(ownerReplaced?.action === "live", ownerReplaced?.action ?? "owner Replace looped");
assert(ownerReplaced?.live?.periodStart === "2026-07-01", String(ownerReplaced?.live?.periodStart));
assert(ownerReplaced?.live?.periodEnd === "2026-09-30", String(ownerReplaced?.live?.periodEnd));
assert(ownerReplaced?.live?.revenue === "182000", `owner replaced revenue ${ownerReplaced?.live?.revenue}`);
assert(ownerReplaced?.live?.cash === "46300", `owner replaced cash ${ownerReplaced?.live?.cash}`);
await unmountOwnerReplace();

const ownerUnknownReview = ownerReview(unknownReview, "income_statement");
const ownerUnknown = ownerConfirm(ytdBooks as Record<string, unknown>, ownerUnknownReview);
const unmountOwnerUnknown = await mount(
  createElement(ExtractionReviewModal, {
    result: ownerUnknownReview,
    open: true,
    booksHaveSpan: true,
    onClose: () => {},
    onConfirm: ownerUnknown.onConfirm,
  }),
);
assert(document.getElementById("import-period-start") instanceof HTMLInputElement, "owner start date");
assert(document.getElementById("import-period-end") instanceof HTMLInputElement, "owner end date");
assert(document.body.textContent?.includes(SET_PERIOD_DATES), "owner uses the same sentence");
const ownerUnknownConfirm = await acceptOwner();
assert(ownerUnknownConfirm.disabled, "owner confirm stays off until both dates are set");
await setDate("import-period-start", "2026-09-30");
await setDate("import-period-end", "2026-07-01");
assert(ownerUnknownConfirm.disabled, "owner rejects an end before the start");
await setDate("import-period-start", "2026-07-01");
await setDate("import-period-end", "2026-09-30");
assert(!ownerUnknownConfirm.disabled, "owner confirm enables once the range is set");
await click(ownerUnknownConfirm);
assert(ownerUnknown.calls[0]?.periodStart === "2026-07-01", ownerUnknown.calls[0]?.periodStart ?? "owner dropped the start");
assert(ownerUnknown.calls[0]?.periodEnd === "2026-09-30", ownerUnknown.calls[0]?.periodEnd ?? "owner dropped the end");
const ownerRanged = ownerUnknown.last();
assert(ownerRanged?.action === "choose", ownerRanged?.action ?? ownerRanged?.message ?? "owner unknown did not ask");
assert(ownerRanged?.addLabel === "Add as Q3", ownerRanged?.addLabel ?? "owner unknown add label");
await unmountOwnerUnknown();

const clientPage = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
const ownerPage = readFileSync(resolve("src/routes/app.tsx"), "utf8");
const ratiosPage = readFileSync(resolve("src/components/accountant-ratios.tsx"), "utf8");
assert(clientPage.includes("passStatementChoice(handleConfirmFinancials)"), "accountant page forwards the choice");
assert(
  !clientPage.includes("handleConfirmFinancials(result, prefs, period)"),
  "accountant page does not drop the choice",
);
assert(clientPage.includes("confirmUploadedStatement"), "accountant confirm uses the shared plan");
assert(ownerPage.includes("confirmUploadedStatement"), "owner confirm uses the shared plan");
assert(ownerPage.includes("periodChoice"), "owner still passes the choice");
assert(ownerPage.includes("periodOverride"), "owner keeps a typed range");
assert(ratiosPage.includes("booksHaveSpan"), "ratios review knows when the books have a span");
assert(ratiosPage.includes("period?.periodStart"), "ratios confirm keeps a typed range");

const nextFile = extraction({
  periodStart: "2026-07-01",
  periodEnd: "2026-09-30",
  periodMonths: 3,
  income: { revenue: 5000, cost_of_sales: 1000, gross_profit: 4000 },
});

const failedUpload = await mount(
  createElement(UploadFinancials, {
    seedReview: q3Review,
    booksHaveSpan: true,
    onConfirm: async () => {
      throw new Error("sn is not a function");
    },
  }),
);
const failedCheck = document.getElementById("confirm-import-figures");
assert(failedCheck instanceof HTMLInputElement, "failed upload checkbox");
await click(failedCheck);
const failedConfirm = buttonNamed("Confirm & import");
assert(failedConfirm, "failed upload confirm");
await click(failedConfirm);
assert(
  document.body.textContent?.includes("Import failed. sn is not a function"),
  document.body.textContent ?? "no failure",
);
assert(buttonNamed("Retry import"), "a failed import offers Retry");
const differentFile = buttonNamed("Upload different file");
assert(differentFile, "upload a different file");
await click(differentFile);
assert(!document.body.textContent?.includes("Import failed"), "leaving the file clears the error");
assert(!buttonNamed("Retry import"), "the idle upload is not Retry");
await failedUpload.rerender(
  createElement(UploadFinancials, {
    seedReview: nextFile,
    booksHaveSpan: true,
    onConfirm: async () => {
      throw new Error("sn is not a function");
    },
  }),
);
assert(!document.body.textContent?.includes("Import failed"), "the next file does not keep the error");
assert(!buttonNamed("Retry import"), "the next file is not Retry import");
const nextConfirm = buttonNamed("Confirm & import");
assert(nextConfirm && !nextConfirm.textContent?.includes("Retry"), nextConfirm?.textContent ?? "no confirm");
await failedUpload();

const failedOwnerReview = ownerReview(q3Review, "income_statement");
const failedOwner = await mount(
  createElement(ExtractionReviewModal, {
    result: failedOwnerReview,
    open: true,
    booksHaveSpan: true,
    onClose: () => {},
    onConfirm: async () => {
      throw new Error("sn is not a function");
    },
  }),
);
await click(await acceptOwner());
assert(
  document.body.textContent?.includes("Import failed. sn is not a function"),
  document.body.textContent ?? "owner failure missing",
);
assert(buttonNamed("Retry import"), "owner failed import offers Retry");
const nextOwnerReview = ownerReview(nextFile, "income_statement");
await failedOwner.rerender(
  createElement(ExtractionReviewModal, {
    result: nextOwnerReview,
    open: true,
    booksHaveSpan: true,
    onClose: () => {},
    onConfirm: async () => {
      throw new Error("sn is not a function");
    },
  }),
);
assert(!document.body.textContent?.includes("Import failed"), "owner next file keeps the error");
assert(buttonNamed("Confirm & import figures"), "owner next file confirms");
assert(!buttonNamed("Retry import"), "owner next file is not Retry");
const ownerBox = document.getElementById("upload-quality-confirm");
assert(ownerBox instanceof HTMLInputElement, "owner quality checkbox after a new file");
if (!ownerBox.checked) await click(ownerBox);
const ownerFailAgain = buttonNamed("Confirm & import figures");
assert(ownerFailAgain && !ownerFailAgain.disabled, "owner can confirm the new file");
await click(ownerFailAgain);
assert(buttonNamed("Retry import"), "owner failure can return");
await failedOwner.rerender(
  createElement(ExtractionReviewModal, {
    result: nextOwnerReview,
    open: false,
    booksHaveSpan: true,
    onClose: () => {},
    onConfirm: async () => {
      throw new Error("sn is not a function");
    },
  }),
);
await failedOwner.rerender(
  createElement(ExtractionReviewModal, {
    result: nextOwnerReview,
    open: true,
    booksHaveSpan: true,
    onClose: () => {},
    onConfirm: async () => {
      throw new Error("sn is not a function");
    },
  }),
);
assert(!document.body.textContent?.includes("Import failed"), "reopening the owner dialog keeps the error");
assert(buttonNamed("Confirm & import figures"), "reopened owner dialog confirms");
assert(!buttonNamed("Retry import"), "reopened owner dialog is not Retry");
await failedOwner();

const ts = await import("typescript");
const calledSpan = statementSpan("2026-07-01", "2026-09-30");
assert(calledSpan?.periodStart === "2026-07-01" && calledSpan.periodEnd === "2026-09-30", "statementSpan reads Q3");
assert(calledSpan?.months === 3, `statementSpan months ${calledSpan?.months}`);
const covered = snapshotCoveringSpan(
  [
    { financials: { periodStart: "2026-01-01", periodEnd: "2026-09-30", revenue: "900" } },
    { financials: { periodStart: "2026-07-01", periodEnd: "2026-09-30", revenue: "182000" } },
  ],
  calledSpan,
);
assert(covered?.financials.revenue === "182000", "snapshotCoveringSpan missed Q3");

function statementSpanCalls(file: string): ts.Identifier[] {
  const text = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const calls: ts.Identifier[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "statementSpan"
    ) {
      calls.push(node.expression);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return calls;
}

function localNamed(file: string, name: string): string | null {
  const text = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let detail: string | null = null;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      detail = node.initializer ? node.initializer.getText(sf).slice(0, 80) : name;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return detail;
}

function resolveBinding(sf: ts.SourceFile, ident: ts.Identifier): { kind: string; detail: string } {
  let current: ts.Node | undefined = ident.parent;
  while (current) {
    const found = declaredIn(sf, current, ident.text);
    if (found) return found;
    current = current.parent;
  }
  return { kind: "missing", detail: ident.text };
}

function declaredIn(
  sf: ts.SourceFile,
  node: ts.Node,
  name: string,
): { kind: string; detail: string } | null {
  if (ts.isSourceFile(node)) {
    for (const stmt of node.statements) {
      if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === name) return { kind: "function", detail: name };
      if (!ts.isImportDeclaration(stmt) || !stmt.importClause?.namedBindings) continue;
      if (!ts.isNamedImports(stmt.importClause.namedBindings)) continue;
      for (const spec of stmt.importClause.namedBindings.elements) {
        if (spec.name.text === name) {
          const from = ts.isStringLiteral(stmt.moduleSpecifier) ? stmt.moduleSpecifier.text : "";
          return { kind: "import", detail: from };
        }
      }
    }
  }
  const params =
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
      ? node.parameters
      : undefined;
  if (params) {
    for (const param of params) {
      if (ts.isIdentifier(param.name) && param.name.text === name) return { kind: "param", detail: name };
    }
  }
  if (
    (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) &&
    node.name &&
    ts.isIdentifier(node.name) &&
    node.name.text === name
  ) {
    return { kind: "function", detail: name };
  }
  const body = ts.isBlock(node)
    ? node
    : (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) &&
        node.body &&
        ts.isBlock(node.body)
      ? node.body
      : null;
  if (!body) return null;
  for (const stmt of body.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.name.text === name) {
        return { kind: "local", detail: decl.initializer ? decl.initializer.getText(sf).slice(0, 120) : name };
      }
    }
  }
  return null;
}

for (const file of ["src/routes/_authenticated/clients.$clientId.tsx", "src/routes/app.tsx"]) {
  const full = resolve(file);
  const shadow = localNamed(full, "statementSpan");
  assert(shadow == null, `${file} hides statementSpan with ${shadow}`);
  assert(readFileSync(full, "utf8").includes("snapshotCoveringSpan("), `${file} skips the shared snapshot lookup`);
  assert(statementSpanCalls(full).length === 0, `${file} still calls statementSpan from the page`);
}
const planFile = resolve("src/lib/statement-import-plan.ts");
const planCalls = statementSpanCalls(planFile);
assert(planCalls.length > 0, "the snapshot lookup does not call statementSpan");
const planSource = ts.createSourceFile(planFile, readFileSync(planFile, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const planBinding = resolveBinding(planSource, planCalls[0]!);
assert(planBinding.kind === "function", `statementSpan in the plan is ${planBinding.kind} (${planBinding.detail})`);

const { build } = await import("esbuild");
const { mkdtempSync, writeFileSync: writeOut } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { pathToFileURL } = await import("node:url");
const outDir = mkdtempSync(join(tmpdir(), "j2-add-period-"));
const outfile = join(outDir, "statement-import-plan.mjs");
await build({
  entryPoints: [resolve("src/lib/statement-import-plan.ts")],
  bundle: true,
  minify: true,
  format: "esm",
  platform: "node",
  outfile,
});
const minified = (await import(pathToFileURL(outfile).href)) as {
  statementSpan: (start: string, end: string) => { periodStart: string; periodEnd: string; months: number } | null;
  snapshotCoveringSpan: <T extends { financials?: { revenue?: string } }>(
    rows: readonly T[] | null | undefined,
    fileSpan: { periodStart: string; periodEnd: string } | null,
  ) => T | undefined;
};
assert(typeof minified.statementSpan === "function", "minified statementSpan is not a function");
assert(typeof minified.snapshotCoveringSpan === "function", "minified snapshotCoveringSpan is not a function");
const minifiedSpan = minified.statementSpan("2026-07-01", "2026-09-30");
assert(minifiedSpan?.periodStart === "2026-07-01" && minifiedSpan.periodEnd === "2026-09-30", "minified Q3 span");
const minifiedMatch = minified.snapshotCoveringSpan(
  [
    { financials: { periodStart: "2026-01-01", periodEnd: "2026-09-30", revenue: "900" } },
    { financials: { periodStart: "2026-07-01", periodEnd: "2026-09-30", revenue: "182000" } },
  ],
  minifiedSpan,
);
assert(minifiedMatch?.financials?.revenue === "182000", "minified add-period lookup missed Q3");
const probe = join(outDir, "add-period-probe.mjs");
writeOut(
  probe,
  `import { snapshotCoveringSpan } from ${JSON.stringify(pathToFileURL(outfile).href)};
const match = snapshotCoveringSpan(
  [
    { financials: { periodStart: "2026-01-01", periodEnd: "2026-09-30", revenue: "900" } },
    { financials: { periodStart: "2026-07-01", periodEnd: "2026-09-30", revenue: "182000" } },
  ],
  { periodStart: "2026-07-01", periodEnd: "2026-09-30" },
);
if (match?.financials.revenue !== "182000") throw new Error("minified add-period lookup missed Q3");
`,
);
await import(pathToFileURL(probe).href);

console.log("j2 period import ok");
