/**
 * One P&L bridge for Budget, the profitability waterfall, and Overview.
 *
 * Operating expenses on the statement are not always the full step from
 * gross profit to EBIT. Depreciation (EBITDA − EBIT) sits between them.
 * Folding that charge into operating expenses, or leaving it out of Budget
 * EBIT, makes the same client show two profits. Callers share this split.
 */

const CLOSE = 1;

/** Dollars. A derived interest or tax step inside this band still ties out. */
export const PROFIT_RECONCILE_TOLERANCE = 1;

/**
 * A derived interest or tax step is not a fact when it is negative, or when
 * operating profit − interest − tax does not land on net income.
 */
export function derivedProfitStepsAreFacts(input: {
  operatingProfit: number;
  interest: number;
  tax: number;
  netIncome: number;
}): boolean {
  if (!Number.isFinite(input.interest) || input.interest < -PROFIT_RECONCILE_TOLERANCE) return false;
  if (!Number.isFinite(input.tax) || input.tax < -PROFIT_RECONCILE_TOLERANCE) return false;
  if (!Number.isFinite(input.operatingProfit) || !Number.isFinite(input.netIncome)) return false;
  return (
    Math.abs(input.operatingProfit - input.interest - input.tax - input.netIncome) <=
    PROFIT_RECONCILE_TOLERANCE
  );
}

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
  /** False when interest was derived and the bridge does not tie out. */
  interestIsFact: boolean;
  /** False when tax was derived and the bridge does not tie out. */
  taxIsFact: boolean;
  /** Next Moves may rank debt drag only when the interest step is a fact. */
  interestBurdenUsable: boolean;
};

/**
 * Period figures → the operating bridge.
 * When EBITDA − EBIT explains why gross profit − operating expenses ≠ EBIT,
 * depreciation is booked on its own and operating expenses stay as entered.
 * Any other gap stays inside operating expenses so operating profit still
 * equals the EBIT on the statement.
 */
/**
 * A cost stored as a credit (negative) is still a cost. Leaving the sign
 * makes revenue − (−COGS) print a gross margin above 100%.
 */
export function costMagnitude(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return amount < 0 ? Math.abs(amount) : amount;
}

/**
 * A stated net income above operating profit is not a reconciled net.
 * Karoo's R540,000 net against R120,000 operating profit fails this.
 */
export function statedNetIsUsable(operatingProfit: number, netIncome: number | null | undefined): boolean {
  if (netIncome == null || !Number.isFinite(netIncome) || !Number.isFinite(operatingProfit)) return false;
  return netIncome <= operatingProfit + PROFIT_RECONCILE_TOLERANCE;
}

/**
 * Gross profit the home Analyst card and the waterfall print.
 * Stated gross profit when it sits in range; otherwise revenue minus the cost
 * of sales (a credit cost is still a cost). A stored amount with no revenue
 * and cost pair is returned as stored. Null when neither is on the file, so
 * a blank cost is not treated as zero.
 */
export function statementGrossProfit(
  fields: Record<string, unknown> | null | undefined,
): number | null {
  if (!fields) return null;
  const stated = fieldPresent(fields, "grossProfit") ? fieldNum(fields, "grossProfit") : null;
  if (!fieldPresent(fields, "revenue") || !fieldPresent(fields, "cogs")) return stated;
  const bridgeFields: Record<string, unknown> = {
    revenue: fieldNum(fields, "revenue"),
    cogs: fieldNum(fields, "cogs"),
  };
  if (stated != null) bridgeFields.grossProfit = stated;
  const gross = periodProfitBridge(bridgeFields).grossProfit;
  return Number.isFinite(gross) ? gross : stated;
}

/** Gross profit ÷ revenue from the same bridge the waterfall prints. Null when revenue is missing. */
export function statementGrossMarginFraction(
  fields: Record<string, unknown> | null | undefined,
): number | null {
  if (!fields) return null;
  const bridge = periodProfitBridge(fields);
  if (!(bridge.revenue > 0) || !Number.isFinite(bridge.grossProfit)) return null;
  return bridge.grossProfit / bridge.revenue;
}

