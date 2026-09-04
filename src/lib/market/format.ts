import type { ResolvedMarket } from "./types";
import { ZA_MARKET } from "./resolve";

export type MoneyMarket = Pick<ResolvedMarket, "currency" | "locale">;

export function currencySymbol(market: Pick<ResolvedMarket, "currency"> = ZA_MARKET): string {
  return market.currency === "USD" ? "$" : "R";
}

/** Compact unit for prose: R1 / $1, R100 / $100. */
export function formatMoneyUnit(
  n: number,
  market: Pick<ResolvedMarket, "currency"> = ZA_MARKET,
): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const body = String(Math.abs(n));
  return `${sign}${currencySymbol(market)}${body}`;
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
  const gap = market.currency === "USD" ? "" : "\u00a0";
  if (abs >= 1_000_000) {
    const digits = abs >= 10_000_000 ? 0 : 1;
    return `${sign}${sym}${gap}${(abs / 1_000_000).toFixed(digits)}m`;
  }
  if (abs >= 1_000) {
    const digits = abs >= 100_000 ? 0 : 1;
    return `${sign}${sym}${gap}${(abs / 1_000).toFixed(digits)}k`;
  }
  return `${sign}${sym}${gap}${Math.round(abs).toLocaleString(market.locale)}`;
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
