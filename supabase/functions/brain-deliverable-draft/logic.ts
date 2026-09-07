/**
 * Deno copy of src/lib/client-brain-deliverable.ts.
 * Keep rules in sync: draft-only insert, similar-open skip, empty assumptions stay empty.
 */

export const MAX_OPEN_DRAFTS = 3;
export const DRAFT_RATE_LIMIT = 8;
export const OPEN_DRAFT_STATUSES = new Set(["draft", "ready"]);
export const DRAFT_KINDS = ["advisory", "client_email", "meeting_agenda", "exec_summary"] as const;
export type DeliverableKind = (typeof DRAFT_KINDS)[number];

export type AssumptionItem = { id: string; text: string; checked: boolean };

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

export function extractJsonText(raw: string): string {
  return raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

export function assumptionsFromUnknown(raw: unknown): AssumptionItem[] {
  if (!Array.isArray(raw)) return [];
  const out: AssumptionItem[] = [];
  raw.forEach((item, i) => {
    let text = "";
    if (typeof item === "string") text = item.trim();
    else if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      text = asTrimmed(o.text) ?? asTrimmed(o.label) ?? "";
    }
    if (!text) return;
    out.push({ id: `a-${out.length || i}`, text, checked: false });
  });
  return out;
}

export function composeDraftBody(subject: string | null, body: string): string {
  const text = body.trim();
  const sub = subject?.trim();
  if (sub && !/^\s*SUBJECT:/i.test(text)) return `SUBJECT: ${sub}\n\n${text}`;
  return text;
}

export function parseDraftSubjectBody(raw: string | null | undefined): { subject: string | null; body: string } {
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
  return {
    kind: normalizeDraftKind(o.kind),
    subject: asTrimmed(o.subject) ?? null,
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
  existing: Array<{ kind: string | null; body: string | null; status: string }>,
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
  return { kind, subject: incoming.subject, body, assumptions: incoming.assumptions };
}
