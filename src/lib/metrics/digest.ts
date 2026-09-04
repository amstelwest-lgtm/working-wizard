/**
 * Founder instrument: headline number, hypothesis status, weekly digest.
 * Pure functions — dashboard and /api/metrics-digest both import from here.
 * Lead with bad news. No cumulative totals. No NPS.
 */

import {
  HYPOTHESES,
  METRICS,
  type HypothesisStatus,
} from "@/lib/metrics/definitions";

export type ActivationRow = {
  cohort_week: string;
  is_founding_practice: boolean;
  practices: number;
  reached_entity?: number;
  reached_upload?: number;
  reached_download?: number;
  reached_send?: number;
  reached_assign?: number;
  reached_completion?: number;
  activation_14d_pct: number | null;
};

export type LoopRow = {
  cohort_week: string;
  tasks_assigned: number;
  emails_dispatched: number;
  links_engaged_by_human: number;
  status_progressed: number;
  completed: number;
  completion_14d_pct: number | null;
  median_hours_to_complete?: number | null;
};

export type AdoptionRow = {
  cohort_week: string;
  entities_with_send: number;
  assigned_within_7d: number;
  assignment_adoption_pct: number | null;
};

export type ExpansionRow = {
  cohort_month: string;
  is_founding_practice: boolean;
  practices: number;
  median_entities: number | null;
};

export type RetentionRow = {
  cohort_month: string;
  is_founding_practice: boolean;
  active_month1: number;
  active_month2: number;
  month2_retention_pct: number | null;
};

export type QueueRow = {
  id: number;
  practice_name?: string | null;
  stall_type: string;
  severity: string;
  suggested_question: string;
  status?: string;
  is_founding_practice?: boolean;
};

export type Traffic = "empty" | "healthy" | "watch" | "bad";

export type Headline = {
  metricKey: keyof typeof METRICS;
  question: string;
  value: number | null;
  unit: string;
  cohortLabel: string;
  isFounding: boolean;
  traffic: Traffic;
  decisionIfBad: string;
};

export type HypothesisCard = {
  id: "H1" | "H2" | "H3" | "H4" | "H5";
  statement: string;
  status: HypothesisStatus;
  evidence: string[];
  blockedReason?: string;
};

export type DigestInput = {
  activation: ActivationRow[];
  loop: LoopRow[];
  adoption: AdoptionRow[];
  expansion: ExpansionRow[];
  retention: RetentionRow[];
  queue: QueueRow[];
  now?: number;
};

export type Instrument = {
  headline: Headline;
  worstLine: string;
  hypotheses: HypothesisCard[];
  loopTotals: {
    assigned: number;
    dispatched: number;
    engaged: number;
    progressed: number;
    completed: number;
  };
};

const CLOSED_DAYS = 14;

export function isClosedCohort(cohortWeek: string, now = Date.now(), windowDays = CLOSED_DAYS): boolean {
  const t = Date.parse(cohortWeek);
  if (!Number.isFinite(t)) return false;
  return t + windowDays * 86_400_000 < now;
}

export function trafficLight(
  value: number | null | undefined,
  healthy: number,
  watch: number,
): Traffic {
  if (value == null || Number.isNaN(Number(value))) return "empty";
  const n = Number(value);
  if (n >= healthy) return "healthy";
  if (n >= watch) return "watch";
  return "bad";
}

export function latestClosed<T extends { cohort_week: string }>(
  rows: T[],
  now: number,
): T | undefined {
  return rows
    .filter((r) => isClosedCohort(r.cohort_week, now))
    .sort((a, b) => Date.parse(b.cohort_week) - Date.parse(a.cohort_week))[0];
}

export function latestMonth<T extends { cohort_month: string }>(rows: T[]): T | undefined {
  return [...rows].sort((a, b) => Date.parse(b.cohort_month) - Date.parse(a.cohort_month))[0];
}

export function unaffiliated<T extends { is_founding_practice?: boolean }>(rows: T[]): T[] {
  return rows.filter((r) => !r.is_founding_practice);
}

export type ClosedReadings = {
  activationPct: number | null;
  loopPct: number | null;
  adoptionPct: number | null;
  retentionPct: number | null;
  medianEntities: number | null;
  activationRow?: ActivationRow;
  loopRow?: LoopRow;
};

export function readClosedMetrics(input: DigestInput): ClosedReadings {
  const now = input.now ?? Date.now();
  const actReal = unaffiliated(input.activation);
  const expReal = unaffiliated(input.expansion);
  const retReal = unaffiliated(input.retention);
  const loopClosed = latestClosed(input.loop.filter((r) => r.tasks_assigned > 0), now);
  const actClosed = latestClosed(actReal.filter((r) => r.practices > 0), now);
  const adoptClosed = latestClosed(input.adoption.filter((r) => r.entities_with_send > 0), now);
  const retLatest = latestMonth(retReal.filter((r) => r.active_month1 > 0));
  const expLatest = latestMonth(expReal.filter((r) => r.practices > 0));
  return {
    activationPct: actClosed?.activation_14d_pct ?? null,
    loopPct: loopClosed?.completion_14d_pct ?? null,
    adoptionPct: adoptClosed?.assignment_adoption_pct ?? null,
    retentionPct: retLatest?.month2_retention_pct ?? null,
    medianEntities: expLatest?.median_entities ?? null,
    activationRow: actClosed,
    loopRow: loopClosed,
  };
}

