/**
 * 13-week grid rows. Recurring names that were stored as a single week
 * repeat on the monthly cadence. Small one-offs fold into one Other row.
 * Amounts are the stored line amounts — grouping only sums them.
 *
 * Single-month assumption (display only; the stored frequency is not rewritten).
 * A month is ~4.33 weeks. A monthly amount lands once a month, on the same
 * day of the month as its start week — about three times in 13 weeks, not
 * every fourth week. The full amount is not spread across every week and it
 * is not divided by 4.33.
 *
 * Inflows and outflows use this same rule when the bank history does not
 * show a second month (`bankHistoryIsSingleMonth`):
 * - Outflows that are rent, payroll (including a staff name that is only an
 *   initial and a surname), insurance (including Santam), a bank debit order,
 *   or a subscription are assumed monthly. The row is labelled with that rule.
 * - Supplier purchases, including Fuji SA, stay in their one week unless the
 *   history already shows that payee twice (stored recurring, or the bank
 *   draft's recurring map). They are labelled purchase (one-off).
 * - Receipts from that same month are assumed monthly at the stored amount
 *   and labelled "receipts (assumed monthly, from last month)". This is the
 *   last month of bank receipts, not a P&L run-rate.
 * When two or more months are on file, a one-off receipt or purchase stays
 * in its week. Only a payee the history shows twice is projected.
 */

const RENT_KEYWORD = /\b(rent|rental|lease|leases|propert(?:y|ies))\b/i;
const PAYROLL_KEYWORD = /\b(payroll|salar(?:y|ies)|wages|staff)\b/i;
const INSURANCE_KEYWORD = /\b(insurance|santam)\b/i;
const DEBIT_KEYWORD = /\bdebit\s*orders?\b/i;
const SUBSCRIPTION_KEYWORD = /\bsubscriptions?\b/i;
const PERSON_OUTFLOW = /^[A-Za-z]\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?$/;

export const ASSUMED_MONTHLY_LABEL = "assumed monthly";
export const RECEIPT_ASSUMED_LABEL = "receipts (assumed monthly, from last month)";

export type ForecastSide = "revenue" | "expenses" | "other" | "inflow" | "outflow";

export type ForecastRule =
  | "rent"
  | "payroll"
  | "insurance"
  | "debit_order"
  | "subscription"
  | "receipt"
  | "purchase"
  | "stored";

export type AssumedMonthlyContext = {
  side?: ForecastSide | null;
  bucket?: string | null;
  /** Bank history does not cover a second month. */
  singleMonth?: boolean;
};

const RULE_LABEL: Record<Exclude<ForecastRule, "stored">, string> = {
  rent: "rent (assumed monthly)",
  payroll: "payroll (assumed monthly)",
  insurance: "insurance (assumed monthly)",
  debit_order: "debit order (assumed monthly)",
  subscription: "subscription (assumed monthly)",
  receipt: RECEIPT_ASSUMED_LABEL,
  purchase: "purchase (one-off)",
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

function inflowSide(side: ForecastSide | null | undefined): boolean {
  return side === "revenue" || side === "inflow";
}

function onceOffFrequency(frequency: string | null | undefined): boolean {
  const freq = frequency ?? "recurring-monthly";
  return freq === "once-off" || freq === "once";
}

function bucketRule(bucket: string): ForecastRule | null {
  if (bucket === "rent") return "rent";
  if (bucket === "payroll") return "payroll";
  if (bucket === "insurance") return "insurance";
  if (bucket === "debit_order" || bucket === "debit-order") return "debit_order";
  if (bucket === "subscription") return "subscription";
  return null;
}

/** Which rule tagged this line. Stored recurring rows are not an assumption. */
export function forecastLineRule(
  name: string,
  frequency: string | null | undefined,
  context?: AssumedMonthlyContext | null,
): ForecastRule {
  const text = name.trim();
  if (!text || !onceOffFrequency(frequency)) return "stored";
  if (inflowSide(context?.side)) return context?.singleMonth ? "receipt" : "stored";
  if (RENT_KEYWORD.test(text)) return "rent";
  if (PAYROLL_KEYWORD.test(text)) return "payroll";
  if (INSURANCE_KEYWORD.test(text)) return "insurance";
  if (DEBIT_KEYWORD.test(text)) return "debit_order";
  if (SUBSCRIPTION_KEYWORD.test(text)) return "subscription";
  const fromBucket = bucketRule((context?.bucket ?? "").trim().toLowerCase());
  if (fromBucket) return fromBucket;
  if (outflowSide(context?.side) && PERSON_OUTFLOW.test(text)) return "payroll";
  if (outflowSide(context?.side)) return "purchase";
  return "stored";
}

export function forecastRuleLabel(rule: ForecastRule): string {
  if (rule === "stored") return "";
  return RULE_LABEL[rule];
}

/** Category, staff name, or a single-month receipt. A purchase is not assumed. */
export function assumedMonthlyPayee(name: string, context?: AssumedMonthlyContext | null): boolean {
  const rule = forecastLineRule(name, "once-off", context);
  return rule !== "stored" && rule !== "purchase";
}

/**
 * True when the bank file does not cover a second month.
 * Two distinct YYYY-MM values in the draft keep one-off receipts and
 * purchases in their own week. A published bank seed with no draft (the
 * live hotel) is one month.
 */
export function bankHistoryIsSingleMonth(input: {
  seededFromBanksAt?: unknown;
  bankDraft?: unknown;
}): boolean {
  const months = draftHistoryMonths(input.bankDraft);
  if (months != null && months >= 2) return false;
  if (months === 1) return true;
  return typeof input.seededFromBanksAt === "string" && input.seededFromBanksAt.length > 0;
}

function draftHistoryMonths(bankDraft: unknown): number | null {
  if (!bankDraft || typeof bankDraft !== "object" || Array.isArray(bankDraft)) return null;
  const extract = (bankDraft as { extract?: unknown }).extract;
  const transactions =
    extract && typeof extract === "object" && !Array.isArray(extract)
      ? (extract as { transactions?: unknown }).transactions
      : null;
  if (!Array.isArray(transactions)) return null;
  const months = new Set<string>();
  for (const row of transactions) {
    if (!row || typeof row !== "object") continue;
    const date = (row as { date?: unknown }).date;
    if (typeof date !== "string") continue;
    const month = date.slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(month)) months.add(month);
  }
  return months.size > 0 ? months.size : null;
}

