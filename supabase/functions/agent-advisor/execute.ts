/**
 * Advisor tools. The allow-list is checked before any read or write.
 * Drafts stay drafts. Signed off is accountant-only. Nothing is emailed.
 */
import type { AgentKey } from "../../../src/lib/agent-bus.ts";
import {
  ADVISOR_DRAFT_KINDS,
  ADVISOR_OWN_READS,
  ADVISOR_PEERS,
  ADVISOR_REUSED_READS,
  executeAdvisorGate,
  type AdvisorToolName,
} from "../../../src/lib/agent-advisor.ts";
import {
  readCash13Week,
  readInbox,
  readOwnMemory,
  readReusedAnalystTool,
  readTeamFindings,
  recordAgentDraft,
  sendAgentMessage,
  type AgentToolCtx,
} from "../_shared/agent-desk.ts";

const REUSED = new Set<string>(ADVISOR_REUSED_READS);
const OWN = new Set<string>(ADVISOR_OWN_READS);

export async function executeAdvisorTool(
  name: string,
  args: Record<string, unknown>,
  ctx: AgentToolCtx,
): Promise<unknown> {
  const gate = executeAdvisorGate(name);
  if (!gate.allowed) return gate;
  const tool: AdvisorToolName = gate.name;
  if (REUSED.has(tool)) return readReusedAnalystTool(tool, ctx);
  if (tool === "get_cash_13_week") return readCash13Week(ctx);
  if (tool === "get_inbox") return readInbox(ctx);
  if (tool === "get_team_findings") return readTeamFindings(ctx);
  if (tool === "get_own_memory") return readOwnMemory(ctx);
  if (OWN.has(tool)) return { error: "That read is not wired." };
  if (tool === "send_agent_message") return sendAgentMessage(args, ctx, ADVISOR_PEERS);
  return recordAgentDraft(args, ctx, ADVISOR_PEERS as readonly AgentKey[], ADVISOR_DRAFT_KINDS);
}