function combineStatus(flags: Traffic[]): HypothesisStatus {
  const usable = flags.filter((f) => f !== "empty");
  if (usable.length === 0) return "untested";
  if (usable.every((f) => f === "healthy")) return "supported";
  if (usable.some((f) => f === "bad")) return "contradicted";
  return "inconclusive";
}

function pct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return `${Number(n)}%`;
}

export function buildInstrument(input: DigestInput): Instrument {
  const now = input.now ?? Date.now();
  const actReal = unaffiliated(input.activation);
  const expReal = unaffiliated(input.expansion);
  const retReal = unaffiliated(input.retention);

  const loopClosed = latestClosed(input.loop.filter((r) => r.tasks_assigned > 0), now);
  const actClosed = latestClosed(actReal.filter((r) => r.practices > 0), now);
  const adoptClosed = latestClosed(input.adoption.filter((r) => r.entities_with_send > 0), now);
  const retLatest = latestMonth(retReal.filter((r) => r.active_month1 > 0));
  const expLatest = latestMonth(expReal.filter((r) => r.practices > 0));

  const loopTraffic = trafficLight(
    loopClosed?.completion_14d_pct ?? null,
    METRICS.LOOP_COMPLETION_RATE.healthy,
    METRICS.LOOP_COMPLETION_RATE.watch,
  );
  const actTraffic = trafficLight(
    actClosed?.activation_14d_pct ?? null,
    METRICS.ACTIVATION_RATE.healthy,
    METRICS.ACTIVATION_RATE.watch,
  );
  const adoptTraffic = trafficLight(
    adoptClosed?.assignment_adoption_pct ?? null,
    METRICS.ASSIGNMENT_ADOPTION.healthy,
    METRICS.ASSIGNMENT_ADOPTION.watch,
  );
  const retTraffic = trafficLight(
    retLatest?.month2_retention_pct ?? null,
    METRICS.SECOND_MONTH_RETENTION.healthy,
    METRICS.SECOND_MONTH_RETENTION.watch,
  );
  const expTraffic = trafficLight(
    expLatest?.median_entities ?? null,
    METRICS.ENTITY_EXPANSION.healthy,
    METRICS.ENTITY_EXPANSION.watch,
  );

  const headline: Headline = loopClosed
    ? {
        metricKey: "LOOP_COMPLETION_RATE",
        question: METRICS.LOOP_COMPLETION_RATE.question,
        value: loopClosed.completion_14d_pct,
        unit: METRICS.LOOP_COMPLETION_RATE.unit,
        cohortLabel: `assignment week ${loopClosed.cohort_week.slice(0, 10)} · ${loopClosed.tasks_assigned} tasks`,
        isFounding: false,
        traffic: loopTraffic,
        decisionIfBad: METRICS.LOOP_COMPLETION_RATE.decisionIfBad,
      }
    : {
        metricKey: "ACTIVATION_RATE",
        question: METRICS.ACTIVATION_RATE.question,
        value: actClosed?.activation_14d_pct ?? null,
        unit: METRICS.ACTIVATION_RATE.unit,
        cohortLabel: actClosed
          ? `signup week ${actClosed.cohort_week.slice(0, 10)} · ${actClosed.practices} unaffiliated practices`
          : "no closed unaffiliated cohort yet",
        isFounding: false,
        traffic: actTraffic,
        decisionIfBad: METRICS.ACTIVATION_RATE.decisionIfBad,
      };

  const candidates: Array<{ line: string; deficit: number }> = [];
  const push = (label: string, value: number | null | undefined, healthy: number, decision: string) => {
    if (value == null) return;
    candidates.push({
      line: `${label} ${Number(value)}${healthy >= 10 ? "%" : ""} (need ${healthy}${healthy >= 10 ? "%" : ""}). ${decision}`,
      deficit: healthy - Number(value),
    });
  };
  push(
    "Loop completion",
    loopClosed?.completion_14d_pct ?? null,
    METRICS.LOOP_COMPLETION_RATE.healthy,
    METRICS.LOOP_COMPLETION_RATE.decisionIfBad,
  );
  push(
    "Practice activation",
    actClosed?.activation_14d_pct ?? null,
    METRICS.ACTIVATION_RATE.healthy,
    METRICS.ACTIVATION_RATE.decisionIfBad,
  );
  push(
    "Report → assignment",
    adoptClosed?.assignment_adoption_pct ?? null,
    METRICS.ASSIGNMENT_ADOPTION.healthy,
    METRICS.ASSIGNMENT_ADOPTION.decisionIfBad,
  );
  push(
    "Month-2 retention",
    retLatest?.month2_retention_pct ?? null,
    METRICS.SECOND_MONTH_RETENTION.healthy,
    METRICS.SECOND_MONTH_RETENTION.decisionIfBad,
  );
  push(
    "Median entities",
    expLatest?.median_entities ?? null,
    METRICS.ENTITY_EXPANSION.healthy,
    METRICS.ENTITY_EXPANSION.decisionIfBad,
  );

  const worst = candidates.sort((a, b) => b.deficit - a.deficit)[0];
  const worstLine = worst
    ? `WORST THIS WEEK: ${worst.line}`
    : "WORST THIS WEEK: No closed unaffiliated cohort yet. Do not celebrate signups.";

  const hypotheses: HypothesisCard[] = [
    {
      id: "H1",
      statement: HYPOTHESES.VALUE_DIAGNOSTIC.statement,
      status: combineStatus([actTraffic, retTraffic]),
      evidence: [
        `Activation 14d: ${pct(actClosed?.activation_14d_pct ?? null)} (unaffiliated, closed cohort)`,
        `Month-2 retention: ${pct(retLatest?.month2_retention_pct ?? null)}`,
      ],
    },
    {
      id: "H2",
      statement: HYPOTHESES.VALUE_ACCOUNTABILITY_LOOP.statement,
      status: combineStatus([loopTraffic, adoptTraffic]),
      evidence: [
        `Task completion 14d: ${pct(loopClosed?.completion_14d_pct ?? null)}`,
        `Report → assignment 7d: ${pct(adoptClosed?.assignment_adoption_pct ?? null)}`,
      ],
    },
    {
      id: "H3",
      statement: HYPOTHESES.VALUE_INGESTION_TRUST.statement,
      status: "blocked",
      evidence: [],
      blockedReason: HYPOTHESES.VALUE_INGESTION_TRUST.blockedReason,
    },
    {
      id: "H4",
      statement: HYPOTHESES.GROWTH_CHANNEL.statement,
      status: combineStatus([expTraffic]),
      evidence: [`Median entities: ${expLatest?.median_entities ?? "—"} (unaffiliated)`],
    },
    {
      id: "H5",
      statement: HYPOTHESES.COMMERCIAL_PRICE.statement,
      status: "untested",
      evidence: ["No unaffiliated paid conversion view yet. Do not invent a price-acceptance number."],
    },
  ];

  const loopTotals = input.loop.reduce(
    (acc, row) => ({
      assigned: acc.assigned + Number(row.tasks_assigned || 0),
      dispatched: acc.dispatched + Number(row.emails_dispatched || 0),
      engaged: acc.engaged + Number(row.links_engaged_by_human || 0),
      progressed: acc.progressed + Number(row.status_progressed || 0),
      completed: acc.completed + Number(row.completed || 0),
    }),
    { assigned: 0, dispatched: 0, engaged: 0, progressed: 0, completed: 0 },
  );

  return { headline, worstLine, hypotheses, loopTotals };
}

