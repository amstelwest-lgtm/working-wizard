import {
  calendarDayLabel,
  dateOrder,
  dateTimeLabel,
  formatMonthRange,
  monthColumnLabel,
  weekHeaderLabel,
  type DateOrder,
} from "./date-presets.ts";
import type { ResolvedMarket } from "./types.ts";
import { ZA_MARKET } from "./resolve.ts";

export { formatMonthRange };

export type MoneyMarket = Pick<ResolvedMarket, "currency" | "locale">;

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
  market: { locale?: string | null } = ZA_MARKET,
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

/** Week axis. ZA "19 Oct". US "Oct 19". The day is not padded. */
export function formatWeekHeader(
  iso: string,
  market: { locale?: string | null } = ZA_MARKET,
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
  return weekHeaderLabel(parts.month, parts.day, orderOf(market)) ?? "—";
}

export function formatDate(
  d: Date | string | number,
  market: { locale?: string | null; timezone?: string } = ZA_MARKET,
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
  market: { locale?: string | null; timezone?: string } = ZA_MARKET,
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

/** Letter abbreviations (SAST, EDT) stay. Offset-only short names become UTC+2. */
function zoneLabel(name: string, date: Date, timeZone: string): string {
  const trimmed = name.trim();
  const offset = offsetLabel(trimmed);
  if (offset) return offset;
  if (/^[A-Z]{2,5}$/.test(trimmed)) return trimmed;
  return offsetFromZone(date, timeZone);
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
 * ZA: "2 Nov 2026, 09:54 SAST". US: "Nov 2, 2026, 9:54 AM EDT".
 * A GMT offset short name is still written as UTC+N.
 */
export function formatSignedOffDateTime(
  d: Date | string | number,
  market: { locale?: string | null; timezone?: string } = ZA_MARKET,
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
  market: { locale?: string | null; timezone?: string } = ZA_MARKET,
  opts?: { firmTimeZone?: string | null },
): string {
  return formatSignedOffDateTime(d, market, { firmTimeZone: opts?.firmTimeZone });
}

export function formatPercentRate(rate: number, digits = 2): string {
  if (!Number.isFinite(rate)) return "—";
  return `${(rate * 100).toFixed(digits)}%`;
}

/** Month column. Both markets: "Oct 26". */
export function formatMonthLabel(
  ym: string,
  _market: { locale?: string | null } = ZA_MARKET,
): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return monthColumnLabel(y, m) ?? ym;
}
