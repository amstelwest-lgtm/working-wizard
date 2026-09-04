/**
 * Honest industry-band display + sales-per-employee health targets.
 *
 * `industry_benchmarks` has no country column. Money-denominated rows are a
 * ZA seed — never label them as US industry medians. Days and percentages
 * may still show for US, captioned as global SME bands.
 *
 * Sales-per-employee uses a market-specific healthy target. The US figure is
 * an SMB rule of thumb, not a PPP conversion of the ZA heuristic.
 */

import { formatMoneyCompact } from "./format";
import { ZA_MARKET } from "./resolve";
import type { ResolvedMarket } from "./types";

export type BenchmarkMarket = Pick<ResolvedMarket, "country" | "copyPack" | "currency" | "locale">;

export const SALES_PER_EMPLOYEE_HEALTHY = {
  ZA: 300_000,
  US: 150_000,
} as const;

/** Money-denominated `industry_benchmarks.metric_key` values in the ZA seed. */
export const MONEY_BENCHMARK_METRIC_KEYS = new Set(["salesPerEmployee"]);

export function isUsBenchmarkMarket(
  market?: Pick<ResolvedMarket, "country" | "copyPack"> | null,
): boolean {
  return market?.country === "US" || market?.copyPack === "us";
}

export function salesPerEmployeeHealthy(
  market?: Pick<ResolvedMarket, "country" | "copyPack"> | null,
): number {
  return isUsBenchmarkMarket(market)
    ? SALES_PER_EMPLOYEE_HEALTHY.US
    : SALES_PER_EMPLOYEE_HEALTHY.ZA;
}

export function scoreSalesPerEmployee(
  val: number,
  market?: Pick<ResolvedMarket, "country" | "copyPack"> | null,
): number {
  if (!Number.isFinite(val)) return Number.NaN;
  const target = salesPerEmployeeHealthy(market);
  return Math.min(100, Math.max(0, (val / target) * 100));
}

export function salesPerEmployeeBenchmarkLabel(market: BenchmarkMarket = ZA_MARKET): string {
  return `≥ ${formatMoneyCompact(salesPerEmployeeHealthy(market), market)}`;
}

export function isMoneyDenominatedBenchmark(opts: {
  metricKey?: string | null;
  unit?: string | null;
  format?: string | null;
}): boolean {
  if (opts.format === "money") return true;
  const unit = (opts.unit ?? "").toLowerCase();
  if (unit === "money" || unit === "currency" || unit === "zar" || unit === "usd") return true;
  if (opts.metricKey && MONEY_BENCHMARK_METRIC_KEYS.has(opts.metricKey)) return true;
  return false;
}

/** ZA: show the full table. US: days / % / × only — hide money rows. */
export function canShowIndustryMedian(
  market: Pick<ResolvedMarket, "country" | "copyPack"> | null | undefined,
  opts: { metricKey?: string | null; unit?: string | null; format?: string | null } = {},
): boolean {
  if (!isUsBenchmarkMarket(market)) return true;
  return !isMoneyDenominatedBenchmark(opts);
}

export function industryBenchmarkCaption(
  market: Pick<ResolvedMarket, "country" | "copyPack"> | null | undefined,
): string {
  if (isUsBenchmarkMarket(market)) {
    return "Global SME bands for days and percentages — not US industry medians. Money-denominated South African figures are hidden until we have US numbers.";
  }
  return "South African industry median";
}

export function industryBenchmarkShortLabel(
  market: Pick<ResolvedMarket, "country" | "copyPack"> | null | undefined,
): string {
  return isUsBenchmarkMarket(market) ? "vs global SME band" : "vs industry";
}
