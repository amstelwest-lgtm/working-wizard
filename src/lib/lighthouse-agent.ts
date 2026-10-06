/**
 * Agent workbench view models. Pure: the panel and tests share these.
 * Cadence prefers E16 contact fields when a Phase 1 row is present, and
 * falls back to the live lead columns (next_touch_on, last_touch_at, touches).
 */

import { leadDisplayName } from "@/lib/lighthouse-due";
import { heldColdDraftRefusal } from "@/lib/lighthouse-targets";
import {
  SA_TIME_ZONE,
  US_TIME_ZONES,
  resolveRecipientZone,
  sendWindowStatus,
  zonedYmd,
  type RecipientPlace,
  type WindowZone,
} from "@/lib/lighthouse-send-windows";

export const AGENT_ANGLES = ["observation", "value", "trial", "breakup"] as const;
export type AgentAngle = (typeof AGENT_ANGLES)[number];

export type AgentTouch = {
  id: string;
  stepNo: number;
  angle: string | null;
  subject: string | null;
  body: string | null;
  status: string;
  sentAt: string | null;
  deliveredAt: string | null;
  clickedAt?: string | null;
};

export type AgentLead = RecipientPlace & {
  id: string;
  name?: string | null;
  company?: string | null;
  stage: string;
  doNotContact: boolean;
  /** A call or meeting was held. Cold cadence stays off. */
  conversationHeld?: boolean;
  nextTouchOn: string | null;
  nextFollowUpAt?: string | null;
  lastTouchAt: string | null;
  lastDeliveryStatus?: string | null;
  lastEngagement?: string | null;
  repliedAt?: string | null;
  lastClickedAt?: string | null;
  lastInboundAt?: string | null;
  sequenceStep: number;
  signal?: string | null;
  trafficTag?: "warmup" | "campaign" | null;
  touches: AgentTouch[];
};

/** "Milōn Dry Run" is the cohort label, not the firm. */
export function isDryRunCohortName(value: string | null | undefined): boolean {
  return /dry[\s-]*run/i.test((value ?? "").trim());
}

/** Review inbox, drawer, Next up, pipeline, and chat chips share this label. */
export function firmCardTitle(lead: {
  name?: string | null;
  company?: string | null;
  firmName?: string | null;
  email?: string | null;
}): string {
  return leadDisplayName(lead);
}

export function angleBucket(angle: string | null | undefined): AgentAngle {
  const a = String(angle ?? "").toLowerCase();
  if (a.includes("break")) return "breakup";
  if (a.includes("trial") || a.includes("pain") || a.includes("proof")) return "trial";
  if (a.includes("value")) return "value";
  return "observation";
}

/** Shared stop for chat, Next up, sequence, preview, and the draft write. */
export function refuseColdDraft(lead: {
  conversationHeld?: boolean | null;
  company?: string | null;
  name?: string | null;
  email?: string | null;
  firmName?: string | null;
}): string | null {
  return heldColdDraftRefusal(lead);
}

export function assertColdDraftOpen(lead: {
  conversationHeld?: boolean | null;
  company?: string | null;
  name?: string | null;
  email?: string | null;
  firmName?: string | null;
}): void {
  const message = refuseColdDraft(lead);
  if (message) throw new Error(message);
}

export function isLeadDue(lead: AgentLead, now = new Date()): boolean {
  if (lead.doNotContact) return false;
  if (refuseColdDraft(lead)) return false;
  if (lead.stage === "won" || lead.stage === "lost") return false;
  if (lead.nextFollowUpAt) {
    const at = Date.parse(lead.nextFollowUpAt);
    if (Number.isFinite(at) && at <= now.getTime()) return true;
  }
  if (lead.nextTouchOn) {
    const zone = resolveRecipientZone(lead);
    const today = zone.timeZone ? zonedYmd(now, zone.timeZone) : now.toISOString().slice(0, 10);
    if (lead.nextTouchOn.slice(0, 10) <= today) return true;
  }
  return false;
}

export type DueQueueRow = {
  leadId: string;
  title: string;
  email: string | null;
  zone: WindowZone | null;
  geo: "US" | "SA" | "OTHER";
  open: boolean;
  nextLabel: string;
  countdownLabel: string;
  stepNo: number;
};

export function buildDueQueue(leads: AgentLead[], now = new Date()): DueQueueRow[] {
  return leads.filter((lead) => isLeadDue(lead, now)).map((lead) => {
    const window = sendWindowStatus(lead, now);
    return {
      leadId: lead.id,
      title: firmCardTitle(lead),
      email: lead.email ?? null,
      zone: window.zone,
      geo: window.geo,
      open: window.open,
      nextLabel: window.nextLabel,
      countdownLabel: window.countdownLabel,
      stepNo: Math.max(1, lead.sequenceStep + 1),
    };
  });
}