/** Stable key for cached answers and briefs. Changes when the forecast or P&L inputs change. */
export function forecastPlFingerprint(cashflow: unknown, financials: unknown): string {
  const cf = cashflow && typeof cashflow === "object" && !Array.isArray(cashflow) ? (cashflow as Record<string, unknown>) : {};
  const fin =
    financials && typeof financials === "object" && !Array.isArray(financials)
      ? (financials as Record<string, unknown>)
      : {};
  const lines = (key: string) => {
    const rows = Array.isArray(cf[key]) ? cf[key] : [];
    return rows.map((row) => {
      if (!row || typeof row !== "object") return "";
      const line = row as Record<string, unknown>;
      return [line.name ?? "", line.amount ?? "", line.frequency ?? "", line.startWeek ?? ""].join("|");
    });
  };
  const plKeys = ["revenue", "cogs", "ebit", "ebitda", "ebt", "netIncome", "interestExpense", "interest", "tax", "fixedCosts"];
  const payload = JSON.stringify({
    opening: cf.openingBalance ?? "",
    seeded: cf.seededFromBanksAt ?? "",
    revenue: lines("revenue"),
    expenses: lines("expenses"),
    other: lines("other"),
    pl: plKeys.map((key) => [key, fin[key] ?? ""]),
  });
  let hash = 0;
  for (let i = 0; i < payload.length; i++) hash = (hash * 31 + payload.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

export function forecastNameRepeats(name: string): boolean {
  const text = name.trim();
  return (
    RENT_KEYWORD.test(text) ||
    PAYROLL_KEYWORD.test(text) ||
    INSURANCE_KEYWORD.test(text) ||
    DEBIT_KEYWORD.test(text) ||
    SUBSCRIPTION_KEYWORD.test(text)
  );
}

export function isAssumedMonthlyLine(
  name: string,
  frequency: string | null | undefined,
  context?: AssumedMonthlyContext | null,
): boolean {
  if (!onceOffFrequency(frequency)) return false;
  return assumedMonthlyPayee(name, context);
}

/** Once-off rent, payroll, insurance, debit orders, subscriptions, and single-month receipts repeat monthly. */
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
  const label = forecastRuleLabel(forecastLineRule(name, frequency, context));
  if (!label) return name;
  return `${name} · ${label}`;
}

export function isDisplayOnceOff(
  name: string,
  frequency: string | null | undefined,
  context?: AssumedMonthlyContext | null,
): boolean {
  return onceOffFrequency(frequency) && !assumedMonthlyPayee(name, context);
}

function magnitude(vals: number[]): number {
  return vals.reduce((sum, n) => sum + Math.abs(n), 0);
}

function peakWeek(vals: number[]): number {
  return vals.reduce((max, n) => Math.max(max, Math.abs(n)), 0);
}

/**
 * Fold small one-offs on one side into a single Other row.
 * A one-off under 15% of the largest single week on that side is small.
 * The cut uses one week, not the 13-week sum, so a monthly rent does not
 * hide a purchase that is a material share of that rent.
 * More than eight remaining one-offs keep the six largest.
 */
export function groupSmallForecastRows<T extends ForecastGridRow>(rows: T[]): T[] {
  const once = rows.filter((row) => row.onceOff);
  const rest = rows.filter((row) => !row.onceOff);
  if (once.length === 0) return rows;

  const sideMax = Math.max(0, ...rows.map((row) => peakWeek(row.vals)));
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
