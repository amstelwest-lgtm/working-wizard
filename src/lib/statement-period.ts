/**
 * Statement period labels shared by the Xero sync and the Profitability /
 * cash-forecast UI. Pure — safe to import from client components.
 */

import { isProratedPeriodLabel } from "../../supabase/functions/_shared/firm-year-label.ts";
import { dateOrder, MONTHS, MONTHS_LONG as FULL_MONTHS } from "./market/date-presets.ts";
import { formatCalendarDay, formatDateRange, type DateMarket } from "./market/format.ts";

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

const STORED_SPAN = /^(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2})$/;

/** Persisted sync label. The two dates, not a market's prose. */
export function storedPeriodSpan(start: string, end: string): string {
  const from = start.trim().slice(0, 10);
  const to = end.trim().slice(0, 10);
  if (!STORED_SPAN.test(`${from}/${to}`)) return "";
  return `${from}/${to}`;
}

function labelText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parseStoredPeriodSpan(
  label: string | null | undefined,
): { start: string; end: string } | null {
  const text = labelText(label);
  const match = STORED_SPAN.exec(text);
  if (!match) return null;
  return { start: match[1]!, end: match[2]! };
}

export function isStatementRangeLabel(label: string): boolean {
  const text = labelText(label);
  if (!text) return false;
  if (parseStoredPeriodSpan(text)) return true;
  return text.includes("–") && /\d{4}/.test(text);
}

/**
 * A stored day span such as "1 Sep 2026 – 21 Sep 2026".
 * Month stamps ("Sep 2026") and the neutral `YYYY-MM-DD/YYYY-MM-DD` form are not.
 */
export function isBakedDayRangeLabel(label: string): boolean {
  const text = label.trim();
  if (!text || isMonthStampLabel(text) || parseStoredPeriodSpan(text)) return false;
  if (!/[–—-]/.test(text)) return false;
  return /\d/.test(text) && /[A-Za-z]{3}/.test(text);
}

function storedLabelOrder(label: string): "day" | "month" | "other" {
  const text = label.trim();
  if (/^\d{1,2}\b/.test(text)) return "day";
  if (/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/.test(text)) return "month";
  return "other";
}

/**
 * Display a statement span. Dates win. A neutral stored span is formatted.
 * A baked day-range is shown only when it already matches the market order.
 */
export function statementSpanLabel(input: {
  periodStart?: string | null;
  periodEnd?: string | null;
  periodLabel?: string | null;
  market: DateMarket;
}): string | null {
  const start = labelText(input.periodStart);
  const end = labelText(input.periodEnd);
  const stored = labelText(input.periodLabel);
  if (!input.market) return stored || null;
  if (start && end) {
    const fresh = formatStatementPeriodLabel(start, end, input.market);
    if (fresh) return fresh;
  }
  const parsed = parseStoredPeriodSpan(stored);
  if (parsed) {
    const fresh = formatStatementPeriodLabel(parsed.start, parsed.end, input.market);
    if (fresh) return fresh;
  }
  if (!stored) return null;
  const repaired = repairCalendarFigureLeaks(stored, input.market);
  if (repaired !== stored) return repaired;
  if (!isBakedDayRangeLabel(stored)) return stored;
  const order = storedLabelOrder(stored);
  const want = dateOrder(input.market.locale) === "us" ? "month" : "day";
  if (order !== "other" && order !== want) return null;
  return stored;
}

/**
 * Autosave uses a calendar month stamp ("Sep 2026"). A ledger snapshot already
 * labeled with both dates must keep that label.
 */
export function resolveSnapshotPeriodLabel(
  existing: string | null | undefined,
  incoming: string,
): string {
  const prev = labelText(existing);
  if (prev && isStatementRangeLabel(prev) && isMonthStampLabel(incoming)) return prev;
  return incoming;
}

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
        (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
        (to.getUTCMonth() - from.getUTCMonth()) +
        1;
      return { months: Math.min(12, Math.max(1, months)), periodStart: start.slice(0, 10) };
    }
  }
  const endDate = end ? utcDate(end) : null;
  if (endDate) {
    const monthEnd =
      endDate.getUTCDate() === lastUtcDay(endDate.getUTCFullYear(), endDate.getUTCMonth());
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

/** Calendar year, month (1–12), and day of `now` in `timeZone`. */
export function calendarDateInTimeZone(
  now: Date,
  timeZone: string,
): { year: number; month: number; day: number } {
  // date-ok: numeric year month and day parts, no month name
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "");
  const year = read("year");
  const month = read("month");
  const day = read("day");
  if (!year || !month || !day) {
    return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, day: now.getUTCDate() };
  }
  return { year, month, day };
}

