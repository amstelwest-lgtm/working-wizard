/**
 * Next Step resolver — pure module (P0.3 of the advisory OS spine).
 *
 * Deterministic: advisory state + missing data + open recommendations +
 * action health → exactly ONE Next Step (title, reason, CTA route). No LLM,
 * no network, no clock reads (`facts.now` is injected). The P0.4 dashboard
 * shell renders the result above health; P1 emails link to `cta.route.href`.
 *
 * Priority is fixed and documented in `resolveNextStep()`:
 *   1. cross-cutting blockers (open data request, overdue actions, blocked
 *      actions) — these override the state-based step because leaving them
 *      alone silently corrupts every later step;
 *   2. the state-based step, specialised by audience (owner vs accountant),
 *      because the same state means different work for each seat;
 *   3. a defensive fallback so a client can never have "no next step".
 *
 * Route mapping: the same target lands on the owner board (`/app`, in-app
 * tab ids) or the accountant studio (`/clients/:id?tab=`), mirroring the tab
 * pairs in `notes-tabs.ts`.
 */
import { ADVISORY_STATE_LABELS, type AdvisoryState } from "@/lib/advisory-state";

export const NEXT_STEP_AUDIENCES = ["owner", "accountant"] as const;
export type NextStepAudience = (typeof NEXT_STEP_AUDIENCES)[number];

export const NEXT_STEP_TARGETS = [
  "profile", // tell MILŌN about the business
  "questions", // answer open brain questions
  "upload", // upload statements / connect accounting
  "validate", // confirm the extracted figures
  "diagnosis", // review the health diagnosis
  "forecast", // publish the 13-week cash forecast
  "recommend", // turn the diagnosis into proposed moves
  "review", // accountant reviews proposed recommendations
  "decide", // owner accepts / rejects recommendations
  "start_actions", // spawn actions from approved recommendations
  "actions", // complete open actions
  "chase", // overdue actions
  "unblock", // blocked actions
  "data_request", // fulfil an open data request (P0.6)
  "outcome", // measure what the actions changed
  "restart", // start the next cycle with fresh statements
  "wait", // nothing for this seat right now (informational)
] as const;
export type NextStepTarget = (typeof NEXT_STEP_TARGETS)[number];

export const NEXT_STEP_URGENCIES = ["blocking", "now", "soon", "info"] as const;
export type NextStepUrgency = (typeof NEXT_STEP_URGENCIES)[number];

/** Everything the resolver needs. Gathered by `getNextStep`; built by hand in tests. */
export type NextStepFacts = {
  clientId: string;
  state: AdvisoryState;
  /** `derived` = advisory migration not applied yet (see getAdvisoryState). */
  stateSource: "persisted" | "derived";
  hasFirm: boolean;
  hasProfile: boolean;
  hasFinancials: boolean;
  hasSnapshot: boolean;
  hasForecast: boolean;
  /** Unanswered brain questions addressed to THIS audience (or both). */
  openQuestions: number;
  /** proposed_next_steps with status = 'proposed'. */
  proposedRecommendations: number;
  /** approved/edited recommendations with no action_item yet. */
  approvedWithoutAction: number;
  /** action_items not done. */
  openActions: number;
  /** action_items not done with due_date before `now`. */
  overdueActions: number;
  /** action_items with status = 'blocked'. */
  blockedActions: number;
  /** approved/edited recommendations that have actions but no recorded outcome. */
  actionedUnmeasured: number;
  /** Open `data_requests` (P0.6). Always 0 until that lands. */
  openDataRequests: number;
  nextReviewAt: string | null;
  /** ISO timestamp used for every date comparison. */
  now: string;
};

export type NextStepRoute = {
  path: string;
  /** Workspace tab to activate. Owner board ids or accountant studio ids. */
  tab: string | null;
  /** Query params the destination route honours today. */
  search: Record<string, string>;
  /** Ready-to-use link (emails, <a href>). */
  href: string;
};

export type NextStepOutstanding = {
  openQuestions: number;
  proposedRecommendations: number;
  approvedWithoutAction: number;
  openActions: number;
  overdueActions: number;
  blockedActions: number;
  actionedUnmeasured: number;
  openDataRequests: number;
};

export type NextStep = {
  key: NextStepTarget;
  state: AdvisoryState;
  stateLabel: string;
  audience: NextStepAudience;
  urgency: NextStepUrgency;
  title: string;
  reason: string;
  cta: { label: string; route: NextStepRoute };
  /** Counts for the "actions outstanding" strip under the CTA. */
  outstanding: NextStepOutstanding;
  /** Days until next review while monitoring; null otherwise. */
  daysToReview: number | null;
};