/**
 * Net profit the Profit tab prints.
 * A stored net income that does not sit above operating profit wins, so
 * interest, tax, and other items between operating profit and the bottom
 * line stay in the figure. Otherwise the bridge walks operating profit
 * down by interest and tax.
 */
export function statementNetProfitFromSteps(input: {
  operatingProfit: number;
  interest: number;
  tax: number;
  statedNetIncome: number | null | undefined;
}): number {
  const stated = input.statedNetIncome;
  if (stated != null && Number.isFinite(stated) && statedNetIsUsable(input.operatingProfit, stated)) {
    return stated;
  }
  return input.operatingProfit - input.interest - input.tax;
}

/**
 * Canonical net profit for a stored P&L. The same rule as the Analyst and
 * ask-ai: quote stored net income when it does not exceed operating profit.
 * Operating profit alone is not returned as net profit. An unusable stored
 * net (above operating profit) is not returned either.
 */
export function statementNetProfit(
  fields: Record<string, unknown> | null | undefined,
): number | null {
  if (!fields || !fieldPresent(fields, "netIncome")) return null;
  const stated = fieldNum(fields, "netIncome");
  if (!fieldPresent(fields, "ebit")) return stated;
  const operating = fieldNum(fields, "ebit");
  return statedNetIsUsable(operating, stated) ? stated : null;
}

export function periodProfitBridge(fields: Record<string, unknown>): PeriodProfitBridge {
  const revenue = fieldNum(fields, "revenue");
  let cogs = revenue > 0 ? costMagnitude(fieldNum(fields, "cogs")) : fieldNum(fields, "cogs");
  const statedGp = fieldPresent(fields, "grossProfit") ? fieldNum(fields, "grossProfit") : null;
  if (
    revenue > 0 &&
    statedGp != null &&
    statedGp >= 0 &&
    statedGp <= revenue + PROFIT_RECONCILE_TOLERANCE
  ) {
    const fromCogs = revenue - cogs;
    if (Math.abs(fromCogs - statedGp) > PROFIT_RECONCILE_TOLERANCE) {
      cogs = Math.max(0, revenue - statedGp);
    }
  }
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
  const statedInterest = fieldPresent(fields, "interestExpense")
    ? fieldNum(fields, "interestExpense")
    : fieldPresent(fields, "interest")
      ? fieldNum(fields, "interest")
      : null;
  const statedTax = fieldPresent(fields, "tax") ? fieldNum(fields, "tax") : null;
  const derivedInterest = hasEbit && hasEbt ? statedEbit - fieldNum(fields, "ebt") : null;
  const derivedTax = hasEbt && hasNet ? fieldNum(fields, "ebt") - fieldNum(fields, "netIncome") : null;
  const interestValue = statedInterest ?? derivedInterest ?? 0;
  const taxValue = statedTax ?? derivedTax ?? 0;
  const interestDerived = statedInterest == null && derivedInterest != null;
  const taxDerived = statedTax == null && derivedTax != null;
  const netIncome = hasNet ? fieldNum(fields, "netIncome") : null;
  const derivedBroken =
    (interestDerived || taxDerived) &&
    !derivedProfitStepsAreFacts({
      operatingProfit: ebit,
      interest: interestValue,
      tax: taxValue,
      netIncome: netIncome ?? ebit - interestValue - taxValue,
    });
  const interestIsFact = !interestDerived || !derivedBroken;
  const taxIsFact = !taxDerived || !derivedBroken;

  return {
    revenue,
    cogs,
    grossProfit: gross,
    operatingExpenses,
    depreciation,
    ebit,
    interest: interestIsFact ? interestValue : 0,
    tax: taxIsFact ? taxValue : 0,
    interestIsFact,
    taxIsFact,
    interestBurdenUsable: interestIsFact && taxIsFact,
  };
}
