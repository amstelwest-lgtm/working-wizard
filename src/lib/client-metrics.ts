/**
 * Shared client metrics for Overview, Health, the Bot brief, and Cash Forecast.
 *
 * Cash, runway, and the forecast floor live here so those surfaces cannot
 * drift. Runway is weeks of cash at the current burn — never "weeks until a
 * fixed R50,000 line". Zero weeks means cash is already gone.
 */

import { applyWeekOverrides, type WeekOverrides } from "./cash-week-overrides.ts";
import { CASH_RUNWAY_THRESHOLD_RAND } from "./cash-runway.ts";
import {
  computeRatios,
  metricDirection,
  periodMonthsOf,
  type RatioInputs,
} from "./ratios.ts";

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

/** Shown when cash is on file but there is no cash-flow statement, bank publish, or prior cash movement. */
export const RUNWAY_INSUFFICIENT_LABEL = "Not enough data";

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
 * - No cash figure → unknown ("—").
 * - Cash ≤ 0 → 0 weeks.
 * - A P&L snapshot with cash, and no operating cash flow, published bank
 *   balance, or prior cash movement, is "Not enough data". Profit on the
 *   P&L is not evidence the business is cash generative.
 * - A loss with no flow evidence still estimates weeks from period expenses.
 * - Cash not falling (prior period), or a period with cash-flow or bank
 *   evidence that is not loss-making → "Cash generative". Never 0.
 * - Burning → cash ÷ weekly burn. One period uses that period's expenses.
 *   A negative operating cash flow is the burn when it is on file.
 */
export function clientRunway(input: {
  cash: number | null | undefined;
  priorCash?: number | null;
  netIncome?: number | null;
  periodExpenses?: number | null;
  periodMonths?: number | null;
  /** Operating cash flow. Absent (not zero) means no cash-flow statement. */
  operatingCashflow?: number | null;
  /** True when a bank balance was published (`seededFromBanksAt`). */
  hasBankCashflow?: boolean;
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

  const ocf = finiteNum(input.operatingCashflow);
  const net = finiteNum(input.netIncome);
  const hasFlow = ocf != null || input.hasBankCashflow === true;
  if (!hasFlow) {
    if (net != null && net < 0) {
      const expenses = finiteNum(input.periodExpenses);
      const burn = expenses != null && expenses > 0 ? expenses : Math.abs(net);
      return weeksFromBurn(cash, burn / span);
    }
    return { weeks: null, kind: "unknown", label: RUNWAY_INSUFFICIENT_LABEL };
  }

  if (ocf != null && ocf < 0) return weeksFromBurn(cash, Math.abs(ocf) / span);
  if (net == null || net >= 0) return cashGenerative();
  const expenses = finiteNum(input.periodExpenses);
  const burn = expenses != null && expenses > 0 ? expenses : Math.abs(net);
  return weeksFromBurn(cash, burn / span);
}

/** Label for Overview, the forecast, and the Bot. A blank cash line stays hidden. */
export function runwayDisplayLabel(runway: ClientRunway): string | null {
  if (runway.kind === "unknown" && runway.label === "—") return null;
  return runway.label;
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
  now?: Date;
  timeZone?: string | null;
}): {
  cash: ResolvedCash;
  runway: ClientRunway;
  forecastNet: number | null;
  outlook: ThirteenWeekForecast;
} {
  const fin = asRecord(input.financials);
  const cf = asRecord(input.cashflow);
  const prior = asRecord(input.priorFinancials);
  // A budget push used to stamp seededFromBanksAt. That is not a bank balance.
  const seededAt =
    cf && cashflowIsRealBankSeed(cf) && typeof cf.seededFromBanksAt === "string"
      ? cf.seededFromBanksAt
      : null;
  const cash = resolveClientCash({
    publishedBankBalance: seededAt ? finiteNum(cf?.openingBalance) : null,
    bankPublishedAt: seededAt,
    periodCash: finiteNum(fin?.cash),
    periodUpdatedAt: input.financialsUpdatedAt ?? null,
  });
  let runway = clientRunway({
    cash: cash.amount,
    priorCash: finiteNum(prior?.cash),
    netIncome: finiteNum(fin?.netIncome),
    periodExpenses: periodOperatingOutflows(fin),
    periodMonths: fin ? periodMonthsOf(fin) : null,
    operatingCashflow: finiteNum(fin?.operatingCashflow),
    hasBankCashflow: Boolean(seededAt),
  });
  // The stored cashflow, including a collection delay that is actually on,
  // is the series. Zeroing those knobs made Overview say cash generative
  // while the forecast on file nets cash out.
  const outlook = resolveThirteenWeekForecast({
    financials: input.financials,
    cashflow: input.cashflow,
    openingCash: cash.amount,
    runway,
    now: input.now,
    timeZone: input.timeZone,
    periodEnd: typeof fin?.periodEnd === "string" ? fin.periodEnd : null,
  });
  const hasSeries =
    outlook.totalInflow > 0.5 || outlook.totalOutflow > 0.5 || outlook.source === "stored";
  const forecastNet = hasSeries ? outlook.totalInflow - outlook.totalOutflow : null;
  if (hasSeries) {
    runway = runwayFromForecastNet({
      base: runway,
      opening: outlook.opening,
      totalInflow: outlook.totalInflow,
      totalOutflow: outlook.totalOutflow,
    });
  }
  return { cash, runway, forecastNet, outlook };
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
  const zeroAt = metricDirection("debtorDays")?.zeroAt ?? 90;
  return clampScore(((zeroAt - val) / zeroAt) * 100);
}

