/**
 * Money printed into prompts and agent context.
 *
 * The stored firm country decides the format. "ZA" (any case, trimmed) is
 * rand. Null, a missing country, and every other country are US dollars.
 * Dates and the copy pack may still fall back to South Africa; this module
 * does not.
 *
 * Printed rand is `R` plus U+0020 SPACE, then digits grouped with U+0020.
 * en-ZA's Intl group separator is a no-break space (U+00A0); formatMoney
 * turns that, and U+202F, into U+0020. A no-break space collapses to "R0"
 * in PDF text extraction, so the gap is a normal space, not U+00A0 or U+202F.
 * Cents, when shown, follow a comma: `R 187 444,50`.
 * The letters ZAR are never printed. US amounts stay `$187,444`.
 */
import { formatMoney, type MoneyMarket } from "./market/format.ts";
import { ZA_MARKET } from "./market/resolve.ts";
import { resolveFirmMarket } from "./pricing/market-resolution.ts";

export type PromptMoneyPack = "za" | "us";

// Currency comes from ZA_MARKET so this file does not add a contiguous
// currency-code literal to the client bundle. formatMoney prints R, not that code.
const ZA_MONEY: MoneyMarket = { currency: ZA_MARKET.currency, locale: ZA_MARKET.locale };
const US_MONEY: MoneyMarket = { currency: "USD", locale: "en-US" };

export function storedFirmIsZa(raw: unknown): boolean {
  return resolveFirmMarket(raw) === "za";
}

export function promptMoneyMarket(raw: unknown): MoneyMarket {
  return storedFirmIsZa(raw) ? ZA_MONEY : US_MONEY;
}

export function promptMoneyPack(raw: unknown): PromptMoneyPack {
  return storedFirmIsZa(raw) ? "za" : "us";
}

export function formatPromptMoney(
  n: number,
  marketOrPack: unknown,
  opts?: { maximumFractionDigits?: number; minimumFractionDigits?: number },
): string {
  const market = marketOrPack === "za" ? ZA_MONEY : marketOrPack === "us" ? US_MONEY : promptMoneyMarket(marketOrPack);
  return formatMoney(n, market, opts);
}

/** One sentence. Included only when the stored firm country is ZA. */
export const ZA_PROMPT_MONEY_LINE =
  "Write amounts as R 187 444: a space after R, a space as the thousands separator, and a comma before any cents.";

export function zaPromptMoneyLine(stored: unknown): string {
  return storedFirmIsZa(stored) ? `\n${ZA_PROMPT_MONEY_LINE}` : "";
}
