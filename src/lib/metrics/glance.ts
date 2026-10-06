/**
 * Glance model for /founder/metrics.
 * One funnel, one call per practice, no verdict when the sample is still tiny.
 */

import { METRICS } from "@/lib/metrics/definitions";
import { trafficLight, type ActivationRow, type Traffic } from "@/lib/metrics/digest";
import {
  isExcludedFromInstrument,
  type ExclusionContext,
  type InstrumentSubject,
} from "@/lib/metrics/internal-exclusion";
import { RUNG_LABEL, stallWhy } from "@/lib/metrics/instrument-view";

export const MIN_READING_N = 5;
export const ROLLING_WINDOW_DAYS = 14;
export const ROLLING_WINDOW_LABEL = "Rolling 14 days";
export const GLANCE_FUNNEL_LABELS = ["Client", "Upload", "Report", "Assign", "Done"] as const;
export const REVIEW_HREF = "/ops?tab=agent";

const DAY_MS = 86_400_000;

const STALL_DEPTH: Record<string, number> = {
  signup_no_entity: 1,
  upload_no_report: 2,
  report_no_send: 3,
  send_no_assign: 4,
  assign_no_completion: 5,
  month2_dormant: 6,
};

const SEVERITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

export type FunnelKey = "client" | "upload" | "report" | "assign" | "done";

export type MergedFunnelStep = {
  key: FunnelKey;
  label: (typeof GLANCE_FUNNEL_LABELS)[number];
  count: number;
};

export type BrainFunnelCounts = {
  "owner.invite.redeemed"?: number;
  "seat.accepted"?: number;
  "brain.proposed"?: number;
  "brain.step.approved"?: number;
  "report.sent"?: number;
};

export type Glance = {
  reports: {
    sent: number;
    n: number;
    pct: number | null;
    valueLabel: string;
    verdict: string;
    traffic: Traffic;
    windowLabel: string;
  };
  funnel: MergedFunnelStep[];
  funnelWindowLabel: string;
  outbound: {
    contacted: number;
    replied: number;
    replyRateLabel: string;
  };
  signups7d: number | null;
  signupsLabel: string;
  revenueLabel: string;
  review: {
    inbox: number;
    dueNow: number;
    href: string;
  };
};

export function readingVerdict(n: number, traffic: Traffic): string {
  if (n < MIN_READING_N) return `too early, n=${n}`;
  if (traffic === "healthy") return "On track";
  if (traffic === "watch") return "Watch";
  if (traffic === "bad") return "Broken";
  return "No reading yet";
}

export function honestHypothesisLabel(status: string, n: number): string {
  if (status === "blocked" || status === "untested") return status;
  if (n < MIN_READING_N) return `too early, n=${n}`;
  return status;
}

export function compactHypothesisLabels(
  cards: Array<{ id: string; status: string; title?: string }>,
  n: number,
): Array<{ id: string; title: string; label: string }> {
  return cards.map((card) => ({
    id: card.id,
    title: card.title ?? card.id,
    label: honestHypothesisLabel(card.status, n),
  }));
}

function inRollingWindow(cohortWeek: string, now: number): boolean {
  const t = Date.parse(String(cohortWeek));
  if (!Number.isFinite(t)) return false;
  return t >= now - ROLLING_WINDOW_DAYS * DAY_MS && t <= now;
}

export function rolling14dActivation(rows: ActivationRow[], now = Date.now()) {
  const inWindow = rows.filter(
    (row) => !row.is_founding_practice && row.practices > 0 && inRollingWindow(row.cohort_week, now),
  );
  const n = inWindow.reduce((sum, row) => sum + Number(row.practices || 0), 0);
  const sent = inWindow.reduce((sum, row) => {
    if (row.reached_send != null) return sum + Number(row.reached_send || 0);
    if (row.activation_14d_pct == null || !row.practices) return sum;
    return sum + Math.round((Number(row.activation_14d_pct) / 100) * Number(row.practices));
  }, 0);
  const reached = {
    client: inWindow.reduce((sum, row) => sum + Number(row.reached_entity || 0), 0),
    upload: inWindow.reduce((sum, row) => sum + Number(row.reached_upload || 0), 0),
    report: sent,
    assign: inWindow.reduce((sum, row) => sum + Number(row.reached_assign || 0), 0),
    done: inWindow.reduce((sum, row) => sum + Number(row.reached_completion || 0), 0),
  };
  const pct = n > 0 ? Math.round((sent / n) * 1000) / 10 : null;
  const traffic = trafficLight(pct, METRICS.ACTIVATION_RATE.healthy, METRICS.ACTIVATION_RATE.watch);
  return { n, sent, pct, reached, traffic, windowLabel: ROLLING_WINDOW_LABEL };
}

