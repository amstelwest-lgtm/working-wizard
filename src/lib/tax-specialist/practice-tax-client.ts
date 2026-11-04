import { parseOperatingProfile } from "@/lib/client-profile";
import { coerceMarketSelection, parseMarketSelection, resolveMarket } from "@/lib/market";
import type { PracticeClient } from "@/lib/practice-client-row";

export type PracticeTaxPageClient = {
  id: string;
  name: string;
  fyStartMonth: number;
  financials: Record<string, unknown> | null;
  financialsAsOf: string | null;
};

/** True when this client is on the ZA market and can use the Tax Specialist. */
export function clientTaxMarketEnabled(market: unknown): boolean {
  return parseMarketSelection(market)?.country === "ZA";
}

/** Build the tax page client shape from a practice book row. */
export function practiceTaxPageClient(c: PracticeClient): PracticeTaxPageClient {
  const clientMarket = resolveMarket(
    parseMarketSelection(c.market) ?? coerceMarketSelection(c.market),
  );
  const fyStartMonth =
    parseOperatingProfile(c.operating_profile)?.fyStartMonth ?? clientMarket.fyStartMonthDefault;
  return {
    id: c.id,
    name: c.name,
    fyStartMonth,
    financials: (c.financials ?? null) as Record<string, unknown> | null,
    financialsAsOf: c.financials_updated_at ?? null,
  };
}
