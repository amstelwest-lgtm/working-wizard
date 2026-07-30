// financialSchema.ts
// Shared schema + types for PDF financial-statement extraction.
// The `responseSchema` below is passed to Gemini so the model is FORCED
// to return JSON in exactly this shape. Nothing is invented — every numeric
// field is nullable and the model is told to return null when a line is absent.

import { Type } from "@google/genai";

// --- Small helpers so we don't repeat ourselves ---------------------------

// A money line item: a number, or null if it isn't printed in the statement.
const money = (description: string) => ({
  type: Type.NUMBER,
  nullable: true,
  description,
});

const nullableString = (description: string) => ({
  type: Type.STRING,
  nullable: true,
  description,
});

// --- The schema Gemini must fill --------------------------------------------

const incomeStatement = {
  type: Type.OBJECT,
  description: "Statement of profit or loss / income statement.",
  properties: {
    revenue: money("Revenue / turnover / sales."),
    cost_of_sales: money("Cost of sales / cost of goods sold (as a positive number)."),
    gross_profit: money("Gross profit."),
    other_income: money("Other income."),
    operating_expenses: money("Total operating / administrative expenses (positive number)."),
    depreciation_amortisation: money("Depreciation and amortisation, if shown separately."),
    operating_profit: money("Operating profit / EBIT / profit from operations."),
    finance_income: money("Interest / finance income."),
    finance_costs: money("Interest / finance costs (positive number)."),
    profit_before_tax: money("Profit (loss) before taxation."),
    income_tax: money("Income tax expense (positive number)."),
    profit_after_tax: money("Profit (loss) for the period after tax."),
  },
};

const balanceSheet = {
  type: Type.OBJECT,
  description: "Statement of financial position / balance sheet.",
  properties: {
    non_current_assets: {
      type: Type.OBJECT,
      properties: {
        property_plant_equipment: money("Property, plant and equipment."),
        intangible_assets: money("Intangible assets / goodwill."),
        investments: money("Long-term investments."),
        deferred_tax_asset: money("Deferred tax asset."),
        other: money("Any other non-current assets not covered above."),
        total: money("Total non-current assets."),
      },
    },
    current_assets: {
      type: Type.OBJECT,
      properties: {
        inventories: money("Inventories / stock."),
        trade_and_other_receivables: money("Trade and other receivables / debtors."),
        cash_and_cash_equivalents: money("Cash and cash equivalents / bank."),
        other: money("Any other current assets not covered above."),
        total: money("Total current assets."),
      },
    },
    total_assets: money("Total assets."),
    equity: {
      type: Type.OBJECT,
      properties: {
        share_capital: money("Share capital / stated capital."),
        retained_earnings: money("Retained earnings / accumulated profit (loss)."),
        other_reserves: money("Other reserves."),
        total: money("Total equity."),
      },
    },
    non_current_liabilities: {
      type: Type.OBJECT,
      properties: {
        borrowings: money("Long-term borrowings / interest-bearing debt."),
        deferred_tax_liability: money("Deferred tax liability."),
        other: money("Any other non-current liabilities."),
        total: money("Total non-current liabilities."),
      },
    },
    current_liabilities: {
      type: Type.OBJECT,
      properties: {
        trade_and_other_payables: money("Trade and other payables / creditors."),
        borrowings: money("Short-term borrowings / current portion of debt."),
        current_tax: money("Current tax payable."),
        bank_overdraft: money("Bank overdraft."),
        other: money("Any other current liabilities."),
        total: money("Total current liabilities."),
      },
    },
    total_liabilities: money("Total liabilities."),
    total_equity_and_liabilities: money("Total equity and liabilities."),
  },
};

