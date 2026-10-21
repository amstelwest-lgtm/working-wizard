/**
 * Compact "What needs you" copy for the owner home.
 * Counts come from the caller. Empty stays empty. Nothing here is invented.
 */
import { DRAFT_NEEDS_ACCOUNTANT, DRAFT_NEEDS_OWNER, draftFindingKindLabel, draftFindingLabel } from "@/hooks/owner-agent-ui";
import { repairDraftMetricUnits, stripRatioDumpLines } from "@/lib/agent-bus";
import {
  draftStoredFiguresHash,
  draftStoredHealth,
  presentLiveDraft,
  type DraftLiveFigures,
} from "@/lib/draft-figures";
import { readStoredScoreSnapshotHash, type HealthScoreSnapshot } from "@/lib/health-snapshot";
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
  /** Snapshot sentence. Home shows it when a draft line is the regenerate marker. */
  draftLiveSentence?: string | null;
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
  /**
   * One next action when the file has no evidence. Replaces "No open work"
   * so an empty plan does not sit beside an unscored client as if nothing is due.
   */
  nextAction?: string | null;
}): { heading: string; lines: string[] } {
  if (!input.known) return { heading: "Action plan", lines: ["Checking the action plan."] };
  if (input.unavailable) return { heading: "Action plan", lines: ["Open actions aren't available yet."] };
  const titles = input.titles.map((title) => actionDisplayTitle(title)).filter(Boolean);
  const next = input.nextAction?.trim() ?? "";
  if (titles.length === 0 && next) return { heading: "Next", lines: [next] };
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

export type HomeDraftLive = {
  overall?: number | null;
  storedHash?: string | null;
  health?: HealthScoreSnapshot | null;
  storedHealth?: HealthScoreSnapshot | null;
  /** score_snapshot_hash from the draft, including the engine version. */
  storedScoreHash?: string | null;
  /** Finding evidence. A row with no hash is read from metrics and figures. */
  evidence?: unknown;
  /** When this draft was saved. */
  writtenAt?: string | null;
  /** Latest upload or ledger sync. A later clock forces stale. It never vouches the stored sentence. */
  figuresUpdatedAt?: string | null;
};

/**
 * Home draft title. Stored sentences are re-read from the live ratios and
 * the live health score. `stale` / `refresh` means the stored text or its
 * figures hash no longer matches. The screen shows the live number, or
 * "Out of date, refresh" when it cannot. The stored row is left as written.
 */
export function presentHomeDraftTitle(
  title: string,
  canonicalRatios?: Record<string, number> | null,
  live?: HomeDraftLive | null,
): { text: string; stale: boolean; refresh: boolean; regenerate?: boolean } {
  return presentStoredDraft(title, canonicalRatios, live);
}

/** Same re-read as the title, for the draft body. */
export function presentHomeDraftBody(
  body: string,
  canonicalRatios?: Record<string, number> | null,
  live?: HomeDraftLive | null,
): { text: string; stale: boolean; refresh: boolean; regenerate?: boolean } {
  return presentStoredDraft(body, canonicalRatios, live);
}

function presentStoredDraft(
  raw: string,
  canonicalRatios?: Record<string, number> | null,
  live?: HomeDraftLive | null,
): { text: string; stale: boolean; refresh: boolean; regenerate?: boolean } {
  const base = repairDraftMetricUnits(
    canonicalScoreProse(rewriteDraftMonthStamp(stripRatioDumpLines(raw).trim())),
  );
  if (!base) return { text: "", stale: false, refresh: false };
  const figures: DraftLiveFigures = {
    ratios: canonicalRatios,
    overall: live?.overall,
    storedHash: live?.storedHash,
    health: live?.health,
    storedHealth: live?.storedHealth,
    storedScoreHash: live?.storedScoreHash,
    evidence: live?.evidence,
    writtenAt: live?.writtenAt,
    figuresUpdatedAt: live?.figuresUpdatedAt,
  };
  const presented = presentLiveDraft(base, figures);
  return {
    text: presented.text ? repairDraftMetricUnits(presented.text) : "",
    stale: presented.stale,
    refresh: presented.refresh,
    regenerate: presented.regenerate,
  };
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
  live?: HomeDraftLive | null,
): { text: string; stale: boolean; refresh: boolean; regenerate?: boolean }[] {
  return findings.flatMap((row) => {
    if (row.status === "approved") return [];
    if (!isVisibleAgentFinding(row)) return [];
    if (draftFindingLabel(row) !== DRAFT_NEEDS_OWNER) return [];
    const shown = presentFindingDraft(row, canonicalRatios, live);
    return shown.text ? [shown] : [];
  });
}

export function advisoryDeliverableTitles(
  findings: readonly AgentFindingRow[],
  canonicalRatios?: Record<string, number> | null,
  live?: HomeDraftLive | null,
): string[] {
  return findings.flatMap((row) => {
    if (row.status === "approved") return [];
    if (!isVisibleAgentFinding(row)) return [];
    if (draftFindingKindLabel(row) !== "Advisory") return [];
    if (draftFindingLabel(row) !== DRAFT_NEEDS_ACCOUNTANT) return [];
    const shown = presentFindingDraft(row, canonicalRatios, live);
    return shown.text ? [shown.text] : [];
  });
}

function presentFindingDraft(
  row: AgentFindingRow,
  canonicalRatios?: Record<string, number> | null,
  live?: HomeDraftLive | null,
): { text: string; stale: boolean; refresh: boolean; regenerate?: boolean } {
  const quote: HomeDraftLive = {
    overall: live?.overall ?? live?.health?.overall,
    storedHash: draftStoredFiguresHash(row.evidence),
    health: live?.health,
    storedHealth: draftStoredHealth(row.evidence),
    storedScoreHash: readStoredScoreSnapshotHash(row.evidence),
    evidence: row.evidence,
    writtenAt: row.created_at,
    figuresUpdatedAt: live?.figuresUpdatedAt,
  };
  const title = presentHomeDraftTitle(row.title, canonicalRatios, quote);
  const body = row.detail?.trim() ? presentHomeDraftBody(row.detail, canonicalRatios, quote) : null;
  const refresh = title.refresh || title.stale || Boolean(body?.refresh || body?.stale);
  return {
    text: title.text || body?.text || "",
    stale: refresh,
    refresh,
    regenerate: Boolean(title.regenerate || body?.regenerate),
  };
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
  draftLiveSentence?: string | null;
  deliverablesReady: boolean;
  deliverablesUnavailable: boolean;
  /** Null until the accountant surface has read deliverable_drafts. Not a confirmed zero. */
  deliverableCount: number | null;
  advisoryTitles: readonly string[];
  quickBooks: BooksLink;
  xero: BooksLink;
  when: (iso: string) => string;
  /** One next action when the file has no evidence. Replaces "No open actions." */
  nextAction?: string | null;
  /** Statement dates already on the client. Same sentence as the accountant Home. */
  statementSpan?: string | null;
}): OwnerNeedsView {
  const assigned = openPlanTitles(input.actions);
  const shownActions = assigned.slice(0, HOME_ACTION_PREVIEW);
  const next = input.nextAction?.trim() ?? "";
  const actionsHeading = !input.actionsReady
    ? "Open actions"
    : input.actionsUnavailable
      ? "Open actions"
      : assigned.length
        ? countPhrase(assigned.length, "open action", "open actions")
        : next
          ? "Next"
          : "Open actions";
  const actionLines = !input.actionsReady
    ? ["Checking open actions."]
    : input.actionsUnavailable
      ? ["Open actions aren't available yet."]
      : shownActions.length
        ? shownActions
        : next
          ? [next]
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

  const ownerDrafts =
    input.draftsReady && !input.draftsUnavailable
      ? input.draftTitles.filter((title) => title.trim())
      : [];
  const advisory =
    input.deliverablesReady && !input.deliverablesUnavailable
      ? input.advisoryTitles.filter((title) => title.trim())
      : [];
  const storedCount = input.deliverableCount;
  const storedChecked = typeof storedCount === "number";
  const stored =
    storedChecked && input.deliverablesReady && !input.deliverablesUnavailable
      ? Math.max(0, storedCount)
      : 0;
  // Owner-OK drafts, accountant advisory drafts, and stored deliverable rows.
  // The same draft titles feed both Home cells. Nothing here is a made-up count.
  const deliverableTotal = ownerDrafts.length + advisory.length + stored;
  const deliverablesHeading = !input.deliverablesReady || !input.draftsReady
    ? "Deliverables"
    : input.deliverablesUnavailable && input.draftsUnavailable
      ? "Deliverables"
      : deliverableTotal
        ? countPhrase(deliverableTotal, "deliverable awaiting review", "deliverables awaiting review")
        : "Deliverables";
  const deliverableLines = !input.deliverablesReady || !input.draftsReady
    ? ["Checking deliverables."]
    : input.deliverablesUnavailable && input.draftsUnavailable
      ? ["Deliverables aren't available yet."]
      : deliverableTotal
        ? [ownerDrafts[0] ?? advisory[0] ?? "Waiting on your accountant."]
        : storedChecked
          ? ["No deliverables awaiting review."]
          : ["Stored deliverables load in Accountant portal."];

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
    draftLiveSentence: input.draftLiveSentence ?? null,
    deliverablesHeading,
    deliverableLines,
    syncHeading: sync.heading,
    syncLines: sync.lines,
  };
}