/**
 * Creditor days. The healthy band is METRIC_DIRECTIONS (30–60). Past the top
 * of that band the score falls, and 120 or more (including 329) is 0.
 * High days are paying slowly — not a reward for stretching suppliers.
 */
export function scoreCreditorDays(val: number): number {
  if (!Number.isFinite(val) || val < 0 || val > 1000) return 0;
  const spec = metricDirection("creditorDays");
  const lo = spec?.healthyMin ?? 30;
  const hi = spec?.healthyMax ?? 60;
  if (val <= lo) return clampScore(70 + (val / lo) * 30);
  if (val <= hi) return 100;
  if (val <= hi * 2) return clampScore(100 - ((val - hi) / hi) * 100);
  return 0;
}

/**
 * "Cash generative" only when the forecast itself nets cash in.
 * A positive P&L or a runway label does not override a negative 13-week flow.
 * Currency-agnostic: the test is the sign of receipts minus payments.
 */
export function forecastIsCashGenerative(totalInflow: number, totalOutflow: number): boolean {
  if (!Number.isFinite(totalInflow) || !Number.isFinite(totalOutflow)) return false;
  return totalInflow - totalOutflow > 0;
}

/**
 * Weeks of cash at the forecast's own weekly net burn.
 * A negative 13-week movement wins over a P&L that looks cash generative.
 * Positive net leaves the P&L runway alone — a profitable series without
 * cash-flow evidence is still not "Cash generative".
 */
export function runwayFromForecastNet(input: {
  base: ClientRunway;
  opening: number;
  totalInflow: number;
  totalOutflow: number;
  horizonWeeks?: number;
}): ClientRunway {
  const net = input.totalInflow - input.totalOutflow;
  if (!(net < 0)) return input.base;
  const opening = input.opening;
  if (!(opening > 0)) return { weeks: 0, kind: "zero", label: "0 weeks" };
  const horizon = input.horizonWeeks ?? CASH_FORECAST_WEEK_COUNT;
  const weeklyBurn = Math.abs(net) / horizon;
  if (!(weeklyBurn > 0)) return input.base;
  const weeks = Math.max(1, Math.round(opening / weeklyBurn));
  return { weeks, kind: "weeks", label: `${weeks} ${weeks === 1 ? "week" : "weeks"}` };
}

/** In the black only when the horizon nets cash in and the last week stays non-negative. */
export function forecastInTheBlack(
  totalInflow: number,
  totalOutflow: number,
  closing: number,
): boolean {
  const net = totalInflow - totalOutflow;
  return Number.isFinite(net) && Number.isFinite(closing) && net >= 0 && closing >= 0;
}

/** Visible name for a scenario that is actually on. Null on the base forecast. */
export function forecastScenarioLabel(input: {
  collectDelay?: number;
  revAdj?: number;
  expAdj?: number;
  headcountDelta?: number;
  capexAmount?: number;
  fixedCostDelta?: number;
  revGrowthPct?: number;
}): string | null {
  const parts: string[] = [];
  const delay = input.collectDelay ?? 0;
  if (delay > 0) parts.push(`collection delay +${delay}w`);
  if ((input.revAdj ?? 100) !== 100) parts.push(`revenue ${input.revAdj}%`);
  if ((input.expAdj ?? 100) !== 100) parts.push(`expenses ${input.expAdj}%`);
  if ((input.headcountDelta ?? 0) !== 0) parts.push(`headcount ${input.headcountDelta}`);
  if ((input.capexAmount ?? 0) > 0) parts.push("capex");
  if ((input.fixedCostDelta ?? 0) !== 0) parts.push("fixed-cost change");
  if ((input.revGrowthPct ?? 0) !== 0) parts.push(`growth ${input.revGrowthPct}%`);
  return parts.length ? `Scenario: ${parts.join(", ")}` : null;
}

/**
 * Runway headline on the cash-forecast report. Agrees with the series:
 * "Cash generative" only when the caller already has cash-flow evidence and
 * the forecast net flow is positive. Otherwise the weeks until the first dip.
 */
