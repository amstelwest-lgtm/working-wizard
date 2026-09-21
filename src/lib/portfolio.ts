/**
 * Accountant portfolio by exception — pure module (P2.3).
 *
 * One row per client, ranked by what needs a human. Everything here is a
 * fact the spine already records (state age, blocking data requests, overdue
 * actions, pack waiting, outcomes that went backwards, unreviewed
 * recommendations); this module only decides what counts as an exception and
 * in what order. Deterministic; `now` is injected.
 */
import { ADVISORY_STATE_LABELS, type AdvisoryState } from "@/lib/advisory-state";

export type PortfolioClientFacts = {
  clientId: string;
  name: string;
  state: AdvisoryState | null;
  /** When the client entered its current state (advisory_cycles.updated_at). */
  stateSince: string | null;
  nextReviewAt: string | null;
  figuresAsOf: string | null;
  openDataRequests: number;
  blockingDataRequests: number;
  overdueActions: number;
  blockedActions: number;
  openActions: number;
  proposedRecommendations: number;
  packStatus: "draft" | "in_review" | "changes_requested" | "approved" | "rejected" | null;
  packVersion: number | null;
  packEditRate: number | null;
  outcomesMissed: number;
  outcomesMeasured: number;
  lastLoginAt: string | null;
};

export const EXCEPTION_KINDS = [
  "pack_waiting",
  "blocking_data",
  "overdue_actions",
  "blocked_actions",
  "outcome_missed",
  "unreviewed_recommendations",
  "stuck",
  "stale_figures",
  "review_due",
  "owner_inactive",
] as const;
export type ExceptionKind = (typeof EXCEPTION_KINDS)[number];

export type PortfolioException = {
  kind: ExceptionKind;
  severity: 1 | 2 | 3; // 1 = act today
  label: string;
  /** Studio tab that resolves it. */
  tab: "advisory" | "summary" | "plan" | "cash" | "ratios";
};

export type PortfolioRow = {
  clientId: string;
  name: string;
  stateLabel: string;
  daysInState: number | null;
  exceptions: PortfolioException[];
  score: number;
};

/** Days in one state after which the cycle counts as stuck. */
export const STUCK_AFTER_DAYS = 21;
export const STALE_FIGURES_DAYS = 75;
export const OWNER_INACTIVE_DAYS = 30;

const DAY_MS = 86_400_000;
function daysSince(iso: string | null, now: string): number | null {
  if (!iso) return null;
  const a = Date.parse(iso);
  const b = Date.parse(now);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.floor((b - a) / DAY_MS);
}

const RESTING_STATES = new Set<AdvisoryState>([
  "outcome_monitoring",
  "next_review",
  "action_execution",
]);

export function exceptionsFor(f: PortfolioClientFacts, now: string): PortfolioException[] {
  const out: PortfolioException[] = [];

  if (f.packStatus === "in_review" || f.packStatus === "changes_requested") {
    out.push({
      kind: "pack_waiting",
      severity: 1,
      label: `Pack v${f.packVersion ?? 1} waiting for your sign-off`,
      tab: "advisory",
    });
  }
  if (f.blockingDataRequests > 0) {
    out.push({
      kind: "blocking_data",
      severity: 1,
      label: `${f.blockingDataRequests} blocking data request${f.blockingDataRequests === 1 ? "" : "s"} open`,
      tab: "summary",
    });
  }
  if (f.outcomesMissed > 0) {
    out.push({
      kind: "outcome_missed",
      severity: 1,
      label: `${f.outcomesMissed} recommendation${f.outcomesMissed === 1 ? "" : "s"} went the wrong way`,
      tab: "advisory",
    });
  }
  if (f.overdueActions > 0) {
    out.push({
      kind: "overdue_actions",
      severity: 2,
      label: `${f.overdueActions} overdue action${f.overdueActions === 1 ? "" : "s"}`,
      tab: "plan",
    });
  }
  if (f.blockedActions > 0) {
    out.push({
      kind: "blocked_actions",
      severity: 2,
      label: `${f.blockedActions} blocked action${f.blockedActions === 1 ? "" : "s"}`,
      tab: "plan",
    });
  }
  if (f.proposedRecommendations > 0 && f.state === "accountant_review" && !f.packStatus) {
    out.push({
      kind: "unreviewed_recommendations",
      severity: 2,
      label: `${f.proposedRecommendations} recommendation${f.proposedRecommendations === 1 ? "" : "s"} drafted, no pack yet`,
      tab: "advisory",
    });
  }
  const inState = daysSince(f.stateSince, now);
  if (f.state && !RESTING_STATES.has(f.state) && inState !== null && inState > STUCK_AFTER_DAYS) {
    out.push({
      kind: "stuck",
      severity: 2,
      label: `${inState} days at "${ADVISORY_STATE_LABELS[f.state].label}"`,
      tab: "summary",
    });
  }
  const figAge = daysSince(f.figuresAsOf, now);
  if (
    f.state &&
    f.state !== "onboarding" &&
    f.state !== "context_collection" &&
    f.state !== "financial_data_collection" &&
    (figAge === null || figAge > STALE_FIGURES_DAYS)
  ) {
    out.push({
      kind: "stale_figures",
      severity: 3,
      label: figAge === null ? "No dated figures" : `Figures ${figAge} days old`,
      tab: "ratios",
    });
  }
  const reviewIn = f.nextReviewAt ? -(daysSince(f.nextReviewAt, now) ?? 0) : null;
  if (f.state === "next_review" || (reviewIn !== null && reviewIn <= 7)) {
    out.push({
      kind: "review_due",
      severity: 3,
      label:
        f.state === "next_review"
          ? "Cycle review due"
          : `Review due in ${Math.max(0, reviewIn ?? 0)} days`,
      tab: "summary",
    });
  }
  const login = daysSince(f.lastLoginAt, now);
  if (login !== null && login > OWNER_INACTIVE_DAYS && f.openActions > 0) {
    out.push({
      kind: "owner_inactive",
      severity: 3,
      label: `Owner not seen for ${login} days with ${f.openActions} open action${f.openActions === 1 ? "" : "s"}`,
      tab: "plan",
    });
  }
  return out.sort((a, b) => a.severity - b.severity);
}

export function rankPortfolio(facts: readonly PortfolioClientFacts[], now: string): PortfolioRow[] {
  return facts
    .map((f) => {
      const ex = exceptionsFor(f, now);
      const score = ex.reduce(
        (s, e) => s + (e.severity === 1 ? 100 : e.severity === 2 ? 10 : 1),
        0,
      );
      return {
        clientId: f.clientId,
        name: f.name,
        stateLabel: f.state ? ADVISORY_STATE_LABELS[f.state].label : "Not started",
        daysInState: daysSince(f.stateSince, now),
        exceptions: ex,
        score,
      };
    })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

export type PortfolioSummary = {
  clients: number;
  needAttention: number;
  packsWaiting: number;
  blockingData: number;
  overdue: number;
  wentBackwards: number;
};

export function summarisePortfolio(rows: readonly PortfolioRow[]): PortfolioSummary {
  const count = (k: ExceptionKind) =>
    rows.filter((r) => r.exceptions.some((e) => e.kind === k)).length;
  return {
    clients: rows.length,
    needAttention: rows.filter((r) => r.exceptions.some((e) => e.severity <= 2)).length,
    packsWaiting: count("pack_waiting"),
    blockingData: count("blocking_data"),
    overdue: count("overdue_actions"),
    wentBackwards: count("outcome_missed"),
  };
}
