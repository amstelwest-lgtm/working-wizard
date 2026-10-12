/**
 * Approve or dismiss an agent draft.
 * Approve writes one live row through the existing table shapes.
 * A second approve returns that row. Nothing here sends email or signs off.
 */

export const DRAFT_DECISIONS = ["approve", "dismiss"] as const;
export type DraftDecision = (typeof DRAFT_DECISIONS)[number];

export const DISMISSED_BY_USER = "dismissed by user";

/** Kinds the owner may approve. The other draft kinds need an accountant or firm member. */
export const OWNER_SIDE_DRAFT_KINDS = [
  "action_point_draft",
  "data_request_draft",
  "next_move_draft",
] as const;

export const ACCOUNTANT_SIDE_DRAFT_KINDS = [
  "accountant_handoff_draft",
  "advisory_deliverable_draft",
] as const;

export const DRAFT_DECISION_KINDS = [
  ...OWNER_SIDE_DRAFT_KINDS,
  ...ACCOUNTANT_SIDE_DRAFT_KINDS,
] as const;

export type DraftDecisionKind = (typeof DRAFT_DECISION_KINDS)[number];

const OWNER_SIDE = new Set<string>(OWNER_SIDE_DRAFT_KINDS);
const DECISION_KINDS = new Set<string>(DRAFT_DECISION_KINDS);
const SIGNED_OFF = /\b(signed[\s-]*off|sign[\s-]*off)\b/i;

/** True when copy uses sign-off wording. Approving a ledger posting is not a sign-off. */
export function refusesSignOffWording(text: string | null | undefined): boolean {
  return SIGNED_OFF.test(text ?? "");
}

export type DraftSeat = "owner" | "firm";

export function draftDecisionAccess(input: {
  kind: string;
  userId: string;
  ownerUserId: string | null;
  firmMember: boolean;
}): { ok: true; seat: DraftSeat } | { ok: false; error: "forbidden" } {
  if (!DECISION_KINDS.has(input.kind)) return { ok: false, error: "forbidden" };
  if (input.firmMember) return { ok: true, seat: "firm" };
  const owner = input.ownerUserId != null && input.ownerUserId === input.userId;
  if (owner && OWNER_SIDE.has(input.kind)) return { ok: true, seat: "owner" };
  return { ok: false, error: "forbidden" };
}

export function isDraftFinding(input: { kind: string; evidence: unknown }): boolean {
  if (!DECISION_KINDS.has(input.kind)) return false;
  if (!input.evidence || typeof input.evidence !== "object" || Array.isArray(input.evidence)) return false;
  const evidence = input.evidence as Record<string, unknown>;
  return evidence.draft === true && evidence.requires_human_approval === true;
}

export function settledDraftEvidence(evidence: unknown): Record<string, unknown> {
  const base =
    evidence && typeof evidence === "object" && !Array.isArray(evidence)
      ? { ...(evidence as Record<string, unknown>) }
      : {};
  return { ...base, draft: false };
}

export function applyDraftEdits(input: {
  title: string;
  detail: string | null;
  edits?: { title?: string; detail?: string };
}): { ok: true; title: string; detail: string } | { ok: false; error: "title_required" | "signed_off_refused" } {
  const title = (input.edits?.title ?? input.title).trim().slice(0, 200);
  const detail = (input.edits?.detail ?? input.detail ?? "").trim().slice(0, 2000);
  if (!title) return { ok: false, error: "title_required" };
  if (SIGNED_OFF.test(title) || SIGNED_OFF.test(detail)) return { ok: false, error: "signed_off_refused" };
  return { ok: true, title, detail };
}

export type StoredDecision = {
  status: string | null;
  dismissedReason: string | null;
  approvedTable: string | null;
  approvedRowId: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
};

export type RepeatDecision =
  | {
      action: "return";
      already: true;
      status: "approved" | "dismissed";
      recordTable: string | null;
      recordId: string | null;
      approvedBy: string | null;
      approvedAt: string | null;
      dismissedReason: string | null;
    }
  | { action: "conflict"; error: "already_approved" | "already_dismissed" | "approve_incomplete" }
  | { action: "apply" };

/** A second approve or dismiss returns the first result. A crossed decision is refused. */
export function repeatDecision(decision: DraftDecision, stored: StoredDecision): RepeatDecision {
  if (stored.status === "approved") {
    if (decision !== "approve") return { action: "conflict", error: "already_approved" };
    if (!stored.approvedRowId || !stored.approvedTable) return { action: "conflict", error: "approve_incomplete" };
    return {
      action: "return",
      already: true,
      status: "approved",
      recordTable: stored.approvedTable,
      recordId: stored.approvedRowId,
      approvedBy: stored.approvedBy,
      approvedAt: stored.approvedAt,
      dismissedReason: null,
    };
  }
  if (stored.status === "dismissed" || stored.dismissedReason) {
    if (decision !== "dismiss") return { action: "conflict", error: "already_dismissed" };
    return {
      action: "return",
      already: true,
      status: "dismissed",
      recordTable: null,
      recordId: null,
      approvedBy: null,
      approvedAt: null,
      dismissedReason: stored.dismissedReason ?? DISMISSED_BY_USER,
    };
  }
  return { action: "apply" };
}

