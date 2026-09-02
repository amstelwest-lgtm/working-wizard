/**
 * Single source of truth for Phase 2 validated-learning metrics.
 * Dashboard, digest, and ad-hoc queries must import from here — never
 * restate thresholds or questions in a second file.
 *
 * Stack note: this is TypeScript (TanStack Start), not the brief's
 * vanilla `src/metrics/definitions.js`.
 *
 * H3 (extraction corrections) is blocked — we cannot tell AI-fill from a
 * blank form. Do not ship a correction-rate number.
 */

export const HYPOTHESES = {
  VALUE_DIAGNOSTIC: {
    id: "H1",
    kind: "value",
    statement:
      "Accountants find the Business Health Score genuinely diagnostic — not a prettier version of what they already see in the trial balance.",
    falsifiedBy:
      "Accountants generate scores but rarely open pillar drilldowns or send reports.",
  },
  VALUE_ACCOUNTABILITY_LOOP: {
    id: "H2",
    kind: "value",
    statement:
      "The recommendation → assignment → completion loop is the defensible wedge: accountants use it and SME employees actually complete tasks.",
    falsifiedBy:
      "Tasks are assigned but completion rate stays low, or the Action Plan is never opened while reports are used — meaning the moat is a feature nobody uses.",
  },
  VALUE_INGESTION_TRUST: {
    id: "H3",
    kind: "value",
    status: "blocked" as const,
    statement:
      "PDF/photo AFS extraction is accurate enough that accountants trust it rather than re-keying — the wedge for SMEs not on live-API ledgers.",
    falsifiedBy:
      "High manual-correction rate per upload, or abandonment after first extraction.",
    blockedReason:
      "Cannot tell AI-fill vs a blank form. Do not compute EXTRACTION_CORRECTION_RATE.",
  },
  GROWTH_CHANNEL: {
    id: "H4",
    kind: "growth",
    statement:
      "Accountants are a scaling channel: an activated practice expands entity count over time and refers other practices.",
    falsifiedBy: "Practices plateau at 1–2 entities, or referrals are zero outside personal network.",
  },
  COMMERCIAL_PRICE: {
    id: "H5",
    kind: "value",
    statement:
      "The per-entity price point is acceptable to unaffiliated accountants without a founder relationship.",
    falsifiedBy:
      "Price objections cluster, or unaffiliated practices convert materially worse than the Founding Practice cohort.",
  },
} as const;

export type HypothesisId = (typeof HYPOTHESES)[keyof typeof HYPOTHESES]["id"];

export const METRICS = {
  ACTIVATION_RATE: {
    key: "ACTIVATION_RATE",
    label: "Practice activation (14d)",
    hypothesis: "H1",
    question:
      "Of practices that signed up, how many sent a real report to a real client within 14 days?",
    unit: "percent",
    cohortBy: "signup_week",
    healthy: 40,
    watch: 25,
    inverted: false,
    /** Activation = report.sent (not download / pdf_download) within 14d of firms.created_at. */
    eventKeys: ["practice.created", "report.sent"],
    decisionIfBad:
      "Onboarding or core value is broken. Do NOT add features. Call every stalled practice with a Mom Test question about what happened after upload.",
  },
  LOOP_COMPLETION_RATE: {
    key: "LOOP_COMPLETION_RATE",
    label: "Task completion rate (assigned → done, 14d)",
    hypothesis: "H2",
    question: "Of tasks assigned to SME employees, how many are actually completed?",
    unit: "percent",
    cohortBy: "assignment_week",
    healthy: 50,
    watch: 30,
    inverted: false,
    eventKeys: ["task.assigned", "task.completed"],
    decisionIfBad:
      "The claimed moat is not real yet. Investigate before pricing or positioning around the accountability loop. Candidate zoom-in or customer-need pivot.",
  },
  ASSIGNMENT_ADOPTION: {
    key: "ASSIGNMENT_ADOPTION",
    label: "Report → assignment conversion",
    hypothesis: "H2",
    question: "Of entities with a sent report, how many had ≥1 task assigned within 7 days?",
    unit: "percent",
    cohortBy: "report_week",
    healthy: 35,
    watch: 20,
    inverted: false,
    eventKeys: ["report.sent", "task.assigned"],
    decisionIfBad:
      "Accountants want the diagnostic, not the workflow. That makes MILŌN a reporting tool competing directly with Syft/Fathom — a strategically worse position.",
  },
  ENTITY_EXPANSION: {
    key: "ENTITY_EXPANSION",
    label: "Median entities per practice by month",
    hypothesis: "H4",
    question: "Does an activated practice add more clients over time, or plateau?",
    unit: "count",
    cohortBy: "signup_month",
    healthy: 3,
    watch: 2,
    inverted: false,
    eventKeys: ["practice.created", "entity.created"],
    decisionIfBad:
      "The channel does not compound. Revisit growth hypothesis — possibly a channel pivot.",
  },
  SECOND_MONTH_RETENTION: {
    key: "SECOND_MONTH_RETENTION",
    label: "Month-2 active practices",
    hypothesis: "H1",
    question: "Of practices active in month 1, how many are still generating value in month 2?",
    unit: "percent",
    cohortBy: "signup_month",
    healthy: 60,
    watch: 40,
    inverted: false,
    eventKeys: ["upload.succeeded", "report.sent", "task.assigned", "task.completed"],
    decisionIfBad: "Novelty, not utility. The strongest single falsifier of the value hypothesis.",
  },
} as const;

