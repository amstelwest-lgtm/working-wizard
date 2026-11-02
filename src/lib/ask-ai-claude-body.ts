/**
 * Anthropic body for ask-ai. Omitting tools leaves the key off, which is the
 * request every non-analyst chat still sends.
 */
import { claudeRequestFields } from "./claude-request.ts";

export type AskAiModelMessage = {
  role: "user" | "assistant";
  content: string | Array<Record<string, unknown>>;
};

export type AskAiClaudeTool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export function askAiClaudeRequestBody(input: {
  model: string;
  system: string;
  messages: AskAiModelMessage[];
  maxTokens: number;
  temperature?: number;
  tools?: AskAiClaudeTool[];
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: input.model,
    system: input.system,
    messages: input.messages,
    max_tokens: input.maxTokens,
    ...claudeRequestFields({
      model: input.model,
      temperature: input.temperature,
    }),
  };
  if (input.tools && input.tools.length > 0) body.tools = input.tools;
  return body;
}
