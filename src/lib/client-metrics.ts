/**
 * Shared client metrics for Overview, Health, the Bot brief, and Cash Forecast.
 *
 * Cash, runway, and the forecast floor live here so those surfaces cannot
 * drift. Runway is weeks of cash at the current burn — never "weeks until a
 * fixed R50,000 line". Zero weeks means cash is already gone.
 */

import { CASH_RUNWAY_THRESHOLD_RAND } from "./cash-runway.ts";
import { periodMonthsOf } from "./ratios.ts";

export type CashSource = "bank" | "period" | "none";

export type ResolvedCash = {
  amount: number | null;
  source: CashSource;
};

export type ResolveCashInput = {
  /** Opening balance from a published bank statement (`seededFromBanksAt` set). */
  publishedBankBalance?: number | null;
  bankPublishedAt?: string | number | null;
  /** Trial-balance / period cash stored on financials.cash. */
  periodCash?: number | null;
  periodUpdatedAt?: string | number | null;
};

export type RunwayKind = "unknown" | "zero" | "cash_generative" | "weeks";

export type ClientRunway = {
  /** Null when unknown or cash-generative. Do not score those as 0 weeks. */
  weeks: number | null;
  kind: RunwayKind;
  label: string;
};

const WEEKS_PER_MONTH = 52 / 12;

