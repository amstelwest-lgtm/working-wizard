/**
 * Analyst review for the sample trial.
 * One model call. The analyst prompt and finding rules are reused.
 * Ledger read tools are not offered and are refused if named.
 */

import { findingKindAllowed } from "@/lib/agent-analyst";
import { claudeRequestFields } from "@/lib/claude-request";
import type { TrialBoard, TrialFinding } from "@/lib/trial-demo";
import {
  ANALYST_SYSTEM,
  analystToolSchemas,
} from "../../supabase/functions/_shared/agent-prompts/analyst.ts";

/** Output cap for the single trial call. Thinking tokens count against it. */
export const TRIAL_ANALYST_MAX_TOKENS = 1024;

export const TRIAL_ANALYST_TOOLS = ["record_finding", "finish"] as const;

export type TrialAnalystToolName = (typeof TRIAL_ANALYST_TOOLS)[number];

const LEDGER_READS = [
  "get_health",
  "get_ratios",
  "get_variance",
  "get_financial_snapshot",
  "get_statement_history",
  "get_data_freshness",
  "get_score_history",
] as const;

export function trialAnalystSystem(): string {
  return `${ANALYST_SYSTEM}

Trial mode, one call:
- The user message is the only books. It is a sample, not a client ledger.
- ${LEDGER_READS.join(", ")} are not available. Do not call them.
- Record at most three findings with record_finding, using only numbers from the user message, then call finish.
- Do not name a model vendor.`;
}

export function trialAnalystTools() {
  const allow = new Set<string>(TRIAL_ANALYST_TOOLS);
  return analystToolSchemas().filter((tool) => allow.has(tool.name));
}

export function executeTrialAnalystGate(
  name: string,
):
  | { allowed: true; name: TrialAnalystToolName }
  | { allowed: false; error: string; tool_blocked: true; tool: string } {
  if ((TRIAL_ANALYST_TOOLS as readonly string[]).includes(name)) {
    return { allowed: true, name: name as TrialAnalystToolName };
  }
  return {
    allowed: false,
    error: "Trial mode has no ledger tools.",
    tool_blocked: true,
    tool: name,
  };
}

export function trialAnalystUserMessage(board: TrialBoard): string {
  const evidence = {
    period_label: "Sample year",
    overall: board.health.score,
    pillars: Object.fromEntries(board.health.pillars.map((pillar) => [pillar.id, pillar.score])),
    ratios: Object.fromEntries(board.ratios.map((ratio) => [ratio.name, ratio.value])),
  };
  const keys = [
    "overall",
    ...board.health.pillars.map((pillar) => `pillar:${pillar.id}`),
    ...board.ratios.map((ratio) => ratio.name),
  ];
  return [
    "Sample figures for this trial. There is no ledger. Quote only these numbers.",
    `evidence keys you may cite: ${keys.join(", ")}`,
    JSON.stringify(evidence),
  ].join("\n");
}

export function trialAnalystRequest(input: { model: string; system: string; user: string }) {
  return {
    model: input.model,
    max_tokens: TRIAL_ANALYST_MAX_TOKENS,
    system: input.system,
    tools: trialAnalystTools(),
    messages: [{ role: "user" as const, content: input.user }],
    ...claudeRequestFields({ model: input.model, toolChoice: { type: "auto" } }),
  };
}

const SEVERITY = new Set(["info", "watch", "act"]);

function cleanSentence(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\b(claude|anthropic|openai|gpt-\d[\w.-]*)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function findingsFromAnalystContent(content: unknown): TrialFinding[] {
  if (!Array.isArray(content)) return [];
  const out: TrialFinding[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const rec = block as { type?: string; name?: string; input?: unknown };
    if (rec.type !== "tool_use" || rec.name !== "record_finding") continue;
    const gate = executeTrialAnalystGate(rec.name);
    if (!gate.allowed) continue;
    const input = rec.input;
    if (!input || typeof input !== "object") continue;
    const row = input as Record<string, unknown>;
    const kind = typeof row.kind === "string" ? row.kind : "";
    const severity = typeof row.severity === "string" ? row.severity : "";
    const title = cleanSentence(row.title, 200);
    const detail = cleanSentence(row.detail, 2000);
    if (!findingKindAllowed(kind)) continue;
    if (!SEVERITY.has(severity)) continue;
    if (!title || !detail) continue;
    out.push({
      kind,
      severity: severity as TrialFinding["severity"],
      title,
      detail,
    });
    if (out.length === 3) break;
  }
  return out;
}

export function analystUsageTokens(usage: {
  input_tokens?: number;
  output_tokens?: number;
} | null): number {
  const input = usage?.input_tokens ?? 0;
  const output = usage?.output_tokens ?? 0;
  const total = (Number.isFinite(input) ? input : 0) + (Number.isFinite(output) ? output : 0);
  return Math.max(0, Math.round(total));
}
