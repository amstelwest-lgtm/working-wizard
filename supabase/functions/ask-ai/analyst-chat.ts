/**
 * Runs the three Analyst chat tools. The allow-list is the chat list, which
 * is narrower than the background runner: no record_finding, no tax bus.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ANALYST_PEERS } from "../../../src/lib/agent-analyst.ts";
import { isAskAiAnalystChatTool } from "../../../src/lib/ask-ai-analyst-tools.ts";
import { readInbox, readTeamFindings, sendAgentMessage } from "../_shared/agent-messages.ts";

export async function executeAskAiAnalystChatTool(
  name: string,
  args: Record<string, unknown>,
  ctx: {
    clientId: string;
    correlationId: string;
    firmId: string | null;
    db: SupabaseClient;
  },
): Promise<unknown> {
  if (!isAskAiAnalystChatTool(name)) {
    return { error: "That tool is not in this Analyst chat.", tool_blocked: true };
  }
  const peer = {
    clientId: ctx.clientId,
    runId: null,
    correlationId: ctx.correlationId,
    firmId: ctx.firmId,
    db: ctx.db,
    agent: "analyst" as const,
  };
  try {
    if (name === "get_inbox") return await readInbox(peer);
    if (name === "get_team_findings") return await readTeamFindings(peer);
    return await sendAgentMessage(args, peer, ANALYST_PEERS);
  } catch (err) {
    return { error: err instanceof Error && err.message ? err.message : "Tool failed" };
  }
}
