/**
 * The firm-year clip the cash interest line shares with the Waterfall.
 * Same overlap and label as `fiscalWaterfallFallback`. Null when the
 * statement was not clipped (US calendar year, 12 months, undated cover).
 */
import { fiscalOverlap, fiscalStatementSlice } from "@/lib/budget-period";
import type { InterestPeriodClip } from "@/lib/cash-interest-note";

export function firmYearInterestClip(
  financials: Record<string, unknown> | null | undefined,
  fyStartMonth: number,
): InterestPeriodClip | null {
  const slice = fiscalStatementSlice(financials, fyStartMonth);
  const overlap = fiscalOverlap(financials, fyStartMonth);
  if (!slice?.prorated || !overlap || !(overlap.scale < 1)) return null;
  return { scale: overlap.scale, label: slice.label };
}
