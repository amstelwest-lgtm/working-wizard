import {
  calendarDayLabel,
  clockLabel,
  dateOrder,
  dateTimeLabel,
  formatMonthRange,
  MONTHS,
  monthColumnLabel,
  monthYearLabel,
  weekHeaderLabel,
  type DateOrder,
} from "./date-presets.ts";
import type { ResolvedMarket } from "./types.ts";
import { ZA_MARKET } from "./resolve.ts";

export { formatMonthRange };

export type MoneyMarket = Pick<ResolvedMarket, "currency" | "locale">;

/** Locale and zone for a printed date. Callers pass the client or the firm. */
export type DateMarket = { locale?: string | null; timezone?: string };

export function currencySymbol(market: Pick<ResolvedMarket, "currency"> = ZA_MARKET): string {
  return market.currency === "USD" ? "$" : "R";
}

/** Compact unit for prose: R1 / $1, R100 / $100. */
/** A regular space. A no-break space collapses to "R0" in PDF text extraction. */
const ZAR_GAP = " ";

function groupedDigits(body: string): string {
  return body.replace(/[\u00a0\u202f]/g, " ");
}

export function formatMoneyUnit(
  n: number,
  market: Pick<ResolvedMarket, "currency"> = ZA_MARKET,
): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const body = String(Math.abs(n));
  const gap = market.currency === "USD" ? "" : ZAR_GAP;
  return `${sign}${currencySymbol(market)}${gap}${body}`;
}

export function formatMoney(
  n: number,
  market: MoneyMarket = ZA_MARKET,
  opts?: { maximumFractionDigits?: number; minimumFractionDigits?: number },
): string {
  if (!Number.isFinite(n)) return "—";
  const maximumFractionDigits = opts?.maximumFractionDigits ?? 0;
  const minimumFractionDigits = opts?.minimumFractionDigits ?? 0;
  const abs = Math.abs(n);
  const body = groupedDigits(
    abs.toLocaleString(market.locale, {
      maximumFractionDigits,
      minimumFractionDigits,
    }),
  );
  const sign = n < 0 ? "-" : "";
  if (market.currency === "USD") {
    return `${sign}$${body}`;
  }
  return `${sign}R${ZAR_GAP}${body}`;
}

export function formatNumber(
  n: number,
  market: Pick<ResolvedMarket, "locale"> = ZA_MARKET,
  opts?: { maximumFractionDigits?: number; minimumFractionDigits?: number },
): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(market.locale, {
    maximumFractionDigits: opts?.maximumFractionDigits ?? 0,
    minimumFractionDigits: opts?.minimumFractionDigits ?? 0,
  });
}

export function formatMoneyCompact(n: number, market: MoneyMarket = ZA_MARKET): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  const sym = currencySymbol(market);
  const gap = market.currency === "USD" ? "" : ZAR_GAP;
  if (abs >= 1_000_000) {
    const digits = abs >= 10_000_000 ? 0 : 1;
    return `${sign}${sym}${gap}${(abs / 1_000_000).toFixed(digits)}m`;
  }
  if (abs >= 1_000) {
    const digits = abs >= 100_000 ? 0 : 1;
    return `${sign}${sym}${gap}${(abs / 1_000).toFixed(digits)}k`;
  }
  return `${sign}${sym}${gap}${groupedDigits(Math.round(abs).toLocaleString(market.locale))}`;
}

/**
 * Chart axis tick. Compact, and with no breakable space, so "R" and "30.0k"
 * stay on one line. Recharts wraps tick text on ordinary spaces.
 */
export function formatMoneyChartTick(n: number, market: MoneyMarket = ZA_MARKET): string {
  return formatMoneyCompact(n, market).replace(/ /g, "");
}

type ClockParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  zoneName: string;
};

/** Numeric parts only. Month names stay on the fixed table in date-presets.ts. */
function readClock(date: Date, timeZone: string): ClockParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  let hour = Number(read("hour"));
  if (hour === 24) hour = 0;
  return {
    year: Number(read("year")),
    month: Number(read("month")),
    day: Number(read("day")),
    hour,
    minute: Number(read("minute")),
    zoneName: read("timeZoneName"),
  };
}

function orderOf(market: { locale?: string | null }): DateOrder {
  return dateOrder(market.locale);
}

/**
 * Format a calendar day (YYYY-MM-DD) without the firm timezone.
 * `formatDate` applies `market.timezone` to an instant, which can print the
 * previous day in the Americas. Noon UTC keeps the written calendar day.
 */
