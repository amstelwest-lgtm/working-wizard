/**
 * Compact "What needs you" copy for the owner home.
 * Counts come from the caller. Empty stays empty. Nothing here is invented.
 */
import { DRAFT_NEEDS_ACCOUNTANT, DRAFT_NEEDS_OWNER, draftFindingKindLabel, draftFindingLabel } from "@/hooks/owner-agent-ui";
import { groundAdvisoryNarrative } from "@/lib/advisory-narrative";
import { repairDraftMetricUnits } from "@/lib/agent-bus";
import { homeStatementsLine } from "@/lib/books-answer";
import { canonicalScoreProse } from "@/lib/score-prose";
import { rewriteDraftMonthStamp } from "@/lib/statement-period";
import { actionDisplayTitle } from "@/lib/strategic-moves";
import { isVisibleAgentFinding, type AgentFindingRow } from "@/lib/milon-team-activity";
import { openPlanTitles } from "@/lib/open-plan-home";

export type OwnerActionRow = { title: string; email: string | null };

export type BooksLink =
  | { state: "unknown" }
  | { state: "absent" }
  | { state: "linked"; at: string | null };

export type OwnerNeedsView = {
  actionsHeading: string;
  actionLines: string[];
  draftsHeading: string;
  draftLines: string[];
  /** True when a stored draft quoted a figure the scorecard has since replaced. */
  draftStale?: boolean[];
  deliverablesHeading: string;
  deliverableLines: string[];
  syncHeading: string;
  syncLines: string[];
};

/**
 * What needs you → Action plan. Unknown is not "No open work".
 * Titles are the open rows already on the plan.
 */
/** Home shows this many open titles. A longer plan says how many are hidden. */
export const HOME_ACTION_PREVIEW = 3;

export function homeActionNeeds(input: {
  known: boolean;
  unavailable?: boolean;
  titles: readonly string[];
  overdue: number;
}): { heading: string; lines: string[] } {
  if (!input.known) return { heading: "Action plan", lines: ["Checking the action plan."] };
  if (input.unavailable) return { heading: "Action plan", lines: ["Open actions aren't available yet."] };
  const titles = input.titles.map((title) => actionDisplayTitle(title)).filter(Boolean);
  if (titles.length === 0) return { heading: "Action plan", lines: ["No open work."] };
  const lines = titles.slice(0, HOME_ACTION_PREVIEW);
  const overdueNote = input.overdue > 0 ? `, ${input.overdue} overdue` : "";
  const heading =
    input.overdue > 0 ? `${titles.length} open${overdueNote}` : `${titles.length} open`;
  return { heading, lines };
}

/** Under Act on these, when the brief shows a short list of a longer plan. */
export function actionPreviewLine(shown: number, total: number): string | null {
  if (!Number.isFinite(shown) || !Number.isFinite(total) || total <= shown) return null;
  return `Showing ${shown} of ${total}`;
}

/** Same open-action sentence the Financial Manager card and the hub count. */
export function openActionSentence(titles: readonly string[]): string | null {
  const clean = titles.map((title) => actionDisplayTitle(title)).filter(Boolean);
  if (clean.length === 0) return null;
  if (clean.length === 1) return clean[0]!;
  return `${clean.length} open actions.`;
}

