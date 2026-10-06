import type { ResolvedMarket } from "./types";
import { ZA_MARKET } from "./resolve";

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
