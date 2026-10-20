/**
 * Answer sentences for the Reports tab and the Advisory drafter.
 * Display copy only. It does not draft, send, or score a report.
 */

import { reportInputsFromFinancials } from "@/lib/equity-coherence";

/**
 * Fields that mean a client has figures on file. Same keys as the Books
 * input list, so Home and the Reports tab agree on "nothing ready".
 */
export const STATEMENT_FIGURE_KEYS = [
  "revenue",
  "cogs",
  "ebit",
  "ebt",
  "netIncome",
  "ebitda",
  "operatingCashflow",
  "totalAssets",
  "equity",
  "receivables",
  "inventory",
  "payables",
  "fixedCosts",
  "variableCosts",
  "top5Revenue",
  "laborCost",
  "employees",
  "founderHours",
  "cash",
] as const;

/** True once any statement figure is stored. Blank and missing values do not count. */
export function financialsHaveStatementFigures(financials: object | null | undefined): boolean {
  if (!financials) return false;
  const record = financials as Record<string, unknown>;
  return STATEMENT_FIGURE_KEYS.some((key) => {
    const value = record[key];
    if (value == null) return false;
    return String(value).trim() !== "";
  });
}

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

/**
 * Ready-report count for one client. Home and the Reports tab both use this,
 * so a firm total of these counts matches each client line exactly.
 */
export function clientReportsReadyCount(financials: object | null | undefined): number {
  const readiness = reportInputsFromFinancials(
    financials as Record<string, unknown> | null | undefined,
  );
  return reportsReadyCount({
    figuresOnFile: financialsHaveStatementFigures(financials),
    leverageReady: readiness.leverageReady,
    assetReady: readiness.assetReady,
  });
}

/** Sum of each client's ready count. A client with no figures adds nothing. */
export function firmReportsReadyTotal(clients: readonly { financials?: object | null }[]): number {
  return clients.reduce((sum, client) => sum + clientReportsReadyCount(client.financials), 0);
}

/**
 * Client whose Reports list the firm Home line opens.
 * The largest ready count wins. A tie uses the client name.
 */
export function firmReportsHomeClient(
  clients: readonly { id: string; name?: string | null; financials?: object | null }[],
): string | null {
  let best: { id: string; name: string; count: number } | null = null;
  for (const client of clients) {
    if (!client.id) continue;
    const count = clientReportsReadyCount(client.financials);
    if (count <= 0) continue;
    const name = client.name?.trim() ?? "";
    if (
      !best ||
      count > best.count ||
      (count === best.count && name.localeCompare(best.name) < 0)
    ) {
      best = { id: client.id, name, count };
    }
  }
  return best?.id ?? null;
}

/** Line under Home’s Reports heading. Null hides the line when the count is 0. */
export function reportsHomeReadyLine(count: number): string | null {
  if (count <= 0) return null;
  if (count === 1) return "1 ready to send";
  return `${count} ready to send`;
}

/** Firm Home line. Null hides it when no client has a report ready to send. */
export function firmReportsHomeLine(count: number): string | null {
  const ready = reportsHomeReadyLine(count);
  if (!ready) return null;
  return `Reports: ${ready}`;
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

/** Gold control on the Reports strip. A named page says which PDF it opens. */
export function reportsPrimaryLabel(readyCount: number, reportName?: string | null): string {
  const name = reportName?.trim();
  if (readyCount > 0) return name ? `Open ${name}` : "Open report";
  return name ? `Create ${name}` : "Create report";
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
