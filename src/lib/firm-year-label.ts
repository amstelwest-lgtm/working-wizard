/**
 * One label for a firm-year clip of a longer statement.
 *
 * A ZA March year that contains a Jan–Sep statement keeps 7 of its 9 months.
 * Those figures are the statement scaled by 7/9. That is an estimate, not
 * the actual Mar–Sep books, so every surface that shows a clipped figure
 * (Home Analyst card, Waterfall, Budget, cash interest line) prints this
 * same label. An unclipped period gets no label from here.
 *
 * Month keys are "YYYY-MM". Nothing is hardcoded: months and years come
 * from the slice and the statement.
 */
import { formatMonthRange } from "@/lib/market/date-presets";

const EN_DASH = "\u2013";

/** "Mar–Sep 2026" in one year, "Nov 2025 – Feb 2026" across years. */
export function compactMonthRange(months: readonly string[]): string | null {
  const first = months[0];
  const last = months[months.length - 1];
  if (!first || !last) return null;
  const range = formatMonthRange(first, last);
  if (!range) return null;
  const sameYear = range.match(/^(\S+) (\d{4}) \u2013 (\S+) (\d{4})$/);
  if (sameYear && sameYear[2] === sameYear[4]) {
    return `${sameYear[1]}${EN_DASH}${sameYear[3]} ${sameYear[2]}`;
  }
  return range;
}

/**
 * "Mar–Sep 2026, pro-rated from your Jan–Sep 2026 statement".
 * Null unless the slice is a strict subset of the statement months.
 */
export function proratedPeriodLabel(
  sliceMonths: readonly string[],
  statementMonths: readonly string[],
): string | null {
  if (!sliceMonths.length || !statementMonths.length) return null;
  if (sliceMonths.length >= statementMonths.length) return null;
  const slice = compactMonthRange(sliceMonths);
  const statement = compactMonthRange(statementMonths);
  if (!slice || !statement) return null;
  return `${slice}, pro-rated from your ${statement} statement`;
}

/** True when a label came from proratedPeriodLabel. */
export function isProratedPeriodLabel(label: string | null | undefined): boolean {
  return typeof label === "string" && label.includes(", pro-rated from your ");
}
