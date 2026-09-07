/**
 * Client Brain — typed rows + small parsers for the Summary tab.
 * Structure only: no Claude propose / AI generation.
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
  if (source === "ask_ai") return "Ask AI";
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