function countPhrase(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Home draft title. Stored sentences are rewritten to the scorecard ratios.
 * `stale` means the stored text quoted a different figure. The screen shows
 * the scorecard number. The stored row is left for the next agent run.
 */
export function presentHomeDraftTitle(
  title: string,
  canonicalRatios?: Record<string, number> | null,
): { text: string; stale: boolean } {
  const base = repairDraftMetricUnits(canonicalScoreProse(rewriteDraftMonthStamp(title.trim())));
  if (!base) return { text: "", stale: false };
  if (!canonicalRatios) return { text: base, stale: false };
  const grounded = repairDraftMetricUnits(groundAdvisoryNarrative(base, canonicalRatios));
  return { text: grounded, stale: grounded !== base };
}

export function ownerDraftTitles(
  findings: readonly AgentFindingRow[],
  canonicalRatios?: Record<string, number> | null,
): string[] {
  return ownerDraftPresentations(findings, canonicalRatios).map((row) => row.text);
}

export function ownerDraftPresentations(
  findings: readonly AgentFindingRow[],
  canonicalRatios?: Record<string, number> | null,
): { text: string; stale: boolean }[] {
  return findings.flatMap((row) => {
    if (row.status === "approved") return [];
    if (!isVisibleAgentFinding(row)) return [];
    if (draftFindingLabel(row) !== DRAFT_NEEDS_OWNER) return [];
    const title = row.title.trim();
    if (!title) return [];
    const presented = presentHomeDraftTitle(title, canonicalRatios);
    return presented.text ? [presented] : [];
  });
}

export function advisoryDeliverableTitles(
  findings: readonly AgentFindingRow[],
  canonicalRatios?: Record<string, number> | null,
): string[] {
  return findings.flatMap((row) => {
    if (row.status === "approved") return [];
    if (!isVisibleAgentFinding(row)) return [];
    if (draftFindingKindLabel(row) !== "Advisory") return [];
    if (draftFindingLabel(row) !== DRAFT_NEEDS_ACCOUNTANT) return [];
    const title = row.title.trim();
    return title ? [presentHomeDraftTitle(title, canonicalRatios).text] : [];
  });
}

export function booksSyncCopy(input: {
  quickBooks: BooksLink;
  xero: BooksLink;
  when: (iso: string) => string;
  /** Statement dates already on the client. Same sentence as the accountant Home. */
  statementSpan?: string | null;
}): { heading: string; lines: string[] } {
  const statements = homeStatementsLine(input.statementSpan);
  if (statements) return { heading: "Books", lines: [statements] };
  const linked = (
    [
      ["QuickBooks", input.quickBooks],
      ["Xero", input.xero],
    ] as const
  ).filter((entry): entry is ["QuickBooks" | "Xero", { state: "linked"; at: string | null }] => {
    return entry[1].state === "linked";
  });
  if (linked.length === 0) {
    const unknown = input.quickBooks.state === "unknown" || input.xero.state === "unknown";
    return unknown
      ? { heading: "Books", lines: ["Sync time isn't available yet."] }
      : { heading: "Books", lines: ["Books are not connected yet."] };
  }
  const ranked = [...linked].sort((a, b) => {
    const left = a[1].at ? Date.parse(a[1].at) : 0;
    const right = b[1].at ? Date.parse(b[1].at) : 0;
    return (Number.isNaN(right) ? 0 : right) - (Number.isNaN(left) ? 0 : left);
  });
  const [source, link] = ranked[0];
  if (!link.at || Number.isNaN(Date.parse(link.at))) {
    return { heading: source, lines: ["Connected. No sync time yet."] };
  }
  return { heading: source, lines: [`Last synced ${input.when(link.at)}.`] };
}

export function ownerNeedsView(input: {
  ownerEmail: string | null;
  actionsReady: boolean;
  actionsUnavailable: boolean;
  actions: readonly OwnerActionRow[];
  draftsReady: boolean;
  draftsUnavailable: boolean;
  draftTitles: readonly string[];
  draftStale?: readonly boolean[];
  deliverablesReady: boolean;
  deliverablesUnavailable: boolean;
  deliverableCount: number;
  advisoryTitles: readonly string[];
  quickBooks: BooksLink;
  xero: BooksLink;
  when: (iso: string) => string;
  statementSpan?: string | null;
}): OwnerNeedsView {
  const assigned = openPlanTitles(input.actions);
  const shownActions = assigned.slice(0, HOME_ACTION_PREVIEW);
  const actionsHeading = !input.actionsReady
    ? "Open actions"
    : input.actionsUnavailable
      ? "Open actions"
      : assigned.length
        ? countPhrase(assigned.length, "open action", "open actions")
        : "Open actions";
  const actionLines = !input.actionsReady
    ? ["Checking open actions."]
    : input.actionsUnavailable
      ? ["Open actions aren't available yet."]
      : shownActions.length
        ? shownActions
        : ["No open actions."];

  const draftsHeading = !input.draftsReady
    ? "Drafts"
    : input.draftsUnavailable
      ? "Drafts"
      : input.draftTitles.length
        ? countPhrase(input.draftTitles.length, "draft needs your OK", "drafts need your OK")
        : "Drafts";
  const draftLines = !input.draftsReady
    ? ["Checking drafts."]
    : input.draftsUnavailable
      ? ["Drafts aren't available yet."]
      : input.draftTitles.length
        ? input.draftTitles.slice(0, 1)
        : ["No drafts need your OK."];
  const draftStale = !input.draftsReady || input.draftsUnavailable || input.draftTitles.length === 0
    ? undefined
    : input.draftStale?.slice(0, 1);

  const deliverableTotal =
    input.deliverableCount + (input.deliverablesUnavailable ? 0 : input.advisoryTitles.length);
  const deliverablesHeading = !input.deliverablesReady
    ? "Deliverables"
    : input.deliverablesUnavailable
      ? "Deliverables"
      : deliverableTotal
        ? countPhrase(deliverableTotal, "deliverable awaiting review", "deliverables awaiting review")
        : "Deliverables";
  const deliverableLines = !input.deliverablesReady
    ? ["Checking deliverables."]
    : input.deliverablesUnavailable
      ? ["Deliverables aren't available yet."]
      : deliverableTotal
        ? input.advisoryTitles.slice(0, 1).length
          ? input.advisoryTitles.slice(0, 1)
          : ["Waiting on your accountant."]
        : ["No deliverables awaiting review."];

  const sync = booksSyncCopy({
    quickBooks: input.quickBooks,
    xero: input.xero,
    when: input.when,
    statementSpan: input.statementSpan,
  });
  return {
    actionsHeading,
    actionLines,
    draftsHeading,
    draftLines,
    draftStale,
    deliverablesHeading,
    deliverableLines,
    syncHeading: sync.heading,
    syncLines: sync.lines,
  };
}