const cashFlow = {
  type: Type.OBJECT,
  nullable: true,
  description: "Statement of cash flows. Null if the document has no cash flow statement.",
  properties: {
    cash_from_operating: money("Net cash from operating activities."),
    cash_from_investing: money("Net cash from investing activities."),
    cash_from_financing: money("Net cash from financing activities."),
    net_change_in_cash: money("Net increase / decrease in cash."),
    cash_at_end: money("Cash and cash equivalents at end of period."),
  },
};

const figures = {
  type: Type.OBJECT,
  properties: {
    income_statement: incomeStatement,
    balance_sheet: balanceSheet,
    cash_flow: cashFlow,
  },
};

const period = (nullable: boolean) => ({
  type: Type.OBJECT,
  nullable,
  properties: {
    period_end: nullableString("Reporting date for this column, ISO format YYYY-MM-DD."),
    figures,
  },
});

export const financialResponseSchema = {
  type: Type.OBJECT,
  properties: {
    entity_name: nullableString("Registered name of the entity."),
    registration_number: nullableString("Company / entity registration number, if shown."),
    currency: nullableString("Presentation currency as an ISO code, e.g. ZAR."),
    units: {
      type: Type.STRING,
      nullable: true,
      enum: ["actual", "thousands", "millions"],
      description:
        "The scale the figures are presented in. Do NOT rescale the numbers — just report the scale so the app can handle it.",
    },
    statement_basis: {
      type: Type.STRING,
      nullable: true,
      enum: [
        "audited",
        "independently_reviewed",
        "compiled",
        "management_accounts",
        "unknown",
      ],
      description: "Assurance level of the statements.",
    },
    current_period: period(false),
    comparative_period: period(true),
    extraction_notes: nullableString(
      "Anything ambiguous or worth a human double-checking. Null if nothing to flag."
    ),
  },
};

// --- TypeScript types (kept in sync with the schema by hand) ----------------

export type Money = number | null;

export interface IncomeStatement {
  revenue: Money;
  cost_of_sales: Money;
  gross_profit: Money;
  other_income: Money;
  operating_expenses: Money;
  depreciation_amortisation: Money;
  operating_profit: Money;
  finance_income: Money;
  finance_costs: Money;
  profit_before_tax: Money;
  income_tax: Money;
  profit_after_tax: Money;
}

export interface BalanceSheet {
  non_current_assets: {
    property_plant_equipment: Money;
    intangible_assets: Money;
    investments: Money;
    deferred_tax_asset: Money;
    other: Money;
    total: Money;
  };
  current_assets: {
    inventories: Money;
    trade_and_other_receivables: Money;
    cash_and_cash_equivalents: Money;
    other: Money;
    total: Money;
  };
  total_assets: Money;
  equity: {
    share_capital: Money;
    retained_earnings: Money;
    other_reserves: Money;
    total: Money;
  };
  non_current_liabilities: {
    borrowings: Money;
    deferred_tax_liability: Money;
    other: Money;
    total: Money;
  };
  current_liabilities: {
    trade_and_other_payables: Money;
    borrowings: Money;
    current_tax: Money;
    bank_overdraft: Money;
    other: Money;
    total: Money;
  };
  total_liabilities: Money;
  total_equity_and_liabilities: Money;
}

export interface CashFlow {
  cash_from_operating: Money;
  cash_from_investing: Money;
  cash_from_financing: Money;
  net_change_in_cash: Money;
  cash_at_end: Money;
}

export interface FinancialFigures {
  income_statement: IncomeStatement;
  balance_sheet: BalanceSheet;
  cash_flow: CashFlow | null;
}

export interface PeriodBlock {
  period_end: string | null;
  figures: FinancialFigures;
}

export interface ExtractionResult {
  entity_name: string | null;
  registration_number: string | null;
  currency: string | null;
  units: "actual" | "thousands" | "millions" | null;
  statement_basis:
    | "audited"
    | "independently_reviewed"
    | "compiled"
    | "management_accounts"
    | "unknown"
    | null;
  current_period: PeriodBlock;
  comparative_period: PeriodBlock | null;
  extraction_notes: string | null;
}
