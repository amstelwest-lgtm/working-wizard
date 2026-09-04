/**
 * Logged-out marketing + legal copy pack. Driven by visitor MarketSelection
 * (URL / localStorage), never by the authenticated workspace.
 */

import { MARKET_STORAGE_KEY, type DraftMarket } from "./types";

export type VisitorCopyPack = "za" | "us";

/** Published list prices. Spark is free; paid tiers are not billed yet. */
export const LIST_PRICES = {
  za: {
    orbit: "R699",
    constellation: "R1 299",
    firm150: "R4 500",
    firmUnlimited: "R7 200",
    retainerUplift: "R1 200+",
  },
  us: {
    orbit: "$39",
    constellation: "$75",
    firm150: "$249",
    firmUnlimited: "$399",
    retainerUplift: "$70+",
  },
} as const;

export function visitorCopyPack(
  draft: Pick<DraftMarket, "country"> | null | undefined,
): VisitorCopyPack {
  return draft?.country === "US" ? "us" : "za";
}

export function applyVisitorMarketToDocument(draft: DraftMarket | null | undefined): void {
  if (typeof document === "undefined") return;
  const us = draft?.country === "US";
  document.documentElement.dataset.market = us ? "us" : draft?.country === "ZA" ? "za" : "";
  document.body.classList.toggle("market-us", us);
}

/**
 * Runs in <head> before paint so a returning US visitor does not flash ZA copy.
 * Keep in sync with MARKET_STORAGE_KEY and URL ?market=&state=.
 */
export const VISITOR_MARKET_BOOT_SCRIPT = `(function(){try{var d=document.documentElement;var m=null;try{var p=new URLSearchParams(location.search);var c=(p.get("market")||"").toUpperCase();if(c==="US"||c==="ZA")m=c;}catch(e){}if(!m){try{var raw=localStorage.getItem("${MARKET_STORAGE_KEY}");if(raw){var j=JSON.parse(raw);if(j&&(j.country==="US"||j.country==="ZA"))m=j.country;}}catch(e){}}if(m==="US"){d.dataset.market="us";}else if(m==="ZA"){d.dataset.market="za";}}catch(e){}})();`;
