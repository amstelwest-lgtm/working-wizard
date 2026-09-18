/**
 * Advisory state machine — pure module (P0.1 of the advisory OS spine).
 *
 * One persistent advisory state per client, advanced by append-only events.
 * The transition RULES below are the single source of truth: the advisory
 * migrations (`supabase/migrations/*advisory*.sql`, `*recommendations*.sql`)
 * seed the exact same rows into `public.advisory_transition_rules`, and
 * `pnpm test:advisory-state` fails if the latest SQL definition of the rules,
 * state/event/guard CHECKs or RPC allowlist ever drifts from this file. Change
 * here first, then add a NEW migration that re-seeds / re-declares the piece
 * that changed (the test prints the expected block on mismatch).
 *
 * Semantics: a state names what MILŌN is waiting for / doing right now, not
 * what the user last clicked. Nothing in this file touches the network.
 */

export const ADVISORY_STATES = [
  "onboarding",
  "context_collection",
  "financial_data_collection",
  "data_validation",
  "diagnosis",
  "forecasting",
  "recommendations",
  "accountant_review",
  "client_decision",
  "action_execution",
  "outcome_monitoring",
  "next_review",
] as const;
export type AdvisoryState = (typeof ADVISORY_STATES)[number];

/** Pseudo-state used in rules for a client that has no advisory row yet. */
export const NO_STATE = "none" as const;
/** Wildcard `from` in rules. Exact-state rules always win over wildcard ones. */
export const ANY_STATE = "*" as const;

export const ADVISORY_EVENTS = [
  // lifecycle
  "client.created",
  "cycle.backfilled",
  "cycle.restarted",
  "cycle.review_due",
  // context
  "profile.completed",
  "brain.question_answered",
  // data
  "data.uploaded",
  "data.validated",
  "data.request_opened", // reserved for P0.6
  "data.request_fulfilled", // reserved for P0.6
  // analysis
  "diagnosis.reviewed",
  "forecast.published",
  // recommendations + review
  "recommendation.proposed",
  "recommendation.approved",
  "recommendation.rejected",
  "recommendation.superseded",
  "review.signed_off",
  "review.retracted",
  // actions
  "action.created",
  "action.started",
  "action.completed",
  "action.blocked",
  // outcomes (P0.2)
  "outcome.recorded",
] as const;
export type AdvisoryEvent = (typeof ADVISORY_EVENTS)[number];

/**
 * Events the browser / server functions may append through the
 * `advisory_record_event` RPC. Everything else is emitted by DB triggers or
 * cron so the audit trail cannot be forged from the client.
 */
export const APP_WRITABLE_ADVISORY_EVENTS: readonly AdvisoryEvent[] = [
  "diagnosis.reviewed",
  "cycle.restarted",
  "data.request_opened",
  "data.request_fulfilled",
];

export const ADVISORY_GUARDS = [
  "none",
  "has_firm",
  "no_firm",
  "has_financials",
  "no_open_actions",
  "scope_advisory",
] as const;
export type AdvisoryGuard = (typeof ADVISORY_GUARDS)[number];

export const ADVISORY_ACTOR_KINDS = ["system", "owner", "accountant", "service"] as const;
export type AdvisoryActorKind = (typeof ADVISORY_ACTOR_KINDS)[number];

/** Days in outcome_monitoring before `cycle.review_due` fires. Mirrored in SQL. */
export const DEFAULT_REVIEW_CADENCE_DAYS = 30;

export type AdvisoryTransitionRule = {
  seq: number;
  event: AdvisoryEvent;
  from: AdvisoryState | typeof NO_STATE | typeof ANY_STATE;
  guard: AdvisoryGuard;
  to: AdvisoryState;
  newCycle: boolean;
};

type RuleGroup = {
  event: AdvisoryEvent;
  from: ReadonlyArray<AdvisoryTransitionRule["from"]>;
  guard?: AdvisoryGuard;
  to: AdvisoryState;
  newCycle?: boolean;
};

const PRE_DATA: readonly AdvisoryState[] = [
  "onboarding",
  "context_collection",
  "financial_data_collection",
];
const IN_ANALYSIS: readonly AdvisoryState[] = [
  "diagnosis",
  "forecasting",
  "recommendations",
  "accountant_review",
  "client_decision",
];
const IN_EXECUTION: readonly AdvisoryState[] = [
  "action_execution",
  "outcome_monitoring",
  "next_review",
];

/**
 * Grouped for readability; `ADVISORY_TRANSITION_RULES` is the expanded,
 * numbered list. Order matters within an event: the first matching rule wins.
 */
