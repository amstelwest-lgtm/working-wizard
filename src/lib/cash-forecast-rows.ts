/**
 * 13-week grid rows. Recurring names that were stored as a single week
 * repeat on the monthly cadence. Small one-offs fold into one Other row.
 * Amounts are the stored line amounts — grouping only sums them.
 */

const RECURRING_NAME = /\b(rent|payroll|salar(?:y|ies)|wages)\b/i;

export type ForecastGridRow = {
  id?: string;
  name: string;
  vals: number[];
  /** Still a one-off after cadence promotion. Grouping uses this. */
  onceOff?: boolean;
  bucket?: "revenue" | "expenses" | "other";
};

export function forecastNameRepeats(name: string): boolean {
  return RECURRING_NAME.test(name);
}

/** Once-off rent and payroll repeat monthly. Other frequencies stay as stored. */
export function displayForecastFrequency(
  name: string,
  frequency: string | null | undefined,
): string {
  const freq = frequency ?? "recurring-monthly";
  if ((freq === "once-off" || freq === "once") && forecastNameRepeats(name)) {
    return "recurring-monthly";
  }
  return freq;
}

export function isDisplayOnceOff(name: string, frequency: string | null | undefined): boolean {
  const freq = frequency ?? "recurring-monthly";
  return (freq === "once-off" || freq === "once") && !forecastNameRepeats(name);
}

function magnitude(vals: number[]): number {
  return vals.reduce((sum, n) => sum + Math.abs(n), 0);
}

/**
 * Fold small one-offs on one side into a single Other row.
 * A one-off under 15% of the largest line on that side is small.
 * More than eight remaining one-offs keep the six largest.
 */
export function groupSmallForecastRows<T extends ForecastGridRow>(rows: T[]): T[] {
  const once = rows.filter((row) => row.onceOff);
  const rest = rows.filter((row) => !row.onceOff);
  if (once.length === 0) return rows;

  const sideMax = Math.max(0, ...rows.map((row) => magnitude(row.vals)));
  const smallCut = sideMax * 0.15;
  const isSmall = (row: T) => {
    const size = magnitude(row.vals);
    return !(size > 0 && size >= smallCut);
  };

  let keep = once.filter((row) => !isSmall(row));
  let fold = once.filter(isSmall);
  if (keep.length > 8) {
    const sorted = [...keep].sort((a, b) => magnitude(b.vals) - magnitude(a.vals));
    fold = [...fold, ...sorted.slice(6)];
    keep = sorted.slice(0, 6);
  }
  if (fold.length === 0) return [...rest, ...keep];

  const width = fold[0]?.vals.length ?? 0;
  const vals = new Array<number>(width).fill(0);
  for (const row of fold) {
    row.vals.forEach((value, index) => {
      vals[index] = (vals[index] ?? 0) + value;
    });
  }
  const other = {
    name: "Other",
    vals,
  } as T;
  return [...rest, ...keep, other];
}
