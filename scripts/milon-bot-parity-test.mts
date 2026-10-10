/**
 * The shared agent loop must produce the same run milon-bot produced
 * before the extraction. No network, no model, no customer data.
 * Run: pnpm test:milon-bot-parity
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AGENT_SYSTEM,
  AGENT_TOOLS,
  runAgentLoop as botLoop,
  type AgentDecision,
} from "../supabase/functions/milon-bot/agent.ts";
import {
  AGENT_SYSTEM as sharedSystem,
  AGENT_TOOLS as sharedTools,
  runAgentLoop as sharedLoop,
} from "../supabase/functions/_shared/agent-core/loop.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(botLoop === sharedLoop, "milon-bot runAgentLoop is the shared loop");
assert(AGENT_SYSTEM === sharedSystem, "system prompt text is unchanged");
assert(AGENT_TOOLS.join(",") === sharedTools.join(","), "milon-bot tool list is unchanged");

const claudeSrc = readFileSync(resolve("supabase/functions/milon-bot/claude.ts"), "utf8");
const sharedClaude = readFileSync(resolve("supabase/functions/_shared/agent-core/claude.ts"), "utf8");
const modelSrc = readFileSync(resolve("supabase/functions/_shared/claude-model.ts"), "utf8");
assert(
  modelSrc.includes('Deno.env.get("CLAUDE_MODEL") || CLAUDE_SONNET_55'),
  "edge model id comes from CLAUDE_MODEL or the Sonnet 5.5 constant",
);
assert(claudeSrc.includes("claude-model.ts"), "milon-bot uses the shared edge model id");
assert(!claudeSrc.includes("claude-sonnet-4-6"), "milon-bot does not default to Sonnet 4.6");
assert(claudeSrc.includes("https://api.anthropic.com/v1/messages"), "messages endpoint is unchanged");
assert(claudeSrc.includes("tool_use"), "tool-use parsing is unchanged");
assert(
  sharedClaude.includes('from "../../milon-bot/claude.ts"'),
  "the shared core calls the milon-bot model function",
);

function scripted(decisions: AgentDecision[]) {
  let i = 0;
  return async () => {
    const decision = decisions[i];
    i += 1;
    if (!decision) throw new Error("scripted reasoner ran out of decisions");
    return decision;
  };
}

const objective = "Read the health score and stop.";
const decisions: AgentDecision[] = [
  { kind: "tool", name: "get_health", args: {}, why: "What is on file?" },
  {
    kind: "stop",
    reason: "objective_complete",
    summary: "Health on file is 48. Nothing was written.",
  },
];

async function run(loop: typeof botLoop) {
  return loop({
    objective,
    audience: "owner",
    reason: scripted(decisions),
    execute: async (name) => {
      assert(name === "get_health", "only the health read runs");
      return { empty: false, overall: 48 };
    },
  });
}

const fromBot = await run(botLoop);
const fromShared = await run(sharedLoop);
assert(JSON.stringify(fromBot) === JSON.stringify(fromShared), "both paths return the same run");
assert(fromBot.status === "objective_complete", "a read then an honest stop completes");
assert(fromBot.claimRejected === false, "the completion claim is kept");
assert(fromBot.trace.length === 1, "one tool step");
assert(fromBot.trace[0]?.tool === "get_health", "the health tool is the step");
assert(fromBot.trace[0]?.happened === false, "a read is not a write");
assert(fromBot.trace[0]?.label === "Health", "tool label is unchanged");
assert(fromBot.summary === "Health on file is 48. Nothing was written.", "summary is the stop text");
assert(fromBot.tools.length === 1 && fromBot.tools[0]?.status === "ok", "tool audit status stays ok");

// A completion claim with no read is still rewritten.
const empty = await botLoop({
  objective: "Finish without looking.",
  audience: "accountant",
  reason: scripted([
    { kind: "stop", reason: "objective_complete", summary: "Done, though nothing was read." },
  ]),
  execute: async () => {
    throw new Error("no tool should run");
  },
});
assert(empty.status === "insufficient_information", "empty completion is not accepted");
assert(empty.claimRejected === true, "the empty claim is rejected");
assert(empty.trace.length === 0, "nothing was executed");

// Two tools outside the allow-list still stop the loop, and the executor is not called.
let calls = 0;
const refused = await botLoop({
  objective: "Send the pack.",
  audience: "owner",
  reason: scripted([
    { kind: "tool", name: "send_email", args: {}, why: "Mail it" },
    { kind: "tool", name: "post_journal", args: {}, why: "Post it" },
  ]),
  execute: async () => {
    calls += 1;
    return {};
  },
});
assert(calls === 0, "refused tools are not executed");
assert(refused.status === "safety_limit", "two refusals stop the loop");
assert(refused.trace.every((step) => step.status === "refused"), "both steps are refusals");

// Default iteration cap is still 6. Passing nothing must not shrink it.
let turns = 0;
const capped = await botLoop({
  objective: "Keep reading.",
  audience: "owner",
  reason: async () => {
    turns += 1;
    return { kind: "tool", name: "answer_from_brain", args: { topic: String(turns) }, why: "Again" };
  },
  execute: async () => ({ empty: false, facts: [] }),
});
assert(turns === 6, "the default cap is still 6 iterations");
assert(capped.status === "safety_limit", "hitting the cap stops as before");

console.log("milon-bot parity ok");