const RULE_GROUPS: readonly RuleGroup[] = [
  {
    event: "client.created",
    from: [NO_STATE],
    guard: "has_financials",
    to: "data_validation",
    newCycle: true,
  },
  { event: "client.created", from: [NO_STATE], to: "onboarding", newCycle: true },

  {
    event: "profile.completed",
    from: ["onboarding", "context_collection"],
    to: "financial_data_collection",
  },
  { event: "brain.question_answered", from: ["onboarding"], to: "context_collection" },

  // New statements before the loop closed: re-validate inside the same cycle.
  { event: "data.uploaded", from: [...PRE_DATA, ...IN_ANALYSIS], to: "data_validation" },
  // New statements after actions started: that is the next cycle's evidence.
  { event: "data.uploaded", from: IN_EXECUTION, to: "data_validation", newCycle: true },

  { event: "data.validated", from: [...PRE_DATA, "data_validation"], to: "diagnosis" },
  { event: "diagnosis.reviewed", from: ["diagnosis"], to: "forecasting" },
  { event: "forecast.published", from: ["diagnosis", "forecasting"], to: "recommendations" },

  {
    event: "recommendation.proposed",
    from: ["diagnosis", "forecasting", "recommendations"],
    guard: "has_firm",
    to: "accountant_review",
  },
  {
    event: "recommendation.proposed",
    from: ["diagnosis", "forecasting", "recommendations"],
    guard: "no_firm",
    to: "client_decision",
  },
  { event: "recommendation.approved", from: ["accountant_review"], to: "client_decision" },
  {
    event: "review.signed_off",
    from: ["accountant_review"],
    guard: "scope_advisory",
    to: "client_decision",
  },

  {
    event: "action.created",
    from: ["recommendations", "accountant_review", "client_decision"],
    to: "action_execution",
  },
  {
    event: "action.completed",
    from: ["action_execution"],
    guard: "no_open_actions",
    to: "outcome_monitoring",
  },

  {
    event: "cycle.review_due",
    from: ["action_execution", "outcome_monitoring"],
    to: "next_review",
  },
  { event: "cycle.restarted", from: [ANY_STATE], to: "financial_data_collection", newCycle: true },
];

export const ADVISORY_TRANSITION_RULES: readonly AdvisoryTransitionRule[] = (() => {
  const out: AdvisoryTransitionRule[] = [];
  let seq = 0;
  for (const g of RULE_GROUPS) {
    for (const from of g.from) {
      seq += 10;
      out.push({
        seq,
        event: g.event,
        from,
        guard: g.guard ?? "none",
        to: g.to,
        newCycle: g.newCycle ?? false,
      });
    }
  }
  return out;
})();

/** Guard inputs. Triggers fill these from the row that fired; the RPC from args. */
export type AdvisoryTransitionContext = {
  hasFirm?: boolean;
  hasFinancials?: boolean;
  openActions?: number;
  scope?: string | null;
};

export function guardPasses(guard: AdvisoryGuard, ctx: AdvisoryTransitionContext): boolean {
  switch (guard) {
    case "none":
      return true;
    case "has_firm":
      return ctx.hasFirm === true;
    case "no_firm":
      return ctx.hasFirm !== true;
    case "has_financials":
      return ctx.hasFinancials === true;
    case "no_open_actions":
      return (ctx.openActions ?? 0) === 0;
    case "scope_advisory":
      return ctx.scope === "advisory" || ctx.scope === "action_plan";
  }
}

export type AdvisoryTransition = {
  from: AdvisoryState | null;
  to: AdvisoryState;
  changed: boolean;
  newCycle: boolean;
  /** Rule that fired, if any (null = event recorded, state unchanged). */
  rule: AdvisoryTransitionRule | null;
};

/**
 * Resolve one event against the current state. Never throws on unknown
 * combinations: an unmatched event is recorded with `changed: false` so the
 * audit trail stays complete without blocking the write that triggered it.
 *
 * A client with no state yet is first implicitly `client.created`, then the
 * incoming event is applied on top — mirrors `public.advisory_apply_event`.
 */
export function nextAdvisoryState(
  current: AdvisoryState | null | undefined,
  event: AdvisoryEvent,
  ctx: AdvisoryTransitionContext = {},
): AdvisoryTransition {
  let from: AdvisoryState | null = current ?? null;
  let bootstrapped = false;
  if (from === null && event !== "client.created") {
    const boot = nextAdvisoryState(null, "client.created", ctx);
    from = boot.to;
    bootstrapped = true;
  }

  const fromKey = from ?? NO_STATE;
  const candidates = ADVISORY_TRANSITION_RULES.filter(
    (r) => r.event === event && (r.from === fromKey || r.from === ANY_STATE),
  ).sort((a, b) => {
    // exact `from` beats wildcard; then declaration order
    const ax = a.from === ANY_STATE ? 1 : 0;
    const bx = b.from === ANY_STATE ? 1 : 0;
    return ax - bx || a.seq - b.seq;
  });
  const rule = candidates.find((r) => guardPasses(r.guard, ctx)) ?? null;

  if (!rule) {
    return {
      from: current ?? null,
      to: from ?? "onboarding",
      changed: bootstrapped,
      newCycle: bootstrapped,
      rule: null,
    };
  }
  return {
    from: current ?? null,
    to: rule.to,
    changed: bootstrapped || rule.to !== from,
    newCycle: bootstrapped || rule.newCycle,
    rule,
  };
}