/** UTC noon on the calendar day `now` has in `timeZone`, so month bounds stay on that day. */
function asUtcCalendarDate(now: Date, timeZone: string): Date {
  const { year, month, day } = calendarDateInTimeZone(now, timeZone);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

/**
 * Calendar month containing `now`, shifted back `monthsBack` months.
 * Month 0 ends today when the month is still open.
 * Without `timeZone` the day is UTC. Sage passes Africa/Johannesburg.
 */
export function calendarMonthBounds(
  now = new Date(),
  monthsBack = 0,
  timeZone?: string,
): { from: string; to: string } {
  if (timeZone) return calendarMonthBounds(asUtcCalendarDate(now, timeZone), monthsBack);
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
 * through today. `fyEndMonth` is 1–12. `fyEndDay` is clamped to the month.
 * Without `timeZone` the day is UTC. Sage passes Africa/Johannesburg.
 */
export function financialYearToDate(
  now: Date,
  fyEndMonth: number,
  fyEndDay: number,
  timeZone?: string,
): { from: string; to: string } {
  if (timeZone) return financialYearToDate(asUtcCalendarDate(now, timeZone), fyEndMonth, fyEndDay);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const year = today.getUTCFullYear();
  const monthIndex = fyEndMonth - 1;
  const endThisYear = utcDay(year, monthIndex, fyEndDay);
  const previousEnd =
    today.getTime() <= endThisYear.getTime() ? utcDay(year - 1, monthIndex, fyEndDay) : endThisYear;
  const start = new Date(previousEnd.getTime() + 24 * 60 * 60 * 1000);
  return { from: isoDateUTC(start), to: isoDateUTC(today) };
}

/** Date span for a statement. Never a bare month name. Order follows the client market. */
export function formatStatementPeriodLabel(
  fromIso: string,
  toIso: string,
  market: DateMarket,
): string {
  const label = formatDateRange(fromIso, toIso, market);
  return label === "—" ? "" : label;
}

/** One calendar date from a YYYY-MM-DD prefix. Order follows the market. */
export function formatIsoDateUTC(
  iso: string | null | undefined,
  market: { locale?: string | null },
): string {
  if (!iso) return "";
  const label = formatCalendarDay(iso, market);
  return label === "—" ? iso : label;
}

/**
 * Period printed on a report and its file name. Uses the statement dates,
 * never the calendar month the PDF happens to be generated in.
 * A full calendar month is "September 2026". A shorter span in that month
 * is the market range plus " (part month)": US "Sep 1–21, 2026 (part month)",
 * ZA "1–21 Sep 2026 (part month)".
 */
export function reportDataPeriodLabel(
  fields: object | null | undefined,
  market: DateMarket,
): string | null {
  const meta = readStatementMeta(fields, market);
  const from = meta.periodStart ? utcDate(meta.periodStart) : null;
  const to = meta.periodEnd ? utcDate(meta.periodEnd) : null;
  if (from && to) {
    const sameMonth =
      from.getUTCFullYear() === to.getUTCFullYear() && from.getUTCMonth() === to.getUTCMonth();
    const lastDay = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() + 1, 0)).getUTCDate();
    if (sameMonth && from.getUTCDate() === 1 && to.getUTCDate() === lastDay) {
      return `${FULL_MONTHS[to.getUTCMonth()]} ${to.getUTCFullYear()}`;
    }
    const range = formatDateRange(meta.periodStart!, meta.periodEnd!, market);
    if (!range || range === "—") return null;
    if (sameMonth) return `${range} (part month)`;
    return range;
  }
  if (to) return `${FULL_MONTHS[to.getUTCMonth()]} ${to.getUTCFullYear()}`;
  const explicit = meta.periodLabel?.trim();
  return explicit || null;
}