// ── Routes ───────────────────────────────────────────────────────────────────

/** Owner board (`/app`) tab per target. `null` = board default. */
const OWNER_TAB: Record<NextStepTarget, string | null> = {
  profile: "today",
  questions: "today",
  upload: "today",
  validate: "today",
  diagnosis: "today",
  forecast: "cash",
  recommend: "next",
  review: "next",
  decide: "next",
  start_actions: "next",
  actions: "tasks",
  chase: "tasks",
  unblock: "tasks",
  data_request: "today",
  outcome: "tasks",
  restart: "today",
  wait: "today",
};

/** Accountant studio (`/clients/:id`) tab per target. */
const ACCOUNTANT_TAB: Record<NextStepTarget, string> = {
  profile: "summary",
  questions: "summary",
  upload: "ratios",
  validate: "ratios",
  diagnosis: "ratios",
  forecast: "cash",
  recommend: "advisory",
  review: "advisory",
  decide: "advisory",
  start_actions: "plan",
  actions: "plan",
  chase: "plan",
  unblock: "plan",
  data_request: "summary",
  outcome: "plan",
  restart: "ratios",
  wait: "summary",
};

/** Extra query params the accountant studio already reacts to. */
function accountantSearch(target: NextStepTarget): Record<string, string> {
  switch (target) {
    case "upload":
    case "restart":
      return { onboard: "1" }; // opens the first-data / upload nudge
    case "chase":
      return { filter: "overdue" };
    case "unblock":
      return { filter: "blocked" };
    default:
      return {};
  }
}

function buildHref(path: string, search: Record<string, string>): string {
  const qs = Object.entries(search)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return qs ? `${path}?${qs}` : path;
}

