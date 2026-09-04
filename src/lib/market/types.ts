/**
 * Market selection — ZA vs US (+ US state). Currency, locale, FY default,
 * and tax regime are derived from this pair, never chosen independently
 * on first run.
 */

export type MarketId = "ZA" | "US";

export const US_STATE_CODES = [
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "DC",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
] as const;

export type UsStateCode = (typeof US_STATE_CODES)[number];

export type MarketSelection = {
  country: MarketId;
  /** Required when country === "US". Always null for ZA. */
  regionCode: UsStateCode | null;
};

export type IndirectTaxProfile =
  | {
      regime: "vat";
      vatRate: number;
      vatMode: "exclusive" | "inclusive";
    }
  | {
      regime: "sales_tax";
      stateCode: UsStateCode;
      collects: boolean;
      stateRate: number;
      localRate: number;
      combinedRate: number;
      remittance: "monthly" | "quarterly" | "none";
    }
  | { regime: "none" };

export type ResolvedMarket = {
  country: MarketId;
  regionCode: UsStateCode | null;
  currency: "ZAR" | "USD";
  locale: "en-ZA" | "en-US";
  timezone: string;
  fyStartMonthDefault: 1 | 3;
  copyPack: "za" | "us";
  tax: IndirectTaxProfile;
};

export type MarketTaxOverrides = {
  /** US: owner says they do not collect sales tax. */
  collects?: boolean;
  /** US: extra local rate on top of the state rate (fraction, e.g. 0.02). */
  localRate?: number;
  /** ZA: override the 15% default. */
  vatRate?: number;
  vatMode?: "exclusive" | "inclusive";
};

export const ZA_SELECTION: MarketSelection = { country: "ZA", regionCode: null };

/** In-progress landing / settings pick — US may not have a state yet. */
export type DraftMarket = {
  country: MarketId | null;
  regionCode: UsStateCode | null;
};

export const MARKET_STORAGE_KEY = "milon.market.v1";
