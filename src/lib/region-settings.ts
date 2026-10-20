import { isDraftComplete, parseMarketSelection } from "@/lib/market/parse";
import { ZA_SELECTION, type DraftMarket } from "@/lib/market/types";

export type RegionFormGate =
  | { status: "loading" }
  | { status: "ready"; draft: DraftMarket; unset: boolean };

/**
 * The settings region form. Until the saved row has loaded there is no
 * country to paint, so a visitor or marketing default of the United States
 * cannot appear. A loaded row that does not parse is South Africa, and
 * `unset` tells the form to say the stored market was missing.
 */
export function regionFormFromSaved(input: { loaded: boolean; saved: unknown }): RegionFormGate {
  if (!input.loaded) return { status: "loading" };
  const parsed = parseMarketSelection(input.saved);
  const sel = parsed ?? ZA_SELECTION;
  return {
    status: "ready",
    unset: parsed == null,
    draft: { country: sel.country, regionCode: sel.regionCode },
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
