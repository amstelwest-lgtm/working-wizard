/**
 * Owner Profit tab and cash forecast, read-only, on the public sample.
 * Loaded only after a chip opens so the /try entry does not pull these modules.
 */
import { CashForecastPanel } from "@/components/cash-forecast";
import { ProfitabilityWaterfall, ProfitLead } from "@/components/profitability-waterfall";
import { MarketProvider } from "@/contexts/market";
import {
  TRIAL_CASH_OPENING_LINE,
  trialCashPreview,
  trialMarketSelection,
  trialWaterfallFallback,
} from "@/lib/trial-sample-view";
import type { MarketId } from "@/lib/market/types";

export function TrySampleBoards({
  market,
  profit,
  cash,
  now,
}: {
  market: MarketId;
  profit?: boolean;
  cash?: boolean;
  now?: Date;
}) {
  const selection = trialMarketSelection(market);
  const preview = cash ? trialCashPreview(market, now) : null;
  return (
    <MarketProvider selection={selection}>
      <div className="try-readout owner-door" data-try-readout>
        {profit ? (
          <div data-try-chip="profit">
            <ProfitLead />
            <ProfitabilityWaterfall
              appearance="premium"
              negative="minus"
              hideCardExport
              fallback={trialWaterfallFallback(market)}
            />
          </div>
        ) : null}
        {cash && preview ? (
          <div data-try-chip="cash">
            <p className="try-cash-note" data-try-cash-note>
              {TRIAL_CASH_OPENING_LINE}
            </p>
            <CashForecastPanel
              simplified
              readOnly
              hideReadOnlyStamp
              includeFloorInDomain
              spacedChartTicks
              preview={preview}
            />
          </div>
        ) : null}
      </div>
    </MarketProvider>
  );
}
