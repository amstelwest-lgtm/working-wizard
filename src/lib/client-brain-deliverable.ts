/**
 * Deliverable-draft helpers: Claude JSON parse, idempotent insert filter,
 * assumption edits, and status gates. Missing assumptions stay empty.
 */

import type { DeliveryKind } from "@/lib/advisory-deliveries";
import {
  parseAssumptionChecklist,
  serializeAssumptionChecklist,
  type AssumptionItem,
  type DeliverableDraft,
  type DeliverableDraftStatus,
} from "@/lib/client-brain";
import type { Json } from "@/integrations/supabase/types";

export const DRAFT_KINDS = ["advisory", "client_email", "meeting_agenda", "exec_summary"] as const;
export type DeliverableKind = (typeof DRAFT_KINDS)[number];

export const OPEN_DRAFT_STATUSES = new Set<DeliverableDraftStatus>(["draft", "ready"]);
export const MAX_OPEN_DRAFTS = 3;
export const DRAFT_RATE_LIMIT = 8;

export type ClaudeDeliverablePayload = {
  kind: DeliverableKind;
  subject: string | null;
  body: string;
  assumptions: AssumptionItem[];
};

function asTrimmed(raw: unknown): string | undefined {
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

export function normalizeDraftKind(raw: unknown): DeliverableKind {
  const k = asTrimmed(raw)?.toLowerCase().replace(/[\s-]+/g, "_");
  if (k === "client_email" || k === "email") return "client_email";
  if (k === "meeting_agenda" || k === "agenda") return "meeting_agenda";
  if (k === "exec_summary" || k === "summary") return "exec_summary";
  return "advisory";
}

export function draftKindLabel(kind: string | null | undefined): string {
  const k = normalizeDraftKind(kind);
  if (k === "client_email") return "Client email";
  if (k === "meeting_agenda") return "Meeting agenda";
  if (k === "exec_summary") return "Exec summary";
  return "Advisory";
}

export function kindToDelivery(kind: string | null | undefined): DeliveryKind {
  const k = normalizeDraftKind(kind);
  if (k === "meeting_agenda") return "meeting_agenda";
  if (k === "exec_summary") return "exec_summary";
  return "advisory_draft";
}

export function extractJsonText(raw: string): string {
  return raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

export function assumptionsFromUnknown(raw: unknown): AssumptionItem[] {
  if (!Array.isArray(raw)) return [];
  return parseAssumptionChecklist(
    raw.map((item, i) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        const o = item as Record<string, unknown>;
        const text = asTrimmed(o.text) ?? asTrimmed(o.label) ?? "";
        return { id: typeof o.id === "string" ? o.id : `a-${i}`, text, checked: false };
      }
      return "";
    }),
  ).map((item, i) => ({ ...item, id: item.id || `a-${i}`, checked: false }));
}

export function composeDraftBody(subject: string | null, body: string): string {
  const text = body.trim();
  const sub = subject?.trim();
  if (sub && !/^\s*SUBJECT:/i.test(text)) return `SUBJECT: ${sub}\n\n${text}`;
  return text;
}

export function parseDraftSubjectBody(raw: string | null | undefined): {
  subject: string | null;
  body: string;
} {
  const text = (raw ?? "").trim();
  const m = text.match(/^\s*SUBJECT:\s*(.+)\s*\n+([\s\S]*)$/i);
  if (m) return { subject: m[1].trim() || null, body: m[2].trim() };
  return { subject: null, body: text };
}

export function parseClaudeDeliverablePayload(raw: string): ClaudeDeliverablePayload | null {
  const jsonText = extractJsonText(raw);
  if (!jsonText) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    const match = jsonText.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;
  const body = asTrimmed(o.body) ?? asTrimmed(o.text);
  if (!body) return null;
  const subject = asTrimmed(o.subject) ?? null;
  return {
    kind: normalizeDraftKind(o.kind),
    subject,
    body,
    assumptions: assumptionsFromUnknown(o.assumptions ?? o.assumption_checklist),
  };
}

export function normalizeDraftBody(body: string): string {
  return body.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function bodiesSimilar(a: string, b: string): boolean {
  const na = normalizeDraftBody(a);
  const nb = normalizeDraftBody(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const ta = new Set(na.split(" ").filter((w) => w.length > 2));
  const tb = new Set(nb.split(" ").filter((w) => w.length > 2));
  if (!ta.size || !tb.size) return false;
  let overlap = 0;
  for (const w of ta) if (tb.has(w)) overlap += 1;
  return overlap / Math.min(ta.size, tb.size) >= 0.8;
}

export function filterNewDeliverableDraft(
  incoming: ClaudeDeliverablePayload | null,
  existing: Array<Pick<DeliverableDraft, "kind" | "body" | "status">>,
  opts?: { maxOpen?: number },
): ClaudeDeliverablePayload | null {
  if (!incoming) return null;
  const body = incoming.body.trim();
  if (!body) return null;
  const maxOpen = opts?.maxOpen ?? MAX_OPEN_DRAFTS;
  const open = existing.filter((d) => OPEN_DRAFT_STATUSES.has(d.status));
  if (open.length >= maxOpen) return null;
  const kind = incoming.kind;
  if (
    open.some(
      (d) =>
        normalizeDraftKind(d.kind) === kind &&
        bodiesSimilar(parseDraftSubjectBody(d.body).body || d.body || "", body),
    )
  ) {
    return null;
  }
  return {
    kind,
    subject: incoming.subject,
    body,
    assumptions: incoming.assumptions,
  };
}

export function canEditAssumptions(status: DeliverableDraftStatus | string): boolean {
  return status === "draft" || status === "ready";
}

export function canMarkReady(status: DeliverableDraftStatus | string): boolean {
  return status === "draft";
}

export function canSend(status: DeliverableDraftStatus | string): boolean {
  return status === "ready";
}

export function canDiscard(status: DeliverableDraftStatus | string): boolean {
  return status === "draft" || status === "ready";
}

export function updateAssumptionText(
  items: AssumptionItem[],
  itemId: string,
  text: string,
): AssumptionItem[] {
  const trimmed = text.trim();
  return items.map((item) => (item.id === itemId ? { ...item, text: trimmed || item.text } : item));
}

export function toggleAssumptionChecked(items: AssumptionItem[], itemId: string): AssumptionItem[] {
  return items.map((item) => (item.id === itemId ? { ...item, checked: !item.checked } : item));
}

export function assumptionsAsJson(items: AssumptionItem[]): Json {
  return serializeAssumptionChecklist(items);
}

/** Append checked/unchecked assumptions so the ledger row is auditable. */
export function bodyWithAssumptionFooter(body: string, items: AssumptionItem[]): string {
  const trimmed = body.trim();
  if (!items.length) return trimmed;
  const lines = items.map((item) => `- [${item.checked ? "x" : " "}] ${item.text}`);
  return `${trimmed}\n\n---\nAssumptions\n${lines.join("\n")}`;
}
