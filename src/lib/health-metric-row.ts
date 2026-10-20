/** Copy the Health rows use when a day metric has no input. */
export const HEALTH_NOT_ENOUGH_DATA = "Not enough data";

export const HEALTH_MISSING_MARK = "—";

/**
 * Owner and accountant Health rows for DSO, DPO, stock days, and the cycle.
 * A blank input is a dash plus "Not enough data", and it carries no score.
 * A stored 0 stays 0 days and keeps its score.
 */
export function healthDayRowPresentation(
  value: number | null | undefined,
  score: number | null | undefined,
): { figure: string; note: string | null; score: string | null } {
  if (typeof value === "number" && Number.isFinite(value)) {
    const scored = typeof score === "number" && Number.isFinite(score);
    return {
      figure: `${Math.round(value)} days`,
      note: null,
      score: scored ? String(Math.round(score)) : null,
    };
  }
  return { figure: HEALTH_MISSING_MARK, note: HEALTH_NOT_ENOUGH_DATA, score: null };
}
