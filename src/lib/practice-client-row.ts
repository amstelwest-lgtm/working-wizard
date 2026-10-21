import {
  assessClientMetrics,
  forecastIsCashGenerative,
  runwayDisplayLabel,
  storedOpeningIsMissing,
} from "@/lib/client-metrics";
import { parseOperatingProfile } from "@/lib/client-profile";
import {
  clientListRunwayCell,
  clientListRunwayHeadline,
  clientListStatusWord,
} from "@/lib/cash-forecast-parity";
import { liveHealthFromBooks, type OverallHealth } from "@/lib/health-score";
import { coerceMarketSelection, parseMarketSelection, resolveMarket } from "@/lib/market";
import { operatingProfitLabel } from "@/lib/operating-profit-display";
import { clientIndustryDisplay } from "@/lib/profile-signals";
import { revenueOf, trendDelta30d, type ScoreHistoryPoint } from "@/lib/portfolio-dashboard";
import { storedFiniteNumber } from "@/lib/stored-number";

export type PracticeClient = {
  id: string;
  name: string;
  business_type: string | null;
  operating_profile?: unknown;
  client_code?: string | null;
  contact_email?: string | null;
  cash_runway_weeks: number | string | null;
  last_forecast_at: string | null;
  last_login_at: string | null;
  firm_id: string | null;
  owner_user_id?: string | null;
  financials: Record<string, string | number | null> | null;
  financials_updated_at?: string | null;
  cashflow?: unknown;
  created_at?: string | null;
  reports_issued_count?: number | null;
  market?: unknown;
};

export type PracticeClientRow = PracticeClient & {
  score: number | null;
  health: OverallHealth;
  trendDelta: number | null;
  scoreSeries: number[];
  chaseActions: { title: string; overdue: boolean }[];
  runwayWeeks: number | null;
  runwayLabel: string | null;
  /** Null when the count has not been read. Zero is a real count. */
  openQueries: number | null;
  openActions: number;
  overdueActions: number;
  revenue: number | null;
};

export type StoredScorePoint = {
  score?: unknown;
  is_estimated?: boolean;
  period_date?: string | null;
};

const UNSCORED_HEALTH: OverallHealth = {
  overall: null,
  status: "at_risk",
  displayStatus: "at_risk",
  displayLabel: "Watch",
  pillars: [],
  weakestPillar: null,
  hasCriticalPillar: false,
};

/** Latest finite score, including a numeric string from PostgREST. */
export function latestStoredScore(history: readonly StoredScorePoint[]): number | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const score = storedFiniteNumber(history[i]?.score);
    if (score != null) return score;
  }
  return null;
}

function scoredHistory(history: readonly StoredScorePoint[]): ScoreHistoryPoint[] {
  const out: ScoreHistoryPoint[] = [];
  for (const point of history) {
    const score = storedFiniteNumber(point.score);
    if (score == null) continue;
    out.push({
      score,
      is_estimated: point.is_estimated === true,
      period_date: point.period_date,
    });
  }
  return out;
}

/**
 * Forecast weeks when the engine counted them. Otherwise the stored
 * `cash_runway_weeks` column, including a numeric string. No forecast and
 * no stored weeks stays null, which the cell prints as an em dash.
 */
export function listRunwayWeeks(forecastWeeks: number | null, stored: unknown): number | null {
  if (forecastWeeks != null && Number.isFinite(forecastWeeks)) return forecastWeeks;
  return storedFiniteNumber(stored);
}

/** Queries cell. Zero is a count. A dash is only an unread count. */
export function clientListQueriesCell(count: number | null | undefined): string {
  if (count == null) return "—";
  const n = storedFiniteNumber(count);
  if (n == null) return "—";
  return String(Math.max(0, Math.trunc(n)));
}

export function practiceListScoreText(score: number | null): string {
  if (score == null || !Number.isFinite(score)) return "—";
  return String(Math.round(score));
}

/** Operating profit for one clients-table row. Numeric strings count. */
export function clientListOpProfit(
  financials: Record<string, unknown> | null | undefined,
  market: unknown,
): string {
  if (!financials) return "—";
  const ebit = storedFiniteNumber(financials.ebit);
  if (ebit == null) return "—";
  const revenue = storedFiniteNumber(financials.revenue);
  const resolved = resolveMarket(parseMarketSelection(market) ?? coerceMarketSelection(market));
  return operatingProfitLabel({
    ebit,
    revenue,
    market: resolved,
    financials,
  });
}