const VANITY = /total (users|signups|reports|tasks)|cumulative|nps|how satisfied/i;

export function buildDigestText(input: DigestInput & { hypothesisChanges?: string[] }): string {
  const inst = buildInstrument(input);
  const open = input.queue.filter((q) => !q.status || q.status === "open");
  const changes = input.hypothesisChanges?.length
    ? input.hypothesisChanges.join("\n")
    : inst.hypotheses.map((h) => `${h.id}: ${h.status}`).join("\n");

  const queueLines = open.length
    ? open
        .map(
          (q) =>
            `- [${q.severity}] ${q.practice_name || "unnamed practice"} — ${q.stall_type}\n  Ask: ${q.suggested_question}`,
        )
        .join("\n")
    : "- No open stalls. That is not a win if the funnel is empty.";

  const h = inst.headline;
  const numberLine =
    h.value == null
      ? `${h.question}\nNo number yet. ${h.cohortLabel}.`
      : `${h.question}\n${h.value}${h.unit === "percent" ? "%" : ""} · ${h.cohortLabel} · ${h.traffic}`;

  const body = [
    inst.worstLine,
    "",
    "THE NUMBER",
    numberLine,
    `If bad: ${h.decisionIfBad}`,
    "",
    "HYPOTHESES",
    changes,
    "",
    "CALL LIST",
    queueLines,
    "",
    "Founding Practice is split out of every headline. GET on a task link is not engagement.",
  ].join("\n");

  if (VANITY.test(body)) {
    throw new Error("digest leaked a vanity phrase");
  }
  return body;
}

export function digestSubject(worstLine: string): string {
  const clipped = worstLine.replace(/^WORST THIS WEEK:\s*/i, "").slice(0, 72);
  return `MILŌN · ${clipped}`;
}
