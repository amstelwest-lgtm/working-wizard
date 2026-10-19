/**
 * 13-week grid rows. Recurring names that were stored as a single week
 * repeat on the monthly cadence. Small one-offs fold into one Other row.
 * Amounts are the stored line amounts — grouping only sums them.
 */

/**
 * Rent, payroll, insurance, debit orders and subscriptions are monthly even
 * from a single stored month. A month is ~4.33 weeks; the 13-week grid's
 * monthly step is every 4th week, so the amount lands in weeks 1, 5, 9 and 13.
 * The stored frequency is not rewritten.
 */
const CATEGORY_KEYWORD =
  /\b(rent|rental|lease|leases|propert(?:y|ies)|payroll|salar(?:y|ies)|wages|staff|insurance|debit\s*orders?|subscriptions?)\b/i;
/** Payees whose category is not in the name. Fuji SA is the hotel subscription. Santam is the insurer. */
const CATEGORY_PAYEE = /\b(fuji|santam)\b/i;
const PERSON_OUTFLOW = /^[A-Za-z]\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?$/;
const ASSUMED_BUCKETS = new Set(["rent", "payroll", "insurance", "subscription", "debit_order", "debit-order"]);

export const ASSUMED_MONTHLY_LABEL = "recurring (assumed monthly)";

export type ForecastSide = "revenue" | "expenses" | "other" | "inflow" | "outflow";

export type AssumedMonthlyContext = {
  side?: ForecastSide | null;
  bucket?: string | null;
};

export type ForecastGridRow = {
  id?: string;
  name: string;
  vals: number[];
  /** Still a one-off after cadence promotion. Grouping uses this. */
  onceOff?: boolean;
  bucket?: "revenue" | "expenses" | "other";
};

function outflowSide(side: ForecastSide | null | undefined): boolean {
  return side === "expenses" || side === "other" || side === "outflow";
}

/** Category, bucket, or an outflow that is only an initial and a surname. Receipts stay once-off. */
export function assumedMonthlyPayee(name: string, context?: AssumedMonthlyContext | null): boolean {
  const text = name.trim();
  if (!text) return false;
  if (CATEGORY_KEYWORD.test(text) || CATEGORY_PAYEE.test(text)) return true;
  const bucket = (context?.bucket ?? "").trim().toLowerCase();
  if (bucket && ASSUMED_BUCKETS.has(bucket)) return true;
  return outflowSide(context?.side) && PERSON_OUTFLOW.test(text);
}

export function forecastNameRepeats(name: string): boolean {
  return assumedMonthlyPayee(name);
}

export function isAssumedMonthlyLine(
  name: string,
  frequency: string | null | undefined,
  context?: AssumedMonthlyContext | null,
): boolean {
  const freq = frequency ?? "recurring-monthly";
  if (freq !== "once-off" && freq !== "once") return false;
  return assumedMonthlyPayee(name, context);
}

/** Once-off rent, payroll, insurance and subscriptions repeat monthly. Other frequencies stay as stored. */
export function displayForecastFrequency(
  name: string,
  frequency: string | null | undefined,
  context?: AssumedMonthlyContext | null,
): string {
  const freq = frequency ?? "recurring-monthly";
  if (isAssumedMonthlyLine(name, freq, context)) return "recurring-monthly";
  return freq;
}

export function forecastRowLabel(
  name: string,
  frequency: string | null | undefined,
  context?: AssumedMonthlyContext | null,
): string {
  if (!isAssumedMonthlyLine(name, frequency, context)) return name;
  return `${name} · ${ASSUMED_MONTHLY_LABEL}`;
}

export function isDisplayOnceOff(
  name: string,
  frequency: string | null | undefined,
  context?: AssumedMonthlyContext | null,
): boolean {
  const freq = frequency ?? "recurring-monthly";
  return (freq === "once-off" || freq === "once") && !assumedMonthlyPayee(name, context);
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
