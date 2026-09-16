/**
 * Logged-out marketing + legal copy pack. Driven by visitor MarketSelection
 * (URL / localStorage), never by the authenticated workspace.
 */

import { MARKET_STORAGE_KEY, type DraftMarket } from "./types";

export type VisitorCopyPack = "za" | "us";

/** Published list prices. Owner Spark is free. Firm bands are USD catalog amounts. */
export const LIST_PRICES = {
  za: {
    orbit: "R699",
    constellation: "R1 299",
    firmStarter: "Free",
    firmSolo: "$99",
    firmSmall: "$149",
    firmGrowing: "$249",
    firmEstablished: "$349",
    firmLarger: "$499",
    firmAdvanced: "$649",
    firmScale: "$999",
    retainerUplift: "R1 200+",
  },
  us: {
    orbit: "$39",
    constellation: "$75",
    firmStarter: "Free",
    firmSolo: "$99",
    firmSmall: "$149",
    firmGrowing: "$249",
    firmEstablished: "$349",
    firmLarger: "$499",
    firmAdvanced: "$649",
    firmScale: "$999",
    retainerUplift: "$70+",
  },
} as const;

export function visitorCopyPack(
  draft: Pick<DraftMarket, "country"> | null | undefined,
): VisitorCopyPack {
  return draft?.country === "ZA" ? "za" : "us";
}

export function applyVisitorMarketToDocument(draft: DraftMarket | null | undefined): void {
  if (typeof document === "undefined") return;
  const za = draft?.country === "ZA";
  document.documentElement.dataset.market = za ? "za" : "us";
  document.body.classList.toggle("market-us", !za);
}

/**
 * Runs in <head> before paint. Unset visitors get US copy (primary market).
 * ZA is opt-in via ?market=ZA or the footer switch. Never geo-redirects.
 * Keep in sync with MARKET_STORAGE_KEY and URL ?market=&state=.
 */
export const VISITOR_MARKET_BOOT_SCRIPT = `(function(){try{var d=document.documentElement;var m=null;try{var p=new URLSearchParams(location.search);var c=(p.get("market")||"").toUpperCase();if(c==="US"||c==="ZA")m=c;}catch(e){}if(!m){try{var raw=localStorage.getItem("${MARKET_STORAGE_KEY}");if(raw){var j=JSON.parse(raw);if(j&&(j.country==="US"||j.country==="ZA"))m=j.country;}}catch(e){}}if(m==="ZA"){d.dataset.market="za";}else{d.dataset.market="us";}}catch(e){}})();`;
