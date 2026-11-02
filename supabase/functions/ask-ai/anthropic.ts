/**
 * Thin wrapper around the Anthropic Messages API.
 * Uses ANTHROPIC_API_KEY from Supabase secrets.
 * Model overridable via CLAUDE_MODEL env; defaults to Claude Sonnet 5.5.
 */
import {
  askAiClaudeRequestBody,
  type AskAiClaudeTool,
  type AskAiModelMessage,
} from "../../../src/lib/ask-ai-claude-body.ts";
import { CLAUDE_MODEL } from "../_shared/claude-model.ts";

const API_URL = "https://api.anthropic.com/v1/messages";

export interface ClaudeResponse {
  text: string;
  toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export async function callClaude(
  system: string,
  user: string,
  opts?: { maxTokens?: number; temperature?: number; tools?: AskAiClaudeTool[] },
): Promise<ClaudeResponse> {
  return callClaudeMessages(system, [{ role: "user", content: user }], opts);
}

export async function callClaudeMessages(
  system: string,
  messages: AskAiModelMessage[],
  opts?: { maxTokens?: number; temperature?: number; tools?: AskAiClaudeTool[] },
): Promise<ClaudeResponse> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    throw new Error(
      "AI is not configured (ANTHROPIC_API_KEY missing). Please contact your administrator.",
    );
  }

  const t0 = Date.now();
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      askAiClaudeRequestBody({
        model: CLAUDE_MODEL,
        system,
        messages,
        maxTokens: opts?.maxTokens ?? 512,
        temperature: opts?.temperature ?? 0.3,
        tools: opts?.tools,
      }),
    ),
  });

  if (res.status === 429) throw new Error("Rate limit reached — try again in a moment.");
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Claude error (${res.status}): ${body.slice(0, 200)}`);
  }

  const json = await res.json();
  const blocks = (Array.isArray(json?.content) ? json.content : []) as Array<
    Record<string, unknown>
  >;
  const text = blocks
    .filter((b) => b?.type === "text")
    .map((b) => String(b.text ?? ""))
    .join("")
    .trim();
  const toolUses = blocks
    .filter((b) => b?.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string")
    .map((b) => ({
      id: String(b.id),
      name: String(b.name),
      input:
        b.input && typeof b.input === "object" && !Array.isArray(b.input)
          ? (b.input as Record<string, unknown>)
          : {},
    }));
  const usage = json?.usage ?? {};

  return {
    text,
    toolUses,
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    latencyMs: Date.now() - t0,
  };
}
