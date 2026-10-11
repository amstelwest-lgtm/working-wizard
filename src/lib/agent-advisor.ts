/**
 * Milōn Advisor allow-list. Drafts only. Signed off is accountant-only.
 * The edge function enforces the same list before it executes a tool.
 */
import { analystRunOutcome, type AnalystToolName } from "./agent-analyst.ts";

export const ADVISOR_MAX_ITERATIONS = 4;

export const ADVISOR_DRAFT_KINDS = ["next_move_draft", "advisory_deliverable_draft"] as const;

export type AdvisorDraftKind = (typeof ADVISOR_DRAFT_KINDS)[number];

export const ADVISOR_PEERS = ["financial_manager", "analyst"] as const;

export const ADVISOR_REUSED_READS = [
  "get_financial_snapshot",
  "get_ratios",
  "get_health",
  "get_statement_history",
] as const satisfies readonly AnalystToolName[];

export const ADVISOR_OWN_READS = ["get_cash_13_week", "get_inbox", "get_team_findings", "get_own_memory"] as const;

export const ADVISOR_WRITE_TOOLS = ["record_draft", "send_agent_message"] as const;

export const ADVISOR_TOOLS = [...ADVISOR_REUSED_READS, ...ADVISOR_OWN_READS, ...ADVISOR_WRITE_TOOLS] as const;

export type AdvisorToolName = (typeof ADVISOR_TOOLS)[number];

export const ADVISOR_TOOL_LABELS: Record<AdvisorToolName, string> = {
  get_financial_snapshot: "Statements",
  get_ratios: "Ratios",
  get_health: "Health",
  get_statement_history: "History",
  get_cash_13_week: "13-week cash",
  get_inbox: "Inbox",
  get_team_findings: "Findings",
  get_own_memory: "Memory",
  record_draft: "Draft",
  send_agent_message: "Message",
};

export function advisorToolAllowed(name: string): name is AdvisorToolName {
  return (ADVISOR_TOOLS as readonly string[]).includes(name);
}

export function executeAdvisorGate(
  name: string,
): { allowed: true; name: AdvisorToolName } | { allowed: false; error: string; tool_blocked: true; tool: string } {
  if (!advisorToolAllowed(name)) {
    return {
      allowed: false,
      error: "MILŌN refused that tool. It is not on the advisor allow-list.",
      tool_blocked: true,
      tool: name,
    };
  }
  return { allowed: true, name };
}

export function advisorRunOutcome(input: {
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
