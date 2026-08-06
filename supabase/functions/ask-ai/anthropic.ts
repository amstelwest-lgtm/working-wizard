/**
 * Thin wrapper around the Anthropic Messages API.
 * Uses ANTHROPIC_API_KEY from Supabase secrets.
 * Model overridable via CLAUDE_MODEL env; defaults to Claude Sonnet 4.6.
 */

const MODEL = Deno.env.get("CLAUDE_MODEL") || "claude-sonnet-4-6";
const API_URL = "https://api.anthropic.com/v1/messages";

export interface ClaudeResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export async function callClaude(
  system: string,
  user: string,
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
    body: JSON.stringify({
      model: MODEL,
      system,
      messages: [{ role: "user", content: user }],
      temperature: 0.3,
      max_tokens: 512,
    }),
  });

  if (res.status === 429) throw new Error("Rate limit reached — try again in a moment.");
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Claude error (${res.status}): ${body.slice(0, 200)}`);
  }

  const json = await res.json();
  const text = (json?.content ?? [])
    .filter((b: { type?: string }) => b?.type === "text")
    .map((b: { text?: string }) => b.text ?? "")
    .join("")
    .trim();
  const usage = json?.usage ?? {};

  return {
    text,
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    latencyMs: Date.now() - t0,
  };
}
