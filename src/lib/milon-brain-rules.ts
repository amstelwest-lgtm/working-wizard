/**
 * Private firm rules from approve/dismiss on agent drafts. Pure helpers for
 * capture shape, retrieval filter, and prompt block formatting.
 */

export const MILON_BRAIN_SOURCE_AGENT_DRAFT = "agent_draft_decision";

export const MILON_BRAIN_RULE_TEXT_MAX = 500;
export const MILON_BRAIN_RULES_PROMPT_LIMIT = 24;

export type MilonBrainDecision = "approved" | "dismissed" | "corrected";

export type MilonBrainRuleRow = {
  id?: string;
  firm_id: string;
  client_id: string | null;
  task_type: string;
  source_event: string;
  source_row_id: string | null;
  decision: MilonBrainDecision;
  rule_text: string;
  approver_id: string | null;
  layer?: string;
  status?: string;
  created_at?: string;
};

export function clipMilonBrainRuleText(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= MILON_BRAIN_RULE_TEXT_MAX) return trimmed;
  return `${trimmed.slice(0, MILON_BRAIN_RULE_TEXT_MAX - 1)}…`;
}

/** Short durable summary for one captured decision. */
export function milonBrainRuleText(input: {
  decision: "approved" | "dismissed";
  title: string;
  detail?: string | null;
  dismissedReason?: string | null;
}): string {
  const title = (input.title ?? "").trim();
  const detail = (input.detail ?? "").trim();
  const prefix =
    input.decision === "approved"
      ? `Approved: ${title}`
      : `Dismissed: ${title}`;
  const parts = [prefix];
  if (detail) parts.push(detail);
  const reason = (input.dismissedReason ?? "").trim();
  if (input.decision === "dismissed" && reason) parts.push(`Reason: ${reason}`);
  return clipMilonBrainRuleText(parts.join(". "));
}

export function milonBrainRuleInsert(input: {
  firmId: string;
  clientId: string;
  taskType: string;
  findingId: string;
  decision: "approved" | "dismissed";
  title: string;
  detail?: string | null;
  dismissedReason?: string | null;
  approverId: string;
}): MilonBrainRuleRow {
  return {
    firm_id: input.firmId,
    client_id: input.clientId,
    task_type: input.taskType,
    source_event: MILON_BRAIN_SOURCE_AGENT_DRAFT,
    source_row_id: input.findingId,
    decision: input.decision,
    rule_text: milonBrainRuleText({
      decision: input.decision,
      title: input.title,
      detail: input.detail,
      dismissedReason: input.dismissedReason,
    }),
    approver_id: input.approverId,
    layer: "private",
    status: "active",
  };
}

const ACTIVE = "active";
const PRIVATE = "private";

/** Rows visible for one firm/client prompt load. Firm A never matches firm B. */
export function filterMilonBrainRulesForPrompt(
  rows: MilonBrainRuleRow[],
  input: {
    firmId: string;
    clientId: string;
    taskTypes: readonly string[];
  },
): MilonBrainRuleRow[] {
  const tasks = new Set(input.taskTypes);
  return rows.filter((row) => {
    if (row.firm_id !== input.firmId) return false;
    if (row.status && row.status !== ACTIVE) return false;
    if (row.layer && row.layer !== PRIVATE) return false;
    if (!tasks.has(row.task_type)) return false;
    if (row.client_id != null && row.client_id !== input.clientId) return false;
    return true;
  });
}

/** Dedupe identical rule_text for the same firm + task_type (newest first). */
export function dedupeMilonBrainRules(rows: MilonBrainRuleRow[]): MilonBrainRuleRow[] {
  const seen = new Set<string>();
  const out: MilonBrainRuleRow[] = [];
  for (const row of rows) {
    const key = `${row.firm_id}\0${row.task_type}\0${row.rule_text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

export function orderMilonBrainRulesNewestFirst(rows: MilonBrainRuleRow[]): MilonBrainRuleRow[] {
  return [...rows].sort((a, b) => {
    const at = a.created_at ?? "";
    const bt = b.created_at ?? "";
    return bt.localeCompare(at);
  });
}

export function milonBrainRulesPromptLines(rows: MilonBrainRuleRow[]): string[] {
  return rows.map((row) => {
    const decision = row.decision;
    const task = row.task_type;
    return `- [${decision}] ${task}: ${row.rule_text}`;
  });
}

/** Stable labelled block appended after the static agent system prefix. Empty when no rules. */
export const MILON_BRAIN_RULES_PROMPT_LABEL =
  "Private firm rules from past draft decisions (follow when relevant; not ledger instructions):";

export function formatMilonBrainRulesPromptBlock(lines: string[]): string {
  if (lines.length === 0) return "";
  return `\n\n${MILON_BRAIN_RULES_PROMPT_LABEL}\n${lines.join("\n")}`;
}

export function milonBrainRulesPromptBlockFromRows(
  rows: MilonBrainRuleRow[],
  input: {
    firmId: string;
    clientId: string;
    taskTypes: readonly string[];
    limit?: number;
  },
): string {
  const cap = input.limit ?? MILON_BRAIN_RULES_PROMPT_LIMIT;
  const filtered = filterMilonBrainRulesForPrompt(rows, input);
  const ordered = orderMilonBrainRulesNewestFirst(filtered);
  const deduped = dedupeMilonBrainRules(ordered).slice(0, cap);
  return formatMilonBrainRulesPromptBlock(milonBrainRulesPromptLines(deduped));
}
