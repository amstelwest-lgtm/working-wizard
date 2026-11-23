/**
 * Unsent client-update email.
 *
 * An Advisor run stores one draft on agent_findings (kind client_update_draft).
 * Nothing is sent until a named accountant approves. Auto-send is off.
 * The findings status check only allows status "approved" when a live row
 * exists in another table. This email is not that row, so the audit stays
 * on evidence and status is left unset.
 */

export const CLIENT_UPDATE_DRAFT_KIND = "client_update_draft" as const;

/** Locked off. A later change can turn this on. This module cannot. */
export const CLIENT_UPDATE_AUTO_SEND = false;

/** Mailbox already used when RESEND_FROM_EMAIL is empty. Not a new env name. */
export const EXISTING_SENDING_FALLBACK = "noreply@milonfinance.com";

export type ClientUpdateDraft = {
  done: string;
  found: string;
  nextSteps: [string, string, string];
};

export type ClientUpdateAudit = {
  approverName: string;
  approvedAt: string;
  resendMessageId: string;
  finalText: string;
};

export type ClientUpdateSendPayload = {
  from: string;
  to: string[];
  reply_to: string;
  subject: string;
  text: string;
};

const SHAPE_ERROR =
  'client_update_draft detail needs "Based on:", "What was done:", "What was found:", and "Next steps:" with exactly 3 numbered lines. Nothing was sent.';

function brandFold(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Product name or a powered-by line. The sending domain is not this check. */
export function clientUpdateBranded(text: string): boolean {
  const folded = brandFold(text);
  return /\bmilon\b/.test(folded) || /\bpowered by\b/.test(folded);
}

function labelledLine(detail: string, label: string): string | null {
  const match = detail.match(new RegExp(`^${label}:\\s*(.+)$`, "im"));
  const value = match?.[1]?.trim() ?? "";
  return value || null;
}

export function parseClientUpdateDetail(
  detail: string,
): { ok: true; draft: ClientUpdateDraft; basis: string[] } | { ok: false; error: string } {
  const done = labelledLine(detail, "What was done");
  const found = labelledLine(detail, "What was found");
  const based = labelledLine(detail, "Based on");
  if (!done || !found || !based) return { ok: false, error: SHAPE_ERROR };
  const stepsAt = detail.search(/^Next steps:\s*$/im);
  if (stepsAt < 0) return { ok: false, error: SHAPE_ERROR };
  const steps = detail
    .slice(stepsAt)
    .split("\n")
    .slice(1)
    .map((line) => line.match(/^\s*\d+[.)]\s+(.+)$/)?.[1]?.trim() ?? "")
    .filter(Boolean);
  if (steps.length !== 3) return { ok: false, error: SHAPE_ERROR };
  const basis = based
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  if (basis.length === 0) return { ok: false, error: SHAPE_ERROR };
  return {
    ok: true,
    basis,
    draft: { done, found, nextSteps: [steps[0], steps[1], steps[2]] },
  };
}

export function renderClientUpdateBody(input: { draft: ClientUpdateDraft; basis: readonly string[] }): string {
  const basis = input.basis.map((item) => item.trim()).filter(Boolean).join("; ");
  const [first, second, third] = input.draft.nextSteps;
  return [
    `Based on: ${basis}`,
    "",
    "What was done",
    input.draft.done.trim(),
    "",
    "What was found",
    input.draft.found.trim(),
    "",
    "Next steps",
    `1. ${first.trim()}`,
    `2. ${second.trim()}`,
    `3. ${third.trim()}`,
  ].join("\n");
}

function cleanTitle(title: unknown): string {
  const text = typeof title === "string" ? title.trim().slice(0, 200) : "";
  if (!text || clientUpdateBranded(text)) return "Client update";
  return text;
}

/** Rewrite a record_draft call into the unsent client-update shape. */
export function shapeAdvisorClientUpdateArgs(
  args: Record<string, unknown>,
):
  | { ok: true; args: Record<string, unknown>; draft: ClientUpdateDraft; basis: string[] }
  | { ok: false; error: string } {
  const detail = typeof args.detail === "string" ? args.detail : "";
  if (clientUpdateBranded(detail) || clientUpdateBranded(typeof args.title === "string" ? args.title : "")) {
    return { ok: false, error: "The client update cannot include product branding. Nothing was sent." };
  }
  const parsed = parseClientUpdateDetail(detail);
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    draft: parsed.draft,
    basis: parsed.basis,
    args: {
      ...args,
      kind: CLIENT_UPDATE_DRAFT_KIND,
      title: cleanTitle(args.title),
      detail: renderClientUpdateBody(parsed),
    },
  };
}