export function forecastRunwayHeadline(input: {
  totalInflow: number;
  totalOutflow: number;
  /** Runway layer already decided the business is not burning. */
  cashGenerative: boolean;
  /** Weeks until the first closing under the minimum. Null when none dip. */
  weeksUntilBreach: number | null;
  horizonWeeks: number;
}): string {
  if (
    input.cashGenerative &&
    forecastIsCashGenerative(input.totalInflow, input.totalOutflow)
  ) {
    return "Cash generative";
  }
  if (input.weeksUntilBreach == null) return `${input.horizonWeeks}+ wks`;
  return `${input.weeksUntilBreach} wks`;
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

// ── 13-week cash forecast ────────────────────────────────────────────────────

export const CASH_FORECAST_WEEK_COUNT = 13;

export type ForecastLineFrequency =
  | "recurring-weekly"
  | "recurring-monthly"
  | "once-off"
  | "split-weeks"
  | "split-months";

export type ForecastLineSeed = {
  id: string;
  name: string;
  amount: string;
  frequency: ForecastLineFrequency;
  startWeek: number;
  splitCount: number;
  weekOverrides?: WeekOverrides;
};

export type ThirteenWeekForecast = {
  /** `derived` replaces a stale or inconsistent stored forecast. */
  source: "stored" | "derived";
  startDate: string;
  /** Week-start dates, local calendar, length 13. */
  weekDates: string[];
  opening: number;
  inflow: number[];
  outflow: number[];
  closing: number[];
  totalInflow: number;
  totalOutflow: number;
  /** About four weeks of operating outflows. */
  floor: number;
  /** First week (1–13) whose closing is under the floor. */
  dipsBelowFloorWeek: number | null;
  shortfall: boolean;
  shortfallWeek: number | null;
  /**
   * Set only when a typed timing knob (collection delay, capex, headcount,
   * fixed-cost change) explains a dip. A cash-generative runway must not
   * show a structural shortfall without this.
   */
  timingNote: string | null;
  /** Cash-cycle context. Does not by itself authorise a shortfall badge. */
  cycleNote: string | null;
  /** When true, the screen must show `lines` instead of the stored forecast. */
  replaceStored: boolean;
  lines: { revenue: ForecastLineSeed[]; expenses: ForecastLineSeed[] };
  /** Set when the series was built from the P&L because nothing was forecast yet. */
  estimateLabel: string | null;
  /** Set when week 1 moved to the current week and the opening was rolled or the gap labelled. */
  anchorNote: string | null;
  reanchored: boolean;
};

type StoredForecastLine = {
  id?: string;
  name?: string;
  amount?: string;
  frequency?: string;
  startWeek?: number;
  splitCount?: number;
  weekOverrides?: WeekOverrides;
};

function formatISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Calendar days from `fromIso` to `toIso`. Negative when `toIso` is earlier. */
export function calendarDaysBetween(fromIso: string, toIso: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}/.test(fromIso) || !/^\d{4}-\d{2}-\d{2}/.test(toIso)) return null;
  const from = parseISODate(fromIso);
  const to = parseISODate(toIso);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

/** Today's calendar date in a firm timezone, as a local Y-M-D date (no UTC shift). */
function calendarDate(now: Date, timeZone?: string | null): Date {
  if (!timeZone) return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  try {
    const formatted = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    const iso = formatted.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return parseISODate(iso);
  } catch {
    // Unknown timezone — fall through to the runtime's local date.
  }
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Parse YYYY-MM-DD as a local calendar date. `new Date("YYYY-MM-DD")` is UTC and shifts a day in the Americas. */
export function parseISODate(iso: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return new Date(iso);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  next.setDate(next.getDate() + days);
  return next;
}

/**
 * First day of the forecast. The current week (Monday of today in the firm's
 * timezone), or the day after the latest statement period end when that is later.
 */
export function forecastAnchorDate(input: {
  now?: Date;
  periodEnd?: string | null;
  timeZone?: string | null;
}): string {
  const now = input.now ?? new Date();
  const today = calendarDate(now, input.timeZone);
  const mondayOffset = (today.getDay() + 6) % 7;
  let anchor = addDays(today, -mondayOffset);
  const endIso = input.periodEnd?.slice(0, 10) ?? "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(endIso)) {
    const next = addDays(parseISODate(endIso), 1);
    if (next.getTime() > anchor.getTime()) anchor = next;
  }
  return formatISODate(anchor);
}

const PL_ESTIMATE_LABEL = "Estimated from the P&L";

function weeklyEquivalent(amount: number, frequency: string | null | undefined): number | null {
  switch (frequency) {
    case "weekly":
    case "recurring-weekly":
      return amount;
    case "monthly":
    case "recurring-monthly":
      return amount * (12 / 52);
    case "annual":
      return amount / 52;
    default:
      return null;
  }
}

function weeklyNetFromDraft(
  lines: Array<{ amount: number; cadence: string; side: "inflow" | "outflow"; status: string }>,
): number | null {
  let net = 0;
  let counted = 0;
  for (const line of lines) {
    if (line.status === "excluded") continue;
    const weekly = weeklyEquivalent(line.amount, line.cadence);
    if (weekly == null || weekly === 0) continue;
    net += line.side === "outflow" ? -weekly : weekly;
    counted += 1;
  }
  return counted > 0 ? net : null;
}

export type BankRollForwardItem = {
  name: string;
  side: "inflow" | "outflow";
  cadence: string;
  amount: number;
  /** Signed weekly run-rate. Outflows are negative. */
  weekly: number;
  /** Signed cash this line adds across the gap. */
  contribution: number;
};

/**
 * Move a bank closing balance from the statement date up to the forecast anchor.
 * Gap days are the days after the statement and before week 1. Recurring lines
 * can supply a daily run-rate, but that estimate is opt-in: the opening the
 * draft proposes is the bank closing balance. With no recurring lines, the
 * balance stays put and the note names the gap.
 */
