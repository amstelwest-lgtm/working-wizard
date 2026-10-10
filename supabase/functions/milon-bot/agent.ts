/**
 * Milonbot loop.
 *
 * The engine lives in `_shared/agent-core`. This file re-exports it so the
 * chat endpoint and its tests keep the same module path and the same outputs.
 */
export {
  AGENT_ACT_TOOLS,
  AGENT_MAX_ITERATIONS,
  AGENT_OUTCOME_LABELS,
  AGENT_REPEAT_LIMIT,
  AGENT_STOP_REASONS,
  AGENT_SYSTEM,
  AGENT_TOOL_LABELS,
  AGENT_TOOLS,
  agentClaudeTools,
  agentTurnMessages,
  classifyResult,
  decisionFromClaude,
  formatAgentPrompt,
  isAgentStopReason,
  isAgentToolName,
  reconcileStop,
  runAgentLoop,
  sanitizeToolArgs,
  type AgentAudience,
  type AgentDecision,
  type AgentReasonContext,
  type AgentReasoner,
  type AgentRun,
  type AgentStep,
  type AgentStepStatus,
  type AgentStopReason,
  type AgentToolExecutor,
  type AgentToolName,
  type AgentTraceStep,
} from "../_shared/agent-core/loop.ts";
