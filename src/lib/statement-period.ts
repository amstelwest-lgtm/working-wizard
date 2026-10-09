/**
 * Statement period labels shared by the Xero sync and the Profitability /
 * cash-forecast UI. Pure — safe to import from client components.
 */

export type YearBasis = "financial" | "calendar";

export type StatementMeta = {
  statementSource: string | null;
  periodLabel: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  /** Companion total. Null when it is the same range as the month, or absent. */
  ytdRevenue: number | null;
  ytdNetIncome: number | null;
  ytdPeriodLabel: string | null;
  ytdPeriodStart: string | null;
  ytdPeriodEnd: string | null;
  ytdBasis: YearBasis | null;
};

export const XERO_YTD_FIELD_KEYS = [
  "ytdRevenue",
  "ytdNetIncome",
  "ytdPeriodStart",
  "ytdPeriodEnd",
  "ytdPeriodLabel",
  "ytdPeriodMonths",
  "ytdBasis",
] as const;

/** Same companion keys on a QuickBooks sync. */
export const STATEMENT_YTD_FIELD_KEYS = XERO_YTD_FIELD_KEYS;

/** Xero, QuickBooks, and Sage each store an explicit from/to on the financials blob. */
export function isDatedLedgerSource(source: string | null | undefined): boolean {
  return source === "xero" || source === "qbo" || source === "sage";
}

const MONTH_STAMP = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4}$/;

export function isMonthStampLabel(label: string): boolean {
  return MONTH_STAMP.test(label.trim());
}

export function isStatementRangeLabel(label: string): boolean {
  return label.includes("–") && /\d{4}/.test(label);
}

/**
 * Autosave uses a calendar month stamp ("Sep 2026"). A ledger snapshot already
 * labeled with both dates must keep that label.
 */
