import { formatMoneyCompact, type MoneyMarket } from "./market/format.ts";

/** Statement presentation scale. Actual rands stay 1. Missing scale is not guessed. */
export function statementMoneyScale(financials: Record<string, unknown> | null | undefined): number {
  if (!financials) return 1;
  const units = String(financials.statementUnits ?? financials.units ?? "")
    .trim()
    .toLowerCase();
  if (units === "thousands" || units === "thousand") return 1_000;
  if (units === "millions" || units === "million") return 1_000_000;
  const flagged = financials.values_appear_in_thousands;
  if (flagged === true || flagged === "true" || flagged === "1") return 1_000;
  const notes = String(financials.extraction_notes ?? financials.extractionNotes ?? "");
  if (/\b(in thousands|r['’]?000|figures in 000)\b/i.test(notes)) return 1_000;
  if (/\bin millions\b/i.test(notes)) return 1_000_000;
  return 1;
}

function compactRand(amount: number, market: MoneyMarket): string {
  return formatMoneyCompact(amount, market).replace(/ /g, "\u00a0");
}

/**
 * Practice-table operating profit. Percent is ebit / revenue (scale-invariant).
 * The amount uses the statement scale when the extraction recorded one.
 */
export function operatingProfitLabel(input: {
  ebit: number;
  revenue: number | null;
  market: MoneyMarket;
  financials?: Record<string, unknown> | null;
}): string {
  const scale = statementMoneyScale(input.financials);
  const amount = compactRand(input.ebit * scale, input.market);
  if (input.revenue != null && Number.isFinite(input.revenue) && input.revenue > 0) {
    const pct = ((input.ebit / input.revenue) * 100).toFixed(1);
    return `${pct}%\u00a0·\u00a0${amount}`;
  }
  return amount;
}