export function clientListRunwayText(weeks: number | string | null, reason: string | null): string {
  return clientListRunwayCell({ weeks, reason }).value;
}

/** First paint. Figures stay empty until the books merge. */
export function lightClientRow(c: PracticeClient): PracticeClientRow {
  return {
    ...c,
    financials: c.financials ?? null,
    score: null,
    health: UNSCORED_HEALTH,
    trendDelta: null,
    scoreSeries: [],
    chaseActions: [],
    runwayWeeks: storedFiniteNumber(c.cash_runway_weeks),
    runwayLabel: null,
    openQueries: null,
    openActions: 0,
    overdueActions: 0,
    revenue: null,
  };
}

/** One book row. A scoring throw still leaves the client on the list. */
export function toClientRow(
  c: PracticeClient,
  history: readonly StoredScorePoint[],
  openActions: number,
  overdueActions: number,
  openQueries: number | null,
  chaseActions: { title: string; overdue: boolean }[] = [],
): PracticeClientRow {
  try {
    const clientMarket = resolveMarket(
      parseMarketSelection(c.market) ?? coerceMarketSelection(c.market),
    );
    const assessed = assessClientMetrics({
      financials: c.financials,
      cashflow: c.cashflow,
      financialsUpdatedAt: c.financials_updated_at ?? null,
      timeZone: clientMarket.timezone,
    });
    const forecastWeeks =
      assessed.runway.kind === "weeks" || assessed.runway.kind === "zero"
        ? assessed.runway.weeks
        : null;
    const runwayWeeks = listRunwayWeeks(forecastWeeks, c.cash_runway_weeks);
    const outlook = assessed.outlook;
    const fyStartMonth =
      parseOperatingProfile(c.operating_profile)?.fyStartMonth ?? clientMarket.fyStartMonthDefault;
    const openingMissing = storedOpeningIsMissing(c.cashflow);
    const scored = liveHealthFromBooks({
      financials: c.financials,
      cashflow: c.cashflow,
      financialsUpdatedAt: c.financials_updated_at ?? null,
      fyStartMonth,
      market: clientMarket,
      industry: clientIndustryDisplay(c.name, parseOperatingProfile(c.operating_profile)),
      timeZone: clientMarket.timezone,
    });
    const statusWord = clientListStatusWord({
      healthLabel: scored.displayLabel,
      healthOverall: scored.overall,
      source: outlook.source,
      opening: outlook.opening,
      floor: outlook.floor,
      dipsBelowFloorWeek: outlook.dipsBelowFloorWeek,
      totalInflow: outlook.totalInflow,
      totalOutflow: outlook.totalOutflow,
      openingMissing,
    });
    const health = statusWord.startsWith("Critical")
      ? { ...scored, displayStatus: "critical" as const, displayLabel: statusWord }
      : statusWord.startsWith("Needs data")
        ? { ...scored, displayStatus: "at_risk" as const, displayLabel: statusWord }
        : scored;
    const runwayLabel = clientListRunwayHeadline({
      source: outlook.source,
      opening: outlook.opening,
      closings: outlook.closing,
      floor: outlook.floor,
      totalInflow: outlook.totalInflow,
      totalOutflow: outlook.totalOutflow,
      runwayLabel: runwayDisplayLabel(assessed.runway),
      cashGenerative:
        assessed.runway.kind === "cash_generative" &&
        forecastIsCashGenerative(outlook.totalInflow, outlook.totalOutflow),
      healthOverall: scored.overall,
      openingMissing,
    });
    const historyScores = scoredHistory(history);
    return {
      ...c,
      score: health.overall ?? latestStoredScore(history),
      health,
      trendDelta: trendDelta30d(historyScores, health.overall),
      scoreSeries: historyScores.map((point) => point.score),
      chaseActions,
      runwayWeeks,
      runwayLabel,
      openQueries,
      openActions,
      overdueActions,
      revenue: revenueOf(c.financials),
    };
  } catch (err) {
    console.error("client row:", c.id, err);
    return {
      ...c,
      score: null,
      health: UNSCORED_HEALTH,
      trendDelta: null,
      scoreSeries: [],
      chaseActions,
      runwayWeeks: null,
      runwayLabel: null,
      openQueries,
      openActions,
      overdueActions,
      revenue: null,
    };
  }
}