export function formatCalendarDay(
  iso: string,
  market: DateMarket,
  _opts?: Intl.DateTimeFormatOptions,
): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return "—";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  let parts: ClockParts;
  try {
    parts = readClock(date, "UTC");
  } catch {
    return "—";
  }
  return calendarDayLabel(parts.year, parts.month, parts.day, orderOf(market)) ?? "—";
}

type CalendarYmd = { year: number; month: number; day: number };

const RANGE_DASH = "\u2013";

function calendarYmd(year: number, month: number, day: number): CalendarYmd | null {
  if (!calendarDayLabel(year, month, day, "za")) return null;
  return { year, month, day };
}

/** A YYYY-MM-DD prefix is that calendar day. Anything else is an instant in the market zone. */
function readCalendarYmd(value: Date | string | number, market: DateMarket): CalendarYmd | null {
  if (typeof value === "string") {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
    if (match) return calendarYmd(Number(match[1]), Number(match[2]), Number(match[3]));
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  try {
    const parts = readClock(date, market.timezone ?? "UTC");
    return calendarYmd(parts.year, parts.month, parts.day);
  } catch {
    return null;
  }
}

/**
 * Inclusive calendar span. Market is required.
 * Same month collapses the month: US "Sep 1–21, 2026", ZA "1–21 Sep 2026".
 * Same year collapses the year: US "Apr 1 – Sep 21, 2026", ZA "1 Apr – 21 Sep 2026".
 * Cross year keeps both dates: US "Oct 1, 2025 – Sep 30, 2026", ZA "1 Oct 2025 – 30 Sep 2026".
 * A YYYY-MM-DD string is the written day, not a timezone-shifted instant.
 */
export function formatDateRange(
  start: Date | string | number,
  end: Date | string | number,
  market: DateMarket,
): string {
  const from = readCalendarYmd(start, market);
  const to = readCalendarYmd(end, market);
  if (!from || !to) return "—";
  const order = orderOf(market);
  if (from.year === to.year && from.month === to.month && from.day === to.day) {
    return calendarDayLabel(from.year, from.month, from.day, order) ?? "—";
  }
  const monthName = (month: number) => MONTHS[month - 1] ?? "";
  if (from.year === to.year && from.month === to.month) {
    return order === "us"
      ? `${monthName(from.month)} ${from.day}${RANGE_DASH}${to.day}, ${from.year}`
      : `${from.day}${RANGE_DASH}${to.day} ${monthName(from.month)} ${from.year}`;
  }
  if (from.year === to.year) {
    return order === "us"
      ? `${monthName(from.month)} ${from.day} ${RANGE_DASH} ${monthName(to.month)} ${to.day}, ${from.year}`
      : `${from.day} ${monthName(from.month)} ${RANGE_DASH} ${to.day} ${monthName(to.month)} ${from.year}`;
  }
  const left = calendarDayLabel(from.year, from.month, from.day, order);
  const right = calendarDayLabel(to.year, to.month, to.day, order);
  if (!left || !right) return "—";
  return `${left} ${RANGE_DASH} ${right}`;
}

/** Week axis. ZA "19 Oct". US "Oct 19". The day is not padded. */
export function formatWeekHeader(iso: string, market: DateMarket): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return "—";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  let parts: ClockParts;
  try {
    parts = readClock(date, "UTC");
  } catch {
    return "—";
  }
  return weekHeaderLabel(parts.month, parts.day, orderOf(market)) ?? "—";
}

export function formatDate(
  d: Date | string | number,
  market: DateMarket,
  opts?: Intl.DateTimeFormatOptions,
): string {
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  const timeZone = opts?.timeZone ?? market.timezone ?? "UTC";
  let parts: ClockParts;
  try {
    parts = readClock(date, timeZone);
  } catch {
    return "—";
  }
  return calendarDayLabel(parts.year, parts.month, parts.day, orderOf(market)) ?? "—";
}

export function formatDateTime(
  d: Date | string | number,
  market: DateMarket,
  opts?: Intl.DateTimeFormatOptions,
): string {
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  const timeZone = opts?.timeZone ?? market.timezone ?? "UTC";
  return renderDateTime(date, timeZone, market);
}