export function resolveSnapshotPeriodLabel(
  existing: string | null | undefined,
  incoming: string,
): string {
  const prev = existing?.trim() ?? "";
  if (prev && isStatementRangeLabel(prev) && isMonthStampLabel(incoming)) return prev;
  return incoming;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FULL_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function utcDate(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(d.getTime()) ? d : null;
}

export function isoDateUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function lastUtcDay(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * Months from a financial-year start (1–12) through a month-end date.
 * US January + 30 Sep → 9, starting 1 Jan. ZA March + 28 Feb → 12, starting 1 Mar
 * of the previous calendar year. A September year-end (start month 10) stays 12.
 */
function financialYearSpan(
  endDate: Date,
  fyStartMonth: number,
): { months: number; periodStart: string } {
  const fy = Math.min(12, Math.max(1, Math.round(fyStartMonth) || 1));
  const endMonth = endDate.getUTCMonth() + 1;
  let months = endMonth - fy + 1;
  let startYear = endDate.getUTCFullYear();
  if (months <= 0) {
    months += 12;
    startYear -= 1;
  }
  return {
    months,
    periodStart: `${startYear}-${String(fy).padStart(2, "0")}-01`,
  };
}

/**
 * How many months a statement covers when periodMonths was not stored.
 * Both dates: inclusive month span. A date before month-end is one month.
 * A month-end date counts from the financial-year start (January when omitted)
 * through that month — 30 Sep is 9 months, not an annual close.
 * No date stays on 12. `preClose` is accepted so callers keep working; the
 * month count follows the year start either way.
 */
export function defaultPeriodCoverage(input: {
  periodStart?: string | null;
  periodEnd?: string | null;
  preClose?: boolean;
  /** 1–12. Month-end statements count from this financial-year start. Default 1. */
  fyStartMonth?: number | null;
}): { months: number; periodStart: string | null } {
  const start = input.periodStart?.trim() ?? "";
  const end = input.periodEnd?.trim() ?? "";
  if (start && end) {
    const from = utcDate(start);
    const to = utcDate(end);
    if (from && to && to >= from) {
      const months =
        (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth()) + 1;
      return { months: Math.min(12, Math.max(1, months)), periodStart: start.slice(0, 10) };
    }
  }
  const endDate = end ? utcDate(end) : null;
  if (endDate) {
    const monthEnd = endDate.getUTCDate() === lastUtcDay(endDate.getUTCFullYear(), endDate.getUTCMonth());
    if (!monthEnd) {
      const month = String(endDate.getUTCMonth() + 1).padStart(2, "0");
      return { months: 1, periodStart: `${endDate.getUTCFullYear()}-${month}-01` };
    }
    const fy =
      input.fyStartMonth != null && Number.isFinite(input.fyStartMonth) ? input.fyStartMonth : 1;
    return financialYearSpan(endDate, fy);
  }
  return { months: 12, periodStart: null };
}

/** Calendar month containing `now`, shifted back `monthsBack` months. Month 0 ends today when the month is still open. */
export function calendarMonthBounds(
  now = new Date(),
  monthsBack = 0,
): { from: string; to: string } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() - monthsBack;
  const start = new Date(Date.UTC(y, m, 1));
  const monthEnd = new Date(Date.UTC(y, m + 1, 0));
  let end = monthEnd;
  if (monthsBack === 0) {
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    if (today < monthEnd) end = today;
  }
  return { from: isoDateUTC(start), to: isoDateUTC(end) };
}

function utcDay(year: number, monthIndex: number, day: number): Date {
  const last = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const clamped = Math.min(Math.max(day, 1), last);
  return new Date(Date.UTC(year, monthIndex, clamped));
}

/**
 * Financial year that contains `now`, from the day after the previous year-end
 * through today (UTC). `fyEndMonth` is 1–12. `fyEndDay` is clamped to the month.
 */
export function financialYearToDate(
  now: Date,
  fyEndMonth: number,
  fyEndDay: number,
): { from: string; to: string } {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const year = today.getUTCFullYear();
  const monthIndex = fyEndMonth - 1;
  const endThisYear = utcDay(year, monthIndex, fyEndDay);
  const previousEnd =
    today.getTime() <= endThisYear.getTime() ? utcDay(year - 1, monthIndex, fyEndDay) : endThisYear;
  const start = new Date(previousEnd.getTime() + 24 * 60 * 60 * 1000);
  return { from: isoDateUTC(start), to: isoDateUTC(today) };
}

/** Always "1 Sep 2026 – 21 Sep 2026". Never a bare month name. */
export function formatStatementPeriodLabel(fromIso: string, toIso: string): string {
  const from = utcDate(fromIso);
  const to = utcDate(toIso);
  if (!from || !to) return "";
  const stamp = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return `${stamp(from)} – ${stamp(to)}`;
}

/** One UTC calendar date, e.g. `21 Sep 2026`. */
export function formatIsoDateUTC(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = utcDate(iso);
  if (!d) return iso;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * Period printed on a report and its file name. Uses the statement dates,
 * never the calendar month the PDF happens to be generated in.
 * A full calendar month is "September 2026". A shorter span in that month
 * is "1–21 Sep 2026 (part month)".
 */
export function reportDataPeriodLabel(fields: object | null | undefined): string | null {
  const meta = readStatementMeta(fields);
  const from = meta.periodStart ? utcDate(meta.periodStart) : null;
  const to = meta.periodEnd ? utcDate(meta.periodEnd) : null;
  if (from && to) {
    const sameMonth =
      from.getUTCFullYear() === to.getUTCFullYear() && from.getUTCMonth() === to.getUTCMonth();
    const lastDay = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() + 1, 0)).getUTCDate();
    if (sameMonth && from.getUTCDate() === 1 && to.getUTCDate() === lastDay) {
      return `${FULL_MONTHS[to.getUTCMonth()]} ${to.getUTCFullYear()}`;
    }
    if (sameMonth) {
      return `${from.getUTCDate()}\u2013${to.getUTCDate()} ${MONTHS[to.getUTCMonth()]} ${to.getUTCFullYear()} (part month)`;
    }
    const range = formatStatementPeriodLabel(meta.periodStart!, meta.periodEnd!);
    return range || null;
  }
  if (to) return `${FULL_MONTHS[to.getUTCMonth()]} ${to.getUTCFullYear()}`;
  const explicit = meta.periodLabel?.trim();
  return explicit || null;
}

/** Studio month dropdown values ("September" / "2026") taken from the period end. */
export function reportPeriodMonthYear(
  fields: object | null | undefined,
): { month: string; year: string } | null {
  const meta = readStatementMeta(fields);
  const end = meta.periodEnd ? utcDate(meta.periodEnd) : null;
  if (!end) return null;
  return { month: FULL_MONTHS[end.getUTCMonth()], year: String(end.getUTCFullYear()) };
}

