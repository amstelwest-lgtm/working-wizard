/**
 * US state sales-tax snapshot used as the budget default after the user
 * picks a state. Rates are general combined rates (state + statewide average
 * local), stored as fractions (0.082 = 8.2%).
 *
 * Source vintage: Tax Foundation, State and Local Sales Tax Rates, mid-year 2025.
 * Refresh this file when those published combined rates move. This is not a
 * live tax API and does not model destination tax, nexus, or exemptions.
 */

import { US_STATE_CODES, type UsStateCode } from "./types";

export type UsSourcing = "origin" | "destination" | "mixed";

export type UsStateRow = {
  code: UsStateCode;
  name: string;
  timezone: string;
  /** Statewide general sales tax. False for DE/MT/NH/OR. AK has local only. */
  hasStateSalesTax: boolean;
  stateRate: number;
  avgLocalRate: number;
  combinedRate: number;
  remittance: "monthly" | "quarterly" | "none";
  sourcing: UsSourcing;
};

const S = (
  code: UsStateCode,
  name: string,
  timezone: string,
  stateRate: number,
  avgLocalRate: number,
  remittance: UsStateRow["remittance"],
  sourcing: UsSourcing,
  hasStateSalesTax = stateRate > 0,
): UsStateRow => ({
  code,
  name,
  timezone,
  hasStateSalesTax,
  stateRate,
  avgLocalRate,
  combinedRate: Math.round((stateRate + avgLocalRate) * 10000) / 10000,
  remittance,
  sourcing,
});

/**
 * Combined rates rounded to 2 decimal places of a percent (4 decimal fraction).
 * AK: no state rate; some localities levy — default local 0, owner can enter.
 */