/** A stored IANA zone, or null when the string is blank or not a real zone. */
export function usableTimeZone(zone: string | null | undefined): string | null {
  const trimmed = zone?.trim() ?? "";
  if (!trimmed) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed }).format(0);
    return trimmed;
  } catch {
    return null;
  }
}

/** Firm zone when the practice stored one, otherwise the market or signer zone. */
export function signedOffTimeZone(
  firmTimeZone: string | null | undefined,
  marketTimeZone: string | null | undefined,
): string {
  return usableTimeZone(firmTimeZone) ?? usableTimeZone(marketTimeZone) ?? "UTC";
}

function offsetLabel(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === "GMT" || trimmed === "UTC") return "UTC";
  const match = /^(?:GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?$/i.exec(trimmed);
  if (!match) return null;
  const hours = String(Number(match[2]));
  const minutes = match[3];
  if (minutes && minutes !== "00") return `UTC${match[1]}${hours}:${minutes}`;
  return `UTC${match[1]}${hours}`;
}

function offsetFromZone(date: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      timeZoneName: "shortOffset",
    }).formatToParts(date);
    const raw = parts.find((part) => part.type === "timeZoneName")?.value ?? "";
    return offsetLabel(raw) ?? "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Printed zone. ICU short names drift (UTC+2, EST, EDT), so mapped zones
 * always use the same letters. Anything else is a UTC offset.
 */
const ZONE_ABBR: Record<string, string> = {
  "Africa/Johannesburg": "SAST",
  "America/New_York": "ET",
  "America/Detroit": "ET",
  "America/Indiana/Indianapolis": "ET",
  "America/Chicago": "CT",
  "America/Denver": "MT",
  "America/Boise": "MT",
  "America/Phoenix": "MT",
  "America/Los_Angeles": "PT",
  "America/Anchorage": "AKT",
  "Pacific/Honolulu": "HT",
};

function zoneLabel(name: string, date: Date, timeZone: string): string {
  const mapped = ZONE_ABBR[timeZone];
  if (mapped) return mapped;
  const offset = offsetLabel(name.trim());
  if (offset) return offset;
  return offsetFromZone(date, timeZone);
}

/** Short zone letters. Mapped zones are SAST, ET, CT, MT, PT, AKT, and HT. Others are UTC+N. */
export function formatZoneLabel(date: Date, timeZone: string): string {
  try {
    const parts = readClock(date, timeZone);
    return parts.zoneName ? zoneLabel(parts.zoneName, date, timeZone) : offsetFromZone(date, timeZone);
  } catch {
    return "UTC";
  }
}

function renderDateTime(
  date: Date,
  timeZone: string,
  market: { locale?: string | null },
): string {
  let parts: ClockParts;
  let activeZone = timeZone;
  try {
    parts = readClock(date, timeZone);
  } catch {
    activeZone = "UTC";
    parts = readClock(date, "UTC");
  }
  const zone = parts.zoneName
    ? zoneLabel(parts.zoneName, date, activeZone)
    : offsetFromZone(date, activeZone);
  const rendered =
    dateTimeLabel(parts.year, parts.month, parts.day, parts.hour, parts.minute, zone, orderOf(market)) ??
    "—";
  if (/\b(?:UTC(?:[+-]\d{1,2}(?::\d{2})?)?|[A-Z]{2,5})\b/.test(rendered)) return rendered;
  return `${rendered} ${offsetFromZone(date, activeZone)}`;
}

/**
 * Sign-off time for every PDF footer. Always in the firm zone when one is
 * stored, otherwise the market zone, and always with a zone label. Never the
 * server's local zone and never an unlabeled clock.
 * ZA: "2 Nov 2026, 09:54 SAST". US: "Nov 2, 2026, 9:54 AM ET".
 * A GMT offset short name is still written as UTC+N.
 */
export function formatSignedOffDateTime(
  d: Date | string | number,
  market: DateMarket,
  opts?: Intl.DateTimeFormatOptions & { firmTimeZone?: string | null },
): string {
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  const timeZone = signedOffTimeZone(opts?.firmTimeZone, opts?.timeZone ?? market.timezone ?? "UTC");
  return renderDateTime(date, timeZone, market).replace(/\u202f/g, " ").replace(/\u00a0/g, " ");
}

/**
 * One clock for the in-app sign-off line, the review trail, and PDF footers.
 * Same preset as `formatSignedOffDateTime`: calendar day, 24-hour ZA clock
 * or 12-hour US clock, and a short zone. A GMT offset is written as UTC+N.
 */
