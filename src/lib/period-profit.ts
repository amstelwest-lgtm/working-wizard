/**
 * One P&L bridge for Budget, the profitability waterfall, and Overview.
 *
 * Operating expenses on the statement are not always the full step from
 * gross profit to EBIT. Depreciation (EBITDA − EBIT) sits between them.
 * Folding that charge into operating expenses, or leaving it out of Budget
 * EBIT, makes the same client show two profits. Callers share this split.
 */

const CLOSE = 1;

function fieldPresent(fields: Record<string, unknown>, key: string): boolean {
  const v = fields[key];
  return v != null && String(v).trim() !== "";
}

function fieldNum(fields: Record<string, unknown>, key: string): number {
  const v = fields[key];
  if (v == null || String(v).trim() === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export type PeriodProfitBridge = {
  revenue: number;
  cogs: number;
  grossProfit: number;
  /** Stated operating expenses. The residual to EBIT when depreciation cannot be split out. */
  operatingExpenses: number;
  /** Non-cash D&A. Zero when it is not the gap between gross profit and EBIT. */
  depreciation: number;
  ebit: number;
  interest: number;
  tax: number;
};

/**
 * Period figures → the operating bridge.
 * When EBITDA − EBIT explains why gross profit − operating expenses ≠ EBIT,
 * depreciation is booked on its own and operating expenses stay as entered.
 * Any other gap stays inside operating expenses so operating profit still
 * equals the EBIT on the statement.
 */
export function periodProfitBridge(fields: Record<string, unknown>): PeriodProfitBridge {
  const revenue = fieldNum(fields, "revenue");
  const cogs = fieldNum(fields, "cogs");
  const gross = revenue - cogs;
  const hasEbit = fieldPresent(fields, "ebit");
  const hasFixed = fieldPresent(fields, "fixedCosts");
  const hasEbitda = fieldPresent(fields, "ebitda");
  const statedEbit = fieldNum(fields, "ebit");
  const statedFixed = fieldNum(fields, "fixedCosts");
  const statedEbitda = fieldNum(fields, "ebitda");
  const identifiedDa = hasEbit && hasEbitda ? Math.max(0, statedEbitda - statedEbit) : 0;

  let operatingExpenses = 0;
  let depreciation = 0;

  if (hasEbit) {
    const residual = gross - statedEbit;
    if (!hasFixed) {
      operatingExpenses = residual;
    } else {
      const gap = residual - statedFixed;
      if (Math.abs(gap) <= CLOSE) {
        operatingExpenses = statedFixed;
      } else if (identifiedDa > 0 && Math.abs(gap - identifiedDa) <= CLOSE) {
        operatingExpenses = statedFixed;
        depreciation = gap;
      } else {
        operatingExpenses = residual;
      }
    }
  } else if (hasFixed) {
    operatingExpenses = statedFixed;
  }

  const ebit = hasEbit ? statedEbit : gross - operatingExpenses - depreciation;
  const hasEbt = fieldPresent(fields, "ebt");
  const hasNet = fieldPresent(fields, "netIncome");
  const interest = hasEbit && hasEbt ? statedEbit - fieldNum(fields, "ebt") : 0;
  const tax = hasEbt && hasNet ? fieldNum(fields, "ebt") - fieldNum(fields, "netIncome") : 0;

  return {
    revenue,
    cogs,
    grossProfit: gross,
    operatingExpenses,
    depreciation,
    ebit,
    interest,
    tax,
  };
}
