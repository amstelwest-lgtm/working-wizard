/**
 * /auth query. `signup=true`, `mode=signup`, or a plan opens Create firm.
 * A ZA or US `market` hint is kept. `country` is not a search key.
 */
import {
  isFirmCheckoutBand,
  isFirmInterval,
  type FirmCheckoutBand,
  type FirmInterval,
} from "./stripe-plans.ts";

export type AuthPageSearch = {
  next?: string;
  signup?: boolean;
  plan?: FirmCheckoutBand;
  interval?: FirmInterval;
  /** Visitor hint from the landing dropdown. ZA or US only. Not a country override. */
  market?: "ZA" | "US";
};

export function parseAuthSearch(search: Record<string, unknown>): AuthPageSearch {
  const next =
    typeof search.next === "string" && search.next.startsWith("/") ? search.next : undefined;
  const plan =
    typeof search.plan === "string" && isFirmCheckoutBand(search.plan) ? search.plan : undefined;
  const interval =
    typeof search.interval === "string" && isFirmInterval(search.interval)
      ? search.interval
      : undefined;
  const modeSignup = typeof search.mode === "string" && search.mode.trim() === "signup";
  const signupFlag =
    search.signup === true ||
    search.signup === "1" ||
    search.signup === "true" ||
    plan != null ||
    modeSignup;
  const marketRaw = typeof search.market === "string" ? search.market.trim().toUpperCase() : "";
  const market = marketRaw === "ZA" || marketRaw === "US" ? marketRaw : undefined;
  return {
    ...(next ? { next } : {}),
    ...(signupFlag ? { signup: true } : {}),
    ...(plan ? { plan } : {}),
    ...(interval ? { interval } : {}),
    ...(market ? { market } : {}),
  };
}
