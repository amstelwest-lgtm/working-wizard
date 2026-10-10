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
 */

export const CLAUDE_SONNET_55 = "claude-sonnet-5-5";

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