/** Studio month dropdown values ("September" / "2026") taken from the period end. */
export function reportPeriodMonthYear(
  fields: object | null | undefined,
): { month: string; year: string } | null {
  const endIso = str((fields ?? {}) as Record<string, unknown>, "periodEnd");
  const end = endIso ? utcDate(endIso) : null;
  if (!end) return null;
  return { month: FULL_MONTHS[end.getUTCMonth()], year: String(end.getUTCFullYear()) };
}

/** Short month stamp used by older snapshots (`Sep 2026`), UTC so it matches the report month. */
export function calendarMonthStamp(iso: string): string {
  const d = utcDate(iso);
  if (!d) return "";
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const PILL_MONTH: Record<string, number> = {};
for (const [index, name] of MONTHS.entries()) PILL_MONTH[name.toLowerCase()] = index;
for (const [index, name] of FULL_MONTHS.entries()) PILL_MONTH[name.toLowerCase()] = index;
PILL_MONTH.sept = 8;

/**
 * Client-header pill. The books' period end wins ("2026-09-30" is Sep 2026).
 * A statement label is the fallback. Null when there are no books, so the
 * pill can use the calendar month.
 */
/**
 * Owner header pill before the board is ready.
 * Unknown books stay pending so the pill cannot show today's month.
 * Once the books are known, the label is the statement period end, or null
 * when that client has no period on file.
 */
export function ownerBootPeriodPill(input: {
  booksKnown: boolean;
  periodEnd?: string | null;
  periodLabel?: string | null;
}): { pending: boolean; label: string | null } {
  if (!input.booksKnown) return { pending: true, label: null };
  return { pending: false, label: booksPeriodPillLabel(input.periodEnd, input.periodLabel) };
}

export function booksPeriodPillLabel(
  periodEnd?: string | null,
  periodLabel?: string | null,
): string | null {
  const iso = typeof periodEnd === "string" ? periodEnd.trim().slice(0, 10) : "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const stamp = calendarMonthStamp(iso);
    if (stamp) return stamp;
  }
  const text = periodLabel?.trim() ?? "";
  if (!text) return null;
  const hits: { index: number; month: number; year: string }[] = [];
  const patterns = [
    /\b([A-Za-z]{3,9})\.?\s+\d{1,2},?\s+(\d{4})\b/g,
    /\b(?:\d{1,2}\s+)?([A-Za-z]{3,9})\.?\s+(\d{4})\b/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const month = PILL_MONTH[(match[1] ?? "").toLowerCase()];
      if (month == null || match.index == null) continue;
      hits.push({ index: match.index, month, year: match[2] ?? "" });
    }
  }
  if (hits.length === 0) return null;
  hits.sort((a, b) => a.index - b.index);
  const last = hits[hits.length - 1]!;
  return `${MONTHS[last.month]} ${last.year}`;
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

function datedRangeLabel(
  start: string | null,
  end: string | null,
  stored: string | null,
  market: DateMarket,
): string | null {
  if (start && end) {
    const fresh = formatStatementPeriodLabel(start, end, market);
    if (fresh) return fresh;
  }
  const parsed = parseStoredPeriodSpan(stored);
  if (parsed) {
    const fresh = formatStatementPeriodLabel(parsed.start, parsed.end, market);
    if (fresh) return fresh;
  }
  return stored;
}

/** Ledger source only. Display labels go through `readStatementMeta` with the client market. */
export function statementSourceOf(fields: object | null | undefined): string | null {
  const f = (fields ?? {}) as Record<string, unknown>;
  return str(f, "statementSource");
}

export function readStatementMeta(
  fields: object | null | undefined,
  market: DateMarket,
): StatementMeta {
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
    // Stored periodLabel is a baked string. Dates on the row win at read time.
    periodLabel: datedRangeLabel(periodStart, periodEnd, explicit, market),
    ytdRevenue: sameRange ? null : num(f, "ytdRevenue"),
    ytdNetIncome: sameRange ? null : num(f, "ytdNetIncome"),
    ytdPeriodStart: sameRange ? null : ytdPeriodStart,
    ytdPeriodEnd: sameRange ? null : ytdPeriodEnd,
    ytdPeriodLabel: sameRange
      ? null
      : datedRangeLabel(ytdPeriodStart, ytdPeriodEnd, str(f, "ytdPeriodLabel"), market),
    ytdBasis: sameRange ? null : ytdBasis,
  };
}

