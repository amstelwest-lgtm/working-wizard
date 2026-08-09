// financialSchema.ts
// Shared TypeScript types for PDF financial-statement extraction.
// Numeric fields are nullable — return null when a line is absent from the document.

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