function finiteNum(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = parseFloat(raw.replace(/[,\s]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function timeMs(raw: string | number | null | undefined): number | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const t = Date.parse(String(raw));
  return Number.isFinite(t) ? t : null;
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

function clampScore(n: number): number {
  return Math.min(100, Math.max(0, n));
}

/**
 * Best cash figure.
 * 1. Latest published bank balance, when it is newer than the period figures,
 *    or when the period has no cash line.
 * 2. Trial-balance / period cash (`financials.cash`) when it is newer, or when
 *    the two timestamps cannot be compared.
 * 3. A published bank balance only when the period cash line is missing.
 *
 * A forecast opening without `seededFromBanksAt` is not a bank publish — pass
 * it as neither input. That keeps a stale forecast from overriding Overview.
 */
export function resolveClientCash(input: ResolveCashInput): ResolvedCash {
  const bank = finiteNum(input.publishedBankBalance);
  const period = finiteNum(input.periodCash);
  const bankAt = timeMs(input.bankPublishedAt);
  const periodAt = timeMs(input.periodUpdatedAt);

  if (bank == null && period == null) return { amount: null, source: "none" };
  if (bank != null && period == null) return { amount: bank, source: "bank" };
  if (bank == null && period != null) return { amount: period, source: "period" };

  if (bankAt != null && periodAt != null && bankAt >= periodAt) {
    return { amount: bank, source: "bank" };
  }
  return { amount: period, source: "period" };
}

/** Operating outflows for one period: COGS plus overheads, without double-counting labour inside fixed costs. */
export function periodOperatingOutflows(
  financials: Record<string, unknown> | null | undefined,
): number | null {
  const fin = asRecord(financials);
  if (!fin) return null;
  const cogs = finiteNum(fin.cogs);
  const fixed = finiteNum(fin.fixedCosts);
  const labor = finiteNum(fin.laborCost);
  if (cogs == null && fixed == null && labor == null) return null;
  const fixedN = fixed ?? 0;
  const laborN = labor ?? 0;
  const opex = laborN > 0 && fixedN >= laborN ? fixedN : fixedN + laborN;
  const total = (cogs ?? 0) + opex;
  return total > 0 ? total : null;
}

function weeksInPeriod(periodMonths: number | null | undefined): number {
  const months =
    periodMonths != null && periodMonths >= 1 && periodMonths <= 12 ? periodMonths : 12;
  return months * WEEKS_PER_MONTH;
}

function cashGenerative(): ClientRunway {
  return { weeks: null, kind: "cash_generative", label: "Cash generative" };
}

function weeksFromBurn(cash: number, weeklyBurn: number): ClientRunway {
  if (!(weeklyBurn > 0)) return cashGenerative();
  const weeks = Math.max(1, Math.round(cash / weeklyBurn));
  return {
    weeks,
    kind: "weeks",
    label: `${weeks} ${weeks === 1 ? "week" : "weeks"}`,
  };
}

/**
 * Runway from cash and burn.
 * - No cash figure → unknown.
 * - Cash ≤ 0 → 0 weeks.
 * - Cash not falling (prior period) or a single period that is not loss-making
 *   → "Cash generative". Never 0.
 * - Burning → cash ÷ weekly burn. One period uses that period's expenses.
 */
export function clientRunway(input: {
  cash: number | null | undefined;
  priorCash?: number | null;
  netIncome?: number | null;
  periodExpenses?: number | null;
  periodMonths?: number | null;
}): ClientRunway {
  const cash = finiteNum(input.cash);
  if (cash == null) return { weeks: null, kind: "unknown", label: "—" };
  if (cash <= 0) return { weeks: 0, kind: "zero", label: "0 weeks" };

  const span = weeksInPeriod(input.periodMonths);
  const prior = finiteNum(input.priorCash);
  if (prior != null) {
    const decrease = prior - cash;
    if (decrease <= 0) return cashGenerative();
    return weeksFromBurn(cash, decrease / span);
  }

  const net = finiteNum(input.netIncome);
  if (net == null || net >= 0) return cashGenerative();
  const expenses = finiteNum(input.periodExpenses);
  const burn = expenses != null && expenses > 0 ? expenses : Math.abs(net);
  return weeksFromBurn(cash, burn / span);
}

/** Column value. Cash-generative and unknown clear a stale 0 rather than storing it. */
export function persistedRunwayWeeks(runway: ClientRunway): number | null {
  return runway.kind === "weeks" || runway.kind === "zero" ? runway.weeks : null;
}

/**
 * Overview / Health / Bot / Forecast cash and runway from the blobs already
 * stored on the client. One call, same answer everywhere.
 */
export function assessClientMetrics(input: {
  financials?: Record<string, unknown> | null;
  cashflow?: unknown;
  financialsUpdatedAt?: string | null;
  priorFinancials?: Record<string, unknown> | null;
}): { cash: ResolvedCash; runway: ClientRunway } {
  const fin = asRecord(input.financials);
  const cf = asRecord(input.cashflow);
  const prior = asRecord(input.priorFinancials);
  const seededAt = typeof cf?.seededFromBanksAt === "string" ? cf.seededFromBanksAt : null;
  const cash = resolveClientCash({
    publishedBankBalance: seededAt ? finiteNum(cf?.openingBalance) : null,
    bankPublishedAt: seededAt,
    periodCash: finiteNum(fin?.cash),
    periodUpdatedAt: input.financialsUpdatedAt ?? null,
  });
  const runway = clientRunway({
    cash: cash.amount,
    priorCash: finiteNum(prior?.cash),
    netIncome: finiteNum(fin?.netIncome),
    periodExpenses: periodOperatingOutflows(fin),
    periodMonths: fin ? periodMonthsOf(fin) : null,
  });
  return { cash, runway };
}

/**
 * Danger line for the 13-week forecast.
 * A configured threshold wins. Otherwise about four weeks of operating
 * outflows across the horizon. The fixed R50,000 line is only the fallback
 * when neither is available.
 */
export function forecastMinimumCash(input: {
  configured?: number | null;
  weeklyOutflows?: Array<number | null | undefined> | null;
}): number {
  const configured = finiteNum(input.configured);
  if (configured != null && configured > 0) return configured;
  const flows = input.weeklyOutflows ?? [];
  if (flows.length) {
    const total = flows.reduce<number>((sum, raw) => sum + Math.max(0, finiteNum(raw) ?? 0), 0);
    const floor = Math.round((total / flows.length) * 4);
    if (floor > 0) return floor;
  }
  return CASH_RUNWAY_THRESHOLD_RAND;
}

export const CYCLE_AXIS_CAP_DAYS = 360;

/** Day axis for the cash-cycle timeline. Extremes are capped so tick labels cannot stack. */
export function cycleTimelineAxis(
  opDays: number,
  creditorDays: number,
): { total: number; capped: boolean; raw: number; step: number; ticks: number[] } {
  const raw = Math.max(
    Number.isFinite(opDays) ? opDays : 0,
    Number.isFinite(creditorDays) ? creditorDays : 0,
    1,
  );
  const capped = raw > CYCLE_AXIS_CAP_DAYS;
  const total = capped ? CYCLE_AXIS_CAP_DAYS : raw;
  const step = total > 240 ? 90 : total > 120 ? 60 : total > 60 ? 30 : 15;
  const ticks: number[] = [];
  for (let t = 0; t < total; t += step) ticks.push(Math.round(t));
  const end = Math.round(total);
  if (ticks[ticks.length - 1] !== end) ticks.push(end);
  return { total, capped, raw, step, ticks };
}

/** Debtor / inventory days. Absurd values (> 1000 days either way) score 0. */
export function scoreLowerIsBetterDays(val: number): number {
  if (!Number.isFinite(val) || Math.abs(val) > 1000) return 0;
  return clampScore(((90 - val) / 90) * 100);
}

/**
 * Creditor days. ~30–60 is the sweet spot. Past 60 the score falls so
 * 81 is about 65, 90 about 50, and 120 or more (including 329) is 0.
 */
export function scoreCreditorDays(val: number): number {
  if (!Number.isFinite(val) || val < 0 || val > 1000) return 0;
  if (val <= 30) return clampScore(70 + (val / 30) * 30);
  if (val <= 60) return 100;
  if (val <= 120) return clampScore(100 - ((val - 60) / 60) * 100);
  return 0;
}

/** Working-capital days. A deeply negative cycle is a stretched-creditor risk, not a perfect score. */
export function scoreWorkingCapitalDays(val: number): number {
  if (!Number.isFinite(val) || Math.abs(val) > 1000) return 0;
  if (val >= -45) return clampScore(((90 - val) / 90) * 100);
  return clampScore((100 * (val + 365)) / 320);
}

/**
 * Working-capital funding intensity (CCC / 365). Large negative intensities
 * are not healthy — they are the same stretched-creditor picture.
 */
export function scoreWorkingCapitalFunding(fraction: number): number {
  if (!Number.isFinite(fraction) || fraction < -1 || fraction > 2) return 0;
  if (fraction < -0.25) return clampScore((1 + fraction) * 100);
  return clampScore((1 - fraction) * 100);
}
