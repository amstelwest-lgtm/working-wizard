import type { ResolvedMarket } from "./types.ts";
import { ZA_MARKET } from "./resolve.ts";

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

/**
 * Format a calendar day (YYYY-MM-DD) without the firm timezone.
 * `formatDate` applies `market.timezone` to a local or UTC midnight Date,
 * which prints the previous day in the Americas (Oct 5 → Oct 4).
 */
export function formatCalendarDay(
  iso: string,
  market: Pick<ResolvedMarket, "locale"> = ZA_MARKET,
  opts?: Intl.DateTimeFormatOptions,
): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return "—";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  return date.toLocaleDateString(market.locale, {
    timeZone: "UTC",
    ...opts,
  });
}

export function formatDate(
  d: Date | string | number,
  market: Pick<ResolvedMarket, "locale" | "timezone"> = ZA_MARKET,
  opts?: Intl.DateTimeFormatOptions,
): string {
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(market.locale, {
    timeZone: opts?.timeZone ?? market.timezone,
    ...opts,
  });
}

export function formatDateTime(
  d: Date | string | number,
  market: Pick<ResolvedMarket, "locale" | "timezone"> = ZA_MARKET,
  opts?: Intl.DateTimeFormatOptions,
): string {
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(market.locale, {
    timeZone: opts?.timeZone ?? market.timezone,
    ...opts,
  });
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

/**
 * Sign-off time for every PDF footer. Always in the firm zone when one is
 * stored, otherwise the market zone, and always with a zone label. Never the
 * server's local zone and never an unlabeled clock.
 */
export function formatSignedOffDateTime(
  d: Date | string | number,
  market: Pick<ResolvedMarket, "locale" | "timezone"> = ZA_MARKET,
  opts?: Intl.DateTimeFormatOptions & { firmTimeZone?: string | null },
): string {
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  const { firmTimeZone, ...rest } = opts ?? {};
  const timeZone = signedOffTimeZone(firmTimeZone, rest.timeZone ?? market.timezone);
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat(market.locale, {
      ...rest,
      timeZone,
      timeZoneName: "short",
    }).formatToParts(date);
  } catch {
    parts = new Intl.DateTimeFormat(market.locale, {
      ...rest,
      timeZone: "UTC",
      timeZoneName: "short",
    }).formatToParts(date);
  }
  const activeZone = parts.some((part) => part.type === "timeZoneName") ? timeZone : "UTC";
  const rendered = parts
    .map((part) =>
      part.type === "timeZoneName" ? zoneLabel(part.value, date, activeZone) : part.value,
    )
    .join("");
  if (/\b(?:UTC(?:[+-]\d{1,2}(?::\d{2})?)?|[A-Z]{2,5})\b/.test(rendered)) return rendered;
  return `${rendered} ${offsetFromZone(date, timeZone)}`;
}

/**
 * One clock for the in-app sign-off line, the review trail, and PDF footers.
 * Short month, numeric day and year, numeric hour (no leading zero), 2-digit
 * minute, no seconds, and a short zone — the same fields as `formatDateTime`
 * with `timeZoneName: "short"`. The zone label still comes from
 * `formatSignedOffDateTime`, so a GMT offset is written as UTC+N.
 */
export const REVIEW_CLOCK: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
};

export function formatReviewDateTime(
  d: Date | string | number,
  market: Pick<ResolvedMarket, "locale" | "timezone"> = ZA_MARKET,
  opts?: { firmTimeZone?: string | null },
): string {
  return formatSignedOffDateTime(d, market, {
    ...REVIEW_CLOCK,
    firmTimeZone: opts?.firmTimeZone,
  })
    .replace(/\u202f/g, " ")
    .replace(/\u00a0/g, " ");
}

export function formatPercentRate(rate: number, digits = 2): string {
  if (!Number.isFinite(rate)) return "—";
  return `${(rate * 100).toFixed(digits)}%`;
}

export function formatMonthLabel(
  ym: string,
  market: Pick<ResolvedMarket, "locale"> = ZA_MARKET,
): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(market.locale, {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
}