export function rollBankDraftOpening(input: {
  statementEnd: string | null;
  anchor: string;
  closing: number;
  lines: Array<{
    name?: string;
    amount: number;
    cadence: string;
    side: "inflow" | "outflow";
    status: string;
  }>;
  /** When true, apply the recurring-line estimate. Default leaves the bank closing balance. */
  rollForward?: boolean;
}): {
  opening: number;
  note: string | null;
  gapDays: number;
  adjustment: number;
  items: BankRollForwardItem[];
} {
  const end = input.statementEnd?.slice(0, 10) ?? "";
  const unchanged = {
    opening: input.closing,
    note: null as string | null,
    gapDays: 0,
    adjustment: 0,
    items: [] as BankRollForwardItem[],
  };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) return unchanged;
  const span = calendarDaysBetween(end, input.anchor);
  const gapDays = span == null ? 0 : Math.max(0, span - 1);
  if (gapDays <= 0) return { ...unchanged, opening: input.closing };

  const items: BankRollForwardItem[] = [];
  for (const line of input.lines) {
    if (line.status === "excluded") continue;
    const weekly = weeklyEquivalent(line.amount, line.cadence);
    if (weekly == null || weekly === 0) continue;
    const signed = line.side === "outflow" ? -weekly : weekly;
    items.push({
      name: line.name?.trim() || "Recurring line",
      side: line.side,
      cadence: line.cadence,
      amount: line.amount,
      weekly: Math.round(signed * 100) / 100,
      contribution: Math.round(((signed / 7) * gapDays) * 100) / 100,
    });
  }

  if (items.length === 0) {
    return {
      opening: input.closing,
      gapDays,
      adjustment: 0,
      items: [],
      note: `${gapDays} days sit between the bank statement (${end}) and this week (${input.anchor}). Opening cash stays the bank closing balance — those days are not in the 13 weeks.`,
    };
  }

  const weeklyNet = items.reduce((sum, item) => sum + item.weekly, 0);
  const adjustment = Math.round(((weeklyNet / 7) * gapDays) * 100) / 100;
  if (items.length) {
    const listed = items.reduce((sum, item) => sum + item.contribution, 0);
    const drift = Math.round((adjustment - listed) * 100) / 100;
    const last = items[items.length - 1]!;
    last.contribution = Math.round((last.contribution + drift) * 100) / 100;
  }

  if (!input.rollForward) {
    return {
      opening: input.closing,
      gapDays,
      adjustment: 0,
      items: [],
      note: `Opening cash stays the bank closing balance on ${end}. ${gapDays} days sit before this week (${input.anchor}) and are not rolled in.`,
    };
  }

  const opening = Math.round((input.closing + adjustment) * 100) / 100;
  return {
    opening,
    gapDays,
    adjustment,
    items,
    note: `Rolled forward ${gapDays} days from the bank closing balance on ${end} to this week (${input.anchor}). Recurring lines move opening cash by ${adjustment.toFixed(2)}.`,
  };
}

function weeklyNetFromStored(cf: Record<string, unknown>): number | null {
  let net = 0;
  let counted = 0;
  const take = (rows: unknown, sign: 1 | -1) => {
    for (const line of asForecastLines(rows)) {
      const amount = parseFloat(line.amount ?? "0") || 0;
      const weekly = weeklyEquivalent(amount, line.frequency);
      if (weekly == null || weekly === 0) continue;
      net += sign * weekly;
      counted += 1;
    }
  };
  take(cf.revenue, 1);
  take(cf.expenses, -1);
  take(cf.other, -1);
  return counted > 0 ? net : null;
}

export type PlBankDisagreement = {
  plRevenueMonthly: number | null;
  bankInflowMonthly: number;
  plCostMonthly: number | null;
  bankOutflowMonthly: number;
};

function materiallyDifferent(left: number | null, right: number): boolean {
  if (left == null || !Number.isFinite(left) || !Number.isFinite(right)) return false;
  const diff = Math.abs(left - right);
  const base = Math.max(Math.abs(left), Math.abs(right), 1);
  return diff >= 1000 && diff / base >= 0.2;
}

/**
 * P&L monthly revenue and costs versus the bank forecast's monthly run-rate.
 * Set only when a bank publish exists and at least one side differs materially.
 */
export function plBankDisagreement(input: {
  financials?: Record<string, unknown> | null;
  cashflow?: unknown;
}): PlBankDisagreement | null {
  const cf = asRecord(input.cashflow);
  if (!cashflowIsRealBankSeed(cf)) return null;
  const fin = asRecord(input.financials);
  if (!fin) return null;
  const months = periodMonthsOf(fin);
  const revenue = finiteNum(fin.revenue);
  const costs = periodOperatingOutflows(fin);
  const plRevenueMonthly = revenue == null ? null : revenue / months;
  const plCostMonthly = costs == null ? null : costs / months;

  const weeks = CASH_FORECAST_WEEK_COUNT;
  const inflow = new Array(weeks).fill(0);
  const outflow = new Array(weeks).fill(0);
  for (const line of asForecastLines(cf.revenue)) {
    distributeForecastLine(line, weeks).forEach((n, i) => {
      inflow[i] += n;
    });
  }
  for (const line of [...asForecastLines(cf.expenses), ...asForecastLines(cf.other)]) {
    distributeForecastLine(line, weeks).forEach((n, i) => {
      outflow[i] += n;
    });
  }
  const monthly = (xs: number[]) => (xs.reduce((sum, n) => sum + n, 0) / xs.length) * (52 / 12);
  const bankInflowMonthly = monthly(inflow);
  const bankOutflowMonthly = monthly(outflow);
  if (bankInflowMonthly < 1 && bankOutflowMonthly < 1) return null;
  if (
    !materiallyDifferent(plRevenueMonthly, bankInflowMonthly) &&
    !materiallyDifferent(plCostMonthly, bankOutflowMonthly)
  ) {
    return null;
  }
  return { plRevenueMonthly, bankInflowMonthly, plCostMonthly, bankOutflowMonthly };
}

export function weekDatesFrom(startIso: string, weeks = CASH_FORECAST_WEEK_COUNT): string[] {
  const start = parseISODate(startIso);
  return Array.from({ length: weeks }, (_, i) => formatISODate(addDays(start, i * 7)));
}

/**
 * Period P&L → one week.
 * Monthly rate = period total / periodMonths (12 when the length is missing).
 * Weekly rate = monthly × 12/52. A one-month actual and the same business
 * written as twelve months therefore produce the same week — the annual
 * figure is not treated as a month, and the month is not treated as a week.
 */