/** Present in the brief; not computed until correction is observable. */
export const BLOCKED_METRICS = {
  EXTRACTION_CORRECTION_RATE: {
    key: "EXTRACTION_CORRECTION_RATE",
    label: "Manual corrections per upload",
    hypothesis: "H3",
    blocked: true,
    blockedReason: HYPOTHESES.VALUE_INGESTION_TRUST.blockedReason,
    question: "How many extracted figures does an accountant have to fix by hand?",
    unit: "count",
    cohortBy: "upload_week",
    healthy: 1,
    watch: 4,
    inverted: true,
    eventKeys: [] as string[],
    decisionIfBad:
      "Trust in ingestion is the bottleneck. Fix the pipeline before any go-to-market spend.",
  },
} as const;

export const COMMITMENT_LADDER = [
  { rung: "signed_up", points: 0, note: "Free. Means nothing.", eventKey: "practice.created" },
  {
    rung: "demo_entity_only",
    points: 1,
    note: "Curiosity, not commitment.",
    eventKey: "entity.created",
  },
  {
    rung: "real_client_uploaded",
    points: 5,
    note: "Gave up real client data — first real signal.",
    eventKey: "upload.succeeded",
  },
  {
    rung: "branding_configured",
    points: 8,
    note: "Put their own logo on it. Reputational skin in the game.",
    eventKey: "practice.brand.configured",
  },
  {
    rung: "report_sent_to_client",
    points: 15,
    note: "Staked their client relationship on MILŌN output.",
    eventKey: "report.sent",
  },
  {
    rung: "task_assigned",
    points: 20,
    note: "Used the workflow, not just the diagnostic.",
    eventKey: "task.assigned",
  },
  {
    rung: "second_entity_added",
    points: 25,
    note: "Expansion within practice.",
    eventKey: "entity.created",
  },
  {
    rung: "colleague_invited",
    points: 30,
    note: "Internal advocacy.",
    eventKey: "seat.invited",
  },
  {
    rung: "invoice_paid",
    points: 50,
    note: "Money. The only unambiguous signal.",
    eventKey: "payment.recorded",
  },
  {
    rung: "referred_another_practice",
    points: 60,
    note: "Staked reputation externally — strongest growth signal.",
    eventKey: null,
    unmeasurable: true,
    unmeasurableReason: "referral_code is unused; no referred_another_practice event yet.",
  },
] as const;

export type StallType =
  | "signup_no_entity"
  | "upload_no_report"
  | "report_no_send"
  | "send_no_assign"
  | "assign_no_completion"
  | "month2_dormant";

