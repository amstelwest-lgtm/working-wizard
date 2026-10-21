/** Shown in the preview modal when the cash file has no entered forecast lines. */
export const FORECAST_PREVIEW_EMPTY =
  "Not enough data. The 13-week chart appears once a forecast line is entered.";

/**
 * A null or empty week list is not a forecast. The numbers engine already
 * returns null for that file. Preview explains it instead of building a PDF.
 */
export function forecastPreviewGap(
  cashForecast: readonly unknown[] | null | undefined,
): string | null {
  if (cashForecast == null || cashForecast.length === 0) return FORECAST_PREVIEW_EMPTY;
  return null;
}

/** A report link opens the PDF modal only when the caller asked for a preview. */
export function reportLinkOpensPreview(action: string | null | undefined): boolean {
  return action === "preview";
}

export function reportLinkRunsDownload(action: string | null | undefined): boolean {
  return action === "download";
}
