/**
 * Client Brain — typed rows + small parsers for the Summary tab.
 * Propose-from-brain writes proposed_next_steps and draft GAP/competitor stubs.
 */

import type { Json } from "@/integrations/supabase/types";

export const ARTIFACT_KINDS = [
  "financial_snapshot",
  "budget",
  "upload",
  "advisory",
  "note",
  "other",
] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export const FACT_SOURCES = [
  "ask_ai",
  "note",
  "profile",
  "manual",
  "extract",
  "other",
] as const;
export type FactSource = (typeof FACT_SOURCES)[number];

export const NEXT_STEP_STATUSES = ["proposed", "approved", "edited", "rejected"] as const;
export type NextStepStatus = (typeof NEXT_STEP_STATUSES)[number];

export const DRAFT_STATUSES = ["draft", "ready", "sent", "discarded"] as const;
export type DeliverableDraftStatus = (typeof DRAFT_STATUSES)[number];

export type ClientArtifact = {
  id: string;
  client_id: string;
  kind: ArtifactKind;
  ref_table: string | null;
  ref_id: string | null;
  storage_path: string | null;
  period_label: string | null;
  meta: Json;
  /** 'private' (owner side only) or 'shared' (anyone with client access). */
  visibility?: "private" | "shared" | string;
  created_by: string | null;
  created_at: string;
};

export type ContextFact = {
  id: string;
  client_id: string;
  fact_text: string;
  category: string | null;
  source: FactSource | null;
  source_ref: string | null;
  confidence: number | null;
  superseded_by: string | null;
  created_by: string | null;
  created_at: string;
};

export type ProposedNextStep = {
  id: string;
  client_id: string;
  title: string;
  rationale: string | null;
  assumptions: Json;
  status: NextStepStatus;
  edit_diff: Json | null;
  linked_action_item_id: string | null;
  signed_off_by_id: string | null;
  signed_off_by_name: string | null;
  signed_off_by_title: string | null;
  firm_name: string | null;
  signed_off_at: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type DeliverableDraft = {
  id: string;
  client_id: string;
  kind: string | null;
  body: string | null;
  assumption_checklist: Json;
  status: DeliverableDraftStatus;
  advisory_delivery_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type BrainSummaryBlob = {
  headline?: string;
  body?: string;
  bullets?: string[];
};

export type GapReportStatus = "draft" | "signed_off";

export type GapReportItem = {
  key: string;
  title: string;
  detail?: string;
  severity?: string;
  status?: GapReportStatus;
};

export type GapReport = {
  items: GapReportItem[];
  updated_at?: string;
};

export type BrainCompetitor = {
  name: string;
  notes?: string;
  threat?: string;
  /** Claude stubs are always draft. Sign-off is accountant-only. */
  status?: GapReportStatus;
};

export type BusinessMap = {
  customers_channels?: string;
  pricing_model?: string;
  team_size?: string;
  key_systems?: string;
  regulatory?: string;
  seasonality?: string;
};

export const BUSINESS_MAP_FIELDS = [
  { key: "customers_channels", label: "Customers / channels" },
  { key: "pricing_model", label: "Pricing model" },
  { key: "team_size", label: "Team size" },
  { key: "key_systems", label: "Key systems" },
  { key: "regulatory", label: "Regulatory" },
  { key: "seasonality", label: "Seasonality" },
] as const;

export type BrainQuestionStatus = "unanswered" | "answered" | "skipped";
export type BrainQuestionAudience = "owner" | "accountant" | "both";

export type ClientBrainQuestion = {
  id: string;
  client_id: string;
  question_key: string;
  prompt_text: string | null;
  status: BrainQuestionStatus;
  audience: BrainQuestionAudience;
  answer_text: string | null;
  answer_json: Json | null;
  last_asked_at: string | null;
  answered_at: string | null;
  answered_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AssumptionItem = {
  id: string;
  text: string;
  checked: boolean;
};

/** True when PostgREST has not seen the brain migration yet. */
export function isMissingBrainRelation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const msg = error.message ?? "";
  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    /does not exist/i.test(msg)
  );
}

export function parseBrainSummary(raw: unknown): BrainSummaryBlob | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const body = raw.trim();
    return body ? { body } : null;
  }
  if (typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const headline =
    (typeof o.headline === "string" && o.headline.trim()) ||
    (typeof o.title === "string" && o.title.trim()) ||
    undefined;
  const body =
    (typeof o.body === "string" && o.body.trim()) ||
    (typeof o.summary === "string" && o.summary.trim()) ||
    undefined;
  const bullets = Array.isArray(o.bullets)
    ? o.bullets.filter((b): b is string => typeof b === "string" && b.trim().length > 0)
    : undefined;
  if (!headline && !body && !bullets?.length) return null;
  return { headline, body, bullets };
}

