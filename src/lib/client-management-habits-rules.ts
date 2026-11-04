/**
 * Client-scoped Reality / Habits / Expectations rules (firm IP).
 * Stored as shared client_artifacts rows — not Compliance, not a second ledger.
 * Management / habits view only.
 */
import type { Json } from "@/integrations/supabase/types";

export const MANAGEMENT_HABITS_VIEW_LABEL = "Management / habits view";

export const MANAGEMENT_RULE_PILLARS = ["reality", "habits", "expectations"] as const;
export type ManagementRulePillar = (typeof MANAGEMENT_RULE_PILLARS)[number];

export const MANAGEMENT_RULE_PILLAR_LABEL: Record<ManagementRulePillar, string> = {
  reality: "Reality",
  habits: "Habits",
  expectations: "Expectations",
};

export const MANAGEMENT_RULE_ARTIFACT_DOC_TYPE = "management_habit_rule";

/** Prompt guardrails — bots and UI copy must stay aligned. */
export const MANAGEMENT_HABITS_HARD_NO = [
  "Not statutory compliance, tax filing, or a second set of books.",
  "Does not write to Xero, QuickBooks, Sage, or any ledger of record.",
  "Templates stay here until an accountant edits them; client confirm/dismiss on instances is separate (P1).",
] as const;

export type ManagementHabitRuleRow = {
  id: string;
  client_id: string;
  pillar: ManagementRulePillar;
  label: string;
  body: string;
  firm_id: string | null;
  author_id: string | null;
  author_name: string;
  edited_at: string;
  created_at: string;
};

export type ManagementHabitRuleInput = {
  pillar: ManagementRulePillar;
  label: string;
  body: string;
};

function asTrimmed(value: unknown, max: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  return text.length > max ? text.slice(0, max) : text;
}

function parsePillar(raw: unknown): ManagementRulePillar | null {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return (MANAGEMENT_RULE_PILLARS as readonly string[]).includes(value)
    ? (value as ManagementRulePillar)
    : null;
}

export function isManagementHabitRuleMeta(meta: unknown): boolean {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return false;
  return (meta as Record<string, unknown>).doc_type === MANAGEMENT_RULE_ARTIFACT_DOC_TYPE;
}

export function parseManagementHabitRuleArtifact(row: {
  id: string;
  client_id: string;
  meta: Json | null;
  created_by?: string | null;
  created_at?: string | null;
}): ManagementHabitRuleRow | null {
  const meta = row.meta && typeof row.meta === "object" && !Array.isArray(row.meta) ? row.meta : null;
  if (!isManagementHabitRuleMeta(meta)) return null;
  const record = meta as Record<string, unknown>;
  const pillar = parsePillar(record.pillar);
  const label = asTrimmed(record.label, 120);
  const body = asTrimmed(record.body, 4000);
  if (!pillar || !label || !body) return null;
  const editedAt =
    asTrimmed(record.edited_at, 40) || asTrimmed(row.created_at, 40) || new Date(0).toISOString();
  return {
    id: row.id,
    client_id: row.client_id,
    pillar,
    label,
    body,
    firm_id: asTrimmed(record.firm_id, 40) || null,
    author_id: asTrimmed(record.author_id, 40) || row.created_by || null,
    author_name: asTrimmed(record.author_name, 120) || "Accountant",
    edited_at: editedAt,
    created_at: asTrimmed(row.created_at, 40) || editedAt,
  };
}

export function buildManagementHabitRuleMeta(input: {
  pillar: ManagementRulePillar;
  label: string;
  body: string;
  firmId: string | null;
  authorId: string | null;
  authorName: string;
  editedAt: string;
}): Record<string, unknown> {
  return {
    doc_type: MANAGEMENT_RULE_ARTIFACT_DOC_TYPE,
    pillar: input.pillar,
    label: input.label.trim(),
    body: input.body.trim(),
    firm_id: input.firmId,
    author_id: input.authorId,
    author_name: input.authorName.trim() || "Accountant",
    edited_at: input.editedAt,
  };
}

export function validateManagementHabitRuleInput(input: ManagementHabitRuleInput): string | null {
  if (!parsePillar(input.pillar)) return "Choose Reality, Habits, or Expectations.";
  if (!input.label.trim()) return "Add a short rule name.";
  if (input.label.trim().length > 120) return "The rule name is too long.";
  if (!input.body.trim()) return "Add the rule text.";
  if (input.body.trim().length > 4000) return "The rule text is too long.";
  return null;
}

/** Compact lines for ask-ai / runner peer context. */
export function formatManagementHabitRulesPeerLines(rules: readonly ManagementHabitRuleRow[]): string[] {
  if (!rules.length) return [];
  const shown = rules.slice(0, 12).map((rule) => {
    const pillar = MANAGEMENT_RULE_PILLAR_LABEL[rule.pillar];
    const snippet = rule.body.length > 140 ? `${rule.body.slice(0, 137)}…` : rule.body;
    return `${rule.id} · ${pillar} · ${rule.label}: ${snippet}`;
  });
  return [
    `${MANAGEMENT_HABITS_VIEW_LABEL} — Reality / Habits / Expectations (${rules.length}): ${shown.join(" | ")}`,
  ];
}

/** Bot citation format — parsed in agent-reply for chips. */
export const LIBRARY_RULE_CITATION_PREFIX = "Library rule:";

export function managementHabitRuleCitationLine(rule: Pick<ManagementHabitRuleRow, "id" | "pillar" | "label">): string {
  const pillar = MANAGEMENT_RULE_PILLAR_LABEL[rule.pillar];
  return `${LIBRARY_RULE_CITATION_PREFIX} ${rule.id} (${pillar} — ${rule.label})`;
}

export const MANAGEMENT_HABITS_BOT_READ_PROMPT =
  "list_client_management_rules returns client-scoped Reality / Habits / Expectations templates from the accountant library (management / habits view). They are firm IP, not Compliance and not statutory books. When you record_draft an action_point_draft or describe a cash call, cite at least one rule id from that list in detail using the exact line format: Library rule: <id> (Reality|Habits|Expectations — <label>). These reads never post to Xero, QuickBooks, or Sage.";

const CITATION_RE =
  /Library rule:\s*([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\s*\(([^)]+)\)/gi;

/** Surface library rule citations already written in model text. */
export function libraryRuleChipsFromText(text: string): Array<{ label: string; value: string; source: string }> {
  const chips: Array<{ label: string; value: string; source: string }> = [];
  for (const match of text.matchAll(CITATION_RE)) {
    const id = match[1];
    const rest = match[2]?.trim() ?? "";
    if (!id) continue;
    chips.push({ label: rest || "Library rule", value: id.slice(0, 8), source: "library_rule" });
    if (chips.length >= 3) break;
  }
  return chips;
}
