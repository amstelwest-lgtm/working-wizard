/**
 * Financial Manager tools. The allow-list is checked before any read or write.
 * Drafts copy figures from tool results. Nothing is emailed.
 */
import type { AgentKey } from "../../../src/lib/agent-bus.ts";
import {
  executeFinancialManagerGate,
  FM_DRAFT_KINDS,
  FM_OWN_READS,
  FM_PEERS,
  FM_REUSED_READS,
  type FmToolName,
} from "../../../src/lib/agent-financial-manager.ts";
import {
  readBooksQuality,
  readBudgetStatus,
  readCash13Week,
  readInbox,
  readOwnMemory,
  readReusedAnalystTool,
  readTeamFindings,
  recordAgentDraft,
  sendAgentMessage,
  type AgentToolCtx,
} from "../_shared/agent-desk.ts";

const REUSED = new Set<string>(FM_REUSED_READS);
const OWN = new Set<string>(FM_OWN_READS);

export async function executeFinancialManagerTool(
  name: string,
  args: Record<string, unknown>,
  ctx: AgentToolCtx,
): Promise<unknown> {
  const gate = executeFinancialManagerGate(name);
  if (!gate.allowed) return gate;
  const tool: FmToolName = gate.name;
  if (REUSED.has(tool)) return readReusedAnalystTool(tool, ctx);
  if (tool === "get_books_quality") return readBooksQuality(ctx);
  if (tool === "get_cash_13_week") return readCash13Week(ctx);
  if (tool === "get_budget_status") return readBudgetStatus(ctx);
  if (tool === "get_inbox") return readInbox(ctx);
  if (tool === "get_team_findings") return readTeamFindings(ctx);
  if (tool === "get_own_memory") return readOwnMemory(ctx);
  if (OWN.has(tool)) return { error: "That read is not wired." };
  if (tool === "send_agent_message") return sendAgentMessage(args, ctx, FM_PEERS);
  return recordAgentDraft(args, ctx, FM_PEERS as readonly AgentKey[], FM_DRAFT_KINDS);
}
