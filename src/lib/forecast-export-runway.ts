/**
 * Weeks written onto an owner cash-forecast export.
 * A missing runway stays missing. A stored 0 stays 0.
 */
export function forecastExportRunwayWeeks(
  weeks: number | null | undefined,
  index: number,
): number | null {
  if (weeks == null || !Number.isFinite(weeks)) return null;
  return Math.max(0, weeks - index);
}