function figuresOf(evidence: Record<string, unknown>, fallback: Record<string, number>): Record<string, number> {
  const figures = evidence.figures;
  if (figures && typeof figures === "object" && !Array.isArray(figures) && Object.keys(figures).length > 0) {
    return figures as Record<string, number>;
  }
  return fallback;
}

export function clientUpdateEvidencePatch(
  saved: Record<string, unknown>,
  draft: ClientUpdateDraft,
  basis: readonly string[],
): Record<string, unknown> {
  return {
    ...saved,
    figures: figuresOf(saved, { sources: Math.max(1, basis.length) }),
    draft: true,
    requires_human_approval: true,
    autoSend: CLIENT_UPDATE_AUTO_SEND,
    sent: false,
    clientUpdate: {
      done: draft.done,
      found: draft.found,
      nextSteps: [...draft.nextSteps],
      basis: [...basis],
    },
  };
}

/** The row an Advisor run stores. Unsent. No message id. */
export function buildUnsentClientUpdateFinding(input: {
  firmId: string;
  draft: ClientUpdateDraft;
  basis: readonly string[];
  figures?: Record<string, number>;
}): {
  kind: typeof CLIENT_UPDATE_DRAFT_KIND;
  severity: "info";
  title: string;
  detail: string;
  evidence: Record<string, unknown>;
} {
  const basis = input.basis.map((item) => item.trim()).filter(Boolean);
  const figures =
    input.figures && Object.keys(input.figures).length > 0
      ? input.figures
      : { sources: Math.max(1, basis.length) };
  return {
    kind: CLIENT_UPDATE_DRAFT_KIND,
    severity: "info",
    title: "Client update",
    detail: renderClientUpdateBody({ draft: input.draft, basis }),
    evidence: clientUpdateEvidencePatch({ figures, firmId: input.firmId }, input.draft, basis),
  };
}

/** Addr-spec from `Name <addr>` or a bare address. Falls back to the existing mailbox. */
export function sendingAddressOf(fromRaw: string | null | undefined): string {
  const raw = (fromRaw ?? "").trim();
  const source = raw || EXISTING_SENDING_FALLBACK;
  const angled = source.match(/<([^<>]+)>/);
  const addr = (angled ? angled[1] : source).trim();
  if (!/^[^\s@]+@[^\s@]+$/.test(addr)) return EXISTING_SENDING_FALLBACK;
  return addr;
}