export function yearToDateTitle(basis: YearBasis | null): string {
  return basis === "calendar" ? "Calendar year to date" : "Financial year to date";
}

/**
 * Period label the accountant Overview prints. A stored from/to wins.
 * When the end is stored without a start, the start is the first of the
 * month `periodMonths` earlier (`periodEnd` 2026-09-30 and 12 months is
 * `1 Oct 2025 – 30 Sep 2026`). The snapshot label is used only when there
 * is no period end.
 */
export function figuresPeriodLabelFrom(
  financials: object | null | undefined,
  snapshotPeriodLabel: string | null | undefined,
  market: DateMarket,
): string | null {
  if (!market) return labelText(snapshotPeriodLabel) || null;
  const meta = readStatementMeta(financials, market);
  if (meta.periodStart && meta.periodEnd) {
    const fromStatement = meta.periodLabel?.trim() ?? "";
    if (fromStatement) return fromStatement;
  }
  if (meta.periodEnd) {
    const months = num((financials ?? {}) as Record<string, unknown>, "periodMonths");
    const end = utcDate(meta.periodEnd);
    if (end && months != null && months >= 1) {
      const span = Math.max(1, Math.round(months));
      const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - (span - 1), 1));
      const label = formatStatementPeriodLabel(isoDateUTC(start), meta.periodEnd.slice(0, 10), market);
      if (label) return label;
    }
    const stamp = calendarMonthStamp(meta.periodEnd);
    if (stamp) return stamp;
  }
  const snap = labelText(snapshotPeriodLabel);
  // A snapshot named "Sep 2026" is the month the file was saved. Figures with
  // no start or end are the full statement on file, not that month.
  if (!meta.periodStart && !meta.periodEnd && snapshotIsMonthStamp(snap)) {
    return FULL_YEAR_ON_FILE;
  }
  const parsed = parseStoredPeriodSpan(snap);
  if (parsed) {
    const label = formatStatementPeriodLabel(parsed.start, parsed.end, market);
    if (label) return label;
  }
  const storedOnFigures = str((financials ?? {}) as Record<string, unknown>, "periodLabel");
  const fromFigures = !snap ? parseStoredPeriodSpan(storedOnFigures) : null;
  if (fromFigures) {
    const label = formatStatementPeriodLabel(fromFigures.start, fromFigures.end, market);
    if (label) return label;
  }
  return snap || null;
}

/** Label for a statement that has amounts and no from/to dates. */
export const FULL_YEAR_ON_FILE = "Full year on file";

const SAVED_MONTH =
  "Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?";

/**
 * A saved finding that names the file month ("Sep 2026 books", "full Sep 2026
 * statement") is the snapshot stamp, not the period. A dated day ("8 Sep 2026")
 * stays. A pro-rated period label stays too: the months inside it are the
 * firm-year clip, not the file stamp. Display only — the stored finding is
 * not rewritten.
 */
/** "Sep 2026 books look healthy" becomes a singular subject. Agree the verb. */
function agreeFullYearGrammar(text: string): string {
  return text.replace(/\bFull year on file look\b/g, "Full year on file looks");
}

/**
 * Compact ranges `proratedPeriodLabel` can emit. Cross-year first, then
 * same-year `Mar–Sep 2026`, then a single month. This only finds the span.
 * `isProratedPeriodLabel` decides whether it is a pro-rata label.
 */
function proratedRangeSource(): string {
  const dash = "[\\u2010-\\u2015-]";
  const month = `(?:${SAVED_MONTH})`;
  const year = "\\d{4}";
  return `(?:${month}\\s+${year}\\s*${dash}\\s*${month}\\s+${year}|${month}\\s*${dash}\\s*${month}\\s+${year}|${month}\\s+${year})`;
}

/**
 * Hide pro-rata labels, run the month-stamp rewrite, then put them back.
 * `src/lib/firm-year-label.ts` is Eng2-owned and its `@/` import cannot sit
 * on this file's Deno graph, so the matcher is the twin
 * `isProratedPeriodLabel`, which Eng2 keeps identical.
 */
