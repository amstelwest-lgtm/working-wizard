/**
 * Suggested cash floor, recurring fixed costs, and opening cash.
 * Every amount is the statement, a stored snapshot, or the forecast already
 * on file. The R50,000 fallback floor is never offered as a suggestion.
 */
import { periodProfitBridge } from "./period-profit.ts";
import { periodMonthsOf } from "./ratios.ts";
import {
  forecastMinimumCash,
  periodOperatingOutflows,
  weeklyRunRate,
  CASH_FORECAST_WEEK_COUNT,
} from "./client-metrics.ts";

export type CashLedger = "QuickBooks" | "Xero" | "On file";

export type TrailingMonthInput = {
  /** YYYY-MM-DD or YYYY-MM. */
  periodDate: string;
  financials: Record<string, unknown> | null | undefined;
};

export type FixedCostStep = {
  n: 1 | 2 | 3;
  label: string;
  amount: number | null;
  note: string;
};

export type CashSuggestion = {
  key: "opening" | "floor" | "fixed";
  label: string;
  amount: number;
  source: string;
};

export type CashForecastSuggestions = {
  suggestions: CashSuggestion[];
  steps: FixedCostStep[];
  /** Monthly fixed cost to place on the forecast, when it is not already inside a movement line. */
  fixedMonthly: number | null;
  /** True when confirm must not add a second fixed-cost line. */
  fixedAlreadyInForecast: boolean;
  empty: string | null;
};

export type ConfirmedCashSuggestions = {
  opening: number | null;
  floor: number | null;
  fixedMonthly: number | null;
  at: string;
};

export function ledgerFromOpeningSource(source: unknown): CashLedger {
  if (source === "qbo") return "QuickBooks";
  if (source === "xero") return "Xero";
  return "On file";
}

function present(fin: Record<string, unknown> | null | undefined, key: string): boolean {
  if (!fin) return false;
  const raw = fin[key];
  if (raw == null || String(raw).trim() === "") return false;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/,/g, ""));
  return Number.isFinite(n);
}

/** Same operating-expense total the profit waterfall uses. Null when it is not on the statement. */
export function statementFixedCostTotal(
  financials: Record<string, unknown> | null | undefined,
): number | null {
  if (!financials) return null;
  if (!present(financials, "fixedCosts") && !present(financials, "ebit")) return null;
  const total = periodProfitBridge(financials).operatingExpenses;
  return Number.isFinite(total) ? total : null;
}

function statedMonths(financials: Record<string, unknown> | null | undefined): number | null {
  if (!financials) return null;
  const raw = financials.periodMonths;
  if (raw == null || String(raw).trim() === "") return null;
  const months = periodMonthsOf(financials);
  return months >= 1 && months <= 12 ? months : null;
}

function monthKey(periodDate: string | null | undefined): string | null {
  if (!periodDate) return null;
  const value = periodDate.slice(0, 7);
  return /^\d{4}-\d{2}$/.test(value) ? value : null;
}

function monthlyFromTotal(total: number, months: number | null): number | null {
  if (months == null || months < 1) return null;
  return Math.round((total / months) * 100) / 100;
}

type MonthRow = { month: string; fixedMonthly: number | null; outflowMonthly: number | null };

function monthRow(periodDate: string, financials: Record<string, unknown> | null | undefined): MonthRow | null {
  const month = monthKey(periodDate);
  if (!month || !financials) return null;
  const months = statedMonths(financials);
  const fixed = statementFixedCostTotal(financials);
  const operating = periodOperatingOutflows(financials);
  return {
    month,
    fixedMonthly: fixed == null ? null : monthlyFromTotal(fixed, months),
    outflowMonthly: operating == null ? null : monthlyFromTotal(operating, months),
  };
}

function latestMonths(rows: MonthRow[], pick: (row: MonthRow) => number | null, count: number): number[] {
  const byMonth = new Map<string, number>();
  const sorted = [...rows].sort((a, b) => b.month.localeCompare(a.month));
  for (const row of sorted) {
    if (byMonth.has(row.month)) continue;
    const value = pick(row);
    if (value == null) continue;
    byMonth.set(row.month, value);
    if (byMonth.size === count) break;
  }
  return [...byMonth.values()];
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return Math.round((values.reduce((sum, n) => sum + n, 0) / values.length) * 100) / 100;
}

/** A positive week series uses the same floor as the chart, including a result of 50,000. */
export function floorFromWeeklyOutflows(weeks: readonly number[]): number | null {
  if (!weeks.some((n) => n > 0)) return null;
  const floor = forecastMinimumCash({ weeklyOutflows: [...weeks] });
  return floor > 0 ? floor : null;
}

function floorFromMonthlyOutflow(monthly: number): number | null {
  if (!(monthly > 0)) return null;
  const weekly = weeklyRunRate({ operatingOutflows: monthly, periodMonths: 1 }).weeklyOutflow;
  if (!(weekly > 0)) return null;
  return floorFromWeeklyOutflows(new Array(CASH_FORECAST_WEEK_COUNT).fill(weekly));
}

