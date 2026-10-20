import { t } from "./market/copy.ts";
import { formatMoneyCompact, type MoneyMarket } from "./market/format.ts";
import type { ResolvedMarket } from "./market/types.ts";

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

/**
 * Annual revenue under this, with no recorded thousands/millions scale, is
 * too small to present as this business's real rands. Woodwork's R1,000 is.
 */
export const IMPLAUSIBLE_SAMPLE_REVENUE = 10_000;

/** South Africa wording. Call `implausibleSampleNote` so a US client says dollars. */
export const IMPLAUSIBLE_SAMPLE_NOTE =
  "Implausible sample — these figures are too small to be this business's real rands.";

/** Currency word comes from the client market. A US list never says rands. */
export function implausibleSampleNote(market: Pick<ResolvedMarket, "copyPack"> | null | undefined): string {
  const word = t("currencyWordPlural", market?.copyPack ? market : { copyPack: "za" });
  return `Implausible sample — these figures are too small to be this business's real ${word}.`;
}

export function statementSampleImplausible(
  financials: Record<string, unknown> | null | undefined,
): boolean {
  if (!financials || statementMoneyScale(financials) !== 1) return false;
  const raw = financials.revenue;
  const revenue = typeof raw === "number" ? raw : parseFloat(String(raw ?? "").replace(/,/g, ""));
  return Number.isFinite(revenue) && revenue > 0 && revenue < IMPLAUSIBLE_SAMPLE_REVENUE;
}

/**
 * Clients-table heading. The amount is annual EBIT when the statement has no
 * single-month range, so the column must not say MTD.
 */
export function operatingProfitColumnHeading(
  rows: readonly { financials?: Record<string, unknown> | null }[],
): string {
  let monthly = false;
  let annual = false;
  for (const row of rows) {
    const fin = row.financials;
    if (!fin) continue;
    const revenue = parseFloat(String(fin.revenue ?? "").replace(/,/g, ""));
    if (!(revenue > 0)) continue;
    const months = parseFloat(String(fin.periodMonths ?? ""));
    const start = String(fin.periodStart ?? "").trim();
    const end = String(fin.periodEnd ?? "").trim();
    if (start && end && months === 1) monthly = true;
    else annual = true;
  }
  if (monthly && !annual) return "Op. profit (MTD)";
  if (annual) return "Op. profit (year)";
  return "Op. profit";
}
