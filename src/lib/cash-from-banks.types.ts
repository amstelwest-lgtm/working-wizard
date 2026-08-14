/**
 * Types for bank-statement → preliminary cash forecast (Phases 1–3).
 */

export type CashTxnDirection = "in" | "out";

export type CashBucket =
  | "trading"
  | "cos"
  | "opex"
  | "payroll"
  | "rent"
  | "loan"
  | "interest"
  | "tax"
  | "vat"
  | "owner"
  | "capex"
  | "transfer"
  | "other";

export type CashCadence =
  | "once_off"
  | "weekly"
  | "monthly"
  | "annual"
  | "split_weeks"
  | "split_months";

/** Maps to Cash Forecast LineItem.frequency */
export type ForecastFrequency =
  | "recurring-weekly"
  | "recurring-monthly"
  | "once-off"
  | "split-weeks"
  | "split-months";

export type CashStatementTransaction = {
  txn_date: string; // YYYY-MM-DD
  amount: number; // always positive magnitude
  direction: CashTxnDirection;
  description: string;
  counterparty: string | null;
  ai_bucket: CashBucket;
  excluded: boolean;
  /** Which bank account this line belongs to (multi-account uploads). */
  account_label?: string | null;
};

export type CashBankAccountSummary = {
  account_label: string;
  opening_balance: number | null;
  closing_balance: number | null;
  file_names: string[];
};

export type CashForecastDraftLine = {
  id: string;
  side: "inflow" | "outflow";
  bucket: CashBucket;
  name: string;
  amount: number; // positive; typical occurrence amount for recurring
  cadence: CashCadence;
  start_week: number; // 1..13
  split_count: number;
  status: "proposed" | "confirmed" | "excluded";
  confidence: number; // 0..1
  source: "ai" | "manual" | "merged";
  txn_count: number;
  sample_descriptions: string[];
};

export type CashBankExtract = {
  period_start: string | null;
  period_end: string | null;
  opening_balance: number | null;
  closing_balance: number | null;
  currency: string | null;
  transactions: CashStatementTransaction[];
  notes: string | null;
  /** Per-account balances when multiple bank accounts were uploaded. */
  accounts?: CashBankAccountSummary[];
};

export type CashForecastPublishPayload = {
  startDate: string;
  openingBalance: string;
  revenue: Array<{
    id: string;
    name: string;
    amount: string;
    frequency: ForecastFrequency;
    startWeek: number;
    splitCount: number;
  }>;
  expenses: Array<{
    id: string;
    name: string;
    amount: string;
    frequency: ForecastFrequency;
    startWeek: number;
    splitCount: number;
  }>;
  other: Array<{
    id: string;
    name: string;
    amount: string;
    frequency: ForecastFrequency;
    startWeek: number;
    splitCount: number;
  }>;
  /** Keep scenario knobs neutral on first publish */
  revAdj: number;
  expAdj: number;
  collectDelay: number;
  headcountDelta: number;
  avgSalary: string;
  fixedCostDelta: string;
  revGrowthPct: number;
  capexAmount: string;
  capexWeek: number;
  seededFromBanksAt: string;
};

export type CashFromBanksDraftResult = {
  extract: CashBankExtract;
  lines: CashForecastDraftLine[];
  startDate: string;
  openingBalance: number;
  warnings: string[];
  /** Movements trial balance + bank tie-out checks (client-facing). */
  movements?: import("@/lib/bank-movements").MovementsTrialBalance;
};

export function cadenceToFrequency(cadence: CashCadence): ForecastFrequency {
  switch (cadence) {
    case "weekly":
      return "recurring-weekly";
    case "monthly":
    case "annual":
      // Annual is weeklyized at publish time into a monthly-ish amount / 12 * displayed monthly —
      // for the existing engine we emit recurring-monthly with amount/12 * wait:
      // Better: convert annual → monthly amount/12 with recurring-monthly.
      return "recurring-monthly";
    case "once_off":
      return "once-off";
    case "split_weeks":
      return "split-weeks";
    case "split_months":
      return "split-months";
  }
}

export function publishAmountForLine(line: CashForecastDraftLine): number {
  if (line.cadence === "annual") return line.amount / 12;
  return line.amount;
}

export function bucketToSide(bucket: CashBucket, direction: CashTxnDirection): "inflow" | "outflow" {
  if (bucket === "trading") return "inflow";
  if (direction === "in" && (bucket === "other" || bucket === "owner" || bucket === "loan")) {
    return "inflow";
  }
  return direction === "in" ? "inflow" : "outflow";
}
