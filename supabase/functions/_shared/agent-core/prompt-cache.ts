/**
 * Anthropic prompt-cache shaping. Pure: no Deno, no network.
 * cachePrompt false leaves the request body identical to an uncached call.
 */

export type CacheControl = { type: "ephemeral" };

export type CachedSystemBlock = {
  type: "text";
  text: string;
  cache_control: CacheControl;
};

export function shapeCachedModelRequest<T extends Record<string, unknown>>(input: {
  system: string;
  tools: T[];
  cachePrompt: boolean;
}): {
  system: string | CachedSystemBlock[];
  tools: T[];
  betaHeader: string | null;
} {
  if (!input.cachePrompt) {
    return { system: input.system, tools: input.tools, betaHeader: null };
  }
  const tools = input.tools.map((tool, index) =>
    index === input.tools.length - 1
      ? { ...tool, cache_control: { type: "ephemeral" as const } }
      : tool,
  );
  return {
    system: [
      {
        type: "text",
        text: input.system,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools,
    betaHeader: "prompt-caching-2024-07-31",
  };
}

/**
 * Prefix cost relative to paying the input rate every turn.
 * Sonnet 5.5: one 5-minute cache write at 1.25× ($2.50 / $2), then reads at
 * 0.05× ($0.10 / $2). The minimum cacheable prefix on 5.5 is 512 tokens
 * (1,024 on Sonnet 4.6). A shorter prefix is billed as input and does not error.
 * cache_control ephemeral breakpoints are unchanged.
 */
export function promptCachePrefixCostFactor(turns: number): number {
  const n = Math.max(1, Math.floor(turns));
  return (1.25 + 0.05 * (n - 1)) / n;
}
