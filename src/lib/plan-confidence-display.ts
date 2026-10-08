/**
 * Plan confidence is already a percent. This only chooses what to print.
 * It does not score actions.
 */
export function planConfidenceDisplay(confidence: number | null | undefined): {
  value: string;
  hint: string | null;
} {
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) {
    return { value: "—", hint: "Not enough progress yet" };
  }
  return { value: `${confidence}%`, hint: null };
}
