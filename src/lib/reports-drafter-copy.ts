/**
 * Answer sentences for the Reports tab and the Advisory drafter.
 * Display copy only. It does not draft, send, or score a report.
 */

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
