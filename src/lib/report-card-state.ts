/** Shown on every report card when the client has no figures to generate from. */
export const NO_FIGURES_REPORT_REASON =
  "Upload financials before generating client reports";

/** A figures read that is still pending past this is empty, same as an error. */
export const FIGURES_READ_DEADLINE_MS = 3_000;

export type FiguresReadStatus = "pending" | "settled" | "error" | "timeout";

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
 * Page count, sign-off, and the "Loading…" label only after a settled read
 * that actually has figures. Pending, error, and timeout stay empty — a
 * parent flag of true may hold the chrome during a still-pending read, and
 * it does not override an error or a missed deadline.
 */
export function reportReadShowsFigures(input: {
  clientLinked: boolean;
  status: FiguresReadStatus;
  hasData: boolean;
  figuresOnFile?: boolean;
}): boolean {
  if (!input.clientLinked) return true;
  if (input.status === "error" || input.status === "timeout") return false;
  if (input.status === "settled") return input.hasData;
  return input.figuresOnFile === true;
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