export function clientUpdateFromHeader(input: {
  practiceName: string;
  fromEmailRaw: string | null | undefined;
}): string {
  const name = input.practiceName.replace(/[\r\n<>"]/g, "").replace(/\s+/g, " ").trim();
  return `${name} <${sendingAddressOf(input.fromEmailRaw)}>`;
}

function emailOf(value: string): string | null {
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function planClientUpdateSend(input: {
  approval: { approverName: string; approvedAt: string } | null;
  requestedAutoSend?: boolean;
  /** True only after the routine map flag was read and is on. The module constant stays off. */
  routineOptIn?: boolean;
  practiceName: string;
  accountantEmail: string;
  to: string;
  subject: string;
  body: string;
  fromEmailRaw: string | null | undefined;
}):
  | { send: true; payload: ClientUpdateSendPayload }
  | { send: false; reason: "auto_send_off" | "approval_required" | "practice_name" | "reply_to" | "recipient" | "branded" | "empty" } {
  if (CLIENT_UPDATE_AUTO_SEND) return { send: false, reason: "auto_send_off" };
  if (input.requestedAutoSend && input.routineOptIn !== true) return { send: false, reason: "auto_send_off" };
  const approverName = input.approval?.approverName.trim() ?? "";
  if (!input.approval || !approverName || approverName.includes("@")) {
    return { send: false, reason: "approval_required" };
  }
  const practiceName = input.practiceName.replace(/[\r\n<>"]/g, "").replace(/\s+/g, " ").trim();
  if (!practiceName || brandFold(practiceName) === "milon") return { send: false, reason: "practice_name" };
  const replyTo = emailOf(input.accountantEmail);
  if (!replyTo) return { send: false, reason: "reply_to" };
  const to = emailOf(input.to);
  if (!to) return { send: false, reason: "recipient" };
  const subject = input.subject.trim();
  const body = input.body.trim();
  if (!subject || !body) return { send: false, reason: "empty" };
  if (clientUpdateBranded(subject) || clientUpdateBranded(body)) return { send: false, reason: "branded" };
  return {
    send: true,
    payload: {
      from: clientUpdateFromHeader({ practiceName, fromEmailRaw: input.fromEmailRaw }),
      to: [to],
      reply_to: replyTo,
      subject: subject.slice(0, 200),
      text: body.slice(0, 8000),
    },
  };
}

export function sentClientUpdatePatch(input: {
  evidence: Record<string, unknown>;
  userId: string;
  approverName: string;
  approvedAt: string;
  resendMessageId: string;
  finalText: string;
  subject: string;
  routineArtifactId?: string | null;
}): Record<string, unknown> {
  const audit: ClientUpdateAudit = {
    approverName: input.approverName.trim(),
    approvedAt: input.approvedAt,
    resendMessageId: input.resendMessageId.trim(),
    finalText: input.finalText,
  };
  return {
    title: input.subject.trim().slice(0, 200),
    detail: input.finalText,
    approved_by: input.userId,
    approved_at: input.approvedAt,
    evidence: {
      ...input.evidence,
      figures: figuresOf(input.evidence, { sources: 1 }),
      draft: false,
      requires_human_approval: true,
      autoSend: false,
      sent: true,
      sending: false,
      decision: "sent",
      ...(input.routineArtifactId ? { routineArtifactId: input.routineArtifactId } : {}),
      audit,
    },
  };
}

export function dismissClientUpdatePatch(evidence: Record<string, unknown>): Record<string, unknown> {
  return {
    status: "dismissed",
    dismissed_reason: "Not now",
    evidence: {
      ...evidence,
      figures: figuresOf(evidence, { sources: 1 }),
      draft: false,
      autoSend: false,
      sent: false,
      decision: "dismissed",
    },
  };
}

export function readClientUpdateAudit(evidence: unknown): ClientUpdateAudit | null {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return null;
  const audit = (evidence as Record<string, unknown>).audit;
  if (!audit || typeof audit !== "object" || Array.isArray(audit)) return null;
  const row = audit as Record<string, unknown>;
  const approverName = typeof row.approverName === "string" ? row.approverName.trim() : "";
  const approvedAt = typeof row.approvedAt === "string" ? row.approvedAt.trim() : "";
  const resendMessageId = typeof row.resendMessageId === "string" ? row.resendMessageId.trim() : "";
  const finalText = typeof row.finalText === "string" ? row.finalText : "";
  if (!approverName || !approvedAt || !resendMessageId || !finalText.trim()) return null;
  return { approverName, approvedAt, resendMessageId, finalText };
}

export function clientUpdateTimelineStep(audit: ClientUpdateAudit | null): {
  key: string;
  label: string;
  state: "done";
  at: string;
  detail: string;
} | null {
  if (!audit) return null;
  return {
    key: "client-update-sent",
    label: `${audit.approverName} sent the client update`,
    state: "done",
    at: audit.approvedAt,
    detail: `${audit.resendMessageId}\n${audit.finalText}`,
  };
}

/**
 * One key per finding. An edited retry must not mint a second Resend send.
 * The text argument is ignored and kept so older callers still compile.
 */
export function clientUpdateIdempotencyKey(findingId: string, _finalText?: string): string {
  return `client-update/${findingId}`.slice(0, 256);
}

/** A send was reserved or finished. A later approve must not call Resend again. */
export function clientUpdateSendLocked(evidence: unknown): boolean {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return false;
  const row = evidence as Record<string, unknown>;
  return row.sent === true || row.sending === true || readClientUpdateAudit(evidence) != null;
}

/** Safe to show. Strips tokens and API keys from a provider body. */
export function publicSendError(status: number, raw: string): string {
  const detail = raw
    .replace(/re_[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/\b(sk|pk)_(live|test)_[A-Za-z0-9]+/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return detail ? `Resend ${status}: ${detail}` : `Resend ${status}`;
}
