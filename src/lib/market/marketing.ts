/**
 * Logged-out marketing + legal copy pack. Driven by visitor MarketSelection
 * (URL / localStorage), never by the authenticated workspace.
 */

import { firmUsdListPrice, type FirmCheckoutBand } from "@/lib/stripe-plans";
import type { DraftMarket } from "./types";

export type VisitorCopyPack = "za" | "us";

function firmUsd(plan: FirmCheckoutBand): string {
  const price = firmUsdListPrice(plan, "month");
  if (!price) throw new Error(`${plan} has no published monthly price.`);
  return price;
}

/** USD firm amounts from the catalog. Rand ladder stays on the server. */
const FIRM_USD = {
  firmStarter: firmUsd("starter"),
  firmSolo: firmUsd("solo"),
  firmSmall: firmUsd("small"),
  firmGrowing: firmUsd("growing"),
  firmEstablished: firmUsd("established"),
  firmLarger: firmUsd("larger"),
  firmAdvanced: firmUsd("advanced"),
  firmScale: firmUsd("scale"),
};

/** Published list prices. Firm bands follow the USD catalog. */
export const LIST_PRICES = {
  za: {
    orbit: "R699",
    constellation: "R1 299",
    ...FIRM_USD,
    retainerUplift: "R1 200+",
  },
  us: {
    orbit: FIRM_USD.firmStarter,
    constellation: "$75",
    ...FIRM_USD,
    retainerUplift: "$70+",
  },
};

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
