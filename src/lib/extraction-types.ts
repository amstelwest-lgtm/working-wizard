export interface DocumentMetadata {
  company_name: string | null;
  registration_number: string | null;
  period_start_date: string | null;
  period_end_date: string | null;
  period_months: number | null;
  prior_period_start_date: string | null;
  prior_period_end_date: string | null;
  document_type: "bank_statement" | "income_statement" | "balance_sheet" | "management_accounts" | "full_annual_financials" | "unknown";
  financial_statement_type: "audited" | "reviewed" | "compiled" | "management_accounts" | "bank_statement" | "unknown";
  prepared_by: string | null;
  auditor_firm: string | null;
  approval_date: string | null;
  industry_description: string | null;
  functional_currency: "ZAR" | "USD" | "EUR" | "GBP" | "other";
  foreign_currency_exposure: boolean | null;
  headcount: number | null;
  accounting_basis: "accrual" | "cash" | "unknown";
  values_appear_in_thousands: boolean;
  contains_income_statement: boolean;
  contains_balance_sheet: boolean;
  contains_cash_flow_statement: boolean;
  contains_notes: boolean;
}

export interface IncomeStatement {
  revenue: number | null;
  cogs: number | null;
  gross_profit: number | null;
  other_income: number | null;
  fixed_costs: number | null;
  labor_cost: number | null;
  depreciation: number | null;
  amortisation: number | null;
  depreciation_amortisation_total: number | null;
  ebitda: number | null;
  ebit: number | null;
  interest_expense: number | null;
  interest_income: number | null;
  ebt: number | null;
  tax: number | null;
  net_income: number | null;
  director_remuneration: number | null;
  dividends_declared: number | null;
}

export interface BalanceSheet {
  total_assets: number | null;
  fixed_assets: number | null;
  goodwill: number | null;
  intangible_assets: number | null;
  right_of_use_assets: number | null;
  current_assets: number | null;
  inventory: number | null;
  wip: number | null;
  debtors: number | null;
  provision_bad_debts: number | null;
  cash: number | null;
  other_current_assets: number | null;
  total_liabilities: number | null;
  current_liabilities: number | null;
  creditors: number | null;
  short_term_debt: number | null;
  lease_liabilities_current: number | null;
  other_current_liabilities: number | null;
  non_current_liabilities: number | null;
  long_term_debt: number | null;
  lease_liabilities_non_current: number | null;
  deferred_tax_liability: number | null;
  deferred_tax_asset: number | null;
  equity: number | null;
  share_capital: number | null;
  retained_earnings_opening: number | null;
  retained_earnings_closing: number | null;
  shareholder_loans_asset: number | null;
  shareholder_loans_liability: number | null;
  contingent_liabilities_notes: string | null;
}

export interface CashFlowStatement {
  operating_cash_flow: number | null;
  working_capital_movement_debtors: number | null;
  working_capital_movement_inventory: number | null;
  working_capital_movement_creditors: number | null;
  capex: number | null;
  asset_disposal_proceeds: number | null;
  investing_cash_flow: number | null;
  debt_drawdowns: number | null;
  debt_repayments: number | null;
  dividends_paid: number | null;
  financing_cash_flow: number | null;
  net_cash_movement: number | null;
  cash_opening_balance: number | null;
  cash_closing_balance: number | null;
}

export interface PriorPeriod {
  revenue: number | null;
  gross_profit: number | null;
  net_income: number | null;
  total_assets: number | null;
  equity: number | null;
  cash: number | null;
  debtors: number | null;
  inventory: number | null;
  creditors: number | null;
  operating_cash_flow: number | null;
}

export interface TopExpense {
  rank: number;
  category: string;
  amount: number;
  percentage_of_revenue: number | null;
  notes: string | null;
}

export interface TopIncomeSource {
  rank: number;
  description: string;
  amount: number;
  percentage_of_total: number | null;
  notes: string | null;
}

export interface DataQuality {
  gross_profit_reconciles: boolean | null;
  net_income_reconciles: boolean | null;
  balance_sheet_balances: boolean | null;
  cash_flow_reconciles: boolean | null;
  retained_earnings_reconciles: boolean | null;
  prior_period_available: boolean;
  confidence_by_section: {
    income_statement: "high" | "medium" | "low" | "not_found";
    balance_sheet: "high" | "medium" | "low" | "not_found";
    cash_flow: "high" | "medium" | "low" | "not_found";
    expenses_detail: "high" | "medium" | "low" | "not_found";
    income_detail: "high" | "medium" | "low" | "not_found";
    notes: "high" | "medium" | "low" | "not_found";
  };
  overall_confidence: "high" | "medium" | "low";
  extraction_notes: string;
}

export interface RawExtraction {
  document_metadata: DocumentMetadata;
  current_period: {
    income_statement: IncomeStatement;
    balance_sheet: BalanceSheet;
    cash_flow_statement: CashFlowStatement;
  };
  prior_period: PriorPeriod;
  top_expenses: TopExpense[];
  top_income_sources: TopIncomeSource[];
  data_quality: DataQuality;
}

export interface MergeConflict {
  field: string;
  value_1: number | null;
  source_1: string;
  value_2: number | null;
  source_2: string;
  resolved_value?: number | null;
}

export interface MergedExtractionResult extends RawExtraction {
  source_map: Record<string, string>;
  conflicts: MergeConflict[];
  normalisation_applied: boolean;
  original_period_months?: number;
  annualisation_factor?: number;
  document_count: number;
  file_names: string[];
}