function withProratedLabelsShielded(text: string, rewrite: (masked: string) => string): string {
  const slots: string[] = [];
  const range = proratedRangeSource();
  const pattern = new RegExp(`${range}, pro-rated from your ${range} statement`, "gi");
  const masked = text.replace(pattern, (match) => {
    if (!isProratedPeriodLabel(match)) return match;
    slots.push(match);
    return `\u0000pr${slots.length - 1}\u0000`;
  });
  let out = rewrite(masked);
  for (let i = slots.length - 1; i >= 0; i--) {
    out = out.split(`\u0000pr${i}\u0000`).join(slots[i] ?? "");
  }
  return out;
}

export function rewriteSavedMonthStamp(text: string): string {
  const monthYear = `(?<!\\d\\s)(?:${SAVED_MONTH})\\s+\\d{4}`;
  return withProratedLabelsShielded(text, (body) =>
    agreeFullYearGrammar(
      body
        .replace(new RegExp(`\\bfull\\s+${monthYear}\\s+statement\\b`, "gi"), FULL_YEAR_ON_FILE)
        .replace(new RegExp(`\\b${monthYear}\\s+books\\s+on\\s+file\\b`, "gi"), FULL_YEAR_ON_FILE)
        .replace(
          new RegExp(`\\b${monthYear}\\s+(?:books|statement|snapshot)\\b`, "gi"),
          FULL_YEAR_ON_FILE,
        ),
    ),
  );
}

/**
 * Stored draft prose. A month with no day ("Sep 2026 accounts") is the file
 * stamp. A dated day ("8 Sep 2026") stays. Display only.
 */
const MONTH_SRC = MONTHS.join("|");
const DAY_SRC = String.raw`\d+(?:\.\d+)?%|\d+\s+days|\d{1,2}`;
const DASH_SRC = String.raw`[\u2010-\u2015-]`;

type CalendarSlot = { year: number; month: number; day: number };

function monthNumber(name: string): number | null {
  const head = name.slice(0, 3).toLowerCase();
  const idx = MONTHS.findIndex((month) => month.toLowerCase() === head);
  return idx >= 0 ? idx + 1 : null;
}

function tokenLeaked(token: string): boolean {
  return /%|\bdays\b/i.test(token);
}

/**
 * A day slot that a percent or day-count replacement overwrote.
 * `100%` is the spelling of a 1.0 ratio, which is what used to replace day 1.
 * A 1–31 percent is the day with a leaked % sign. `allowScaled` is only for
 * a slot that is already inside a date, not a bare "100% Sep 2026".
 */
function dayFromToken(token: string, allowScaled: boolean): number | null {
  const text = token.trim();
  const days = /^(\d+)\s+days$/i.exec(text);
  if (days) {
    const n = Number(days[1]);
    return n >= 1 && n <= 31 ? n : null;
  }
  const pct = /^(\d+(?:\.\d+)?)%$/.exec(text);
  if (pct) {
    const n = Number(pct[1]);
    if (Number.isInteger(n) && n >= 1 && n <= 31) return n;
    if (allowScaled && n === 100) return 1;
    return null;
  }
  if (!/^\d{1,2}$/.test(text)) return null;
  const n = Number(text);
  return n >= 1 && n <= 31 ? n : null;
}

function isoDay(slot: CalendarSlot): string {
  return `${slot.year}-${String(slot.month).padStart(2, "0")}-${String(slot.day).padStart(2, "0")}`;
}

function emitRange(start: CalendarSlot, end: CalendarSlot, market: DateMarket): string | null {
  const label = formatDateRange(isoDay(start), isoDay(end), market);
  return label && label !== "—" ? label : null;
}

function slot(year: string, monthName: string, dayToken: string, allowScaled: boolean): CalendarSlot | null {
  const month = monthNumber(monthName);
  const day = dayFromToken(dayToken, allowScaled);
  const y = Number(year);
  if (!month || !day || !Number.isInteger(y) || y < 1900 || y > 2200) return null;
  return { year: y, month, day };
}

/**
 * A percent that landed in a calendar day. "Jan 100% – Sep 30, 2026" was
 * "Jan 1 – Sep 30, 2026" after a 1.0 ratio was written as 100%.
 * The repaired span is `formatDateRange` in the client's market.
 * A date that was not overwritten is left as written.
 */
