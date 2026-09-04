import {
  ZA_SELECTION,
  type DraftMarket,
  type MarketId,
  type MarketSelection,
  type UsStateCode,
} from "./types";
import { isUsStateCode } from "./us-states";

export class MarketSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketSelectionError";
  }
}

export function parseMarketSelection(raw: unknown): MarketSelection | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const country = o.country === "US" || o.country === "ZA" ? o.country : null;
  if (!country) return null;
  const regionRaw = o.regionCode;
  const regionCode =
    regionRaw == null || regionRaw === ""
      ? null
      : isUsStateCode(regionRaw)
        ? regionRaw
        : ("invalid" as const);
  if (regionCode === "invalid") return null;
  try {
    return assertMarketSelection({ country, regionCode });
  } catch {
    return null;
  }
}

export function assertMarketSelection(sel: {
  country: MarketId;
  regionCode: UsStateCode | null;
}): MarketSelection {
  if (sel.country === "ZA") {
    if (sel.regionCode != null) {
      throw new MarketSelectionError("South Africa does not take a US state.");
    }
    return { country: "ZA", regionCode: null };
  }
  if (sel.regionCode == null) {
    throw new MarketSelectionError("A US workspace needs a state so sales tax can be set.");
  }
  if (!isUsStateCode(sel.regionCode)) {
    throw new MarketSelectionError("Unknown US state.");
  }
  return { country: "US", regionCode: sel.regionCode };
}

/** Missing or unreadable rows (legacy production) are South Africa. */
export function coerceMarketSelection(raw: unknown): MarketSelection {
  return parseMarketSelection(raw) ?? ZA_SELECTION;
}

export function marketToJson(sel: MarketSelection): {
  country: MarketId;
  regionCode: UsStateCode | null;
} {
  const valid = assertMarketSelection(sel);
  return { country: valid.country, regionCode: valid.regionCode };
}

export function parseDraftMarket(raw: unknown): DraftMarket {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { country: null, regionCode: null };
  }
  const o = raw as Record<string, unknown>;
  const country = o.country === "US" || o.country === "ZA" ? o.country : null;
  const regionCode = isUsStateCode(o.regionCode) ? o.regionCode : null;
  if (country === "ZA") return { country: "ZA", regionCode: null };
  return { country, regionCode: country === "US" ? regionCode : null };
}

export function draftToSelection(draft: DraftMarket): MarketSelection | null {
  if (draft.country === "ZA") return { country: "ZA", regionCode: null };
  if (draft.country === "US" && draft.regionCode) {
    try {
      return assertMarketSelection({ country: "US", regionCode: draft.regionCode });
    } catch {
      return null;
    }
  }
  return null;
}

export function isDraftComplete(draft: DraftMarket): boolean {
  return draftToSelection(draft) != null;
}
