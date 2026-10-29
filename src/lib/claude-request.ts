/**
 * Pure Claude request rules shared by the Node server and the Deno edge
 * functions. No env reads: each runtime picks CLAUDE_MODEL itself.
 *
 * Sonnet 5.5 rejects manual thinking budgets, non-default temperature /
 * top_p / top_k, and tool_choice "any" or "tool". Omitting `thinking` turns
 * adaptive thinking on, and those tokens count against max_tokens. These
 * calls were sized for a reply with thinking off, so 5.5 sends between_tools
 * (no up-front thinking). A CLAUDE_MODEL override to any other id, including
 * Sonnet 4.6, keeps temperature and forced tool choice.
 *
 * Opus 5.5 is a separate branch. It rejects between_tools, disabled thinking,
 * budget_tokens, temperature, top_p, top_k, and forced tool choice. Omitting
 * `thinking` leaves adaptive thinking on. Omitting `effort` leaves Anthropic's
 * medium default. Only the Financial Manager uses this id.
 */

export const CLAUDE_SONNET_55 = "claude-sonnet-5-5";
export const CLAUDE_OPUS_55 = "claude-opus-5-5";

const FINANCIAL_MANAGER_AGENTS = new Set([
  "financial_manager",
  "financial-manager",
  "agent-financial-manager",
]);

/** Exact Opus 5.5 id, plus a dated snapshot such as claude-opus-5-5-20261001. */
export function isClaudeOpus55(model: string): boolean {
  return model === CLAUDE_OPUS_55 || model.startsWith(`${CLAUDE_OPUS_55}-`);
}

/**
 * Financial Manager resolves to Opus 5.5. Every other agent resolves to
 * `standard` (the CLAUDE_MODEL / Sonnet 5.5 default). Pass `financialManager`
 * only to honour a CLAUDE_MODEL_FM override.
 */
export function modelForAgent(
  agent: string,
  models: { standard?: string; financialManager?: string } = {},
): string {
  const standard = models.standard || CLAUDE_SONNET_55;
  const financialManager = models.financialManager || CLAUDE_OPUS_55;
  return FINANCIAL_MANAGER_AGENTS.has(agent) ? financialManager : standard;
}

/**
 * Opus tool turns must echo the assistant content, including thinking and
 * redacted_thinking blocks. Other models keep the rebuilt text + tool_use
 * history.
 */
export function assistantContentForModel(model: string, blocks: unknown): unknown[] | undefined {
  if (!isClaudeOpus55(model) || !Array.isArray(blocks) || blocks.length === 0) return undefined;
  return blocks;
}

/** Sonnet 5.5 will not cache a prefix shorter than this. Shorter prompts still run. */
export const SONNET_55_MIN_CACHE_TOKENS = 512;

export type ClaudeToolChoice =
  | { type: "auto" | "any"; disable_parallel_tool_use?: boolean }
  | { type: "tool"; name: string; disable_parallel_tool_use?: boolean };

/** Keep a caller's parallel-tool flag. Omit the key when they did not set it. */
function toolChoiceForRequest(choice: ClaudeToolChoice, forceAuto: boolean): ClaudeToolChoice {
  const disable = choice.disable_parallel_tool_use;
  const type = forceAuto ? "auto" : choice.type;
  if (type === "tool") {
    const named = choice.type === "tool" ? choice.name : "";
    return disable == null
      ? { type: "tool", name: named }
      : { type: "tool", name: named, disable_parallel_tool_use: disable };
  }
  return disable == null ? { type } : { type, disable_parallel_tool_use: disable };
}

export function claudeRequestFields(input: {
  model: string;
  temperature?: number;
  toolChoice?: ClaudeToolChoice;
}): {
  thinking?: { type: "between_tools" };
  temperature?: number;
  tool_choice?: ClaudeToolChoice;
} {
  if (isClaudeOpus55(input.model)) {
    const fields: { tool_choice?: ClaudeToolChoice } = {};
    if (input.toolChoice) {
      const forced = input.toolChoice.type === "any" || input.toolChoice.type === "tool";
      fields.tool_choice = toolChoiceForRequest(input.toolChoice, forced);
    }
    return fields;
  }
  if (input.model === CLAUDE_SONNET_55) {
    const fields: {
      thinking: { type: "between_tools" };
      tool_choice?: ClaudeToolChoice;
    } = { thinking: { type: "between_tools" } };
    if (input.toolChoice) fields.tool_choice = toolChoiceForRequest(input.toolChoice, true);
    return fields;
  }
  const legacy: { temperature?: number; tool_choice?: ClaudeToolChoice } = {};
  if (input.temperature != null) legacy.temperature = input.temperature;
  if (input.toolChoice) legacy.tool_choice = toolChoiceForRequest(input.toolChoice, false);
  return legacy;
}
