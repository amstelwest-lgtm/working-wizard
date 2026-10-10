/**
 * Sonnet 5.5 is the default. Sonnet 4.6 remains only as a pricing-table row.
 * Run: pnpm test:claude-model
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { CLAUDE_MODEL_RATES_USD_PER_MTOK } from "../src/lib/agent-analyst.ts";
import { CLAUDE_MODEL } from "../src/lib/claude-config.ts";
import {
  CLAUDE_SONNET_55,
  SONNET_55_MIN_CACHE_TOKENS,
  claudeRequestFields,
} from "../src/lib/claude-request.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const NEEDLE = "claude-sonnet-4-6";
const ROOTS = ["src", "supabase/functions"];

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx|mts|js|mjs)$/.test(name)) out.push(path);
  }
  return out;
}

const pricingFile = resolve("src/lib/agent-analyst.ts");
for (const root of ROOTS) {
  for (const file of walk(resolve(root), [])) {
    const text = readFileSync(file, "utf8");
    if (!text.includes(NEEDLE)) continue;
    assert(file === pricingFile, `${file} still mentions ${NEEDLE}`);
    const withoutTable = text.replace(
      /export const CLAUDE_MODEL_RATES_USD_PER_MTOK = \{[\s\S]*?\n\} as const;/,
      "",
    );
    assert(!withoutTable.includes(NEEDLE), "Sonnet 4.6 id leaked outside the pricing table");
    assert(
      !/\|\|\s*["']claude-sonnet-4-6["']/.test(text),
      "pricing file does not default to Sonnet 4.6",
    );
  }
}

assert(CLAUDE_SONNET_55 === "claude-sonnet-5-5", "the shared id is Sonnet 5.5");
assert(CLAUDE_MODEL === CLAUDE_SONNET_55, "Node default is Sonnet 5.5 when CLAUDE_MODEL is unset");
assert(SONNET_55_MIN_CACHE_TOKENS === 512, "Sonnet 5.5 caches prefixes of 512 tokens or more");

const rates = CLAUDE_MODEL_RATES_USD_PER_MTOK;
assert(rates[CLAUDE_SONNET_55].input === 2, "Sonnet 5.5 input is $2 / MTok");
assert(rates[CLAUDE_SONNET_55].output === 10, "Sonnet 5.5 output is $10 / MTok");
assert(
  rates[CLAUDE_SONNET_55].cacheWrite5m === 2.5,
  "Sonnet 5.5 5-minute cache write is $2.50 / MTok",
);
assert(rates[CLAUDE_SONNET_55].cacheRead === 0.1, "Sonnet 5.5 cache read is $0.10 / MTok");
assert(rates["claude-sonnet-4-6"].input === 3, "Sonnet 4.6 input rate is kept");
assert(rates["claude-sonnet-4-6"].output === 15, "Sonnet 4.6 output rate is kept");

const sonnet55 = claudeRequestFields({
  model: CLAUDE_SONNET_55,
  temperature: 0.2,
  toolChoice: { type: "any" },
});
assert(sonnet55.thinking?.type === "between_tools", "Sonnet 5.5 skips up-front thinking");
assert(sonnet55.temperature == null, "Sonnet 5.5 does not send temperature");
assert(!("top_p" in sonnet55) && !("top_k" in sonnet55), "Sonnet 5.5 does not send top_p or top_k");
assert(sonnet55.tool_choice?.type === "auto", "forced tool choice becomes auto on Sonnet 5.5");
assert(
  sonnet55.tool_choice != null && !("disable_parallel_tool_use" in sonnet55.tool_choice),
  "parallel tool use stays enabled unless the caller turns it off",
);
assert(
  !JSON.stringify(sonnet55).includes("budget_tokens"),
  "Sonnet 5.5 does not send a thinking budget",
);

const parallelOff = claudeRequestFields({
  model: CLAUDE_SONNET_55,
  toolChoice: { type: "any", disable_parallel_tool_use: true },
});
assert(
  parallelOff.tool_choice?.type === "auto" && parallelOff.tool_choice.disable_parallel_tool_use === true,
  "a caller-set disable_parallel_tool_use is kept on Sonnet 5.5",
);
const parallelExplicit = claudeRequestFields({
  model: "claude-sonnet-4-6",
  toolChoice: { type: "auto", disable_parallel_tool_use: false },
});
assert(
  parallelExplicit.tool_choice?.disable_parallel_tool_use === false,
  "an explicit false disable_parallel_tool_use is preserved",
);

const sonnet46 = claudeRequestFields({
  model: "claude-sonnet-4-6",
  temperature: 0.2,
  toolChoice: { type: "any" },
});
assert(sonnet46.thinking == null, "a Sonnet 4.6 override does not send between_tools");
assert(sonnet46.temperature === 0.2, "a Sonnet 4.6 override keeps temperature");
assert(sonnet46.tool_choice?.type === "any", "a Sonnet 4.6 override keeps forced tool choice");

const edgeModel = readFileSync(resolve("supabase/functions/_shared/claude-model.ts"), "utf8");
assert(
  edgeModel.includes('Deno.env.get("CLAUDE_MODEL")'),
  "edge functions read CLAUDE_MODEL from the Deno env",
);
assert(edgeModel.includes("CLAUDE_SONNET_55"), "edge default is the Sonnet 5.5 constant");

console.log("claude-model-default-test: ok");
