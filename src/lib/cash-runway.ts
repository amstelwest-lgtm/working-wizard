/**
 * Cash runway — weeks until the 13-week forecast dips below the danger floor.
 * Same rule as CashForecastPDF (default R50,000). Maths mirrors CashForecastPanel.
 */

export const CASH_RUNWAY_THRESHOLD_RAND = 50_000;
export const CASH_FORECAST_WEEKS = 13;

export type CashflowFrequency =
  | "recurring-weekly"
  | "recurring-monthly"
  | "once-off"
  | "split-weeks"
  | "split-months"
  | "weekly"
  | "monthly"
  | "once"
  | "split"
  | string;

export type CashflowLineLike = {
  amount?: string;
  frequency?: CashflowFrequency;
  startWeek?: number;
  splitCount?: number;
};

/** Shape stored on clients.cashflow (and budget→cash / bank publish payloads). */
export type SavedCashflowLike = {
  openingBalance?: string;
  revenue?: CashflowLineLike[];
  expenses?: CashflowLineLike[];
  other?: CashflowLineLike[];
  revAdj?: number;
  expAdj?: number;
  collectDelay?: number;
  headcountDelta?: number;
  avgSalary?: string;
  fixedCostDelta?: string;
  revGrowthPct?: number;
  capexAmount?: string;
  capexWeek?: number;
};

/**
 * Weeks until first closing balance is below threshold.
 * If never breached within the horizon, returns the horizon length (e.g. 13).
 */
export function runwayWeeksFromClosings(
  closings: number[],
  threshold: number = CASH_RUNWAY_THRESHOLD_RAND,
): number {
  if (!closings.length) return 0;
  const firstBreach = closings.findIndex((c) => c < threshold);
  return firstBreach === -1 ? closings.length : firstBreach;
}

function distributeLine(l: CashflowLineLike, weeks: number): number[] {
  const out = new Array(weeks).fill(0);
  const amt = parseFloat(l.amount ?? "0") || 0;
  if (amt === 0) return out;
  const start = Math.max(1, Math.min(weeks, l.startWeek ?? 1)) - 1;
  const freq = l.frequency ?? "recurring-monthly";
  switch (freq) {
    case "recurring-weekly":
    case "weekly":
      for (let i = start; i < weeks; i++) out[i] = amt;
      break;
    case "recurring-monthly":
    case "monthly":
      for (let i = start; i < weeks; i += 4) out[i] = amt;
      break;
    case "once-off":
    case "once":
      out[start] = amt;
      break;
    case "split-weeks":
    case "split": {
      const n = Math.max(1, l.splitCount ?? 3);
      const per = amt / n;
      for (let i = start; i < Math.min(weeks, start + n); i++) out[i] = per;
      break;
    }
    case "split-months": {
      const n = Math.max(1, l.splitCount ?? 3);
      const per = amt / n;
      for (let i = 0; i < n; i++) {
        const w = start + i * 4;
        if (w < weeks) out[w] = per;
      }
      break;
    }
    default:
      for (let i = start; i < weeks; i += 4) out[i] = amt;
  }
  return out;
}

/**
 * Project closing balances from a saved cashflow payload (mirrors the
 * CashForecastPanel moderate / active scenario maths).
 */
export function closingBalancesFromCashflow(
  cf: SavedCashflowLike | null | undefined,
  weeks: number = CASH_FORECAST_WEEKS,
): number[] | null {
  if (!cf) return null;
  const revenue = cf.revenue ?? [];
  const expenses = cf.expenses ?? [];
  const other = cf.other ?? [];
  const hasAmount = [...revenue, ...expenses, ...other].some(
    (l) => (parseFloat(l.amount ?? "0") || 0) !== 0,
  );
  if (!hasAmount) return null;

  const revAdj = (cf.revAdj ?? 100) / 100;
  const expAdj = (cf.expAdj ?? 100) / 100;
  const collectDelay = Math.max(
    0,
    Math.min(weeks - 1, Math.round(cf.collectDelay ?? 0)),
  );
  const headDelta = cf.headcountDelta ?? 0;
  const avgSal = parseFloat(cf.avgSalary ?? "0") || 0;
  const fixedDelta = parseFloat(cf.fixedCostDelta ?? "0") || 0;
  const revGrowth = cf.revGrowthPct ?? 0;
  const capexAmt = parseFloat(cf.capexAmount ?? "0") || 0;
  const capexWk = cf.capexWeek ?? 1;

  const shiftVals = (vals: number[]) => {
    if (!collectDelay) return vals;
    const out = new Array(weeks).fill(0);
    for (let i = 0; i < weeks; i++) {
      const j = i + collectDelay;
      if (j < weeks) out[j] += vals[i];
    }
    return out;
  };
  const growthMul = (i: number) => Math.pow(1 + revGrowth / 100, i);

  const inflow = new Array(weeks).fill(0) as number[];
  const outflow = new Array(weeks).fill(0) as number[];

  revenue.forEach((l) => {
    shiftVals(distributeLine(l, weeks).map((v) => v * revAdj)).forEach(
      (v, i) => (inflow[i] += v * growthMul(i)),
    );
  });
  [...expenses, ...other].forEach((l) => {
    distributeLine(l, weeks)
      .map((v) => v * expAdj)
      .forEach((v, i) => (outflow[i] += v));
  });
  if (headDelta !== 0) {
    const weekly = (headDelta * avgSal) / 4.33;
    for (let i = 0; i < weeks; i++) outflow[i] += weekly;
  }
  if (fixedDelta !== 0) {
    const weekly = fixedDelta / 4.33;
    for (let i = 0; i < weeks; i++) outflow[i] += weekly;
  }
  if (capexAmt !== 0) {
    const w = Math.max(1, Math.min(weeks, capexWk)) - 1;
    outflow[w] += capexAmt;
  }

  const opening = parseFloat(cf.openingBalance ?? "0") || 0;
  const closings: number[] = [];
  let bal = opening;
  for (let i = 0; i < weeks; i++) {
    bal += inflow[i] - outflow[i];
    closings.push(bal);
  }
  return closings;
}

export function runwayWeeksFromCashflow(
  cf: SavedCashflowLike | null | undefined,
  threshold: number = CASH_RUNWAY_THRESHOLD_RAND,
): number | null {
  const closings = closingBalancesFromCashflow(cf);
  if (!closings) return null;
  return runwayWeeksFromClosings(closings, threshold);
}

/** Prefer persisted column; else derive from cashflow JSON for display. */
export function effectiveCashRunwayWeeks(
  stored: number | null | undefined,
  cashflow: SavedCashflowLike | null | undefined,
): number | null {
  if (stored != null && Number.isFinite(Number(stored))) return Number(stored);
  return runwayWeeksFromCashflow(cashflow);
}