export function nextStepRoute(
  target: NextStepTarget,
  audience: NextStepAudience,
  clientId: string,
): NextStepRoute {
  if (audience === "owner") {
    // /app reads no ?tab= today; the P0.4 shell switches tabs in-app from `tab`.
    return { path: "/app", tab: OWNER_TAB[target], search: {}, href: "/app" };
  }
  const path = `/clients/${clientId}`;
  const tab = ACCOUNTANT_TAB[target];
  const search = { tab, ...accountantSearch(target) };
  return { path, tab, search, href: buildHref(path, search) };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

export function daysBetween(fromIso: string, toIso: string): number | null {
  const a = Date.parse(fromIso);
  const b = Date.parse(toIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.ceil((b - a) / DAY_MS);
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

type Draft = {
  key: NextStepTarget;
  urgency: NextStepUrgency;
  title: string;
  reason: string;
  ctaLabel: string;
};

const UPLOAD_CTA = "Upload statements";
const UPLOAD_CTA_ACCT = "Upload or connect accounting";

// ── Resolver ─────────────────────────────────────────────────────────────────

/**
 * Cross-cutting blockers. Only applies once the client is past data
 * collection: before that, "upload your numbers" is already the whole story.
 */
function blockerStep(f: NextStepFacts, audience: NextStepAudience): Draft | null {
  const preData =
    f.state === "onboarding" ||
    f.state === "context_collection" ||
    f.state === "financial_data_collection";
  if (preData) return null;

  if (f.openDataRequests > 0) {
    return {
      key: "data_request",
      urgency: "blocking",
      title: `Send the ${plural(f.openDataRequests, "missing document")}`,
      reason:
        "MILŌN asked for data it needs to keep the diagnosis and forecast honest. Until it arrives, everything downstream is weaker than it looks.",
      ctaLabel: "See what's missing",
    };
  }
  if (f.overdueActions > 0) {
    return {
      key: "chase",
      urgency: "blocking",
      title:
        audience === "accountant"
          ? `Chase ${plural(f.overdueActions, "overdue action")}`
          : `${plural(f.overdueActions, "action is", "actions are")} overdue`,
      reason:
        "Recommendations only move the numbers when the actions behind them get done. Overdue work is the first thing to clear.",
      ctaLabel: audience === "accountant" ? "Open overdue actions" : "Catch up on actions",
    };
  }
  if (f.blockedActions > 0) {
    return {
      key: "unblock",
      urgency: "blocking",
      title: `Unblock ${plural(f.blockedActions, "action")}`,
      reason: "Someone flagged a blocker. Resolve it or re-plan the action so the cycle can close.",
      ctaLabel: "See blocked actions",
    };
  }
  return null;
}

function stateStep(f: NextStepFacts, audience: NextStepAudience): Draft {
  const acct = audience === "accountant";
  const who = acct ? "the client" : "you";

  switch (f.state) {
    case "onboarding":
      if (!f.hasProfile) {
        return {
          key: "profile",
          urgency: "now",
          title: acct ? "Set up the business profile" : "Tell MILŌN about the business",
          reason:
            "A few facts about how the business runs let every later diagnosis be specific instead of generic.",
          ctaLabel: acct ? "Complete profile" : "Answer 4 quick questions",
        };
      }
      return uploadStep(f, audience);

    case "context_collection":
      if (f.openQuestions > 0) {
        return {
          key: "questions",
          urgency: "now",
          title: `Answer ${plural(f.openQuestions, "open question")}`,
          reason:
            "These fill gaps the numbers alone can't explain. Each answer sharpens the next recommendation.",
          ctaLabel: "Answer now",
        };
      }
      return uploadStep(f, audience);

    case "financial_data_collection":
      return uploadStep(f, audience);

    case "data_validation":
      return {
        key: "validate",
        urgency: "now",
        title: "Confirm the extracted figures",
        reason:
          "The statements have been read. A 2-minute check that the totals match prevents a wrong diagnosis downstream.",
        ctaLabel: "Check the numbers",
      };

    case "diagnosis":
      return {
        key: "diagnosis",
        urgency: "now",
        title: acct ? "Review the health diagnosis" : "See what the numbers say",
        reason: acct
          ? "The four-pillar score and ratios are ready. Confirm the reading before MILŌN forecasts and recommends."
          : "MILŌN has scored the business. Read the diagnosis, then it moves on to the cash forecast.",
        ctaLabel: acct ? "Review diagnosis" : "Open diagnosis",
      };

    case "forecasting":
      return {
        key: "forecast",
        urgency: "now",
        title: "Publish the 13-week cash forecast",
        reason:
          "Recommendations without a cash view are guesses. The forecast sets the runway every move is judged against.",
        ctaLabel: "Open cash forecast",
      };

    case "recommendations":
      return {
        key: "recommend",
        urgency: "now",
        title: "Turn the diagnosis into proposed moves",
        reason:
          "Diagnosis and forecast are done. The next step is a short list of moves with the expected impact on cash or profit.",
        ctaLabel: acct ? "Draft recommendations" : "See proposed moves",
      };

    case "accountant_review":
      if (acct) {
        return {
          key: "review",
          urgency: "now",
          title: `Review ${plural(f.proposedRecommendations || 1, "proposed recommendation")}`,
          reason:
            "MILŌN drafted these from the client's numbers. Approve, edit or reject — the client only sees what you sign off.",
          ctaLabel: "Review and approve",
        };
      }
      return {
        key: "wait",
        urgency: "info",
        title: "Your accountant is reviewing the recommendations",
        reason:
          "MILŌN has drafted moves from your numbers. They reach you once your accountant has checked them.",
        ctaLabel: "See what's in review",
      };

    case "client_decision":
      if (f.proposedRecommendations > 0 && !f.hasFirm) {
        return {
          key: "decide",
          urgency: "now",
          title: `Decide on ${plural(f.proposedRecommendations, "recommendation")}`,
          reason:
            "Each one shows the problem, the evidence and the expected impact. Accept the ones you'll act on; reject the rest.",
          ctaLabel: "Decide now",
        };
      }
      if (f.approvedWithoutAction > 0) {
        return {
          key: "start_actions",
          urgency: "now",
          title: `Start actions for ${plural(f.approvedWithoutAction, "approved recommendation")}`,
          reason:
            "Approved but not yet planned. Turning each into a dated, owned action is what makes the impact measurable.",
          ctaLabel: "Create actions",
        };
      }
      if (f.proposedRecommendations > 0) {
        // Firm-connected client: the accountant already approved some; the
        // rest are still with them. Nothing for the owner to do but wait.
        return acct
          ? {
              key: "review",
              urgency: "soon",
              title: `Review the remaining ${plural(f.proposedRecommendations, "recommendation")}`,
              reason: "Some recommendations are still unreviewed.",
              ctaLabel: "Review",
            }
          : {
              key: "wait",
              urgency: "info",
              title: "Waiting on your accountant",
              reason: "The remaining recommendations are still in review.",
              ctaLabel: "See recommendations",
            };
      }
      return {
        key: "recommend",
        urgency: "soon",
        title: "Propose new moves",
        reason:
          "Every recommendation in this cycle was rejected or superseded. Draft fresh moves or restart with new statements.",
        ctaLabel: acct ? "Draft recommendations" : "See moves",
      };

    case "action_execution":
      if (f.openActions > 0) {
        return {
          key: "actions",
          urgency: "now",
          title: `Complete ${plural(f.openActions, "open action")}`,
          reason: "The cycle closes when these are done and the next numbers show what changed.",
          ctaLabel: acct ? "Open action plan" : "Open my actions",
        };
      }
      if (f.approvedWithoutAction > 0) {
        return {
          key: "start_actions",
          urgency: "now",
          title: `Plan ${plural(f.approvedWithoutAction, "approved recommendation")}`,
          reason: "Approved recommendations without actions never get measured.",
          ctaLabel: "Create actions",
        };
      }
      return outcomeStep(f, audience);

    case "outcome_monitoring":
      return outcomeStep(f, audience);

    case "next_review":
      return {
        key: "restart",
        urgency: "now",
        title: "Start the next cycle",
        reason: `Review is due. Upload the latest statements so MILŌN can measure what the last moves changed and re-diagnose${
          acct ? "" : " the business"
        }.`,
        ctaLabel: acct ? UPLOAD_CTA_ACCT : UPLOAD_CTA,
      };
  }
  // Unreachable with a valid state; keeps the resolver total if a new state
  // lands before this switch is updated.
  return uploadStep(f, audience);
}

function uploadStep(f: NextStepFacts, audience: NextStepAudience): Draft {
  const acct = audience === "accountant";
  return {
    key: "upload",
    urgency: "now",
    title: acct ? "Get the client's numbers in" : "Upload your latest statements",
    reason: f.hasFinancials
      ? "Some figures exist but not enough for a full diagnosis. A bank statement or management accounts unlocks the health score and cash forecast."
      : "MILŌN can't diagnose without numbers. A bank statement, management accounts or an accounting connection is enough to start.",
    ctaLabel: acct ? UPLOAD_CTA_ACCT : UPLOAD_CTA,
  };
}

function outcomeStep(f: NextStepFacts, audience: NextStepAudience): Draft {
  const acct = audience === "accountant";
  const days = f.nextReviewAt ? daysBetween(f.now, f.nextReviewAt) : null;
  if (days !== null && days > 0) {
    return {
      key: "outcome",
      urgency: "soon",
      title: `Next review in ${plural(days, "day")}`,
      reason:
        f.actionedUnmeasured > 0
          ? `Actions are done. ${plural(f.actionedUnmeasured, "recommendation")} still ${
              f.actionedUnmeasured === 1 ? "needs" : "need"
            } its result recorded — upload next period's statements early to measure sooner.`
          : "Actions are done. Upload next period's statements when they're ready to measure the impact.",
      ctaLabel: acct ? "Record outcomes" : "Upload when ready",
    };
  }
  return {
    key: "outcome",
    urgency: "now",
    title: "Measure what changed",
    reason:
      f.actionedUnmeasured > 0
        ? `${plural(f.actionedUnmeasured, "recommendation")} ${
            f.actionedUnmeasured === 1 ? "has" : "have"
          } no recorded result. Upload the latest statements or record the outcome to close the loop.`
        : "Upload the latest statements so MILŌN can compare expected against actual impact.",
    ctaLabel: acct ? UPLOAD_CTA_ACCT : UPLOAD_CTA,
  };
}

export function resolveNextStep(facts: NextStepFacts, audience: NextStepAudience): NextStep {
  const draft = blockerStep(facts, audience) ?? stateStep(facts, audience);
  const daysToReview =
    (facts.state === "outcome_monitoring" || facts.state === "action_execution") &&
    facts.nextReviewAt
      ? daysBetween(facts.now, facts.nextReviewAt)
      : null;
  return {
    key: draft.key,
    state: facts.state,
    stateLabel: ADVISORY_STATE_LABELS[facts.state].label,
    audience,
    urgency: draft.urgency,
    title: draft.title,
    reason: draft.reason,
    cta: { label: draft.ctaLabel, route: nextStepRoute(draft.key, audience, facts.clientId) },
    outstanding: {
      openQuestions: facts.openQuestions,
      proposedRecommendations: facts.proposedRecommendations,
      approvedWithoutAction: facts.approvedWithoutAction,
      openActions: facts.openActions,
      overdueActions: facts.overdueActions,
      blockedActions: facts.blockedActions,
      actionedUnmeasured: facts.actionedUnmeasured,
      openDataRequests: facts.openDataRequests,
    },
    daysToReview,
  };
}

/** Tab ids each surface can activate; the test asserts every route lands on one. */
export const OWNER_BOARD_TABS = ["today", "waterfall", "cash", "budget", "next", "tasks"] as const;
export const ACCOUNTANT_STUDIO_TABS = [
  "summary",
  "ask",
  "ratios",
  "profit",
  "cash",
  "budget",
  "reports",
  "plan",
  "advisory",
] as const;