export function weeklyRunRate(input: {
  revenue?: number | null;
  operatingOutflows?: number | null;
  periodMonths?: number | null;
}): { weeklyInflow: number; weeklyOutflow: number } {
  const months =
    input.periodMonths != null && input.periodMonths >= 1 && input.periodMonths <= 12
      ? input.periodMonths
      : 12;
  const toWeek = (periodTotal: number) => (periodTotal / months) * (12 / 52);
  return {
    weeklyInflow: Math.max(0, toWeek(finiteNum(input.revenue) ?? 0)),
    weeklyOutflow: Math.max(0, toWeek(finiteNum(input.operatingOutflows) ?? 0)),
  };
}

/** Spread one forecast line across the horizon. Shared by the screen, the PDF, and the Bot. */
export function distributeForecastLine(
  line: StoredForecastLine,
  weeks = CASH_FORECAST_WEEK_COUNT,
): number[] {
  const out = new Array(weeks).fill(0);
  const amt = parseFloat(line.amount ?? "0") || 0;
  if (amt === 0) return out;
  const start = Math.max(1, Math.min(weeks, line.startWeek ?? 1)) - 1;
  const freq = line.frequency ?? "recurring-monthly";
  switch (freq) {
    case "recurring-weekly":
    case "weekly":
      for (let i = start; i < weeks; i++) out[i] = amt;
      break;
    case "once-off":
    case "once":
      out[start] = amt;
      break;
    case "split-weeks":
    case "split": {
      const n = Math.max(1, line.splitCount ?? 3);
      const per = amt / n;
      for (let i = start; i < Math.min(weeks, start + n); i++) out[i] = per;
      break;
    }
    case "split-months": {
      const n = Math.max(1, line.splitCount ?? 3);
      const per = amt / n;
      for (let i = 0; i < n; i++) {
        const w = start + i * 4;
        if (w < weeks) out[w] = per;
      }
      break;
    }
    default:
      for (let i = start; i < weeks; i += 4) out[i] = amt;
  }
  return applyWeekOverrides(out, line.weekOverrides);
}

function asForecastLines(value: unknown): StoredForecastLine[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row) => row && typeof row === "object") as StoredForecastLine[];
}

function forecastLineNames(cf: Record<string, unknown>): string[] {
  return [...asForecastLines(cf.revenue), ...asForecastLines(cf.expenses), ...asForecastLines(cf.other)].map(
    (line) => line.name ?? "",
  );
}

/** Budget bridge stamps this on every seeded line. */
function cashflowNamedFromBudget(cf: Record<string, unknown> | null | undefined): boolean {
  if (!cf) return false;
  return forecastLineNames(cf).some((name) => /\(from budget\)/i.test(name));
}

/**
 * A bank publish. `seededFromBanksAt` alone is not enough: budget pushes
 * used to set that flag, and those lines are not bank movements.
 */
function cashflowIsRealBankSeed(cf: Record<string, unknown> | null | undefined): boolean {
  if (!cf) return false;
  const seeded = typeof cf.seededFromBanksAt === "string" && cf.seededFromBanksAt.length > 0;
  if (!seeded || cashflowNamedFromBudget(cf)) return false;
  return true;
}