function funnel(
  counts: Record<FunnelKey, number>,
): MergedFunnelStep[] {
  const labels: Record<FunnelKey, MergedFunnelStep["label"]> = {
    client: "Client",
    upload: "Upload",
    report: "Report",
    assign: "Assign",
    done: "Done",
  };
  return (Object.keys(labels) as FunnelKey[]).map((key) => ({
    key,
    label: labels[key],
    count: Math.max(0, Math.round(counts[key] || 0)),
  }));
}

export function buildMergedFunnel(input: {
  activation: { n: number; reached: Record<FunnelKey, number> } | null;
  loop?: { assigned?: number; completed?: number } | null;
  brain?: BrainFunnelCounts | null;
}): { steps: MergedFunnelStep[]; windowLabel: string } {
  if (input.activation && input.activation.n > 0) {
    return {
      steps: funnel(input.activation.reached),
      windowLabel: ROLLING_WINDOW_LABEL,
    };
  }
  const brain = input.brain ?? {};
  const assigned = Number(input.loop?.assigned || 0);
  const completed = Number(input.loop?.completed || 0);
  const brainAssign = Number(brain["brain.step.approved"] || 0);
  return {
    steps: funnel({
      client: Number(brain["owner.invite.redeemed"] || 0) + Number(brain["seat.accepted"] || 0),
      upload: 0,
      report: Number(brain["report.sent"] || 0),
      assign: assigned || brainAssign,
      done: completed,
    }),
    windowLabel: "Last 7 days",
  };
}

export function cohortRowsForDisplay(rows: ActivationRow[]): ActivationRow[] {
  return rows
    .filter((row) => !row.is_founding_practice && row.practices >= MIN_READING_N)
    .sort((a, b) => Date.parse(String(b.cohort_week)) - Date.parse(String(a.cohort_week)));
}

export function countRecentSignups(
  users: Array<{ createdAt?: string | null; email?: string | null; name?: string | null }>,
  now = Date.now(),
  ctx?: ExclusionContext,
): number {
  const since = now - 7 * DAY_MS;
  return users.filter((user) => {
    const t = user.createdAt ? Date.parse(user.createdAt) : NaN;
    if (!Number.isFinite(t) || t < since || t > now) return false;
    return !isExcludedFromInstrument({ email: user.email, name: user.name }, ctx);
  }).length;
}

function replyRateLabel(contacted: number, replied: number): string {
  if (!contacted) return "—";
  const pct = Math.round((replied / contacted) * 1000) / 10;
  return `${pct}%`;
}

export function buildGlance(input: {
  activation: ActivationRow[];
  loop?: { assigned?: number; completed?: number } | null;
  brain?: BrainFunnelCounts | null;
  contacted: number;
  replied: number;
  signups7d: number | null;
  revenueLabel: string;
  reviewInbox: number;
  reviewDueNow: number;
  now?: number;
}): Glance {
  const rolling = rolling14dActivation(input.activation, input.now ?? Date.now());
  const merged = buildMergedFunnel({
    activation: rolling.n > 0 ? { n: rolling.n, reached: rolling.reached } : null,
    loop: input.loop,
    brain: input.brain,
  });
  const verdict = readingVerdict(rolling.n, rolling.n > 0 ? rolling.traffic : "empty");
  return {
    reports: {
      sent: rolling.sent,
      n: rolling.n,
      pct: rolling.pct,
      valueLabel: rolling.pct == null ? "—" : `${rolling.pct}%`,
      verdict,
      traffic: rolling.n < MIN_READING_N ? "empty" : rolling.traffic,
      windowLabel: ROLLING_WINDOW_LABEL,
    },
    funnel: merged.steps,
    funnelWindowLabel: merged.windowLabel,
    outbound: {
      contacted: input.contacted,
      replied: input.replied,
      replyRateLabel: replyRateLabel(input.contacted, input.replied),
    },
    signups7d: input.signups7d,
    signupsLabel: input.signups7d == null ? "—" : String(input.signups7d),
    revenueLabel: input.revenueLabel || "—",
    review: {
      inbox: input.reviewInbox,
      dueNow: input.reviewDueNow,
      href: REVIEW_HREF,
    },
  };
}

export type CallQueueRow = {
  id: number;
  practice_id?: string | null;
  practice_name?: string | null;
  stall_type: string;
  severity?: string | null;
  suggested_question?: string | null;
  status?: string | null;
  is_founding_practice?: boolean | null;
  is_internal?: boolean | null;
  is_test?: boolean | null;
  owner_email?: string | null;
};

