/**
 * Read-only figures for the public sample chips.
 * Same sample business as the trial board. A stored forecast dated before
 * this week keeps its opening cash and notes the gap — no client row, no ledger.
 */
import {
  forecastMinimumCash,
  resolveThirteenWeekForecast,
  rollForwardForecast,
} from "@/lib/client-metrics";
import { cashBalanceSeries, lowestCashPoint } from "@/lib/cash-forecast-view";
import { resolveMarket } from "@/lib/market/resolve";
import type { MarketId, UsStateCode } from "@/lib/market/types";
import { sampleFinancialsFor } from "@/lib/sample-business";
import { derivePeriodWaterfallFallback, type WaterfallFallback } from "@/lib/weekly-inputs";

/**
 * Shown with the cash chart, the Financial Manager, and the findings.
 * The opening is the sample bank balance, so this line is true.
 */
export const TRIAL_CASH_OPENING_LINE = "Opening cash stays the balance on file.";

/** Display state so a US sample formats as dollars. Tax is not shown on these chips. */
export const TRIAL_US_STATE: UsStateCode = "NY";

export function trialMarketSelection(market: MarketId): {
  country: MarketId;
  regionCode: UsStateCode | null;
} {
  if (market === "ZA") return { country: "ZA", regionCode: null };
  return { country: "US", regionCode: TRIAL_US_STATE };
}

export function trialWaterfallFallback(market: MarketId): WaterfallFallback {
  return derivePeriodWaterfallFallback(sampleFinancialsFor(market));
}

type PreviewLine = {
  id: string;
  name: string;
  amount: string;
  frequency: "recurring-weekly" | "recurring-monthly" | "once-off" | "split-weeks" | "split-months";
  startWeek: number;
  splitCount: number;
};

export type TrialCashPreview = {
  startDate: string;
  openingBalance: string;
  revenue: PreviewLine[];
  expenses: PreviewLine[];
  other: PreviewLine[];
  note: string | null;
  cycleNote: string | null;
  financials: Record<string, string>;
};

/**
 * Cash left after debtors and stock on the sample balance sheet.
 * That is the SAMPLE opening bank balance. It is not written onto
 * `financials.cash`, so the health score stays on the ratios alone.
 */
export function sampleOpeningCash(market: MarketId): number {
  const financials = sampleFinancialsFor(market);
  const cash =
    Number(financials.currentAssets) -
    Number(financials.receivables) -
    Number(financials.inventory);
  if (!Number.isFinite(cash)) return 0;
  return Math.max(0, Math.round(cash));
}

export type TrialCashSeries = {
  preview: TrialCashPreview;
  opening: number;
  closing: number[];
  weekDates: string[];
  low: number;
  floor: number;
};

/**
 * One 13-week series for the public sample.
 * The chart plots `preview`. Findings quote `low` from that same line,
 * opening included, so the two cannot disagree.
 */
export function trialCashSeries(market: MarketId, now = new Date()): TrialCashSeries {
  const financials = sampleFinancialsFor(market);
  const timeZone = resolveMarket(trialMarketSelection(market)).timezone;
  const openingCash = sampleOpeningCash(market);
  const derived = resolveThirteenWeekForecast({
    financials,
    openingCash,
    now,
    timeZone,
  });
  const preview: TrialCashPreview = {
    startDate: derived.startDate,
    openingBalance: String(openingCash),
    revenue: derived.lines.revenue,
    expenses: derived.lines.expenses,
    other: [],
    note: null,
    cycleNote: derived.cycleNote,
    financials,
  };
  const rolled = rollForwardForecast(
    {
      openingBalance: preview.openingBalance,
      revenue: preview.revenue,
      expenses: preview.expenses,
      other: preview.other,
    },
    13,
  );
  const opening = rolled?.opening ?? openingCash;
  const closing = rolled?.closing ?? derived.closing;
  const outflow = rolled?.outflow ?? derived.outflow;
  const floor = forecastMinimumCash({ weeklyOutflows: outflow });
  const low = lowestCashPoint(
    cashBalanceSeries({ opening, closings: closing, floor }),
  ).balance;
  return { preview, opening, closing, weekDates: derived.weekDates, low, floor };
}

/** Client-shaped cash row from the sample P&L, opening at the sample bank balance. */
export function trialCashPreview(market: MarketId, now = new Date()): TrialCashPreview {
  return trialCashSeries(market, now).preview;
}
