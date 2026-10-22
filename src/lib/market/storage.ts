import { MARKET_STORAGE_KEY, type DraftMarket, type MarketSelection } from "./types";
import { draftToSelection, parseDraftMarket } from "./parse";

function draftFromSearch(search: string): DraftMarket {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const countryRaw = params.get("market")?.toUpperCase();
  const country = countryRaw === "US" || countryRaw === "ZA" ? countryRaw : null;
  const state = params.get("state")?.toUpperCase() ?? null;
  return parseDraftMarket({ country, regionCode: state });
}

/**
 * URL `?market=` is a choice on this visit. localStorage is a previous visit.
 * Callers that price a page must pass `fromThisVisit` into resolveVisitorDraft.
 */
export function readVisitorChoice(): { draft: DraftMarket; fromThisVisit: boolean } {
  const empty = { country: null, regionCode: null } as const;
  if (typeof window === "undefined") return { draft: { ...empty }, fromThisVisit: false };
  try {
    const fromUrl = draftFromSearch(window.location.search);
    if (fromUrl.country) return { draft: fromUrl, fromThisVisit: true };
    const raw = window.localStorage.getItem(MARKET_STORAGE_KEY);
    if (raw) return { draft: parseDraftMarket(JSON.parse(raw)), fromThisVisit: false };
  } catch {
    /* ignore */
  }
  return { draft: { ...empty }, fromThisVisit: false };
}

export function readVisitorDraft(): DraftMarket {
  return readVisitorChoice().draft;
}

export function writeVisitorDraft(draft: DraftMarket): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MARKET_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    /* ignore */
  }
}

export function readVisitorMarket(): MarketSelection | null {
  return draftToSelection(readVisitorDraft());
}

export function writeVisitorMarket(sel: MarketSelection): void {
  writeVisitorDraft({ country: sel.country, regionCode: sel.regionCode });
}

export function visitorMarketFromSearch(search: string): DraftMarket {
  return draftFromSearch(search);
}