function moneyString(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * Roll a saved forecast forward. Same rules as the cash screen: monthly
 * lines land every four weeks, collection delay shifts receipts, and a
 * headcount change can reduce outflow.
 */
export function rollForwardForecast(
  cf: Record<string, unknown> | null | undefined,
  weeks = CASH_FORECAST_WEEK_COUNT,
): { opening: number; inflow: number[]; outflow: number[]; closing: number[] } | null {
  if (!cf) return null;
  const revenue = asForecastLines(cf.revenue);
  const expenses = asForecastLines(cf.expenses);
  const other = asForecastLines(cf.other);
  const hasAmount = [...revenue, ...expenses, ...other].some(
    (line) => (parseFloat(line.amount ?? "0") || 0) !== 0,
  );
  if (!hasAmount) return null;

  const revAdj = (finiteNum(cf.revAdj) ?? 100) / 100;
  const expAdj = (finiteNum(cf.expAdj) ?? 100) / 100;
  const collectDelay = Math.max(0, Math.min(weeks - 1, Math.round(finiteNum(cf.collectDelay) ?? 0)));
  const headDelta = finiteNum(cf.headcountDelta) ?? 0;
  const avgSal = finiteNum(cf.avgSalary) ?? 0;
  const fixedDelta = finiteNum(cf.fixedCostDelta) ?? 0;
  const revGrowth = finiteNum(cf.revGrowthPct) ?? 0;
  const capexAmt = finiteNum(cf.capexAmount) ?? 0;
  const capexWk = finiteNum(cf.capexWeek) ?? 1;

  const shiftVals = (vals: number[]) => {
    if (!collectDelay) return vals;
    const shifted = new Array(weeks).fill(0);
    for (let i = 0; i < weeks; i++) {
      const j = i + collectDelay;
      if (j < weeks) shifted[j] += vals[i];
    }
    return shifted;
  };
  const growthMul = (i: number) => Math.pow(1 + revGrowth / 100, i);

  const inflow = new Array(weeks).fill(0);
  const outflow = new Array(weeks).fill(0);
  for (const line of revenue) {
    shiftVals(distributeForecastLine(line, weeks).map((v) => v * revAdj)).forEach((v, i) => {
      inflow[i] += v * growthMul(i);
    });
  }
  for (const line of [...expenses, ...other]) {
    distributeForecastLine(line, weeks)
      .map((v) => v * expAdj)
      .forEach((v, i) => {
        outflow[i] += v;
      });
  }
  if (headDelta !== 0) {
    const weekly = (headDelta * avgSal) / (52 / 12);
    for (let i = 0; i < weeks; i++) outflow[i] += weekly;
  }
  if (fixedDelta !== 0) {
    const weekly = fixedDelta / (52 / 12);
    for (let i = 0; i < weeks; i++) outflow[i] += weekly;
  }
  if (capexAmt !== 0) {
    const w = Math.max(1, Math.min(weeks, capexWk)) - 1;
    outflow[w] += capexAmt;
  }

  const opening = finiteNum(cf.openingBalance) ?? 0;
  const closing: number[] = [];
  let bal = opening;
  for (let i = 0; i < weeks; i++) {
    bal += inflow[i] - outflow[i];
    closing.push(bal);
  }
  return { opening, inflow, outflow, closing };
}

function ratioInputsFromFinancials(fin: Record<string, unknown>): RatioInputs {
  const text = (key: string) => {
    const raw = fin[key];
    if (raw == null || raw === "") return "";
    return String(raw);
  };
  return {
    revenue: text("revenue"),
    cogs: text("cogs"),
    ebit: text("ebit"),
    ebt: text("ebt"),
    netIncome: text("netIncome"),
    ebitda: text("ebitda"),
    operatingCashflow: text("operatingCashflow"),
    totalAssets: text("totalAssets"),
    equity: text("equity"),
    receivables: text("receivables"),
    inventory: text("inventory"),
    payables: text("payables"),
    fixedCosts: text("fixedCosts"),
    variableCosts: text("variableCosts"),
    top5Revenue: text("top5Revenue"),
    laborCost: text("laborCost"),
    employees: text("employees"),
    founderHours: text("founderHours"),
    periodMonths: text("periodMonths"),
  };
}

function storedTimingNote(cf: Record<string, unknown>): string | null {
  const parts: string[] = [];
  const delay = finiteNum(cf.collectDelay) ?? 0;
  if (delay > 0) parts.push(`collections delayed ${Math.round(delay)} weeks`);
  const capex = finiteNum(cf.capexAmount) ?? 0;
  if (capex > 0) parts.push(`capex in week ${Math.round(finiteNum(cf.capexWeek) ?? 1)}`);
  const heads = finiteNum(cf.headcountDelta) ?? 0;
  if (heads !== 0) parts.push(`headcount change of ${heads}`);
  const fixed = finiteNum(cf.fixedCostDelta) ?? 0;
  if (fixed !== 0) parts.push("a fixed-cost change");
  return parts.length ? parts.join("; ") : null;
}

function seriesTotals(inflow: number[], outflow: number[], closing: number[]) {
  const totalInflow = inflow.reduce((sum, n) => sum + n, 0);
  const totalOutflow = outflow.reduce((sum, n) => sum + n, 0);
  const floor = forecastMinimumCash({ weeklyOutflows: outflow });
  let dipsBelowFloorWeek: number | null = null;
  let shortfallWeek: number | null = null;
  closing.forEach((balance, i) => {
    if (dipsBelowFloorWeek == null && balance < floor) dipsBelowFloorWeek = i + 1;
    if (shortfallWeek == null && balance < 0) shortfallWeek = i + 1;
  });
  const structural = totalOutflow > totalInflow + 1 && shortfallWeek != null;
  return {
    totalInflow,
    totalOutflow,
    floor,
    dipsBelowFloorWeek,
    shortfall: shortfallWeek != null,
    shortfallWeek,
    structural,
  };
}

function reclose(opening: number, inflow: number[], outflow: number[]): number[] {
  const closing: number[] = [];
  let bal = opening;
  for (let i = 0; i < inflow.length; i++) {
    bal += inflow[i] - outflow[i];
    closing.push(bal);
  }
  return closing;
}

function derivedLines(weeklyInflow: number, weeklyOutflow: number): {
  revenue: ForecastLineSeed[];
  expenses: ForecastLineSeed[];
} {
  return {
    revenue: [
      {
        id: "derived-collections",
        name: "Collections (monthly revenue)",
        amount: moneyString(weeklyInflow),
        frequency: "recurring-weekly",
        startWeek: 1,
        splitCount: 1,
      },
    ],
    expenses: [
      {
        id: "derived-operating",
        name: "Operating payments (monthly costs)",
        amount: moneyString(weeklyOutflow),
        frequency: "recurring-weekly",
        startWeek: 1,
        splitCount: 1,
      },
    ],
  };
}

/**
 * The 13-week forecast Overview, Cash, the PDF, and the Bot all read.
 * A stored forecast is shown only when its start is on or after the anchor
 * and its opening matches live cash. Anything else — 2025 dates, a stale
 * opening, or a structural shortfall while runway is cash generative with
 * no timing driver — is ignored and rebuilt from the monthly P&L.
 */
export function resolveThirteenWeekForecast(input: {
  financials?: Record<string, unknown> | null;
  cashflow?: unknown;
  openingCash?: number | null;
  runway?: ClientRunway | null;
  now?: Date;
  periodEnd?: string | null;
  timeZone?: string | null;
}): ThirteenWeekForecast {
  const weeks = CASH_FORECAST_WEEK_COUNT;
  const fin = asRecord(input.financials);
  const periodEnd =
    input.periodEnd ?? (typeof fin?.periodEnd === "string" ? fin.periodEnd : null);
  const anchor = forecastAnchorDate({ now: input.now, periodEnd, timeZone: input.timeZone });
  const opening = finiteNum(input.openingCash) ?? finiteNum(fin?.cash) ?? 0;
  const runway = input.runway ?? { weeks: null, kind: "unknown" as const, label: "—" };
  const cf = asRecord(input.cashflow);

  const months = fin ? periodMonthsOf(fin) : 12;
  const operating = fin ? periodOperatingOutflows(fin) : null;
  const rate = weeklyRunRate({
    revenue: finiteNum(fin?.revenue),
    operatingOutflows: operating,
    periodMonths: months,
  });
  let cycleNote: string | null = null;
  if (fin && (finiteNum(fin.revenue) != null || operating != null)) {
    const ratios = computeRatios(ratioInputsFromFinancials(fin));
    const creditorDays = ratios["Creditor Days"];
    const debtorDays = ratios["Debtor Days"];
    if (Number.isFinite(creditorDays) && creditorDays > 90) {
      cycleNote = `Creditor days are ${Math.round(creditorDays)}. Weekly payments follow the scaled monthly run-rate, not a payoff of the payable balance inside 13 weeks.`;
    } else if (Number.isFinite(debtorDays) && debtorDays > 0) {
      cycleNote = `Debtor days are ${Math.round(debtorDays)}. Collections use the same monthly revenue run-rate.`;
    }
  }

  const buildDerived = (): ThirteenWeekForecast => {
    const inflow = new Array(weeks).fill(rate.weeklyInflow);
    const outflow = new Array(weeks).fill(rate.weeklyOutflow);
    const closing = reclose(opening, inflow, outflow);
    const totals = seriesTotals(inflow, outflow, closing);
    const suppress = runway.kind === "cash_generative" && totals.structural;
    return {
      source: "derived",
      startDate: anchor,
      weekDates: weekDatesFrom(anchor, weeks),
      opening,
      inflow,
      outflow,
      closing,
      totalInflow: totals.totalInflow,
      totalOutflow: totals.totalOutflow,
      floor: totals.floor,
      dipsBelowFloorWeek: totals.dipsBelowFloorWeek,
      shortfall: suppress ? false : totals.shortfall,
      shortfallWeek: suppress ? null : totals.shortfallWeek,
      timingNote: null,
      cycleNote,
      replaceStored: true,
      lines: derivedLines(rate.weeklyInflow, rate.weeklyOutflow),
      estimateLabel:
        rate.weeklyInflow > 1 || rate.weeklyOutflow > 1 ? PL_ESTIMATE_LABEL : null,
      anchorNote: null,
      reanchored: false,
    };
  };

  const rolled = cf ? rollForwardForecast(cf, weeks) : null;
  const startRaw = typeof cf?.startDate === "string" ? cf.startDate.slice(0, 10) : "";
  const startOk = /^\d{4}-\d{2}-\d{2}$/.test(startRaw) && startRaw >= anchor;
  const storedOpening = finiteNum(cf?.openingBalance);
  const openingOk =
    storedOpening != null && Number.isFinite(opening) && Math.abs(storedOpening - opening) < 0.5;
  const timingNote = cf ? storedTimingNote(cf) : null;

  const bankSeeded = typeof cf?.seededFromBanksAt === "string" && cf.seededFromBanksAt.length > 0;
  const protectedLines = bankSeeded || cf?.forecastLinesSource === "xero-bank-summary";

  let storedCurrent = Boolean(rolled && startOk && openingOk);
  if (storedCurrent && rolled && !protectedLines && runway.kind === "cash_generative") {
    const totals = seriesTotals(rolled.inflow, rolled.outflow, rolled.closing);
    if (totals.structural && !timingNote) storedCurrent = false;
  }
  // A timing note must not keep a series whose weekly payments are still the
  // old annual-as-monthly scale. The PDF floor is four weeks of these outflows.
  // A published bank series is the cash record — a gap versus the P&L is flagged,
  // not discarded.
  if (storedCurrent && rolled && !protectedLines && rate.weeklyOutflow > 0) {
    const meanOut =
      rolled.outflow.reduce((sum, n) => sum + Math.max(0, n), 0) / rolled.outflow.length;
    if (meanOut > rate.weeklyOutflow * 3 + 1) storedCurrent = false;
  }

  const blankSeries =
    rolled != null &&
    rolled.inflow.every((n) => Math.abs(n) < 0.5) &&
    rolled.outflow.every((n) => Math.abs(n) < 0.5);
  const plHasRate = rate.weeklyInflow > 1 || rate.weeklyOutflow > 1;
  if (storedCurrent && blankSeries && plHasRate && !protectedLines) storedCurrent = false;

  if (storedCurrent && rolled) {
    const totals = seriesTotals(rolled.inflow, rolled.outflow, rolled.closing);
    const showShortfall =
      totals.shortfall && (runway.kind !== "cash_generative" || Boolean(timingNote));
    return {
      source: "stored",
      startDate: startRaw,
      weekDates: weekDatesFrom(startRaw, weeks),
      opening: rolled.opening,
      inflow: rolled.inflow,
      outflow: rolled.outflow,
      closing: rolled.closing,
      totalInflow: totals.totalInflow,
      totalOutflow: totals.totalOutflow,
      floor: totals.floor,
      dipsBelowFloorWeek: totals.dipsBelowFloorWeek,
      shortfall: showShortfall,
      shortfallWeek: showShortfall ? totals.shortfallWeek : null,
      timingNote: showShortfall ? timingNote : null,
      cycleNote,
      replaceStored: false,
      lines: { revenue: [], expenses: [] },
      estimateLabel: cf?.forecastLinesSource === "pl-estimate" ? PL_ESTIMATE_LABEL : null,
      anchorNote: null,
      reanchored: false,
    };
  }

  // Week 1 is already in the past (the day after an older bank line). Keep the
  // lines, move the start to this week, and roll the opening across the gap.
  if (
    rolled &&
    cf &&
    openingOk &&
    !blankSeries &&
    /^\d{4}-\d{2}-\d{2}$/.test(startRaw) &&
    startRaw < anchor
  ) {
    const meanOut =
      rolled.outflow.reduce((sum, n) => sum + Math.max(0, n), 0) / rolled.outflow.length;
    const scaleBad =
      !protectedLines && rate.weeklyOutflow > 0 && meanOut > rate.weeklyOutflow * 3 + 1;
    if (!scaleBad) {
      const gapDays = Math.max(0, calendarDaysBetween(startRaw, anchor) ?? 0);
      // A few days inside the opening week is not a new forecast. Rolling it
      // made Overview and the cash tab disagree by a few hundred rand and a week.
      if (gapDays < 7) {
        const totals = seriesTotals(rolled.inflow, rolled.outflow, rolled.closing);
        const showShortfall =
          totals.shortfall && (runway.kind !== "cash_generative" || Boolean(timingNote) || bankSeeded);
        return {
          source: "stored",
          startDate: startRaw,
          weekDates: weekDatesFrom(startRaw, weeks),
          opening: rolled.opening,
          inflow: rolled.inflow,
          outflow: rolled.outflow,
          closing: rolled.closing,
          totalInflow: totals.totalInflow,
          totalOutflow: totals.totalOutflow,
          floor: totals.floor,
          dipsBelowFloorWeek: totals.dipsBelowFloorWeek,
          shortfall: showShortfall,
          shortfallWeek: showShortfall ? totals.shortfallWeek : null,
          timingNote: showShortfall ? timingNote : null,
          cycleNote,
          replaceStored: false,
          lines: { revenue: [], expenses: [] },
          estimateLabel: null,
          anchorNote: null,
          reanchored: false,
        };
      }
      const weeklyNet = weeklyNetFromStored(cf);
      // Budget lines, including ones that still carry seededFromBanksAt, are
      // not a bank balance. With statement cash on file, leave that figure
      // and skip the roll-forward banner. A real bank publish still rolls.
      const realBankSeed = bankSeeded && !cashflowNamedFromBudget(cf);
      const statementCash = finiteNum(fin?.cash);
      const preferStatement = statementCash != null && !realBankSeed;
      const opening = preferStatement
        ? statementCash
        : weeklyNet == null
          ? rolled.opening
          : Math.round((rolled.opening + (weeklyNet / 7) * gapDays) * 100) / 100;
      const closing = reclose(opening, rolled.inflow, rolled.outflow);
      const totals = seriesTotals(rolled.inflow, rolled.outflow, closing);
      const showShortfall =
        totals.shortfall && (runway.kind !== "cash_generative" || Boolean(timingNote) || bankSeeded);
      const anchorNote = preferStatement
        ? null
        : gapDays <= 0
          ? null
          : weeklyNet == null
            ? `${gapDays} days sit between ${startRaw} and this week (${anchor}). Opening cash is still the balance on ${startRaw}.`
            : `Opening cash was rolled forward ${gapDays} days from ${startRaw} to this week (${anchor}).`;
      return {
        source: "stored",
        startDate: anchor,
        weekDates: weekDatesFrom(anchor, weeks),
        opening,
        inflow: rolled.inflow,
        outflow: rolled.outflow,
        closing,
        totalInflow: totals.totalInflow,
        totalOutflow: totals.totalOutflow,
        floor: totals.floor,
        dipsBelowFloorWeek: totals.dipsBelowFloorWeek,
        shortfall: showShortfall,
        shortfallWeek: showShortfall ? totals.shortfallWeek : null,
        timingNote: showShortfall ? timingNote : null,
        cycleNote,
        replaceStored: false,
        lines: { revenue: [], expenses: [] },
        estimateLabel: null,
        anchorNote,
        reanchored: gapDays > 0,
      };
    }
  }

  // Lines with no start date are still the forecast on file. Rebuilding them
  // from the P&L dropped a real cash-out series and left runway as "not enough data".
  if (rolled && openingOk && !blankSeries && !/^\d{4}-\d{2}-\d{2}$/.test(startRaw)) {
    const meanOut =
      rolled.outflow.reduce((sum, n) => sum + Math.max(0, n), 0) / rolled.outflow.length;
    const scaleBad =
      !protectedLines && rate.weeklyOutflow > 0 && meanOut > rate.weeklyOutflow * 3 + 1;
    if (!scaleBad) {
      const totals = seriesTotals(rolled.inflow, rolled.outflow, rolled.closing);
      const showShortfall =
        totals.shortfall && (runway.kind !== "cash_generative" || Boolean(timingNote) || bankSeeded);
      return {
        source: "stored",
        startDate: anchor,
        weekDates: weekDatesFrom(anchor, weeks),
        opening: rolled.opening,
        inflow: rolled.inflow,
        outflow: rolled.outflow,
        closing: rolled.closing,
        totalInflow: totals.totalInflow,
        totalOutflow: totals.totalOutflow,
        floor: totals.floor,
        dipsBelowFloorWeek: totals.dipsBelowFloorWeek,
        shortfall: showShortfall,
        shortfallWeek: showShortfall ? totals.shortfallWeek : null,
        timingNote: showShortfall ? timingNote : null,
        cycleNote,
        replaceStored: false,
        lines: { revenue: [], expenses: [] },
        estimateLabel: null,
        anchorNote: null,
        reanchored: false,
      };
    }
  }

  return buildDerived();
}
