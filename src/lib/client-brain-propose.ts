/**
 * Propose-from-brain helpers: idempotent next steps, draft-only GAP/competitor
 * merges, and Claude JSON parsing. Missing data stays empty — no filler.
 */

import type { Json } from "@/integrations/supabase/types";
import {
  parseCompetitors,
  parseGapReport,
  type BrainCompetitor,
  type GapReportItem,
  type ProposedNextStep,
} from "@/lib/client-brain";

export const MAX_NEW_STEPS_PER_CALL = 3;
export const MAX_OPEN_PROPOSED_STEPS = 5;
export const MAX_NEW_GAP_DRAFTS = 3;
export const MAX_NEW_COMPETITOR_DRAFTS = 3;
export const PROPOSE_RATE_LIMIT = 8;

export const OPEN_STEP_STATUSES = new Set(["proposed", "edited"]);

export type ProposedStepInput = {
  title: string;
  rationale: string | null;
  assumptions: Json;
};

export type ClaudeProposePayload = {
  next_steps: ProposedStepInput[];
  gap_items: Array<{
    key?: string;
    title?: string;
    detail?: string;
    severity?: string;
    status?: string;
  }>;
  competitors: Array<{
    name?: string;
    notes?: string;
    threat?: string;
    status?: string;
  }>;
};

