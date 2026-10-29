/**
 * Sonnet 5.5 is the default. Sonnet 4.6 remains only as a pricing-table row.
 * Run: pnpm test:claude-model
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { analystRunCostUsd, CLAUDE_MODEL_RATES_USD_PER_MTOK } from "../src/lib/agent-analyst.ts";
import { CLAUDE_MODEL } from "../src/lib/claude-config.ts";
import { agentTurnMessages } from "../supabase/functions/_shared/agent-core/loop.ts";
import {
  CLAUDE_OPUS_55,
  CLAUDE_SONNET_55,
  SONNET_55_MIN_CACHE_TOKENS,
  assistantContentForModel,
  claudeRequestFields,
  modelForAgent,
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
  parallelOff.tool_choice?.type === "auto" &&
    parallelOff.tool_choice.disable_parallel_tool_use === true,
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
  edgeModel.includes('Deno.env.get("CLAUDE_MODEL") || CLAUDE_SONNET_55'),
  "edge functions read CLAUDE_MODEL from the Deno env and default to Sonnet 5.5",
);
assert(
  edgeModel.includes('Deno.env.get("CLAUDE_MODEL_FM") || CLAUDE_OPUS_55'),
  "only the Financial Manager secret defaults to Opus 5.5",
);
assert(
  !edgeModel.includes('Deno.env.get("CLAUDE_MODEL") || CLAUDE_OPUS_55'),
  "CLAUDE_MODEL does not default to Opus",
);

const nodeConfig = readFileSync(resolve("src/lib/claude-config.ts"), "utf8");
assert(nodeConfig.includes("CLAUDE_SONNET_55"), "Node default stays the Sonnet 5.5 constant");
assert(!nodeConfig.includes("CLAUDE_OPUS_55"), "Node CLAUDE_MODEL is not Opus");
assert(!nodeConfig.includes("claude-opus-5-5"), "Node config does not hard-code Opus");

assert(CLAUDE_OPUS_55 === "claude-opus-5-5", "the shared Opus id is Opus 5.5");
assert(
  modelForAgent("financial_manager") === CLAUDE_OPUS_55,
  "Financial Manager resolves to Opus 5.5",
);
assert(
  modelForAgent("financial-manager") === CLAUDE_OPUS_55,
  "the hyphenated Financial Manager id is Opus",
);
assert(
  modelForAgent("agent-financial-manager") === CLAUDE_OPUS_55,
  "the edge name resolves to Opus",
);
assert(modelForAgent("analyst") === CLAUDE_SONNET_55, "Analyst stays on Sonnet 5.5");
assert(modelForAgent("advisor") === CLAUDE_SONNET_55, "Advisor stays on Sonnet 5.5");
assert(modelForAgent("ask-ai") === CLAUDE_SONNET_55, "Ask AI stays on Sonnet 5.5");
assert(modelForAgent("milon-bot") === CLAUDE_SONNET_55, "Milonbot stays on Sonnet 5.5");
assert(modelForAgent("owner-handoff") === CLAUDE_SONNET_55, "owner hand-off stays on Sonnet 5.5");
assert(
  modelForAgent("analyst", { standard: "claude-sonnet-4-6" }) === "claude-sonnet-4-6",
  "a CLAUDE_MODEL override still selects the model for non-FM agents",
);
assert(
  modelForAgent("financial_manager", { standard: "claude-sonnet-4-6" }) === CLAUDE_OPUS_55,
  "a CLAUDE_MODEL override does not move the Financial Manager off Opus",
);
assert(
  modelForAgent("advisor", { standard: CLAUDE_SONNET_55, financialManager: CLAUDE_OPUS_55 }) ===
    CLAUDE_SONNET_55,
  "the Financial Manager override does not apply to the Advisor",
);
assert(
  modelForAgent("financial_manager", { financialManager: CLAUDE_SONNET_55 }) === CLAUDE_SONNET_55,
  "CLAUDE_MODEL_FM can point the Financial Manager at another id",
);

const opusRates = rates[CLAUDE_OPUS_55];
assert(opusRates.input === 4, "Opus 5.5 input is $4 / MTok");
assert(opusRates.output === 20, "Opus 5.5 output is $20 / MTok");
assert(opusRates.cacheWrite5m === 5, "Opus 5.5 5-minute cache write is $5 / MTok");
assert(opusRates.cacheRead === 0.2, "Opus 5.5 cache read is $0.20 / MTok (0.05× input)");
assert(
  analystRunCostUsd(1_000_000, 1_000_000, 0, 0, CLAUDE_OPUS_55) === 24,
  "a million Opus input and output tokens cost $24",
);
assert(
  analystRunCostUsd(0, 0, 1_000_000, 0, CLAUDE_OPUS_55) === 5,
  "a million Opus cache-write tokens cost $5",
);
assert(
  analystRunCostUsd(0, 0, 0, 1_000_000, CLAUDE_OPUS_55) === 0.2,
  "a million Opus cache-read tokens cost $0.20",
);
assert(
  analystRunCostUsd(1_000_000, 1_000_000, 0, 0, "claude-opus-5-5-20990101") === 24,
  "an unrecognized Opus id is not priced as Sonnet 5.5",
);
assert(
  analystRunCostUsd(1_000_000, 1_000_000) === 12,
  "a cost call with no model still uses Sonnet 5.5",
);

const opus = claudeRequestFields({
  model: CLAUDE_OPUS_55,
  temperature: 0,
  toolChoice: { type: "any" },
});
assert(opus.thinking == null, "Opus 5.5 omits thinking so adaptive stays on");
assert(opus.temperature == null, "Opus 5.5 does not send temperature");
assert(!("top_p" in opus) && !("top_k" in opus), "Opus 5.5 does not send top_p or top_k");
assert(
  !("effort" in opus) && !("output_config" in opus),
  "Opus 5.5 leaves effort at the medium default",
);
assert(opus.tool_choice?.type === "auto", "forced tool choice becomes auto on Opus 5.5");
const opusJson = JSON.stringify(opus);
assert(!opusJson.includes("between_tools"), "Opus 5.5 does not send between_tools");
assert(!opusJson.includes("budget_tokens"), "Opus 5.5 does not send a thinking budget");
assert(!opusJson.includes("disabled"), "Opus 5.5 does not disable thinking");
const opusNamed = claudeRequestFields({
  model: CLAUDE_OPUS_55,
  toolChoice: { type: "tool", name: "record_draft", disable_parallel_tool_use: true },
});
assert(
  opusNamed.tool_choice?.type === "auto" &&
    opusNamed.tool_choice.disable_parallel_tool_use === true,
  "a named tool becomes auto on Opus 5.5 and keeps the parallel flag",
);
assert(!("name" in (opusNamed.tool_choice ?? {})), "Opus 5.5 does not force a tool name");
const opusDated = claudeRequestFields({
  model: "claude-opus-5-5-20990101",
  temperature: 0.2,
  toolChoice: { type: "any" },
});
assert(
  opusDated.thinking == null && opusDated.temperature == null,
  "a dated Opus 5.5 id uses the Opus request shape",
);

const echoed = assistantContentForModel(CLAUDE_OPUS_55, [
  { type: "thinking", thinking: "", signature: "sig" },
]);
assert(
  echoed?.length === 1,
  "Opus echoes assistant content so thinking blocks survive the tool turn",
);
assert(
  assistantContentForModel(CLAUDE_SONNET_55, [{ type: "thinking", signature: "sig" }]) == null,
  "Sonnet does not switch onto the Opus echo path",
);
const replay = agentTurnMessages({
  objective: "Check cash.",
  audience: "accountant",
  iteration: 2,
  maxIterations: 6,
  transcript: [],
  allowedTools: [],
  exchanges: [
    {
      text: "rebuilt text must not replace the echoed turn",
      assistantContent: [
        { type: "thinking", thinking: "", signature: "sig" },
        { type: "tool_use", id: "tu_1", name: "get_cash_13_week", input: {} },
      ],
      calls: [{ id: "tu_1", name: "get_cash_13_week", args: {}, content: '{"cash":1}' }],
    },
  ],
});
assert(replay[1]?.role === "assistant", "the echoed assistant turn is replayed");
assert(
  JSON.stringify(replay[1]?.content).includes("signature"),
  "the replay keeps the thinking signature",
);
assert(
  !JSON.stringify(replay[1]?.content).includes("rebuilt text"),
  "an echoed Opus turn is not rebuilt from the tool text",
);
const rebuilt = agentTurnMessages({
  objective: "Check cash.",
  audience: "accountant",
  iteration: 2,
  maxIterations: 6,
  transcript: [],
  allowedTools: [],
  exchanges: [
    {
      text: "Read cash.",
      calls: [{ id: "tu_1", name: "get_cash_13_week", args: {}, content: '{"cash":1}' }],
    },
  ],
});
assert(
  JSON.stringify(rebuilt[1]?.content).includes("Read cash."),
  "a turn without echoed content still rebuilds text and tool_use",
);

const OPUS_LITERAL = "claude-opus-5-5";
const allowedOpusLiteral = new Set([
  resolve("src/lib/claude-request.ts"),
  resolve("src/lib/agent-analyst.ts"),
  resolve("supabase/functions/agent-financial-manager/run.ts"),
]);
for (const root of ROOTS) {
  for (const file of walk(resolve(root), [])) {
    const text = readFileSync(file, "utf8");
    if (!text.includes(OPUS_LITERAL)) continue;
    assert(allowedOpusLiteral.has(file), `${file} hard-codes ${OPUS_LITERAL}`);
  }
}

const fmRun = readFileSync(resolve("supabase/functions/agent-financial-manager/run.ts"), "utf8");
assert(
  fmRun.includes('modelForAgent("financial_manager"'),
  "the Financial Manager call site selects its own model",
);
assert(
  fmRun.includes("CLAUDE_OPUS_55"),
  "the Financial Manager call site uses the Opus 5.5 constant",
);
assert(
  fmRun.includes("financialManager:"),
  "the Financial Manager passes the FM model, not the global default",
);

const advisorRun = readFileSync(resolve("supabase/functions/agent-advisor/run.ts"), "utf8");
assert(
  advisorRun.includes('modelForAgent("advisor"'),
  "the Advisor call site selects its own model",
);
assert(advisorRun.includes("standard: CLAUDE_MODEL"), "the Advisor stays on CLAUDE_MODEL");
assert(
  !advisorRun.includes("CLAUDE_OPUS_55") && !advisorRun.includes(OPUS_LITERAL),
  "the Advisor does not select Opus",
);

const analystRun = readFileSync(resolve("supabase/functions/agent-analyst/run.ts"), "utf8");
assert(
  analystRun.includes('modelForAgent("analyst"'),
  "the Analyst call site selects its own model",
);
assert(analystRun.includes("standard: CLAUDE_MODEL"), "the Analyst stays on CLAUDE_MODEL");
assert(
  !analystRun.includes("CLAUDE_OPUS_55") && !analystRun.includes(OPUS_LITERAL),
  "the Analyst does not select Opus",
);

const job = readFileSync(resolve("supabase/functions/_shared/agent-core/job.ts"), "utf8");
const jobCall = job.slice(job.indexOf("callClaudeRound"));
assert(jobCall.includes("model,"), "the shared runner passes the per-agent model into the call");
assert(
  /analystRunCostUsd\(\s*inputTokens,\s*outputTokens,\s*cacheWriteTokens,\s*cacheReadTokens,\s*model,?\s*\)/.test(
    job,
  ),
  "the shared runner prices the run with the same model it called",
);
assert(
  !/analystRunCostUsd\([\s\S]*?CLAUDE_MODEL/.test(job),
  "the shared runner does not price a run with the global model constant",
);
assert(!job.includes(OPUS_LITERAL), "the shared runner does not hard-code Opus");

for (const file of [
  "supabase/functions/ask-ai/anthropic.ts",
  "supabase/functions/brain-deliverable-draft/index.ts",
  "supabase/functions/extract-financials/index.ts",
  "supabase/functions/extract-source-document/index.ts",
  "supabase/functions/milon-bot/claude.ts",
  "src/lib/advisory.functions.ts",
  "src/lib/claude-messages.ts",
  "src/lib/industry-news.functions.ts",
  "src/lib/tax-deliverable.functions.ts",
  "src/lib/client-agent-link.functions.ts",
]) {
  const text = readFileSync(resolve(file), "utf8");
  assert(text.includes("CLAUDE_MODEL"), `${file} still uses CLAUDE_MODEL`);
  assert(
    !text.includes("CLAUDE_OPUS_55") && !text.includes(OPUS_LITERAL),
    `${file} does not select Opus`,
  );
}
for (const file of [
  "supabase/functions/brain-propose/index.ts",
  "supabase/functions/milon-bot/handler.ts",
  "supabase/functions/milon-bot/index.ts",
  "supabase/functions/prospect-talk/index.ts",
  "supabase/functions/owner-handoff/index.ts",
]) {
  const text = readFileSync(resolve(file), "utf8");
  assert(
    !text.includes("CLAUDE_OPUS_55") && !text.includes(OPUS_LITERAL),
    `${file} does not select Opus`,
  );
}

const claudeSrc = readFileSync(resolve("supabase/functions/milon-bot/claude.ts"), "utf8");
assert(
  claudeSrc.includes("opts?.model || CLAUDE_MODEL"),
  "a call with no model keeps the Sonnet default",
);

const envExample = readFileSync(resolve(".env.example"), "utf8");
assert(
  envExample.includes("CLAUDE_MODEL=claude-sonnet-5-5"),
  ".env.example keeps the Sonnet default",
);
assert(
  envExample.includes("CLAUDE_MODEL_FM=claude-opus-5-5"),
  ".env.example documents the Financial Manager override",
);
assert(
  envExample.includes("Do not set this to claude-opus-5-5"),
  ".env.example says not to point CLAUDE_MODEL at Opus",
);

console.log("claude-model-default-test: ok");