export const STALL_RULES: Array<{
  stallType: StallType;
  severity: "high" | "medium" | "low";
  condition: string;
  suggestedQuestion: string;
}> = [
  {
    stallType: "signup_no_entity",
    severity: "medium",
    condition: "Signed up >5d, no entity",
    suggestedQuestion:
      "Walk me through what you did right after you signed up — where did you get stuck?",
  },
  {
    stallType: "upload_no_report",
    severity: "high",
    condition: "Uploaded >7d, no report sent or downloaded",
    suggestedQuestion:
      "You uploaded a client's statements but didn't generate a report — what happened next?",
  },
  {
    stallType: "report_no_send",
    severity: "high",
    condition: "Report downloaded/zipped >7d, never sent",
    suggestedQuestion: "You made a report for a client but didn't send it. What stopped you?",
  },
  {
    stallType: "send_no_assign",
    severity: "high",
    condition: "Report sent >10d, no task assigned",
    suggestedQuestion:
      "After the client saw the report, what did you actually do to get things fixed?",
  },
  {
    stallType: "assign_no_completion",
    severity: "high",
    condition: "Tasks assigned >14d, 0 completed",
    suggestedQuestion:
      "Talk me through the last task you assigned — what did the person on the other end do?",
  },
  {
    stallType: "month2_dormant",
    severity: "high",
    condition: "Active m1, zero activity 21d into m2",
    suggestedQuestion: "What were you using instead of MILŌN this month?",
  },
];

/** high_correction_rate is listed in the brief but blocked with H3. */
export const BLOCKED_STALLS = {
  high_correction_rate: {
    stallType: "high_correction_rate",
    blocked: true,
    blockedReason: HYPOTHESES.VALUE_INGESTION_TRUST.blockedReason,
    suggestedQuestion:
      "Which numbers did you have to fix by hand last time, and how did you catch them?",
  },
} as const;

const FORBIDDEN_QUESTION = /^(would you|do you like|how satisfied|is it useful)\b/i;

export function isBehavioralQuestion(question: string): boolean {
  const q = question.trim();
  if (q.length < 12) return false;
  return !FORBIDDEN_QUESTION.test(q);
}

export function assertBehavioralQuestion(question: string): void {
  if (!isBehavioralQuestion(question)) {
    throw new Error(`Stall question is compliment/hypothetical bait: ${question}`);
  }
}

export const LOOP_INTERPRETATION = [
  {
    reading: "High assignment + low completion",
    meaning: "The loop is theatre. The moat is unproven.",
  },
  {
    reading: "High engagement + low completion",
    meaning:
      "The task UX or the task content is wrong (tasks too vague, too big, or aimed at the wrong person).",
  },
  {
    reading: "Low dispatch → engagement",
    meaning: "Deliverability problem, not a product problem. Check bounces before concluding value.",
  },
  {
    reading: "Low assignment despite high report send",
    meaning:
      "Accountants want diagnostics, not workflow. The most strategically dangerous reading.",
  },
] as const;

export const SITUATION_MIN_CHARS = 21;

export const HYPOTHESIS_STATUSES = [
  "untested",
  "supported",
  "contradicted",
  "inconclusive",
  "blocked",
] as const;

export type HypothesisStatus = (typeof HYPOTHESIS_STATUSES)[number];

export const EXPERIMENT_DECISIONS = [
  "persevere",
  "pivot",
  "inconclusive",
  "abandoned",
] as const;

export type ExperimentDecision = (typeof EXPERIMENT_DECISIONS)[number];

export const PIVOT_TYPES = [
  "zoom_in",
  "zoom_out",
  "customer_segment",
  "customer_need",
  "platform",
  "business_architecture",
  "value_capture",
  "engine_of_growth",
  "channel",
  "technology",
] as const;

export type PivotType = (typeof PIVOT_TYPES)[number];

export const EVENT_RETENTION_MONTHS = 24;

export const PREDICTION_MIN_CHARS = 9;

/** Views / tables created by Phase 2 SQL. No cumulative counters. */
export const DERIVED_OBJECTS = {
  views: [
    "analytics.v_real_events",
    "analytics.v_practice_activation",
    "analytics.v_accountability_loop",
    "analytics.v_assignment_adoption",
    "analytics.v_entity_expansion",
    "analytics.v_month2_retention",
    "analytics.v_practice_commitment_current",
  ],
  tables: [
    "analytics.practice_commitment_weekly",
    "analytics.founder_action_queue",
    "analytics.customer_signals",
  ],
} as const;

export const ANALYTICS_PHASE2_SQL = [
  "20260902200000_analytics_derived_views.sql",
  "20260902201000_analytics_commitment_stalls.sql",
] as const;

export const ANALYTICS_PHASE3_SQL = ["20260902300000_analytics_experiments_digest.sql"] as const;

export const ANALYTICS_SQL_TO_RUN = [...ANALYTICS_PHASE2_SQL, ...ANALYTICS_PHASE3_SQL] as const;
