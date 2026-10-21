/**
 * Firm-year slice shape. Kept off budget-period.ts so a type import from
 * budget.types does not pull the market barrel into the ask-ai Deno graph.
 * A missing line stays null.
 */

export type FiscalStatementSlice = {
  /** "Mar 2026 – Sep 2026, prorated". Null when the statement has no months. */
  label: string | null;
  /** True when the statement was scaled onto a shorter firm-year overlap. */
  prorated: boolean;
  /** Months of the firm year the statement covers. */
  months: number | null;
  revenue: number | null;
  cogs: number | null;
  grossProfit: number | null;
  operatingExpenses: number | null;
  operatingProfit: number | null;
  netProfit: number | null;
};
