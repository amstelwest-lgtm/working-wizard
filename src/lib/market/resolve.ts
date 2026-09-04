import { ZA_VAT_RATE } from "./defaults";
import { assertMarketSelection } from "./parse";
import type {
  IndirectTaxProfile,
  MarketSelection,
  MarketTaxOverrides,
  ResolvedMarket,
} from "./types";
import { usState } from "./us-states";

export { ZA_VAT_RATE };

const ZA_TAX: IndirectTaxProfile = {
  regime: "vat",
  vatRate: ZA_VAT_RATE,
  vatMode: "exclusive",
};

function zaMarket(overrides?: MarketTaxOverrides): ResolvedMarket {
  const vatRate =
    overrides?.vatRate != null && overrides.vatRate >= 0 ? overrides.vatRate : ZA_VAT_RATE;
  return {
    country: "ZA",
    regionCode: null,
    currency: "ZAR",
    locale: "en-ZA",
    timezone: "Africa/Johannesburg",
    fyStartMonthDefault: 3,
    copyPack: "za",
    tax: {
      regime: "vat",
      vatRate: vatRate > 0 ? vatRate : ZA_VAT_RATE,
      vatMode: overrides?.vatMode ?? "exclusive",
    },
  };
}

function usTax(
  stateCode: NonNullable<MarketSelection["regionCode"]>,
  overrides?: MarketTaxOverrides,
): IndirectTaxProfile {
  const row = usState(stateCode);
  const localRate =
    overrides?.localRate != null && Number.isFinite(overrides.localRate)
      ? Math.max(0, overrides.localRate)
      : row.avgLocalRate;
  const combinedRate = Math.round((row.stateRate + localRate) * 10000) / 10000;
  const collects = overrides?.collects ?? combinedRate > 0;
  if (!collects || combinedRate <= 0) {
    return { regime: "none" };
  }
  return {
    regime: "sales_tax",
    stateCode,
    collects: true,
    stateRate: row.stateRate,
    localRate,
    combinedRate,
    remittance: row.remittance === "none" ? "monthly" : row.remittance,
  };
}

/**
 * Derive currency, locale, FY default, and tax from region + (US) state.
 * Throws if US is missing a state or ZA is given a state.
 */
export function resolveMarket(
  selection: MarketSelection,
  overrides?: MarketTaxOverrides,
): ResolvedMarket {
  const sel = assertMarketSelection(selection);
  if (sel.country === "ZA") return zaMarket(overrides);
  const row = usState(sel.regionCode!);
  return {
    country: "US",
    regionCode: sel.regionCode,
    currency: "USD",
    locale: "en-US",
    timezone: row.timezone,
    fyStartMonthDefault: 1,
    copyPack: "us",
    tax: usTax(sel.regionCode!, overrides),
  };
}

export const ZA_MARKET: ResolvedMarket = zaMarket();

export { ZA_TAX };
