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
import { executeSharedDeliverableRead } from "../_shared/agent-shared-reads.ts";
import { isSharedDeliverableRead } from "../../../src/lib/agent-shared-reads.ts";
import {
  CLIENT_UPDATE_DRAFT_KIND,
  clientUpdateEvidencePatch,
  shapeAdvisorClientUpdateArgs,
} from "../../../src/lib/client-update-draft.ts";

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
  if (isSharedDeliverableRead(tool)) {
    return executeSharedDeliverableRead(tool, args, {
      db: ctx.db,
      clientId: ctx.clientId,
      prepareLibraryArtifact: ctx.prepareLibraryArtifact,
    });
  }
  if (REUSED.has(tool)) return readReusedAnalystTool(tool, ctx);
  if (tool === "get_cash_13_week") return readCash13Week(ctx);
  if (tool === "get_inbox") return readInbox(ctx);
  if (tool === "get_team_findings") return readTeamFindings(ctx);
  if (tool === "get_own_memory") return readOwnMemory(ctx);
  if (OWN.has(tool)) return { error: "That read is not wired." };
  if (tool === "send_agent_message") return sendAgentMessage(args, ctx, ADVISOR_PEERS);
  let draftArgs = args;
  let clientUpdate: { draft: { done: string; found: string; nextSteps: [string, string, string] }; basis: string[] } | null =
    null;
  if (args.kind === CLIENT_UPDATE_DRAFT_KIND) {
    const shaped = shapeAdvisorClientUpdateArgs(args);
    if (!shaped.ok) return { error: shaped.error };
    draftArgs = shaped.args;
    clientUpdate = { draft: shaped.draft, basis: shaped.basis };
  }
  const saved = await recordAgentDraft(draftArgs, ctx, ADVISOR_PEERS as readonly AgentKey[], ADVISOR_DRAFT_KINDS);
  if (!clientUpdate || !saved || typeof saved !== "object" || !("recorded" in saved) || saved.recorded !== true) {
    return saved;
  }
  if ("deduped" in saved && saved.deduped === true) return saved;
  const findingId = "finding_id" in saved && typeof saved.finding_id === "string" ? saved.finding_id : "";
  const savedEvidence =
    "evidence" in saved && saved.evidence && typeof saved.evidence === "object" && !Array.isArray(saved.evidence)
      ? (saved.evidence as Record<string, unknown>)
      : {};
  if (!findingId) return saved;
  const evidence = clientUpdateEvidencePatch(savedEvidence, clientUpdate.draft, clientUpdate.basis);
  const { error } = await ctx.db.from("agent_findings").update({ evidence }).eq("id", findingId);
  if (error) return { error: error.message, finding_id: findingId };
  return { ...saved, evidence };
}
