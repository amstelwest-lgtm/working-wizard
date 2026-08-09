/**
 * Shared Anthropic Messages helpers for server-side Claude calls.
 * Model defaults to Claude Sonnet 4.6 via CLAUDE_MODEL.
 */

import { CLAUDE_MODEL } from "@/lib/claude-config";

export type ClaudeContentPart =
  | { type: "text"; text: string }
  | {
      type: "document";
      source: { type: "base64"; media_type: string; data: string };
    };

export function extractJsonText(raw: string): string {
  return raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

export async function callClaudeMessages(opts: {
  content: ClaudeContentPart[];
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not configured. Please add it in your project secrets.",
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? 90_000,
  );

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: opts.maxTokens ?? 8192,
        messages: [{ role: "user", content: opts.content }],
      }),
    });

    if (res.status === 429) {
      throw new Error("Rate limit hit — try again in a moment.");
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Claude error (${res.status}): ${body.slice(0, 300)}`);
    }

    const json = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = (json.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("")
      .trim();
    if (!text) throw new Error("Claude returned an empty response.");
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

export function parseClaudeJson<T = unknown>(raw: string): T {
  const jsonText = extractJsonText(raw);
  try {
    return JSON.parse(jsonText) as T;
  } catch {
    const match = jsonText.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]) as T;
    throw new Error("Could not parse JSON from Claude response");
  }
}