// ── Labels ───────────────────────────────────────────────────────────────────

export const ADVISORY_STATE_LABELS: Record<AdvisoryState, { label: string; waitingFor: string }> = {
  onboarding: { label: "Getting started", waitingFor: "Tell MILŌN about the business." },
  context_collection: {
    label: "Building context",
    waitingFor: "A few questions about how the business runs.",
  },
  financial_data_collection: {
    label: "Waiting for numbers",
    waitingFor: "Upload statements or connect accounting.",
  },
  data_validation: { label: "Checking the numbers", waitingFor: "Confirm the extracted figures." },
  diagnosis: { label: "Diagnosis ready", waitingFor: "Review the health diagnosis." },
  forecasting: { label: "Forecasting", waitingFor: "Publish the 13-week cash forecast." },
  recommendations: {
    label: "Recommendations",
    waitingFor: "Turn the diagnosis into proposed moves.",
  },
  accountant_review: {
    label: "With your accountant",
    waitingFor: "Accountant to review and approve.",
  },
  client_decision: {
    label: "Your decision",
    waitingFor: "Accept a recommendation and start actions.",
  },
  action_execution: { label: "Actions in progress", waitingFor: "Complete the open actions." },
  outcome_monitoring: {
    label: "Measuring outcome",
    waitingFor: "Next period's numbers to measure impact.",
  },
  next_review: {
    label: "Review due",
    waitingFor: "Upload the latest statements to start the next cycle.",
  },
};

export function isAdvisoryState(v: unknown): v is AdvisoryState {
  return typeof v === "string" && (ADVISORY_STATES as readonly string[]).includes(v);
}

export function isAdvisoryEvent(v: unknown): v is AdvisoryEvent {
  return typeof v === "string" && (ADVISORY_EVENTS as readonly string[]).includes(v);
}

// ── Fallback derivation (before the migration is applied) ────────────────────

export type AdvisoryFacts = {
  hasFirm: boolean;
  hasProfile: boolean;
  hasFinancials: boolean;
  hasSnapshot: boolean;
  hasForecast: boolean;
  proposedSteps: number;
  approvedSteps: number;
  openActions: number;
  doneActions: number;
};

/**
 * Best-effort state from existing tables. Used (a) by the migration backfill —
 * keep the CASE there in the same order — and (b) by `getAdvisoryState` when
 * the advisory relations do not exist yet, so callers always get a state.
 */
export function inferAdvisoryStateFromFacts(f: AdvisoryFacts): AdvisoryState {
  if (f.openActions > 0) return "action_execution";
  if (f.doneActions > 0) return "outcome_monitoring";
  if (f.approvedSteps > 0) return "client_decision";
  if (f.proposedSteps > 0) return f.hasFirm ? "accountant_review" : "client_decision";
  if (f.hasForecast) return "recommendations";
  if (f.hasSnapshot) return "diagnosis";
  if (f.hasFinancials) return "data_validation";
  if (f.hasProfile) return "financial_data_collection";
  return "onboarding";
}

/** PostgREST error text when the advisory tables/columns are not migrated yet. */
export function isMissingAdvisoryRelation(err: unknown): boolean {
  const msg =
    typeof err === "string"
      ? err
      : err && typeof err === "object" && "message" in err
        ? String((err as { message?: unknown }).message ?? "")
        : "";
  return /does not exist|schema cache|could not find the function|advisory_(state|cycle_id|events|cycles|record_event)/i.test(
    msg,
  );
}

// ── SQL seed generation (used by the test and when authoring the migration) ──

function sqlLit(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

/** Deterministic VALUES block the migration must contain verbatim. */
export function advisoryRulesSqlValues(): string {
  return ADVISORY_TRANSITION_RULES.map(
    (r) =>
      `  (${r.seq}, ${sqlLit(r.event)}, ${sqlLit(r.from)}, ${sqlLit(r.guard)}, ${sqlLit(r.to)}, ${
        r.newCycle ? "true" : "false"
      })`,
  ).join(",\n");
}