export function repairCalendarFigureLeaks(text: string, market: DateMarket): string {
  if (!text || !market) return text;
  const usCross = new RegExp(
    `\\b(${MONTH_SRC})\\s+(${DAY_SRC}),\\s*(\\d{4})\\s*${DASH_SRC}\\s*(${MONTH_SRC})\\s+(${DAY_SRC}),\\s*(\\d{4})\\b`,
    "gi",
  );
  const zaCross = new RegExp(
    `\\b(${DAY_SRC})\\s+(${MONTH_SRC})\\s+(\\d{4})\\s*${DASH_SRC}\\s*(${DAY_SRC})\\s+(${MONTH_SRC})\\s+(\\d{4})\\b`,
    "gi",
  );
  const usYear = new RegExp(
    `\\b(${MONTH_SRC})\\s+(${DAY_SRC})\\s*${DASH_SRC}\\s*(${MONTH_SRC})\\s+(${DAY_SRC}),\\s*(\\d{4})\\b`,
    "gi",
  );
  const zaYear = new RegExp(
    `\\b(${DAY_SRC})\\s+(${MONTH_SRC})\\s*${DASH_SRC}\\s*(${DAY_SRC})\\s+(${MONTH_SRC})\\s+(\\d{4})\\b`,
    "gi",
  );
  const usMonth = new RegExp(
    `\\b(${MONTH_SRC})\\s+(${DAY_SRC})\\s*${DASH_SRC}\\s*(${DAY_SRC}),\\s*(\\d{4})\\b`,
    "gi",
  );
  const zaMonth = new RegExp(
    `\\b(${DAY_SRC})\\s*${DASH_SRC}\\s*(${DAY_SRC})\\s+(${MONTH_SRC})\\s+(\\d{4})\\b`,
    "gi",
  );
  const usDay = new RegExp(`\\b(${MONTH_SRC})\\s+(${DAY_SRC}),\\s*(\\d{4})\\b`, "gi");
  const zaDay = new RegExp(`\\b(${DAY_SRC})\\s+(${MONTH_SRC})\\s+(\\d{4})\\b`, "gi");

  const paint = (start: CalendarSlot, end: CalendarSlot) => emitRange(start, end, market);

  let next = text.replace(usCross, (full, m1: string, d1: string, y1: string, m2: string, d2: string, y2: string) => {
    if (!tokenLeaked(d1) && !tokenLeaked(d2)) return full;
    const start = slot(y1, m1, d1, true);
    const end = slot(y2, m2, d2, true);
    if (!start || !end) return full;
    return paint(start, end) ?? full;
  });
  next = next.replace(zaCross, (full, d1: string, m1: string, y1: string, d2: string, m2: string, y2: string) => {
    if (!tokenLeaked(d1) && !tokenLeaked(d2)) return full;
    const start = slot(y1, m1, d1, true);
    const end = slot(y2, m2, d2, true);
    if (!start || !end) return full;
    return paint(start, end) ?? full;
  });
  next = next.replace(usYear, (full, m1: string, d1: string, m2: string, d2: string, year: string) => {
    if (!tokenLeaked(d1) && !tokenLeaked(d2)) return full;
    const start = slot(year, m1, d1, true);
    const end = slot(year, m2, d2, true);
    if (!start || !end) return full;
    return paint(start, end) ?? full;
  });
  next = next.replace(zaYear, (full, d1: string, m1: string, d2: string, m2: string, year: string) => {
    if (!tokenLeaked(d1) && !tokenLeaked(d2)) return full;
    const start = slot(year, m1, d1, true);
    const end = slot(year, m2, d2, true);
    if (!start || !end) return full;
    return paint(start, end) ?? full;
  });
  next = next.replace(usMonth, (full, month: string, d1: string, d2: string, year: string) => {
    if (!tokenLeaked(d1) && !tokenLeaked(d2)) return full;
    const start = slot(year, month, d1, true);
    const end = slot(year, month, d2, true);
    if (!start || !end) return full;
    return paint(start, end) ?? full;
  });
  next = next.replace(zaMonth, (full, d1: string, d2: string, month: string, year: string) => {
    if (!tokenLeaked(d1) && !tokenLeaked(d2)) return full;
    const start = slot(year, month, d1, true);
    const end = slot(year, month, d2, true);
    if (!start || !end) return full;
    return paint(start, end) ?? full;
  });
  next = next.replace(usDay, (full, month: string, day: string, year: string) => {
    if (!tokenLeaked(day)) return full;
    const one = slot(year, month, day, true);
    if (!one) return full;
    return paint(one, one) ?? full;
  });
  next = next.replace(zaDay, (full, day: string, month: string, year: string) => {
    // "30% Sep 2026" can be a real percent beside a month. Only a leaked day-count is a date.
    if (!/\bdays\b/i.test(day)) return full;
    const one = slot(year, month, day, false);
    if (!one) return full;
    return paint(one, one) ?? full;
  });
  return next;
}