export const US_STATES: readonly UsStateRow[] = [
  S("AL", "Alabama", "America/Chicago", 0.04, 0.0524, "monthly", "destination"),
  S("AK", "Alaska", "America/Anchorage", 0, 0, "none", "destination", false),
  S("AZ", "Arizona", "America/Phoenix", 0.056, 0.0277, "monthly", "origin"),
  S("AR", "Arkansas", "America/Chicago", 0.065, 0.0297, "monthly", "destination"),
  S("CA", "California", "America/Los_Angeles", 0.0725, 0.0157, "quarterly", "destination"),
  S("CO", "Colorado", "America/Denver", 0.029, 0.0487, "monthly", "destination"),
  S("CT", "Connecticut", "America/New_York", 0.0635, 0, "quarterly", "origin"),
  S("DE", "Delaware", "America/New_York", 0, 0, "none", "destination", false),
  S("DC", "District of Columbia", "America/New_York", 0.06, 0, "monthly", "destination"),
  S("FL", "Florida", "America/New_York", 0.06, 0.0105, "monthly", "destination"),
  S("GA", "Georgia", "America/New_York", 0.04, 0.034, "monthly", "destination"),
  S("HI", "Hawaii", "Pacific/Honolulu", 0.04, 0.005, "monthly", "origin"),
  S("ID", "Idaho", "America/Boise", 0.06, 0.0003, "monthly", "destination"),
  S("IL", "Illinois", "America/Chicago", 0.0625, 0.0261, "monthly", "origin"),
  S("IN", "Indiana", "America/Indiana/Indianapolis", 0.07, 0, "monthly", "destination"),
  S("IA", "Iowa", "America/Chicago", 0.06, 0.0094, "monthly", "destination"),
  S("KS", "Kansas", "America/Chicago", 0.065, 0.0226, "monthly", "origin"),
  S("KY", "Kentucky", "America/New_York", 0.06, 0, "monthly", "origin"),
  S("LA", "Louisiana", "America/Chicago", 0.0445, 0.051, "monthly", "destination"),
  S("ME", "Maine", "America/New_York", 0.055, 0, "monthly", "origin"),
  S("MD", "Maryland", "America/New_York", 0.06, 0, "monthly", "origin"),
  S("MA", "Massachusetts", "America/New_York", 0.0625, 0, "monthly", "origin"),
  S("MI", "Michigan", "America/Detroit", 0.06, 0, "monthly", "origin"),
  S("MN", "Minnesota", "America/Chicago", 0.06875, 0.0061, "monthly", "destination"),
  S("MS", "Mississippi", "America/Chicago", 0.07, 0.0007, "monthly", "origin"),
  S("MO", "Missouri", "America/Chicago", 0.04225, 0.0406, "monthly", "origin"),
  S("MT", "Montana", "America/Denver", 0, 0, "none", "destination", false),
  S("NE", "Nebraska", "America/Chicago", 0.055, 0.0147, "monthly", "destination"),
  S("NV", "Nevada", "America/Los_Angeles", 0.0685, 0.0138, "monthly", "origin"),
  S("NH", "New Hampshire", "America/New_York", 0, 0, "none", "destination", false),
  S("NJ", "New Jersey", "America/New_York", 0.06625, 0, "quarterly", "destination"),
  S("NM", "New Mexico", "America/Denver", 0.04875, 0.0271, "monthly", "origin"),
  S("NY", "New York", "America/New_York", 0.04, 0.0453, "quarterly", "destination"),
  S("NC", "North Carolina", "America/New_York", 0.0475, 0.0225, "monthly", "destination"),
  S("ND", "North Dakota", "America/Chicago", 0.05, 0.0196, "monthly", "destination"),
  S("OH", "Ohio", "America/New_York", 0.0575, 0.0149, "monthly", "origin"),
  S("OK", "Oklahoma", "America/Chicago", 0.045, 0.0449, "monthly", "destination"),
  S("OR", "Oregon", "America/Los_Angeles", 0, 0, "none", "destination", false),
  S("PA", "Pennsylvania", "America/New_York", 0.06, 0.0034, "quarterly", "origin"),
  S("RI", "Rhode Island", "America/New_York", 0.07, 0, "monthly", "origin"),
  S("SC", "South Carolina", "America/New_York", 0.06, 0.015, "monthly", "destination"),
  S("SD", "South Dakota", "America/Chicago", 0.042, 0.019, "monthly", "destination"),
  S("TN", "Tennessee", "America/Chicago", 0.07, 0.0255, "monthly", "origin"),
  S("TX", "Texas", "America/Chicago", 0.0625, 0.0195, "monthly", "origin"),
  S("UT", "Utah", "America/Denver", 0.061, 0.0109, "monthly", "origin"),
  S("VT", "Vermont", "America/New_York", 0.06, 0.0024, "monthly", "destination"),
  S("VA", "Virginia", "America/New_York", 0.053, 0.0047, "monthly", "origin"),
  S("WA", "Washington", "America/Los_Angeles", 0.065, 0.0279, "monthly", "destination"),
  S("WV", "West Virginia", "America/New_York", 0.06, 0.0043, "monthly", "destination"),
  S("WI", "Wisconsin", "America/Chicago", 0.05, 0.0044, "monthly", "destination"),
  S("WY", "Wyoming", "America/Denver", 0.04, 0.0136, "monthly", "destination"),
];

export const US_STATE_BY_CODE: Record<UsStateCode, UsStateRow> = Object.fromEntries(
  US_STATES.map((row) => [row.code, row]),
) as Record<UsStateCode, UsStateRow>;

const CODE_SET = new Set<string>(US_STATE_CODES);

export function isUsStateCode(raw: unknown): raw is UsStateCode {
  return typeof raw === "string" && CODE_SET.has(raw);
}

export function usState(code: UsStateCode): UsStateRow {
  return US_STATE_BY_CODE[code];
}

export const NO_STATE_SALES_TAX: ReadonlySet<UsStateCode> = new Set(
  US_STATES.filter((s) => !s.hasStateSalesTax && s.combinedRate === 0).map((s) => s.code),
);
