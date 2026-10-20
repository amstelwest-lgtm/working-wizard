import { parseMarketSelection } from "./market/parse.ts";
import type { DraftMarket, MarketSelection } from "./market/types.ts";

const GOOGLE_PRACTICE_GATE_KEY = "milon.google.practice-gate";

/** Survives a refresh while the practice location picker is open. Scoped to the user. */
export type StashedGooglePracticeGate = {
  userId: string;
  firmName: string;
  fullName: string;
  next: string | null;
  joinToken: string | null;
};

export function stashGooglePracticeGate(gate: StashedGooglePracticeGate): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(GOOGLE_PRACTICE_GATE_KEY, JSON.stringify(gate));
  } catch {
    /* private mode */
  }
}

export function readGooglePracticeGate(userId: string): StashedGooglePracticeGate | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(GOOGLE_PRACTICE_GATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StashedGooglePracticeGate>;
    if (!parsed || parsed.userId !== userId) {
      if (parsed?.userId && parsed.userId !== userId) clearGooglePracticeGate();
      return null;
    }
    return {
      userId,
      firmName: typeof parsed.firmName === "string" ? parsed.firmName : "",
      fullName: typeof parsed.fullName === "string" ? parsed.fullName : "",
      next: typeof parsed.next === "string" ? parsed.next : null,
      joinToken: typeof parsed.joinToken === "string" ? parsed.joinToken : null,
    };
  } catch {
    return null;
  }
}

export function clearGooglePracticeGate(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(GOOGLE_PRACTICE_GATE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Market stored on a firm created from Google sign-in.
 * A complete draft or visitor pick wins. A known South Africa edge can be
 * stored on its own. A United States edge still needs a state, and any other
 * country is not a practice market. Never invent South Africa.
 */
export function googlePracticeFirmMarket(input: {
  draftCountry?: string | null;
  draftRegion?: string | null;
  visitor: MarketSelection | null;
  geoCountry?: string | null;
}): MarketSelection | null {
  const fromDraft = input.draftCountry
    ? parseMarketSelection({
        country: input.draftCountry,
        regionCode: input.draftRegion ?? null,
      })
    : null;
  if (fromDraft) return fromDraft;
  if (input.visitor) return input.visitor;
  const geo = (input.geoCountry ?? "").trim().toUpperCase();
  if (geo === "ZA") return { country: "ZA", regionCode: null };
  return null;
}

/** Picker seed when the firm cannot be created yet. Does not default to South Africa. */
export function googlePracticePickerDraft(input: {
  visitorDraft: DraftMarket;
  geoCountry?: string | null;
}): DraftMarket {
  if (input.visitorDraft.country === "ZA") return { country: "ZA", regionCode: null };
  if (input.visitorDraft.country === "US") {
    return { country: "US", regionCode: input.visitorDraft.regionCode };
  }
  const geo = (input.geoCountry ?? "").trim().toUpperCase();
  if (geo === "US") return { country: "US", regionCode: null };
  if (geo === "ZA") return { country: "ZA", regionCode: null };
  return { country: null, regionCode: null };
}