function asTrimmed(raw: unknown): string | undefined {
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

export function parseGapReport(raw: unknown): GapReport | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const src = o.gap_report && typeof o.gap_report === "object" ? (o.gap_report as Record<string, unknown>) : o;
  const list = Array.isArray(src.items) ? src.items : Array.isArray(o.items) ? o.items : null;
  if (!list) return null;
  const items: GapReportItem[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const title = asTrimmed(row.title);
    if (!title) continue;
    const status = row.status === "signed_off" || row.status === "draft" ? row.status : undefined;
    items.push({
      key: asTrimmed(row.key) ?? `gap-${items.length}`,
      title,
      detail: asTrimmed(row.detail),
      severity: asTrimmed(row.severity),
      status,
    });
  }
  if (!items.length) return null;
  return { items, updated_at: asTrimmed(src.updated_at) };
}

export function parseCompetitors(raw: unknown): BrainCompetitor[] {
  if (!raw || typeof raw !== "object") return [];
  const o = raw as Record<string, unknown>;
  const list = Array.isArray(o.competitors) ? o.competitors : [];
  const out: BrainCompetitor[] = [];
  for (const item of list) {
    if (typeof item === "string" && item.trim()) {
      out.push({ name: item.trim() });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const name = asTrimmed(row.name);
    if (!name) continue;
    const status = row.status === "signed_off" || row.status === "draft" ? row.status : undefined;
    out.push({
      name,
      notes: asTrimmed(row.notes),
      threat: asTrimmed(row.threat),
      status,
    });
  }
  return out;
}

export function parseBusinessMap(raw: unknown): BusinessMap {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const src =
    o.business_map && typeof o.business_map === "object" && !Array.isArray(o.business_map)
      ? (o.business_map as Record<string, unknown>)
      : o;
  const map: BusinessMap = {};
  for (const { key } of BUSINESS_MAP_FIELDS) {
    const value = asTrimmed(src[key]);
    if (value) map[key] = value;
  }
  return map;
}

const FACT_CATEGORY_TO_MAP: Record<string, keyof BusinessMap> = {
  customers: "customers_channels",
  channels: "customers_channels",
  customers_channels: "customers_channels",
  pricing: "pricing_model",
  pricing_model: "pricing_model",
  team: "team_size",
  team_size: "team_size",
  systems: "key_systems",
  key_systems: "key_systems",
  regulatory: "regulatory",
  regulation: "regulatory",
  seasonality: "seasonality",
};

/** Fill empty business-map slots from context_facts categories. Never invents text. */
export function mergeBusinessMapFromFacts(map: BusinessMap, facts: ContextFact[]): BusinessMap {
  const next = { ...map };
  for (const fact of facts) {
    const cat = (fact.category ?? "").trim().toLowerCase().replace(/\s+/g, "_");
    const key = FACT_CATEGORY_TO_MAP[cat];
    if (!key || next[key]) continue;
    const text = fact.fact_text.trim();
    if (text) next[key] = text;
  }
  return next;
}

export function parseAssumptionChecklist(raw: unknown): AssumptionItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, i): AssumptionItem | null => {
      if (typeof item === "string") {
        const text = item.trim();
        return text ? { id: `a-${i}`, text, checked: false } : null;
      }
      if (!item || typeof item !== "object") return null;
      const o = item as Record<string, unknown>;
      const text =
        (typeof o.text === "string" && o.text.trim()) ||
        (typeof o.label === "string" && o.label.trim()) ||
        "";
      if (!text) return null;
      const id = typeof o.id === "string" && o.id.trim() ? o.id : `a-${i}`;
      const checked = o.checked === true || o.done === true;
      return { id, text, checked };
    })
    .filter((x): x is AssumptionItem => x != null);
}

export function serializeAssumptionChecklist(items: AssumptionItem[]): Json {
  return items.map((item) => ({
    id: item.id,
    text: item.text,
    checked: item.checked,
  }));
}

export function nextStepStatusLabel(status: NextStepStatus): string {
  if (status === "proposed") return "Proposed";
  if (status === "approved") return "Approved";
  if (status === "edited") return "Edited";
  return "Rejected";
}

export function artifactKindLabel(kind: ArtifactKind | string): string {
  if (kind === "financial_snapshot") return "Financial snapshot";
  if (kind === "budget") return "Budget";
  if (kind === "upload") return "Upload";
  if (kind === "advisory") return "Advisory";
  if (kind === "note") return "Note";
  return "Other";
}

export function factSourceLabel(source: FactSource | string | null): string {
  if (source === "ask_ai") return "Milōn Bot";
  if (source === "note") return "Note";
  if (source === "profile") return "Profile";
  if (source === "manual") return "Manual";
  if (source === "extract") return "Extract";
  if (source === "other") return "Other";
  return "Unknown";
}

export function draftStatusLabel(status: DeliverableDraftStatus | string | null): string {
  if (status === "ready") return "Ready";
  if (status === "sent") return "Sent";
  if (status === "discarded") return "Discarded";
  return "Draft";
}

export type NextStepEditDiff = {
  title?: { from: string; to: string };
  rationale?: { from: string | null; to: string | null };
};

export function buildNextStepEditDiff(
  prior: Pick<ProposedNextStep, "title" | "rationale">,
  next: { title: string; rationale: string | null },
): NextStepEditDiff {
  const diff: NextStepEditDiff = {};
  if (prior.title !== next.title) diff.title = { from: prior.title, to: next.title };
  if ((prior.rationale ?? null) !== next.rationale) {
    diff.rationale = { from: prior.rationale ?? null, to: next.rationale };
  }
  return diff;
}
