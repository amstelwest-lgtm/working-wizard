import { isDraftComplete, parseMarketSelection } from "@/lib/market/parse";
import type { DraftMarket } from "@/lib/market/types";

export type RegionFormGate =
  | { status: "loading" }
  | { status: "ready"; draft: DraftMarket; unset: boolean };

/**
 * The settings region form. Until the saved row has loaded there is no
 * country to paint, so a visitor or marketing default cannot appear. A loaded
 * row that does not parse leaves both countries unselected. Dates still use
 * the South African presentation fallback until a choice is saved.
 */
export function regionFormFromSaved(input: { loaded: boolean; saved: unknown }): RegionFormGate {
  if (!input.loaded) return { status: "loading" };
  const parsed = parseMarketSelection(input.saved);
  if (!parsed) {
    return {
      status: "ready",
      unset: true,
      draft: { country: null, regionCode: null },
    };
  }
  return {
    status: "ready",
    unset: false,
    draft: { country: parsed.country, regionCode: parsed.regionCode },
  };
}

/** Save stays off until the saved region loaded and the draft is a real selection. */
export function regionSaveAllowed(input: {
  loaded: boolean;
  recordId: string | null;
  draft: DraftMarket | null;
}): boolean {
  if (!input.loaded || !input.recordId || !input.draft) return false;
  return isDraftComplete(input.draft);
}
