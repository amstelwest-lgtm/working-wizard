/** Shown on every report card when the client has no figures to generate from. */
export const NO_FIGURES_REPORT_REASON =
  "Upload financials before generating client reports";

/** A figures read that is still pending past this is empty, same as an error. */
export const FIGURES_READ_DEADLINE_MS = 3_000;

export type FiguresReadStatus = "pending" | "settled" | "error" | "timeout";

/**
 * Parent knowledge of the file. Omitted and "unknown" are the same: the caller
 * has not said, so the cards stay available until a settled read says otherwise.
 */
export type FiguresOnFile = "unknown" | boolean;

export function normalizeFiguresOnFile(value: boolean | "unknown" | undefined): FiguresOnFile {
  if (value === true) return true;
  if (value === false) return false;
  return "unknown";
}

/**
 * Real no-books rows store `financials: null` and have no statement snapshots.
 * An empty object and a blank revenue string are the same absence. Only a
 * settled revenue value counts as figures.
 */
export function financialsHaveRevenue(financials: unknown): boolean {
  if (financials == null || typeof financials !== "object" || Array.isArray(financials)) {
    return false;
  }
  const revenue = (financials as Record<string, unknown>).revenue;
  if (typeof revenue === "number") return Number.isFinite(revenue);
  if (typeof revenue !== "string") return false;
  return revenue.trim() !== "";
}

/**
 * A settled read wins. Until then, figures already on the file (or an unknown
 * caller) keep the cards enabled. Only a parent that knows the file is empty
 * shows the upload reason during a pending or timed-out read.
 */
export function reportReadShowsFigures(input: {
  clientLinked: boolean;
  status: FiguresReadStatus;
  hasData: boolean;
  figuresOnFile?: boolean | "unknown";
}): boolean {
  if (!input.clientLinked) return true;
  if (input.status === "settled") return input.hasData;
  return normalizeFiguresOnFile(input.figuresOnFile) !== false;
}

/**
 * Preview and download links wait until the figures read settles.
 * A timeout is not a result, so it must not toast or clear the link.
 */
export function reportDeepLinkDecision(input: {
  status: FiguresReadStatus;
  showFigures: boolean;
}): "wait" | "run" | "blocked" | "hold" {
  if (input.status === "pending" || input.status === "timeout") return "wait";
  if (input.status === "error") return input.showFigures ? "hold" : "blocked";
  if (!input.showFigures) return "blocked";
  return "run";
}

/** Reports index lines for a client with no positively settled figures. */
export function reportIndexDetail(
  kind: "scorecard" | "forecast" | "waterfall" | "all" | "drafts" | "sent",
  hasPositiveFigures: boolean,
): string {
  if (
    !hasPositiveFigures &&
    (kind === "scorecard" || kind === "forecast" || kind === "waterfall" || kind === "all")
  ) {
    return NO_FIGURES_REPORT_REASON;
  }
  if (kind === "scorecard") return "The health scorecard PDF.";
  if (kind === "forecast") return "The 13-week cash forecast PDF.";
  if (kind === "waterfall") return "The profitability waterfall PDF.";
  if (kind === "all") return "Every board-ready PDF, with export.";
  if (kind === "drafts") return "Packs and the drafter, ready for sign-off.";
  return "Reports already sent to this client.";
}

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
