/**
 * Answer sentences for the Reports tab and the Advisory drafter.
 * Display copy only. It does not draft, send, or score a report.
 */

/**
 * One name list for every reports strip.
 * A loaded list wins, including an empty one. While the catalogue is still
 * loading, figures already on the file use the full catalogue so Health and
 * All reports do not disagree.
 */
export function reportStripNames(input: {
  loadedNames: readonly string[] | null;
  figuresOnFile: boolean;
  catalogueNames: readonly string[];
}): string[] {
  const source = input.loadedNames ?? (input.figuresOnFile ? input.catalogueNames : []);
  return source.map((name) => name.trim()).filter(Boolean);
}

/** Catalogue keys the Reports tab counts. Leverage and assets drop out when their figures are missing. */
export const REPORT_CATALOGUE_KEYS = [
  "scorecard",
  "intervention",
  "forecast",
  "cycle",
  "waterfall",
  "leverage",
  "assets",
  "labor",
  "movement",
  "benchmark",
  "budget",
] as const;

export function reportReady(
  key: string,
  input: { leverageReady: boolean; assetReady: boolean },
): boolean {
  if (key === "leverage") return input.leverageReady;
  if (key === "assets") return input.assetReady;
  return true;
}

/**
 * Same count the Reports tab puts in “N reports ready”.
 * No figures means nothing is ready, including while a report page is still closed.
 */
export function reportsReadyCount(input: {
  figuresOnFile: boolean;
  leverageReady: boolean;
  assetReady: boolean;
}): number {
  if (!input.figuresOnFile) return 0;
  return REPORT_CATALOGUE_KEYS.filter((key) => reportReady(key, input)).length;
}

/** Line under Home’s Reports heading. Null hides the line when the count is 0. */
export function reportsHomeReadyLine(count: number): string | null {
  if (count <= 0) return null;
  if (count === 1) return "1 ready to send";
  return `${count} ready to send`;
}

export function reportsAnswerSentence(input: {
  readyNames: readonly string[];
  periodLabel?: string | null;
}): string {
  const names = input.readyNames.map((name) => name.trim()).filter(Boolean);
  if (names.length === 0) {
    return "No reports yet. Pick one to build from this client's figures.";
  }
  const period = input.periodLabel?.trim() || "this period";
  const count = names.length === 1 ? "1 report ready" : `${names.length} reports ready`;
  const first = names[0] ?? "";
  const title = first.endsWith(".") ? first : `${first}.`;
  return `${count} for ${period}. Start with: ${title}`;
}

/** Gold control on the Reports strip. Zero ready reports still opens the first template. */
export function reportsPrimaryLabel(readyCount: number): string {
  return readyCount > 0 ? "Open report" : "Create report";
}

const SENT_LABEL: Record<string, string> = {
  advisory_draft: "Client email",
  meeting_agenda: "Meeting agenda",
  exec_summary: "Exec summary",
  health_summary: "Health summary",
  report_pdf: "Report",
};

export function sentDraftLabel(kind: string): string {
  return SENT_LABEL[kind] ?? "Note";
}

export const DRAFTER_EMPTY_SENTENCE =
  "Draft a client email, meeting agenda or exec summary from this month's figures.";

export const DRAFTER_HISTORY_SENTENCE =
  "Everything you copy, email or share is saved to Sent history.";

export const SENT_HISTORY_INTRO =
  "Every email, WhatsApp share and PDF you've sent from here, with the figures it used. A share means you opened it to send; we can't confirm the client received it.";

/** en-ZA prints a leading zero (`02 Oct 2026`). The strip reads `2 Oct 2026`. */
export function plainSentDate(label: string): string {
  return label.replace(/^0(?=\d)/, "");
}

export function drafterAnswerSentence(input: {
  last?: { kind: string; recipient: string; dateLabel: string } | null;
}): string {
  const last = input.last;
  const recipient = last?.recipient.trim() ?? "";
  const dateLabel = last?.dateLabel.trim() ?? "";
  if (!last || !recipient || !dateLabel) return DRAFTER_EMPTY_SENTENCE;
  return `Last sent: ${sentDraftLabel(last.kind)} to ${recipient} · ${dateLabel}.`;
}
