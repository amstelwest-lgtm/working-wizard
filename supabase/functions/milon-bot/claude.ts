/**
 * Claude Messages + tool_use loop for milon-bot only.
 * Does not change ask-ai/anthropic.ts or extract pipelines.
 * Prompt caching is opt-in (cachePrompt). Milonbot leaves it off, so its
 * request body and headers stay the same.
 */
import { shapeCachedModelRequest } from "../_shared/agent-core/prompt-cache.ts";
import { claudeRequestFields } from "../../../src/lib/claude-request.ts";
import { CLAUDE_MODEL } from "../_shared/claude-model.ts";

const API_URL = "https://api.anthropic.com/v1/messages";

export type ClaudeContent =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

export type ClaudeMessage = {
  role: "user" | "assistant";
  content: string | ClaudeContent[];
};

export type ClaudeTool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export type ClaudeRound = {
  text: string;
  toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  stopReason: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  latencyMs: number;
};

export async function callClaudeRound(
  system: string,
  messages: ClaudeMessage[],
  tools: ClaudeTool[],
  opts?: {
    maxTokens?: number;
    temperature?: number;
    toolChoice?: { type: "auto" | "any" } | { type: "tool"; name: string };
    /** Agent runs set this. Milonbot omits it, so its request is unchanged. */
    cachePrompt?: boolean;
  },
): Promise<ClaudeRound> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    throw new Error(
      "AI is not configured (ANTHROPIC_API_KEY missing). Please contact your administrator.",
    );
  }

  const shaped = shapeCachedModelRequest({
    system,
    tools,
    cachePrompt: opts?.cachePrompt === true,
  });
  const t0 = Date.now();
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
      ...(shaped.betaHeader ? { "anthropic-beta": shaped.betaHeader } : {}),
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      system: shaped.system,
      messages,
      tools: shaped.tools,
      max_tokens: opts?.maxTokens ?? 1024,
      ...claudeRequestFields({
        model: CLAUDE_MODEL,
        temperature: opts?.temperature ?? 0.2,
        toolChoice: opts?.toolChoice,
      }),
    }),
  });

  if (res.status === 429) throw new Error("Rate limit reached — try again in a moment.");
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Claude error (${res.status}): ${body.slice(0, 200)}`);
  }

  const json = await res.json();
  const blocks = (json?.content ?? []) as Array<Record<string, unknown>>;
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
    stopReason: String(json?.stop_reason ?? ""),
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    latencyMs: Date.now() - t0,
  };
}
