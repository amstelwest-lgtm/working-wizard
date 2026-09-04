import type { ResolvedMarket } from "./types";
import { ZA_MARKET } from "./resolve";

export function formatMoney(
  n: number,
  market: Pick<ResolvedMarket, "currency" | "locale"> = ZA_MARKET,
  opts?: { maximumFractionDigits?: number; minimumFractionDigits?: number },
): string {
  if (!Number.isFinite(n)) return "—";
  const maximumFractionDigits = opts?.maximumFractionDigits ?? 0;
  const minimumFractionDigits = opts?.minimumFractionDigits ?? 0;
  const abs = Math.abs(n);
  const body = abs.toLocaleString(market.locale, {
    maximumFractionDigits,
    minimumFractionDigits,
  });
  const sign = n < 0 ? "-" : "";
  if (market.currency === "USD") {
    return `${sign}$${body}`;
  }
  return `${sign}R\u00a0${body}`;
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