export type ReviewItem = {
  touchId: string;
  leadId: string;
  title: string;
  email: string | null;
  subject: string;
  status: "draft" | "approved";
  stepNo: number;
  angle: AgentAngle;
};

const REVIEW_STATUSES = new Set(["draft", "approved"]);

export function buildReviewInbox(leads: AgentLead[]): ReviewItem[] {
  const items: ReviewItem[] = [];
  for (const lead of leads) {
    if (lead.doNotContact) continue;
    for (const touch of lead.touches) {
      if (!REVIEW_STATUSES.has(touch.status)) continue;
      if (touch.sentAt) continue;
      items.push({
        touchId: touch.id,
        leadId: lead.id,
        title: firmCardTitle(lead),
        email: lead.email ?? null,
        subject: (touch.subject ?? "").trim() || "(no subject)",
        status: touch.status === "approved" ? "approved" : "draft",
        stepNo: touch.stepNo,
        angle: angleBucket(touch.angle),
      });
    }
  }
  return items.sort((a, b) => {
    if (a.status !== b.status) return a.status === "draft" ? -1 : 1;
    return a.title.localeCompare(b.title);
  });
}

export type LighthouseReviewPulse = {
  inbox: number;
  dueNow: number;
};

/**
 * Pending review drafts plus rows that are due inside an open send window.
 * The founder glance and the Agent tab both read this.
 */
export function lighthouseReviewPulse(leads: AgentLead[], now = new Date()): LighthouseReviewPulse {
  return {
    inbox: buildReviewInbox(leads).length,
    dueNow: buildDueQueue(leads, now).filter((row) => row.open).length,
  };
}

export type CadenceStrip = {
  lastTouch: string;
  delivery: string;
  engagement: string;
  nextFollowUp: string;
};

function shortWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = iso.slice(0, 16).replace("T", " ");
  return d || "—";
}

export function cadenceOf(lead: AgentLead): CadenceStrip {
  const sent = lead.touches.filter((t) => t.sentAt || t.status === "sent" || t.deliveredAt);
  const latest = [...sent].sort((a, b) => (b.sentAt ?? "").localeCompare(a.sentAt ?? ""))[0];
  const delivery =
    (lead.lastDeliveryStatus ?? "").trim() ||
    (latest?.deliveredAt ? "delivered" : latest?.sentAt ? "sent" : "none");
  const engagement =
    (lead.lastEngagement ?? "").trim() ||
    (lead.repliedAt || lead.lastInboundAt
      ? "replied"
      : lead.lastClickedAt || latest?.clickedAt
        ? "clicked"
        : "none");
  const next = lead.nextFollowUpAt
    ? shortWhen(lead.nextFollowUpAt)
    : lead.nextTouchOn
      ? lead.nextTouchOn.slice(0, 10)
      : "—";
  return {
    lastTouch: shortWhen(lead.lastTouchAt),
    delivery,
    engagement,
    nextFollowUp: next,
  };
}

export type AttentionMix = {
  us: number;
  sa: number;
  other: number;
  usPct: number;
  saPct: number;
};

/** Sends in the last 7 days. Falls back to the due queue when nothing was sent. */
export function attentionMix(leads: AgentLead[], now = new Date()): AttentionMix {
  const weekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  let us = 0;
  let sa = 0;
  let other = 0;
  const add = (geo: "US" | "SA" | "OTHER", n = 1) => {
    if (geo === "US") us += n;
    else if (geo === "SA") sa += n;
    else other += n;
  };
  let sent = 0;
  for (const lead of leads) {
    const geo = resolveRecipientZone(lead).geo;
    for (const touch of lead.touches) {
      if (!touch.sentAt) continue;
      const at = Date.parse(touch.sentAt);
      if (!Number.isFinite(at) || at < weekAgo || at > now.getTime()) continue;
      add(geo);
      sent += 1;
    }
  }
  if (sent === 0) {
    for (const row of buildDueQueue(leads, now)) add(row.geo);
  }
  const base = us + sa;
  return {
    us,
    sa,
    other,
    usPct: base ? Math.round((us / base) * 100) : 0,
    saPct: base ? Math.round((sa / base) * 100) : 0,
  };
}

export type ZoneClock = {
  zone: WindowZone;
  geo: "US" | "SA";
  open: boolean;
  nextLabel: string;
  countdownLabel: string;
  due: number;
  dueNow: number;
};

