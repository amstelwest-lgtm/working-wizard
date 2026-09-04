/**
 * Presentation layer for /founder/metrics.
 * Turns the validated-learning bundle into copy a founder can act on.
 * Does not invent numbers. Does not blend founding practice into headlines.
 */

import { COMMITMENT_LADDER, LOOP_INTERPRETATION, METRICS, STALL_RULES } from "@/lib/metrics/definitions";
import {
  readClosedMetrics,
  trafficLight,
  type ActivationRow,
  type ClosedReadings,
  type DigestInput,
  type Headline,
  type Instrument,
  type QueueRow,
  type Traffic,
} from "@/lib/metrics/digest";

export const STALL_COPY: Record<
  string,
  { title: string; who: "Accountant" | "Owner / staff"; why: string }
> = {
  signup_no_entity: {
    title: "Signed up, never added a client",
    who: "Accountant",
    why: "Activation never started. Call before adding more product.",
  },
  upload_no_report: {
    title: "Uploaded, never produced a report",
    who: "Accountant",
    why: "They gave us real data and then stalled. Highest-value call.",
  },
  report_no_send: {
    title: "Built a report, never sent it",
    who: "Accountant",
    why: "They do not trust it enough to put their name on it.",
  },
  send_no_assign: {
    title: "Sent a report, never assigned a task",
    who: "Accountant",
    why: "They want the diagnostic, not the loop. That is the dangerous reading.",
  },
  assign_no_completion: {
    title: "Assigned work, nobody finished it",
    who: "Owner / staff",
    why: "The loop is theatre until someone on the client side actually does the task.",
  },
  month2_dormant: {
    title: "Used it in month one, gone in month two",
    who: "Accountant",
    why: "Novelty, not utility. Strongest falsifier of the value hypothesis.",
  },
};

export const HYPOTHESIS_PLAIN: Record<string, { title: string; inOneLine: string }> = {
  H1: {
    title: "The score is actually useful",
    inOneLine: "Accountants send a real report, then come back next month.",
  },
  H2: {
    title: "The loop is the product",
    inOneLine: "After a report, they assign work — and the client finishes it.",
  },
  H3: {
    title: "Extraction is trusted",
    inOneLine: "We cannot measure this yet. Do not guess a correction rate.",
  },
  H4: {
    title: "Practices grow their book here",
    inOneLine: "An activated firm adds more clients over time.",
  },
  H5: {
    title: "Unaffiliated firms will pay",
    inOneLine: "No clean paid-conversion view yet. Do not invent one.",
  },
};

export const RUNG_COPY: Record<string, string> = Object.fromEntries(
  COMMITMENT_LADDER.map((r) => [r.rung, r.note]),
);

export const RUNG_LABEL: Record<string, string> = {
  signed_up: "Signed up",
  demo_entity_only: "Added a demo client",
  real_client_uploaded: "Uploaded real figures",
  branding_configured: "Put their logo on it",
  report_sent_to_client: "Sent a report to a client",
  task_assigned: "Assigned a task",
  second_entity_added: "Added a second client",
  colleague_invited: "Invited a colleague",
  invoice_paid: "Paid",
  referred_another_practice: "Referred another practice",
};

export type ScorecardItem = {
  key: keyof typeof METRICS;
  shortLabel: string;
  question: string;
  value: number | null;
  unit: "percent" | "count";
  traffic: Traffic;
  healthy: number;
  who: "Accountant" | "Owner / staff" | "Both";
  meaning: string;
};

export type FunnelStep = {
  key: string;
  label: string;
  count: number;
  pctOfFirst: number;
  who: "Accountant" | "Owner / staff";
};

export type ActivationStep = {
  key: string;
  label: string;
  count: number;
  of: number;
};

export type ConversationPulse = {
  available: boolean;
  sourced: number;
  contacted: number;
  replied: number;
  meeting: number;
  trial: number;
  won: number;
  replyRatePct: number | null;
};

export type CommitmentCard = {
  practiceId: string;
  name: string;
  rung: string;
  rungLabel: string;
  note: string;
  points: number;
  founding: boolean;
};

export type NextMove = {
  kind: "call" | "decide" | "empty";
  title: string;
  body: string;
  question?: string;
  practice?: string;
};

export function stallTitle(stallType: string): string {
  return STALL_COPY[stallType]?.title ?? stallType.replace(/_/g, " ");
}

export function stallWho(stallType: string): string {
  return STALL_COPY[stallType]?.who ?? "Practice";
}

export function stallWhy(stallType: string): string {
  return STALL_COPY[stallType]?.why ?? STALL_RULES.find((r) => r.stallType === stallType)?.condition ?? "";
}

export function headlineTitle(h: Headline): string {
  if (h.metricKey === "LOOP_COMPLETION_RATE") return "Tasks that actually got done";
  return "Practices that sent a real report";
}

export function trafficWord(t: Traffic): string {
  if (t === "healthy") return "On track";
  if (t === "watch") return "Watch";
  if (t === "bad") return "Broken";
  return "No reading yet";
}

