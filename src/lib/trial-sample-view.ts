/**
 * Read-only figures for the public sample chips.
 * Same sample business as the trial board. A stored forecast dated before
 * this week is what the cash tab rolls forward — no client row, no ledger.
 */
import { resolveThirteenWeekForecast } from "@/lib/client-metrics";
import { resolveMarket } from "@/lib/market/resolve";
import type { MarketId, UsStateCode } from "@/lib/market/types";
import { sampleFinancialsFor } from "@/lib/sample-business";
import { derivePeriodWaterfallFallback, type WaterfallFallback } from "@/lib/weekly-inputs";

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

function shiftIso(iso: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return iso;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Client-shaped cash row from the sample P&L. Week 1 sits three weeks back
 * so the forecast component rolls opening cash to this week, the same way a
 * stale bank line does inside Milōn.
 */
export function trialCashPreview(market: MarketId, now = new Date()): TrialCashPreview {
  const financials = sampleFinancialsFor(market);
  const timeZone = resolveMarket(trialMarketSelection(market)).timezone;
  const derived = resolveThirteenWeekForecast({
    financials,
    openingCash: null,
    now,
    timeZone,
  });
  const cashflow = {
    startDate: shiftIso(derived.startDate, -21),
    openingBalance: "0",
    revenue: derived.lines.revenue,
    expenses: derived.lines.expenses,
    other: [] as PreviewLine[],
  };
  const outlook = resolveThirteenWeekForecast({
    financials,
    cashflow,
    openingCash: null,
    now,
    timeZone,
  });
  return {
    startDate: outlook.startDate,
    openingBalance: String(Math.round(outlook.opening * 100) / 100),
    revenue: outlook.replaceStored ? outlook.lines.revenue : cashflow.revenue,
    expenses: outlook.replaceStored ? outlook.lines.expenses : cashflow.expenses,
    other: [],
    note: outlook.anchorNote,
    cycleNote: outlook.cycleNote,
    financials,
  };
}
