/**
 * Logged-out marketing + legal copy pack. Driven by visitor MarketSelection
 * (URL / localStorage), never by the authenticated workspace.
 */

import type { DraftMarket } from "./types";

export type VisitorCopyPack = "za" | "us";

/** Published list prices. Owner Spark is free. Firm bands are USD catalog amounts. */
export const LIST_PRICES = {
  za: {
    orbit: "R699",
    constellation: "R1 299",
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
 * Runs in <head> before paint. The server bakes the pack. This script does
 * not read ?market= or localStorage — a stored ZA market must not repaint
 * a non-ZA visitor. Never geo-redirects.
 */
export const VISITOR_MARKET_BOOT_SCRIPT = `(function(){try{var d=document.documentElement;d.dataset.market="us";}catch(e){}})();`;

export function visitorMarketBootScript(pack: VisitorCopyPack | null | undefined): string {
  if (pack !== "za") return VISITOR_MARKET_BOOT_SCRIPT;
  return `(function(){try{var d=document.documentElement;d.dataset.market="za";}catch(e){}})();`;
}