export function buildScorecard(readings: ClosedReadings): ScorecardItem[] {
  const activation = readings.activationPct;
  const loop = readings.loopPct;
  const adoption = readings.adoptionPct;
  const retention = readings.retentionPct;
  const expansion = readings.medianEntities;

  return [
    {
      key: "ACTIVATION_RATE",
      shortLabel: "Sent a report",
      question: METRICS.ACTIVATION_RATE.question,
      value: activation ?? null,
      unit: "percent",
      traffic: trafficLight(activation, METRICS.ACTIVATION_RATE.healthy, METRICS.ACTIVATION_RATE.watch),
      healthy: METRICS.ACTIVATION_RATE.healthy,
      who: "Accountant",
      meaning: "Did they stake a client relationship on Milōn within two weeks?",
    },
    {
      key: "LOOP_COMPLETION_RATE",
      shortLabel: "Finished the task",
      question: METRICS.LOOP_COMPLETION_RATE.question,
      value: loop ?? null,
      unit: "percent",
      traffic: trafficLight(loop, METRICS.LOOP_COMPLETION_RATE.healthy, METRICS.LOOP_COMPLETION_RATE.watch),
      healthy: METRICS.LOOP_COMPLETION_RATE.healthy,
      who: "Owner / staff",
      meaning: "Did the person on the client side actually do the work?",
    },
    {
      key: "ASSIGNMENT_ADOPTION",
      shortLabel: "Assigned after send",
      question: METRICS.ASSIGNMENT_ADOPTION.question,
      value: adoption,
      unit: "percent",
      traffic: trafficLight(adoption, METRICS.ASSIGNMENT_ADOPTION.healthy, METRICS.ASSIGNMENT_ADOPTION.watch),
      healthy: METRICS.ASSIGNMENT_ADOPTION.healthy,
      who: "Accountant",
      meaning: "Diagnostic-only, or did they use the loop?",
    },
    {
      key: "SECOND_MONTH_RETENTION",
      shortLabel: "Still here in month 2",
      question: METRICS.SECOND_MONTH_RETENTION.question,
      value: retention,
      unit: "percent",
      traffic: trafficLight(
        retention,
        METRICS.SECOND_MONTH_RETENTION.healthy,
        METRICS.SECOND_MONTH_RETENTION.watch,
      ),
      healthy: METRICS.SECOND_MONTH_RETENTION.healthy,
      who: "Both",
      meaning: "Novelty, or a habit?",
    },
    {
      key: "ENTITY_EXPANSION",
      shortLabel: "Clients per practice",
      question: METRICS.ENTITY_EXPANSION.question,
      value: expansion,
      unit: "count",
      traffic: trafficLight(expansion, METRICS.ENTITY_EXPANSION.healthy, METRICS.ENTITY_EXPANSION.watch),
      healthy: METRICS.ENTITY_EXPANSION.healthy,
      who: "Accountant",
      meaning: "Does the channel compound?",
    },
  ];
}

export function buildFunnel(loop: Instrument["loopTotals"]): FunnelStep[] {
  const first = Math.max(1, loop.assigned);
  const steps: FunnelStep[] = [
    { key: "assigned", label: "Assigned", count: loop.assigned, pctOfFirst: 100, who: "Accountant" },
    {
      key: "dispatched",
      label: "Emailed",
      count: loop.dispatched,
      pctOfFirst: Math.round((loop.dispatched / first) * 100),
      who: "Accountant",
    },
    {
      key: "engaged",
      label: "Opened by a person",
      count: loop.engaged,
      pctOfFirst: Math.round((loop.engaged / first) * 100),
      who: "Owner / staff",
    },
    {
      key: "progressed",
      label: "Moved",
      count: loop.progressed,
      pctOfFirst: Math.round((loop.progressed / first) * 100),
      who: "Owner / staff",
    },
    {
      key: "completed",
      label: "Done",
      count: loop.completed,
      pctOfFirst: Math.round((loop.completed / first) * 100),
      who: "Owner / staff",
    },
  ];
  return steps;
}

export function pickLoopReading(
  loop: Instrument["loopTotals"],
  adoptionPct: number | null,
): (typeof LOOP_INTERPRETATION)[number] | null {
  const assigned = loop.assigned;
  if (assigned <= 0 && (adoptionPct == null || adoptionPct >= METRICS.ASSIGNMENT_ADOPTION.watch)) {
    return null;
  }
  const completion = assigned > 0 ? loop.completed / assigned : 0;
  const engageRate = assigned > 0 ? loop.engaged / assigned : 0;
  const dispatchEngage = loop.dispatched > 0 ? loop.engaged / loop.dispatched : 1;
  if (adoptionPct != null && adoptionPct < METRICS.ASSIGNMENT_ADOPTION.watch) {
    return LOOP_INTERPRETATION[3];
  }
  if (loop.dispatched > 3 && dispatchEngage < 0.15) return LOOP_INTERPRETATION[2];
  if (engageRate >= 0.4 && completion < 0.3) return LOOP_INTERPRETATION[1];
  if (assigned > 0 && completion < 0.3) return LOOP_INTERPRETATION[0];
  return null;
}

