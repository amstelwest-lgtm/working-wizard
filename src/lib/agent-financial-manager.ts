/**
 * Financial Manager allow-list. Drafts only. The edge function
 * enforces the same list before it executes a tool.
 */
import { analystRunOutcome, type AnalystToolName } from "./agent-analyst.ts";

/** A normal run saves its draft in 2–3 turns. Later turns are headroom before the cap. */
export const FM_MAX_ITERATIONS = 6;
export const FM_COST_CEILING_USD = 0.06;

export const FM_DRAFT_KINDS = [
  "action_point_draft",
  "data_request_draft",
  "accountant_handoff_draft",
] as const;

export type FmDraftKind = (typeof FM_DRAFT_KINDS)[number];

export const FM_PEERS = ["analyst", "advisor"] as const;

export const FM_REUSED_READS = ["get_financial_snapshot", "get_ratios"] as const satisfies readonly AnalystToolName[];

export const FM_OWN_READS = [
  "get_books_quality",
  "get_cash_13_week",
  "get_budget_status",
  "get_inbox",
  "get_team_findings",
  "get_own_memory",
] as const;

export const FM_WRITE_TOOLS = ["record_draft", "send_agent_message"] as const;

export const FM_TOOLS = [...FM_REUSED_READS, ...FM_OWN_READS, ...FM_WRITE_TOOLS] as const;

export type FmToolName = (typeof FM_TOOLS)[number];

export const FM_TOOL_LABELS: Record<FmToolName, string> = {
  get_financial_snapshot: "Statements",
  get_ratios: "Ratios",
  get_books_quality: "Books quality",
  get_cash_13_week: "13-week cash",
  get_budget_status: "Budget",
  get_inbox: "Inbox",
  get_team_findings: "Findings",
  get_own_memory: "Memory",
  record_draft: "Draft",
  send_agent_message: "Message",
};

export function fmToolAllowed(name: string): name is FmToolName {
  return (FM_TOOLS as readonly string[]).includes(name);
}

export function executeFinancialManagerGate(
  name: string,
): { allowed: true; name: FmToolName } | { allowed: false; error: string; tool_blocked: true; tool: string } {
  if (!fmToolAllowed(name)) {
    return {
      allowed: false,
      error: "MILŌN refused that tool. It is not on the financial manager allow-list.",
      tool_blocked: true,
      tool: name,
    };
  }
  return { allowed: true, name };
}

export function fmRunOutcome(input: {
  stopReason: string;
  steps: Array<{ tool: string | null; status: string }>;
  maxIterations: number;
}): { status: "succeeded" | "partial"; stopReason: string } {
  return analystRunOutcome({
    ...input,
    steps: input.steps.map((step) => ({
      tool: step.tool === "record_draft" ? "record_finding" : step.tool,
      status: step.status,
    })),
  });
}