export type CallCommitmentRow = {
  practice_id?: string | null;
  practice_name?: string | null;
  highest_rung?: string | null;
  points?: number | null;
  is_founding_practice?: boolean | null;
  is_internal?: boolean | null;
  is_test?: boolean | null;
  owner_email?: string | null;
};

export type PracticeCall = {
  key: string;
  practiceId: string | null;
  name: string;
  founding: boolean;
  furthestRung: string | null;
  furthestLabel: string;
  stallType: string;
  severity: string;
  question: string;
  why: string;
  queueIds: number[];
  ownerEmail: string | null;
  isInternal: boolean;
  isTest: boolean;
};

function subjectOf(row: {
  practice_name?: string | null;
  is_internal?: boolean | null;
  is_test?: boolean | null;
  owner_email?: string | null;
}): InstrumentSubject {
  return {
    name: row.practice_name,
    isInternal: row.is_internal,
    isTest: row.is_test,
    ownerEmail: row.owner_email,
  };
}

function callKey(practiceId: string | null | undefined, name: string): string {
  if (practiceId) return `id:${practiceId}`;
  return `name:${name.trim().toLowerCase()}`;
}

function urgency(row: CallQueueRow): number {
  const severity = SEVERITY_RANK[row.severity ?? "low"] ?? 9;
  const depth = STALL_DEPTH[row.stall_type] ?? 0;
  return severity * 100 - depth;
}

export function dedupePracticeCalls(
  queue: CallQueueRow[],
  commitment: CallCommitmentRow[] = [],
  ctx?: ExclusionContext,
): PracticeCall[] {
  const open = queue.filter((row) => !row.status || row.status === "open");
  const kept = open.filter((row) => !isExcludedFromInstrument(subjectOf(row), ctx));
  const ladder = commitment.filter((row) => !isExcludedFromInstrument(subjectOf(row), ctx));
  const byKey = new Map<string, CallQueueRow[]>();
  for (const row of kept) {
    const name = (row.practice_name || "Unnamed practice").trim() || "Unnamed practice";
    const key = callKey(row.practice_id, name);
    const list = byKey.get(key) ?? [];
    list.push(row);
    byKey.set(key, list);
  }

  const cards: PracticeCall[] = [];
  for (const [key, rows] of byKey) {
    const chosen = [...rows].sort((a, b) => urgency(a) - urgency(b) || a.id - b.id)[0];
    const name = (chosen.practice_name || "Unnamed practice").trim() || "Unnamed practice";
    const practiceId = chosen.practice_id ?? rows.find((row) => row.practice_id)?.practice_id ?? null;
    const match = ladder
      .filter((row) => {
        if (practiceId && row.practice_id) return row.practice_id === practiceId;
        return (row.practice_name || "").trim().toLowerCase() === name.toLowerCase();
      })
      .sort((a, b) => Number(b.points || 0) - Number(a.points || 0))[0];
    const rung = match?.highest_rung ?? null;
    cards.push({
      key,
      practiceId,
      name,
      founding: Boolean(chosen.is_founding_practice || match?.is_founding_practice),
      furthestRung: rung,
      furthestLabel: rung ? (RUNG_LABEL[rung] ?? rung.replace(/_/g, " ")) : "No ladder step yet",
      stallType: chosen.stall_type,
      severity: chosen.severity || "low",
      question: chosen.suggested_question || "",
      why: stallWhy(chosen.stall_type),
      queueIds: rows.map((row) => row.id).sort((a, b) => a - b),
      ownerEmail: chosen.owner_email ?? match?.owner_email ?? null,
      isInternal: Boolean(chosen.is_internal),
      isTest: Boolean(chosen.is_test),
    });
  }

  return cards.sort((a, b) => {
    const ar = urgency({ id: 0, stall_type: a.stallType, severity: a.severity });
    const br = urgency({ id: 0, stall_type: b.stallType, severity: b.severity });
    if (ar !== br) return ar - br;
    return a.name.localeCompare(b.name);
  });
}

export function pickNextCall(cards: PracticeCall[], ctx?: ExclusionContext): PracticeCall | null {
  return (
    cards.find(
      (card) =>
        !isExcludedFromInstrument(
          {
            name: card.name,
            ownerEmail: card.ownerEmail,
            isInternal: card.isInternal,
            isTest: card.isTest,
          },
          ctx,
        ),
    ) ?? null
  );
}

export function nextCallCopy(card: PracticeCall | null): {
  title: string;
  body: string;
  question?: string;
} {
  if (!card) {
    return {
      title: "No open stalls",
      body: "Nothing real is waiting. Refresh, then talk to a practice that used it.",
    };
  }
  return {
    title: `Call ${card.name}`,
    body: card.why,
    question: card.question || undefined,
  };
}