export function buildActivationPath(row: ActivationRow | undefined): ActivationStep[] {
  if (!row || !row.practices) return [];
  const of = row.practices;
  return [
    { key: "entity", label: "Added a client", count: Number(row.reached_entity ?? 0), of },
    { key: "upload", label: "Uploaded figures", count: Number(row.reached_upload ?? 0), of },
    { key: "send", label: "Sent a report", count: Number(row.reached_send ?? 0), of },
    { key: "assign", label: "Assigned a task", count: Number(row.reached_assign ?? 0), of },
    { key: "done", label: "Someone finished it", count: Number(row.reached_completion ?? 0), of },
  ];
}

export function latestUnaffiliatedActivation(rows: ActivationRow[]): ActivationRow | undefined {
  return [...rows]
    .filter((r) => !r.is_founding_practice && r.practices > 0)
    .sort((a, b) => Date.parse(String(b.cohort_week)) - Date.parse(String(a.cohort_week)))[0];
}

export function mapCommitment(
  rows: Array<{
    practice_id?: string;
    practice_name?: string | null;
    is_founding_practice?: boolean;
    highest_rung?: string;
    points?: number;
  }>,
): CommitmentCard[] {
  return rows
    .map((r) => {
      const rung = r.highest_rung ?? "signed_up";
      return {
        practiceId: String(r.practice_id ?? r.practice_name ?? Math.random()),
        name: r.practice_name || "Unnamed practice",
        rung,
        rungLabel: RUNG_LABEL[rung] ?? rung.replace(/_/g, " "),
        note: RUNG_COPY[rung] ?? "",
        points: Number(r.points ?? 0),
        founding: Boolean(r.is_founding_practice),
      };
    })
    .sort((a, b) => b.points - a.points)
    .slice(0, 12);
}

export function buildNextMove(queue: QueueRow[], inst: Instrument): NextMove {
  const open = queue.filter((q) => !q.status || q.status === "open");
  const first = open[0];
  if (first) {
    const copy = STALL_COPY[first.stall_type];
    return {
      kind: "call",
      title: `Call ${first.practice_name || "this practice"}`,
      body: copy?.why ?? "Ask what they actually did, not whether they liked it.",
      question: first.suggested_question,
      practice: first.practice_name || undefined,
    };
  }
  if (inst.headline.traffic === "bad" || inst.headline.traffic === "watch") {
    return {
      kind: "decide",
      title: "No one is stalled in the queue — the number still is",
      body: inst.headline.decisionIfBad,
    };
  }
  return {
    kind: "empty",
    title: "No open stalls",
    body: "That is not a win if the funnel is empty. Refresh the snapshot, then go talk to someone who used it.",
  };
}

export const MOVEMENT_INVENTORY = {
  shown: [
    { event: "report.sent", who: "Accountant", means: "Staked a client relationship on the output" },
    { event: "task.assigned → completed", who: "Both", means: "The loop — the claimed moat" },
    { event: "upload.succeeded", who: "Accountant", means: "Gave up real client data" },
    { event: "entity.created", who: "Accountant", means: "Added a client to the book" },
    { event: "task.link.engaged", who: "Owner / staff", means: "A person opened the task (not a GET prefetch)" },
  ],
  trackedHidden: [
    { event: "signoff.recorded", who: "Accountant", means: "Reviewed a tab — not on the headline" },
    { event: "owner.invite / seat.accepted", who: "Both", means: "Invites exist; shown on the commitment ladder" },
    { event: "qbo.connected", who: "Accountant", means: "Live ledger — not a value proof on its own" },
    { event: "forecast.saved / budget.saved", who: "Both", means: "Habit signals, not the weekly number" },
  ],
  conversations: [
    { event: "Lighthouse send / reply / trial", who: "Prospect", means: "Mom Test conversations live here, not in the headline" },
  ],
  missing: [
    { event: "extraction.corrected", who: "Accountant", means: "H3 stays blocked until we can tell AI-fill from a blank form" },
    { event: "referred_another_practice", who: "Accountant", means: "Referral code is unused" },
    { event: "price objection", who: "Accountant", means: "H5 has no unaffiliated paid-conversion view" },
    { event: "owner-only SME (no firm)", who: "Owner", means: "Out of this practice-channel instrument on purpose" },
  ],
} as const;

export function formatValue(value: number | null, unit: "percent" | "count"): string {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return unit === "percent" ? `${Number(value)}%` : String(Number(value));
}

export function worstPlain(worstLine: string): string {
  return worstLine.replace(/^WORST THIS WEEK:\s*/i, "");
}

export function readingsFromBundle(input: DigestInput): ClosedReadings {
  return readClosedMetrics(input);
}