export function formatReviewDateTime(
  d: Date | string | number,
  market: DateMarket,
  opts?: { firmTimeZone?: string | null },
): string {
  return formatSignedOffDateTime(d, market, { firmTimeZone: opts?.firmTimeZone });
}

export function formatPercentRate(rate: number, digits = 2): string {
  if (!Number.isFinite(rate)) return "—";
  return `${(rate * 100).toFixed(digits)}%`;
}

function runtimeZone(): string {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Month and year. Both markets: "Oct 2026". Omitting the zone uses the runtime zone. */
export function formatMonthYear(
  d: Date | string | number = new Date(),
  timeZone?: string,
): string {
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  try {
    const parts = readClock(date, timeZone || runtimeZone());
    return monthYearLabel(parts.year, parts.month) ?? "—";
  } catch {
    return "—";
  }
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** Month and day only. ZA "8 Sep". US "Sep 8". */
export function formatMonthDay(
  d: Date | string | number,
  market: DateMarket,
  opts?: { timeZone?: string },
): string {
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  const timeZone = opts?.timeZone ?? market.timezone ?? "UTC";
  try {
    const parts = readClock(date, timeZone);
    return weekHeaderLabel(parts.month, parts.day, orderOf(market)) ?? "—";
  } catch {
    return "—";
  }
}

/** Weekday plus the calendar day. ZA "Monday, 8 Sep 2026". US "Monday, Sep 8, 2026". */
export function formatNamedDay(
  d: Date | string | number,
  market: DateMarket,
  opts?: { timeZone?: string },
): string {
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  const timeZone = opts?.timeZone ?? market.timezone ?? "UTC";
  try {
    const parts = readClock(date, timeZone);
    const calendar = calendarDayLabel(parts.year, parts.month, parts.day, orderOf(market));
    if (!calendar) return "—";
    const weekday = WEEKDAYS[new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()];
    return weekday ? `${weekday}, ${calendar}` : calendar;
  } catch {
    return "—";
  }
}

/** ICU zone name. Slot leads keep the long name; printed dates use the mapped letters. */
export function icuZoneName(
  date: Date,
  timeZone: string,
  style: "short" | "longGeneric",
): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: style,
    }).formatToParts(date);
    return parts.find((part) => part.type === "timeZoneName")?.value?.trim() ?? "";
  } catch {
    return "";
  }
}

/** ZA "09:54". US "9:54 AM". The clock is in the market zone. Slot buttons only. */
export function formatClock(d: Date | string | number, market: DateMarket): string | null {
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return null;
  try {
    const parts = readClock(date, market.timezone ?? "UTC");
    return clockLabel(parts.hour, parts.minute, orderOf(market));
  } catch {
    return null;
  }
}

function sameCalendarDay(left: ClockParts, right: ClockParts): boolean {
  return left.year === right.year && left.month === right.month && left.day === right.day;
}

/**
 * Event line. Same calendar day in the market zone is the clock and zone
 * only: ZA "07:37 SAST", US "1:37 AM ET". Any other day is the full
 * date-time preset: "20 Oct 2026, 07:37 SAST" / "Oct 20, 2026, 1:37 AM ET".
 */
export function formatEventTime(
  at: Date | string | number,
  market: DateMarket,
  now: Date | string | number = new Date(),
): string | null {
  const date = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(date.getTime())) return null;
  const nowDate = now instanceof Date ? now : new Date(now);
  const timeZone = market.timezone ?? "UTC";
  let parts: ClockParts;
  let nowParts: ClockParts;
  try {
    parts = readClock(date, timeZone);
    nowParts = readClock(Number.isNaN(nowDate.getTime()) ? new Date() : nowDate, timeZone);
  } catch {
    return null;
  }
  const clock = clockLabel(parts.hour, parts.minute, orderOf(market));
  if (!clock) return null;
  const zone = parts.zoneName
    ? zoneLabel(parts.zoneName, date, timeZone)
    : offsetFromZone(date, timeZone);
  if (sameCalendarDay(parts, nowParts)) return `${clock} ${zone}`;
  return dateTimeLabel(
    parts.year,
    parts.month,
    parts.day,
    parts.hour,
    parts.minute,
    zone,
    orderOf(market),
  );
}

/** Month column. Both markets: "Oct 26". */
export function formatMonthLabel(ym: string, _market: DateMarket): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return monthColumnLabel(y, m) ?? ym;
}
