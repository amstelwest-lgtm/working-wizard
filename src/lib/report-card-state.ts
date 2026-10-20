/** Shown on every report card when the client has no figures to generate from. */
export const NO_FIGURES_REPORT_REASON =
  "Upload financials before generating client reports";

/**
 * Empty-client report cards keep Preview and Download disabled, and put the
 * reason on the card. Page count and the sign-off control stay hidden.
 */
export function reportCardNoFiguresState(input: { noFigures: boolean }): {
  reason: string | null;
  showPageCount: boolean;
  showSignoff: boolean;
} {
  if (!input.noFigures) {
    return { reason: null, showPageCount: true, showSignoff: true };
  }
  return {
    reason: NO_FIGURES_REPORT_REASON,
    showPageCount: false,
    showSignoff: false,
  };
}
