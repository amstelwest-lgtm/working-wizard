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

/**
 * Copy the 13-week Preview shows instead of a PDF.
 * An empty client has no statement figures, so the week list is never built.
 * A file with figures but no lines uses the same sentence. A demo with no
 * client, and a file that already has weeks, return null so Preview opens the PDF.
 */
export function forecastPreviewMessage(input: {
  emptyClient: boolean;
  hasStatementData: boolean;
  cashForecast: readonly unknown[] | null | undefined;
}): string | null {
  if (input.emptyClient) return FORECAST_PREVIEW_EMPTY;
  if (!input.hasStatementData) return null;
  return forecastPreviewGap(input.cashForecast);
}

/**
 * Empty-client 13-week Preview stays enabled so that sentence can be shown.
 * Loading and an in-flight preview still disable it. Download keeps the gate.
 */
export function forecastPreviewButtonDisabled(input: {
  gateDisabled: boolean;
  emptyClient: boolean;
  loading: boolean;
  previewing: boolean;
}): boolean {
  if (input.previewing || input.loading) return true;
  if (input.emptyClient) return false;
  return input.gateDisabled;
}

/** A report link opens the PDF modal only when the caller asked for a preview. */
export function reportLinkOpensPreview(action: string | null | undefined): boolean {
  return action === "preview";
}

export function reportLinkRunsDownload(action: string | null | undefined): boolean {
  return action === "download";
}