export function suggestCashForecast(input: {
  ledger: CashLedger | null;
  openingCash: number | null;
  currentFinancials: Record<string, unknown> | null | undefined;
  currentPeriodEnd?: string | null;
  trailing: readonly TrailingMonthInput[];
  /** Week-by-week outflows already on the forecast. The floor matches the chart. */
  forecastWeeklyOutflows?: readonly number[] | null;
  forecastHasMovement?: boolean;
}): CashForecastSuggestions {
  const rows: MonthRow[] = [];
  const currentMonth = monthKey(input.currentPeriodEnd);
  if (currentMonth && input.currentFinancials) {
    const row = monthRow(`${currentMonth}-01`, input.currentFinancials);
    if (row) rows.push(row);
  }
  for (const snap of input.trailing) {
    const row = monthRow(snap.periodDate, snap.financials);
    if (row) rows.push(row);
  }

  const fixedMonths = latestMonths(rows, (row) => row.fixedMonthly, 3);
  const outflowMonths = latestMonths(rows, (row) => row.outflowMonthly, 3);
  const trailingFixed = fixedMonths.length === 3 ? average(fixedMonths) : null;
  const trailingOutflow = outflowMonths.length === 3 ? average(outflowMonths) : null;

  const statementTotal = statementFixedCostTotal(input.currentFinancials);
  const currentMonths = statedMonths(input.currentFinancials);
  const currentMonthly =
    statementTotal == null ? null : monthlyFromTotal(statementTotal, currentMonths);
  const fixedMonthly = trailingFixed ?? currentMonthly;
  const fixedSource =
    trailingFixed != null
      ? "Trailing 3 months"
      : currentMonthly != null
        ? (input.ledger ?? "This period on file")
        : null;

  let floor: number | null = null;
  let floorSource: string | null = null;
  const chartWeeks = input.forecastWeeklyOutflows ?? [];
  if (input.forecastHasMovement && chartWeeks.length) {
    floor = floorFromWeeklyOutflows(chartWeeks);
    if (floor != null) floorSource = "Same floor as the cash forecast";
  }
  if (floor == null && trailingOutflow != null) {
    floor = floorFromMonthlyOutflow(trailingOutflow);
    if (floor != null) floorSource = "Trailing 3 months";
  }
  if (floor == null) {
    const operating = periodOperatingOutflows(input.currentFinancials);
    const monthly = operating == null ? null : monthlyFromTotal(operating, currentMonths);
    if (monthly != null) {
      floor = floorFromMonthlyOutflow(monthly);
      if (floor != null) floorSource = input.ledger ?? "This period on file";
    }
  }

  const suggestions: CashSuggestion[] = [];
  if (input.openingCash != null && Number.isFinite(input.openingCash)) {
    suggestions.push({
      key: "opening",
      label: "Opening cash",
      amount: input.openingCash,
      source: input.ledger ?? "On file",
    });
  }
  if (floor != null && floorSource) {
    suggestions.push({
      key: "floor",
      label: "Cash floor",
      amount: floor,
      source: floorSource,
    });
  }
  if (fixedMonthly != null && fixedSource) {
    suggestions.push({
      key: "fixed",
      label: "Recurring fixed costs",
      amount: fixedMonthly,
      source: fixedSource,
    });
  }

  const steps: FixedCostStep[] = [
    {
      n: 1,
      label: "Statement total",
      amount: statementTotal,
      note: statementTotal == null ? "Fixed costs are not on the statement." : "Same total as Profit.",
    },
    {
      n: 2,
      label: "Monthly amount",
      amount: fixedMonthly,
      note:
        fixedMonthly == null
          ? "Period length is not on file, so there is no monthly figure."
          : fixedSource === "Trailing 3 months"
            ? "Average of the trailing 3 months."
            : "This period divided by the months on file.",
    },
    {
      n: 3,
      label: "Forecast line",
      amount: input.forecastHasMovement ? null : fixedMonthly,
      note: input.forecastHasMovement
        ? "Already inside the forecast payments. Confirm does not add them again."
        : fixedMonthly == null
          ? "Nothing to place on the forecast yet."
          : "Recurring monthly line, after you confirm.",
    },
  ];

  return {
    suggestions,
    steps,
    fixedMonthly,
    fixedAlreadyInForecast: Boolean(input.forecastHasMovement),
    empty: suggestions.length ? null : "Nothing on file to suggest yet.",
  };
}

export function suggestionsMatchConfirm(
  suggestions: readonly CashSuggestion[],
  confirmed: ConfirmedCashSuggestions | null | undefined,
): boolean {
  if (!confirmed) return false;
  const amount = (key: CashSuggestion["key"]) => suggestions.find((row) => row.key === key)?.amount ?? null;
  const close = (a: number | null, b: number | null) => {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    return Math.abs(a - b) < 0.5;
  };
  return (
    close(amount("opening"), confirmed.opening) &&
    close(amount("floor"), confirmed.floor) &&
    close(amount("fixed"), confirmed.fixedMonthly)
  );
}