const CLOCKS: Array<{ zone: WindowZone; geo: "US" | "SA"; timeZone: string }> = [
  { zone: "ET", geo: "US", timeZone: US_TIME_ZONES.ET },
  { zone: "CT", geo: "US", timeZone: US_TIME_ZONES.CT },
  { zone: "MT", geo: "US", timeZone: US_TIME_ZONES.MT },
  { zone: "PT", geo: "US", timeZone: US_TIME_ZONES.PT },
  { zone: "SAST", geo: "SA", timeZone: SA_TIME_ZONE },
];

export function zoneClocks(leads: AgentLead[], now = new Date()): ZoneClock[] {
  const due = buildDueQueue(leads, now);
  return CLOCKS.map((clock) => {
    const status = sendWindowStatus({ timezone: clock.timeZone }, now);
    const inZone = due.filter((row) => row.zone === clock.zone);
    return {
      zone: clock.zone,
      geo: clock.geo,
      open: status.open,
      nextLabel: status.nextLabel,
      countdownLabel: status.countdownLabel,
      due: inZone.length,
      dueNow: inZone.filter((row) => row.open).length,
    };
  });
}

/** Zero stays "0". Never pad. */
export function formatOpsCount(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "0";
  return String(Math.trunc(n));
}

/** Zero stays "0%". Never "00%". */
export function formatOpsPercent(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "0%";
  const rounded = Math.round(n * 10) / 10;
  return `${rounded}%`;
}

/**
 * Usage cards used to glue a zero event count to a zero unique-user suffix
 * ("00u"). A zero pair is "0". A positive count with no people is the count.
 */
export function formatUsageMetric(events: number, uniqueUsers: number): string {
  if (!events) return "0";
  if (!uniqueUsers) return String(events);
  return `${events} · ${uniqueUsers}`;
}

export type NextUpKind = "review" | "approved" | "followup" | "import" | "plan";

export type NextUpAction = {
  kind: NextUpKind;
  label: string;
  leadId: string | null;
  touchId: string | null;
};

/**
 * One next action. Pending drafts beat an approved draft, which beats the
 * first due firm (open window first). An empty book asks for an import.
 */
export function nextUpAction(input: {
  inbox: ReviewItem[];
  queue: DueQueueRow[];
  hasFirms: boolean;
}): NextUpAction {
  const pending = input.inbox.filter((item) => item.status === "draft");
  if (pending.length > 0) {
    const first = pending[0];
    return {
      kind: "review",
      label: pending.length === 1 ? "Review 1 draft" : `Review ${pending.length} drafts`,
      leadId: first.leadId,
      touchId: first.touchId,
    };
  }
  const approved = input.inbox.filter((item) => item.status === "approved");
  if (approved.length > 0) {
    const first = approved[0];
    return {
      kind: "approved",
      label: "Open approved draft",
      leadId: first.leadId,
      touchId: first.touchId,
    };
  }
  const due = input.queue.find((row) => row.open) ?? input.queue[0];
  if (due) {
    return {
      kind: "followup",
      label: `Follow up with ${due.title}`,
      leadId: due.leadId,
      touchId: null,
    };
  }
  if (!input.hasFirms) {
    return { kind: "import", label: "Import cohort", leadId: null, touchId: null };
  }
  return { kind: "plan", label: "Run plan (dry-run)", leadId: null, touchId: null };
}

/** US uses the ET countdown when every US zone is closed. SA uses SAST. */
export function geoWindowLine(clocks: ZoneClock[]): string {
  const us = clocks.filter((clock) => clock.geo === "US");
  const sa = clocks.find((clock) => clock.geo === "SA");
  const et = us.find((clock) => clock.zone === "ET") ?? us[0];
  const usPart = us.some((clock) => clock.open)
    ? "US Open"
    : `US opens in ${et?.countdownLabel ?? "—"}`;
  const saPart = sa?.open ? "SA Open" : `SA opens in ${sa?.countdownLabel ?? "—"}`;
  return `${usPart} · ${saPart}`;
}

export function trafficTagOf(tags: unknown): "warmup" | "campaign" | null {
  if (typeof tags === "string") {
    const v = tags.trim().toLowerCase();
    if (v === "warmup" || v === "campaign") return v;
    return null;
  }
  const list = Array.isArray(tags) ? tags.map((t) => String(t).toLowerCase()) : [];
  if (list.includes("warmup")) return "warmup";
  if (list.includes("campaign")) return "campaign";
  return null;
}
