/**
 * Plan confidence is a percent. The display helper only chooses what to print.
 * `planConfidencePercent` caps that percent when the burn-up is behind, so a
 * finished-item average cannot read 100% next to a gap.
 */

export function planPaceGapPoints(
  items: readonly { progress_pct: number }[],
  createdAt: string,
  targetDate: string,
  now = Date.now(),
): number {
  const start = new Date(createdAt).getTime();
  const end = new Date(`${targetDate.slice(0, 10)}T23:59:59`).getTime();
  const nowFrac = end > start ? Math.max(0, Math.min(1, (now - start) / (end - start))) : 1;
  const actual = items.length
    ? items.reduce((sum, item) => sum + (Number.isFinite(item.progress_pct) ? item.progress_pct : 0), 0) /
      items.length /
      100
    : 0;
  return Math.round((actual - nowFrac) * 100);
}

/** Item-average confidence, limited by a negative pace gap. Ahead keeps the average. */
export function planConfidencePercent(itemAverage: number | null, gap: number | null): number | null {
  if (itemAverage == null || !Number.isFinite(itemAverage)) return null;
  const average = Math.max(0, Math.min(100, Math.round(itemAverage)));
  if (gap != null && Number.isFinite(gap) && gap < 0) {
    return Math.min(average, Math.max(0, 100 + Math.round(gap)));
  }
  return average;
}

export function planConfidenceDisplay(confidence: number | null | undefined): {
  value: string;
  hint: string | null;
} {
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) {
    return { value: "—", hint: "Not enough progress yet" };
  }
  return { value: `${confidence}%`, hint: null };
}
