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

/** Xero and QuickBooks both store an explicit from/to on the financials blob. */
export function isDatedLedgerSource(source: string | null | undefined): boolean {
  return source === "xero" || source === "qbo";
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

function utcDate(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(d.getTime()) ? d : null;
}

export function isoDateUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
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