const CALENDAR_SPAN_PATTERNS = [
  `\\b(?:${MONTH_SRC})\\s+(?:${DAY_SRC}),\\s*\\d{4}\\s*${DASH_SRC}\\s*(?:${MONTH_SRC})\\s+(?:${DAY_SRC}),\\s*\\d{4}\\b`,
  `\\b(?:${DAY_SRC})\\s+(?:${MONTH_SRC})\\s+\\d{4}\\s*${DASH_SRC}\\s*(?:${DAY_SRC})\\s+(?:${MONTH_SRC})\\s+\\d{4}\\b`,
  `\\b(?:${MONTH_SRC})\\s+(?:${DAY_SRC})\\s*${DASH_SRC}\\s*(?:${MONTH_SRC})\\s+(?:${DAY_SRC}),\\s*\\d{4}\\b`,
  `\\b(?:${DAY_SRC})\\s+(?:${MONTH_SRC})\\s*${DASH_SRC}\\s*(?:${DAY_SRC})\\s+(?:${MONTH_SRC})\\s+\\d{4}\\b`,
  `\\b(?:${MONTH_SRC})\\s+(?:${DAY_SRC})\\s*${DASH_SRC}\\s*(?:${DAY_SRC}),\\s*\\d{4}\\b`,
  `\\b(?:${DAY_SRC})\\s*${DASH_SRC}\\s*(?:${DAY_SRC})\\s+(?:${MONTH_SRC})\\s+\\d{4}\\b`,
  `\\b(?:${MONTH_SRC})\\s+(?:${DAY_SRC}),\\s*\\d{4}\\b`,
  `\\b(?:${DAY_SRC})\\s+(?:${MONTH_SRC})\\s+\\d{4}\\b`,
];

/** True when this number sits inside a calendar date, including a leaked percent. */
export function offsetInsideCalendarSpan(text: string, offset: number, length: number): boolean {
  if (!text || length <= 0 || offset < 0) return false;
  const end = offset + length;
  for (const source of CALENDAR_SPAN_PATTERNS) {
    const pattern = new RegExp(source, "gi");
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      const spanEnd = match.index + match[0].length;
      if (offset >= match.index && end <= spanEnd) return true;
      if (match[0].length === 0) break;
    }
  }
  return false;
}

export function rewriteDraftMonthStamp(text: string): string {
  const monthYear = `(?<!\\d\\s)(?:${SAVED_MONTH})\\s+\\d{4}`;
  return withProratedLabelsShielded(text, (body) =>
    agreeFullYearGrammar(
      rewriteSavedMonthStamp(body).replace(new RegExp(monthYear, "gi"), FULL_YEAR_ON_FILE),
    ),
  );
}

function snapshotIsMonthStamp(label: string): boolean {
  return /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{4}$/i.test(label.trim());
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
  fyStartMonth: number | null | undefined,
  market: { locale?: string | null },
): string | null {
  const meta = readStatementMeta(fields, market);
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
  return formatIsoDateUTC(meta.periodEnd, market);
}

/** True when the blob came from a dated Xero or QuickBooks sync. */
export function preferStatementPeriod(fields: object | null | undefined): boolean {
  return isDatedLedgerSource(statementSourceOf(fields));
}

/** Year companion for the waterfall. Null until a dated Xero or QuickBooks sync stored a different range. */
export function statementYearLine(
  fields: object | null | undefined,
  market: DateMarket,
): {
  basis: YearBasis | null;
  periodLabel: string;
  revenue: number;
} | null {
  const meta = readStatementMeta(fields, market);
  if (
    !isDatedLedgerSource(meta.statementSource) ||
    meta.ytdRevenue == null ||
    !meta.ytdPeriodLabel
  ) {
    return null;
  }
  return { basis: meta.ytdBasis, periodLabel: meta.ytdPeriodLabel, revenue: meta.ytdRevenue };
}
