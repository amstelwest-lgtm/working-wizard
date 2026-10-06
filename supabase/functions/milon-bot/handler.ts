/**
 * One objective → one Milonbot run.
 * Claude is asked once per turn. The loop in agent.ts decides what happens next.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  AGENT_SYSTEM,
  agentClaudeTools,
  decisionFromClaude,
  formatAgentPrompt,
  runAgentLoop,
  type AgentAudience,
  type AgentRun,
} from "./agent.ts";
import { callClaudeRound } from "./claude.ts";
import { executeAgentTool } from "./execute.ts";
import { hashToolArgs, summarizeToolArgs } from "./logic.ts";
import { buildAgentTurnPayload } from "./prompt.ts";
import {
  applyRedaction,
  createRedactionSession,
  redactStructured,
  rehydrateForUi,
} from "../_shared/redact-identifiers.ts";

type AdminClient = SupabaseClient;

export async function runMilonbotObjective(input: {
  clientId: string;
  userId: string;
  token: string;
  audience: AgentAudience;
  objective: string;
  userClient: SupabaseClient;
  adminClient: AdminClient;
  /** Live Overview figures. Appended to the system prompt so the loop cannot invent a score. */
  overviewBlock?: string;
  clientName?: string | null;
}): Promise<{ run: AgentRun; inputTokens: number; outputTokens: number; latencyMs: number }> {
  let inputTokens = 0;
  let outputTokens = 0;
  let latencyMs = 0;
  const tools = agentClaudeTools();
  const session = createRedactionSession({ clientName: input.clientName });
  const system = buildAgentTurnPayload({
    system: AGENT_SYSTEM,
    overviewBlock: input.overviewBlock,
    user: "",
    session,
  }).system;

  const run = await runAgentLoop({
    objective: applyRedaction(input.objective, session),
    audience: input.audience,
    reason: async (ctx) => {
      const round = await callClaudeRound(
        system,
        [{ role: "user", content: applyRedaction(formatAgentPrompt(ctx), session) }],
        tools,
        { toolChoice: { type: "any" }, maxTokens: 700 },
      );
      inputTokens += round.inputTokens;
      outputTokens += round.outputTokens;
      latencyMs += round.latencyMs;
      return decisionFromClaude({ text: round.text, toolUses: round.toolUses });
    },
    execute: async (name, args) =>
      redactStructured(
        await executeAgentTool(name, args, {
          clientId: input.clientId,
          userId: input.userId,
          token: input.token,
          audience: input.audience,
          userClient: input.userClient,
          adminClient: input.adminClient,
        }),
        session,
      ),
  });

  run.objective = input.objective;
  run.summary = rehydrateForUi(run.summary, session, input.objective);
  if (run.escalationReason) {
    run.escalationReason = rehydrateForUi(run.escalationReason, session);
  }
  run.questions = run.questions.map((question) => rehydrateForUi(question, session));
  for (const step of run.steps) step.detail = rehydrateForUi(step.detail, session);
  for (const step of run.trace) step.detail = rehydrateForUi(step.detail, session);

  for (const step of run.steps) {
    if (!step.tool || step.status === "refused") continue;
    const args_hash = await hashToolArgs({ tool: step.tool });
    const { error } = await input.adminClient.from("bot_tool_calls").insert({
      client_id: input.clientId,
      user_id: input.userId,
      tool: step.tool,
      args_hash,
      args_summary: summarizeToolArgs(step.tool, { topic: step.label }).slice(0, 120),
      result_status: step.status === "ok" ? "ok" : step.status === "empty" ? "empty" : "error",
    });
    if (error) console.warn("bot_tool_calls insert:", error.message);
  }

  const { data: saved, error: saveErr } = await input.adminClient
    .from("milon_bot_runs")
    .insert({
      client_id: input.clientId,
      user_id: input.userId,
      audience: input.audience,
      objective: input.objective.slice(0, 500),
      status: run.status,
      summary: run.summary.slice(0, 2000),
      escalation_reason: run.escalationReason,
      outstanding_questions: run.questions,
      trace: run.trace,
    })
    .select("id")
    .maybeSingle();
  if (saveErr) console.warn("milon_bot_runs insert:", saveErr.message);
  if (saved?.id) run.id = String(saved.id);

  return { run, inputTokens, outputTokens, latencyMs };
}

export function publicRun(run: AgentRun & { id?: string }) {
  return {
    id: run.id ?? null,
    objective: run.objective,
    status: run.status,
    outcomeLabel: run.outcomeLabel,
    summary: run.summary,
    claimRejected: run.claimRejected,
    escalationReason: run.escalationReason,
    questions: run.questions,
    trace: run.trace.map((step) => ({
      iteration: step.iteration,
      label: step.label,
      tool: step.tool,
      status: step.status,
      verified: step.verified,
      happened: step.happened,
      detail: step.detail.slice(0, 400),
    })),
  };
}