function dataRequestSeverity(severity: string): "critical" | "important" | "nice_to_have" {
  if (severity === "act") return "critical";
  if (severity === "info") return "nice_to_have";
  return "important";
}

/** Same quarter plan the recommendation-to-action path creates when none is active. */
export function actionPlanInsert(clientId: string, now: Date): {
  client_id: string;
  period_label: string;
  outcome_goal: string;
  target_date: string;
} {
  const quarter = Math.floor(now.getUTCMonth() / 3) + 1;
  const year = now.getUTCFullYear();
  const quarterEnd = new Date(Date.UTC(year, quarter * 3, 0)).toISOString().slice(0, 10);
  return {
    client_id: clientId,
    period_label: `Q${quarter} ${year}`,
    outcome_goal: "Set your outcome goal for this quarter",
    target_date: quarterEnd,
  };
}

function deliverableBody(title: string, detail: string): string {
  const text = detail.trim();
  const subject = title.trim();
  if (subject && text && !/^\s*SUBJECT:/i.test(text)) return `SUBJECT: ${subject}\n\n${text}`;
  return text || subject;
}

export type LiveDraftRecord = {
  table: "data_requests" | "action_items" | "proposed_next_steps" | "deliverable_drafts" | "accountant_requests";
  row: Record<string, unknown>;
};

/**
 * The row an approval inserts. Sign-off columns are absent.
 * data_requests stays open and unsent. accountant_requests is the existing
 * owner-to-firm table; this row does not call the accept RPC.
 */
export function liveRecordForDraft(input: {
  kind: string;
  title: string;
  detail: string;
  severity: string;
  clientId: string;
  userId: string;
  seat: DraftSeat;
  firmId: string | null;
  findingId: string;
  planId?: string;
  seq?: number;
}): { ok: true; record: LiveDraftRecord } | { ok: false; error: "unknown_kind" | "client_has_no_firm" | "plan_required" | "signed_off_refused" } {
  if (SIGNED_OFF.test(input.title) || SIGNED_OFF.test(input.detail)) {
    return { ok: false, error: "signed_off_refused" };
  }
  if (input.kind === "data_request_draft") {
    return {
      ok: true,
      record: {
        table: "data_requests",
        row: {
          client_id: input.clientId,
          kind: "other",
          title: input.title,
          reason: input.detail || null,
          severity: dataRequestSeverity(input.severity),
          status: "open",
          source: input.seat === "owner" ? "owner" : "accountant",
          requested_by: input.userId,
          sent_at: null,
          sent_to: null,
          meta: { auto_send: false, agent_finding_id: input.findingId },
        },
      },
    };
  }
  if (input.kind === "action_point_draft") {
    if (!input.planId || input.seq == null) return { ok: false, error: "plan_required" };
    return {
      ok: true,
      record: {
        table: "action_items",
        row: {
          plan_id: input.planId,
          client_id: input.clientId,
          seq: input.seq,
          title: input.title,
          outcome_why: input.detail || null,
          source: "manual",
          status: "not_started",
          sent_at: null,
        },
      },
    };
  }
  if (input.kind === "next_move_draft") {
    return {
      ok: true,
      record: {
        table: "proposed_next_steps",
        row: {
          client_id: input.clientId,
          title: input.title,
          rationale: input.detail || null,
          assumptions: [],
          status: "proposed",
          source: "ai",
          data_depth: "statement",
          evidence: [],
          created_by: input.userId,
        },
      },
    };
  }
  if (input.kind === "advisory_deliverable_draft") {
    return {
      ok: true,
      record: {
        table: "deliverable_drafts",
        row: {
          client_id: input.clientId,
          kind: "advisory",
          body: deliverableBody(input.title, input.detail),
          assumption_checklist: [],
          status: "draft",
          created_by: input.userId,
        },
      },
    };
  }
  if (input.kind === "accountant_handoff_draft") {
    if (!input.firmId) return { ok: false, error: "client_has_no_firm" };
    const message = [input.title, input.detail].filter((part) => part.trim()).join("\n\n");
    return {
      ok: true,
      record: {
        table: "accountant_requests",
        row: {
          client_id: input.clientId,
          firm_id: input.firmId,
          status: "open",
          message,
          pack_id: null,
          created_by: input.userId,
        },
      },
    };
  }
  return { ok: false, error: "unknown_kind" };
}

/** True when a live row carries a sign-off stamp or a signed-off status. */
export function recordMarksSignedOff(row: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(row)) {
    if (/signed_off/i.test(key) && value != null) return true;
    if (typeof value === "string" && value.trim().toLowerCase() === "signed_off") return true;
  }
  return false;
}