/** Short month stamp used by older snapshots (`Sep 2026`), UTC so it matches the report month. */
export function calendarMonthStamp(iso: string): string {
  const d = utcDate(iso);
  if (!d) return "";
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function str(fields: Record<string, unknown>, key: string): string | null {
  const v = fields[key];
  if (typeof v !== "string" && typeof v !== "number") return null;
  const t = String(v).trim();
  return t ? t : null;
}

function num(fields: Record<string, unknown>, key: string): number | null {
  const v = fields[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function readStatementMeta(fields: object | null | undefined): StatementMeta {
  const f = (fields ?? {}) as Record<string, unknown>;
  const periodStart = str(f, "periodStart");
  const periodEnd = str(f, "periodEnd");
  const explicit = str(f, "periodLabel");
  const ytdPeriodStart = str(f, "ytdPeriodStart");
  const ytdPeriodEnd = str(f, "ytdPeriodEnd");
  const sameRange = Boolean(
    periodStart && periodEnd && periodStart === ytdPeriodStart && periodEnd === ytdPeriodEnd,
  );
  const basisRaw = str(f, "ytdBasis");
  const ytdBasis: YearBasis | null =
    basisRaw === "financial" || basisRaw === "calendar" ? basisRaw : null;
  return {
    statementSource: str(f, "statementSource"),
    periodStart,
    periodEnd,
    periodLabel:
      explicit ||
      (periodStart && periodEnd ? formatStatementPeriodLabel(periodStart, periodEnd) : null),
    ytdRevenue: sameRange ? null : num(f, "ytdRevenue"),
    ytdNetIncome: sameRange ? null : num(f, "ytdNetIncome"),
    ytdPeriodStart: sameRange ? null : ytdPeriodStart,
    ytdPeriodEnd: sameRange ? null : ytdPeriodEnd,
    ytdPeriodLabel: sameRange
      ? null
      : str(f, "ytdPeriodLabel") ||
        (ytdPeriodStart && ytdPeriodEnd
          ? formatStatementPeriodLabel(ytdPeriodStart, ytdPeriodEnd)
          : null),
    ytdBasis: sameRange ? null : ytdBasis,
  };
}

export function yearToDateTitle(basis: YearBasis | null): string {
  return basis === "calendar" ? "Calendar year to date" : "Financial year to date";
}

/**
 * Period label the accountant Overview prints. Dated statements win
 * (`1 Jan 2026 – 30 Sep 2026`). Otherwise the snapshot label.
 */
export function figuresPeriodLabelFrom(
  financials: object | null | undefined,
  snapshotPeriodLabel?: string | null,
): string | null {
  const meta = readStatementMeta(financials);
  const dated = Boolean(meta.periodStart && meta.periodEnd);
  const fromStatement = dated ? meta.periodLabel?.trim() ?? "" : "";
  if (fromStatement) return fromStatement;
  const snap = snapshotPeriodLabel?.trim() ?? "";
  return snap || null;
}

function opensStoredYear(from: Date, fyStartMonth: number): boolean {
  if (from.getUTCDate() !== 1) return false;
  const month = from.getUTCMonth() + 1;
  return month === 1 || month === fyStartMonth;
}

function isCompleteYear(from: Date, to: Date): boolean {
  const nextOpen = new Date(Date.UTC(from.getUTCFullYear() + 1, from.getUTCMonth(), 1));
  const fullYearEnd = new Date(nextOpen.getTime() - 24 * 60 * 60 * 1000);
  return to.getTime() >= fullYearEnd.getTime();
}

/**
 * End date to quote when the stored figures period is year-to-date
 * (`30 Sep 2026` for 1 Jan–30 Sep). A finished 12-month year is not
 * "to date". A month that does not open the year is not year-to-date.
 * A range marked as the year companion, or one that opens 1 January or
 * the financial year, is.
 */
export function storedYearToDateEnd(
  fields: object | null | undefined,
  fyStartMonth?: number | null,
): string | null {
  const meta = readStatementMeta(fields);
  if (!meta.periodStart || !meta.periodEnd) return null;
  const from = utcDate(meta.periodStart);
  const to = utcDate(meta.periodEnd);
  if (!from || !to || to < from) return null;
  if (isCompleteYear(from, to)) return null;
  const fy =
    fyStartMonth != null && Number.isFinite(fyStartMonth)
      ? Math.min(12, Math.max(1, Math.round(Number(fyStartMonth))))
      : 1;
  const raw = (fields ?? {}) as Record<string, unknown>;
  const ytdStart = str(raw, "ytdPeriodStart");
  const ytdEnd = str(raw, "ytdPeriodEnd");
  const basis = str(raw, "ytdBasis");
  const marked =
    (basis === "financial" || basis === "calendar") &&
    ytdStart === meta.periodStart &&
    ytdEnd === meta.periodEnd;
  if (!marked && !opensStoredYear(from, fy)) return null;
  return formatIsoDateUTC(meta.periodEnd);
}

/** True when the blob came from a dated Xero or QuickBooks sync. */
export function preferStatementPeriod(fields: object | null | undefined): boolean {
  return isDatedLedgerSource(readStatementMeta(fields).statementSource);
}

/** Year companion for the waterfall. Null until a dated Xero or QuickBooks sync stored a different range. */
export function statementYearLine(fields: object | null | undefined): {
  basis: YearBasis | null;
  periodLabel: string;
  revenue: number;
} | null {
  const meta = readStatementMeta(fields);
  if (
    !isDatedLedgerSource(meta.statementSource) ||
    meta.ytdRevenue == null ||
    !meta.ytdPeriodLabel
  ) {
    return null;
  }
  return { basis: meta.ytdBasis, periodLabel: meta.ytdPeriodLabel, revenue: meta.ytdRevenue };
}
