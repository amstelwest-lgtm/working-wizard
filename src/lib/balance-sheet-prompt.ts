/**
 * After a P&L import, cash and runway stay locked until a balance sheet is on file.
 * Cash alone does not count — it can come from a bank file without a balance sheet.
 */

const PROFIT_AND_LOSS_KEYS = [
  "revenue",
  "cogs",
  "grossProfit",
  "ebit",
  "ebt",
  "netIncome",
  "ebitda",
  "fixedCosts",
  "laborCost",
] as const;

const BALANCE_SHEET_KEYS = [
  "totalAssets",
  "equity",
  "receivables",
  "inventory",
  "payables",
  "currentAssets",
  "currentLiabilities",
  "totalLiabilities",
] as const;

function filled(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (value == null) return false;
  if (typeof value === "number") return Number.isFinite(value);
  return String(value).trim() !== "";
}

export function needsBalanceSheetPrompt(financials: object | null | undefined): boolean {
  if (!financials) return false;
  const record = financials as Record<string, unknown>;
  const hasProfitAndLoss = PROFIT_AND_LOSS_KEYS.some((key) => filled(record, key));
  const hasBalanceSheet = BALANCE_SHEET_KEYS.some((key) => filled(record, key));
  return hasProfitAndLoss && !hasBalanceSheet;
}