function asTrimmed(raw: unknown): string | undefined {
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

export function normalizeStepTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function titlesSimilar(a: string, b: string): boolean {
  const na = normalizeStepTitle(a);
  const nb = normalizeStepTitle(b);
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

export function filterNewProposedSteps(
  incoming: ProposedStepInput[],
  existing: Array<Pick<ProposedNextStep, "title" | "status">>,
  opts?: { maxNew?: number; maxOpen?: number },
): ProposedStepInput[] {
  const maxNew = opts?.maxNew ?? MAX_NEW_STEPS_PER_CALL;
  const maxOpen = opts?.maxOpen ?? MAX_OPEN_PROPOSED_STEPS;
  const open = existing.filter((s) => OPEN_STEP_STATUSES.has(s.status));
  if (open.length >= maxOpen) return [];
  const out: ProposedStepInput[] = [];
  for (const step of incoming) {
    if (out.length >= maxNew) break;
    if (open.length + out.length >= maxOpen) break;
    const title = step.title.trim();
    if (!title) continue;
    if (open.some((e) => titlesSimilar(e.title, title))) continue;
    if (out.some((e) => titlesSimilar(e.title, title))) continue;
    out.push({
      title,
      rationale: step.rationale?.trim() || null,
      assumptions: step.assumptions,
    });
  }
  return out;
}

export function slugGapKey(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return slug || "gap";
}

/** Claude proposals are always draft. Never copy signed_off from the model. */
export function mergeDraftGapItems(
  existing: GapReportItem[] | null | undefined,
  incoming: ClaudeProposePayload["gap_items"],
  maxNew = MAX_NEW_GAP_DRAFTS,
): { items: GapReportItem[]; added: number } {
  const items: GapReportItem[] = [...(existing ?? [])];
  let added = 0;
  for (const raw of incoming) {
    if (added >= maxNew) break;
    const title = asTrimmed(raw.title);
    if (!title) continue;
    const key = asTrimmed(raw.key) ?? slugGapKey(title);
    const dup = items.find(
      (i) => i.key === key || i.title.toLowerCase() === title.toLowerCase(),
    );
    if (dup) continue;
    items.push({
      key,
      title,
      detail: asTrimmed(raw.detail),
      severity: asTrimmed(raw.severity),
      status: "draft",
    });
    added += 1;
  }
  return { items, added };
}

export function mergeDraftCompetitors(
  existing: BrainCompetitor[],
  incoming: ClaudeProposePayload["competitors"],
  maxNew = MAX_NEW_COMPETITOR_DRAFTS,
): { items: BrainCompetitor[]; added: number } {
  const items: BrainCompetitor[] = [...existing];
  let added = 0;
  for (const raw of incoming) {
    if (added >= maxNew) break;
    const name = asTrimmed(raw.name);
    if (!name) continue;
    const dup = items.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (dup) continue;
    items.push({
      name,
      notes: asTrimmed(raw.notes),
      threat: asTrimmed(raw.threat),
      status: "draft",
    });
    added += 1;
  }
  return { items, added };
}

export function asBrainSummaryObject(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return { ...(raw as Record<string, unknown>) };
  }
  if (typeof raw === "string" && raw.trim()) return { body: raw.trim() };
  return {};
}

export function applyDraftBrainPatches(
  rawSummary: unknown,
  payload: Pick<ClaudeProposePayload, "gap_items" | "competitors">,
  nowIso: string,
): { blob: Record<string, unknown>; gapAdded: number; competitorAdded: number } {
  const blob = asBrainSummaryObject(rawSummary);
  const gap = mergeDraftGapItems(parseGapReport(rawSummary)?.items, payload.gap_items);
  const competitors = mergeDraftCompetitors(parseCompetitors(rawSummary), payload.competitors);
  if (gap.added > 0) {
    blob.gap_report = { items: gap.items, updated_at: nowIso };
  } else if (gap.items.length) {
    blob.gap_report = {
      items: gap.items,
      updated_at: parseGapReport(rawSummary)?.updated_at,
    };
  }
  if (competitors.added > 0 || competitors.items.length) {
    blob.competitors = competitors.items;
  }
  return { blob, gapAdded: gap.added, competitorAdded: competitors.added };
}

export function assumptionsToJson(raw: unknown): Json {
  if (!Array.isArray(raw)) return [];
  const items = raw
    .map((item, i) => {
      if (typeof item === "string" && item.trim()) {
        return { id: `a-${i}`, text: item.trim(), checked: false };
      }
      if (item && typeof item === "object") {
        const text = asTrimmed((item as { text?: unknown }).text);
        if (!text) return null;
        return { id: `a-${i}`, text, checked: false };
      }
      return null;
    })
    .filter((x): x is { id: string; text: string; checked: boolean } => x != null);
  return items;
}

export function extractJsonText(raw: string): string {
  return raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

export function parseClaudeProposePayload(raw: string): ClaudeProposePayload {
  const empty: ClaudeProposePayload = { next_steps: [], gap_items: [], competitors: [] };
  const jsonText = extractJsonText(raw);
  if (!jsonText) return empty;
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    const match = jsonText.match(/\{[\s\S]*\}/);
    if (!match) return empty;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return empty;
    }
  }
  if (!parsed || typeof parsed !== "object") return empty;
  const o = parsed as Record<string, unknown>;
  const stepsRaw = Array.isArray(o.next_steps) ? o.next_steps : [];
  const next_steps: ProposedStepInput[] = [];
  for (const step of stepsRaw) {
    if (!step || typeof step !== "object") continue;
    const title = asTrimmed((step as { title?: unknown }).title);
    if (!title) continue;
    next_steps.push({
      title,
      rationale: asTrimmed((step as { rationale?: unknown }).rationale) ?? null,
      assumptions: assumptionsToJson((step as { assumptions?: unknown }).assumptions),
    });
  }
  const gapRaw = Array.isArray(o.gap_items)
    ? o.gap_items
    : Array.isArray(o.gap_report)
      ? o.gap_report
      : [];
  const gap_items: ClaudeProposePayload["gap_items"] = [];
  for (const item of gapRaw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    gap_items.push({
      key: asTrimmed(row.key),
      title: asTrimmed(row.title),
      detail: asTrimmed(row.detail),
      severity: asTrimmed(row.severity),
      // Ignore model status — merge always stamps draft.
    });
  }
  const compRaw = Array.isArray(o.competitors) ? o.competitors : [];
  const competitors: ClaudeProposePayload["competitors"] = [];
  for (const item of compRaw) {
    if (typeof item === "string") {
      competitors.push({ name: asTrimmed(item) });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    competitors.push({
      name: asTrimmed(row.name),
      notes: asTrimmed(row.notes),
      threat: asTrimmed(row.threat),
    });
  }
  return { next_steps, gap_items, competitors };
}

export function markGapItemSignedOff(
  items: GapReportItem[],
  key: string,
): GapReportItem[] {
  return items.map((item) => (item.key === key ? { ...item, status: "signed_off" } : item));
}

export function markCompetitorSignedOff(
  items: BrainCompetitor[],
  name: string,
): BrainCompetitor[] {
  return items.map((item) =>
    item.name.toLowerCase() === name.toLowerCase() ? { ...item, status: "signed_off" } : item,
  );
}
