/**
 * Milonbot objective loop — no network, no Claude, no customer data.
 * Run: pnpm test:milon-bot-agent
 *
 * The scripted reasoner stands in for Claude. The assertions are about the
 * loop MILŌN owns: tool choice, execution, verification, reassessment, stop.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AGENT_SYSTEM,
  AGENT_TOOLS,
  classifyResult,
  decisionFromClaude,
  formatAgentPrompt,
  isAgentToolName,
  runAgentLoop,
  sanitizeToolArgs,
  type AgentDecision,
  type AgentReasoner,
  type AgentToolExecutor,
  type AgentToolName,
} from "../supabase/functions/milon-bot/agent.ts";
import { parseAgentObjective } from "../src/lib/milon-bot-copy.ts";
import {
  shapeAdvisoryPosition,
  shapeCash,
  shapeHealth,
} from "../supabase/functions/milon-bot/tools.ts";
import type { NextStepFacts } from "../src/lib/next-step.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function scripted(decisions: AgentDecision[]): AgentReasoner {
  let i = 0;
  return async (ctx) => {
    assert(ctx.objective.length > 0, "reasoner sees the objective");
    assert(ctx.transcript.length === i, "transcript grows one step at a time");
    const decision = decisions[i];
    i += 1;
    if (!decision) throw new Error("scripted reasoner ran out of decisions");
    return decision;
  };
}

function recording(handlers: Record<string, (args: Record<string, unknown>) => unknown>): {
  execute: AgentToolExecutor;
  calls: Array<{ name: string; args: Record<string, unknown> }>;
} {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const execute: AgentToolExecutor = async (name, args) => {
    calls.push({ name, args });
    const handler = handlers[name];
    if (!handler) throw new Error(`unexpected tool ${name}`);
    return handler(args);
  };
  return { execute, calls };
}

const objective = "Find the cash pressure and turn an approved move into a task if one exists.";

// 1. Investigate, reassess, stop complete — reads only.
{
  const { execute, calls } = recording({
    get_advisory_position: () => ({
      empty: false,
      state: "diagnosis",
      next_step: "Review the health diagnosis",
      reason: "Figures are in and nobody has reviewed them.",
    }),
    get_health: () => ({
      empty: false,
      overall: 48,
      weakest: { id: "cash", label: "Cash & working capital", score: 31 },
      priority_moves: [{ title: "Invoice the same day work is done", ratio: "Debtor Days" }],
    }),
    get_cash_flow: () => ({ empty: false, runwayWeeks: 4, shortfall: true, amounts_omitted: true }),
    list_recommendations: () => ({ empty: true, recommendations: [] }),
  });
  const run = await runAgentLoop({
    objective,
    audience: "accountant",
    execute,
    reason: scripted([
      { kind: "tool", name: "get_advisory_position", args: {}, why: "Where is the cycle?" },
      { kind: "tool", name: "get_health", args: {}, why: "Which pillar is weak?" },
      { kind: "tool", name: "get_cash_flow", args: {}, why: "Is the weak pillar cash?" },
      { kind: "tool", name: "list_recommendations", args: {}, why: "Is there already a move?" },
      {
        kind: "stop",
        reason: "objective_complete",
        summary:
          "Cash is the weak pillar and runway is 4 weeks. No recommendation is on file, so no task was created.",
      },
    ]),
  });
  assert(
    calls.map((c) => c.name).join(",") ===
      "get_advisory_position,get_health,get_cash_flow,list_recommendations",
    "investigation order",
  );
  assert(run.status === "objective_complete", "read-only objective can complete");
  assert(run.claimRejected === false, "honest complete is kept");
  assert(run.trace.length === 4, "trace has four actions");
  assert(
    run.trace.every((s) => s.happened === false),
    "reads are not writes",
  );
  assert(run.summary.includes("4 weeks"), "summary stays grounded in the tool result");
}

// 2. Approved recommendation → task verified → complete.
{
  let seen: Record<string, unknown> = {};
  const { execute } = recording({
    list_recommendations: () => ({
      empty: false,
      recommendations: [{ id: "rec-1", status: "approved", title: "Invoice the same day" }],
    }),
    create_task_from_recommendation: (args) => {
      seen = args;
      return {
        created: true,
        verified: true,
        action_item_id: "task-9",
        title: "Invoice the same day",
        status: "not_started",
      };
    },
  });
  const run = await runAgentLoop({
    objective: "Turn the approved debtor-days recommendation into a task.",
    audience: "owner",
    execute,
    reason: scripted([
      { kind: "tool", name: "list_recommendations", args: {}, why: "Which move is approved?" },
      {
        kind: "tool",
        name: "create_task_from_recommendation",
        args: { recommendationId: "rec-1", approve: true, p_approve: true },
        why: "Create the task",
      },
      {
        kind: "stop",
        reason: "objective_complete",
        summary:
          "The approved recommendation is now task task-9. It was verified on the action plan.",
      },
    ]),
  });
  assert(seen.recommendationId === "rec-1", "task tool receives the recommendation");
  assert(
    !("approve" in seen) && !("p_approve" in seen),
    "self-approval is stripped before execution",
  );
  assert(
    run.trace[1].happened === true && run.trace[1].verified === true,
    "verified task counts as happened",
  );
  assert(run.status === "objective_complete", "verified action can complete the objective");
}

// 3. Tool says the recommendation is not approved. Model claims success. App rejects the claim.
{
  const { execute, calls } = recording({
    create_task_from_recommendation: () => ({
      error: "Recommendation must be approved before it becomes an action (status: proposed)",
      created: false,
      verified: false,
      needs_human: true,
      recommendation_id: "rec-2",
    }),
  });
  const run = await runAgentLoop({
    objective: "Create the task for the debtor-days recommendation.",
    audience: "owner",
    execute,
    reason: scripted([
      {
        kind: "tool",
        name: "create_task_from_recommendation",
        args: { recommendationId: "rec-2" },
        why: "Try to create it",
      },
      {
        kind: "stop",
        reason: "objective_complete",
        summary: "Created the task and the objective is done.",
      },
    ]),
  });
  assert(calls.length === 1, "failed create ran once");
  assert(
    run.trace[0].happened === false && run.trace[0].status === "needs_human",
    "unapproved create did not happen",
  );
  assert(run.claimRejected === true, "completion claim rejected");
  assert(run.status === "needs_human", "escalates instead of pretending success");
  assert(!/created the task/i.test(run.summary), "outcome text does not repeat the false claim");
  assert(/did not happen/i.test(run.summary), "outcome says the action did not happen");
}

// 4. Cash tool fails. Agent reads health instead and completes without claiming the cash read.
{
  const run = await runAgentLoop({
    objective: "See where the pressure is.",
    audience: "accountant",
    execute: recording({
      get_cash_flow: () => {
        throw new Error("cashflow unavailable");
      },
      get_health: () => ({
        empty: false,
        overall: 42,
        weakest: { id: "cash", label: "Cash", score: 20 },
      }),
    }).execute,
    reason: scripted([
      { kind: "tool", name: "get_cash_flow", args: {}, why: "Start with cash" },
      { kind: "tool", name: "get_health", args: {}, why: "Cash failed — read health" },
      {
        kind: "stop",
        reason: "objective_complete",
        summary:
          "Cash flow could not be read. Health shows cash as the weak pillar at 20. No action was taken.",
      },
    ]),
  });
  assert(
    run.trace[0].status === "error" && run.trace[0].happened === false,
    "failed tool stays failed",
  );
  assert(run.trace[1].status === "ok", "second read recovered");
  assert(run.status === "objective_complete", "a failed read does not block an honest complete");
  assert(run.summary.includes("could not be read"), "summary keeps the failure");
}

// 5. Explicit escalation after an unapproved recommendation.
{
  const { execute } = recording({
    list_recommendations: () => ({
      empty: false,
      recommendations: [{ id: "rec-3", status: "proposed", title: "Chase debtors" }],
    }),
  });
  const run = await runAgentLoop({
    objective: "Put the debtor chase on the action plan.",
    audience: "accountant",
    execute,
    reason: async (ctx) => {
      if (ctx.iteration === 1) {
        return { kind: "tool", name: "list_recommendations", args: {}, why: "Is it approved?" };
      }
      const row = ctx.transcript[0];
      assert(row?.status === "ok", "reassessment sees the recommendation read");
      return {
        kind: "tool",
        name: "request_human",
        args: {
          reason:
            "The debtor chase is still proposed. A person has to approve it before it can become a task.",
          questions: ["Approve the debtor chase?"],
        },
        why: "Cannot approve it myself",
      };
    },
  });
  assert(run.status === "needs_human", "request_human stops the loop");
  assert(run.escalationReason?.includes("still proposed"), "escalation reason kept");
  assert(run.questions[0] === "Approve the debtor chase?", "outstanding question kept");
  assert(
    run.trace.every((s) => s.happened === false),
    "escalation is not an action",
  );
}

// 6. Disallowed tool is refused and never executed.
{
  const { execute, calls } = recording({});
  const run = await runAgentLoop({
    objective: "Email the owner about cash.",
    audience: "accountant",
    execute,
    reason: scripted([
      { kind: "tool", name: "send_email", args: { to: "owner@example.com" }, why: "Send it" },
      {
        kind: "stop",
        reason: "needs_human",
        summary: "Email is not a tool I can run.",
        escalationReason: "Someone has to send this themselves.",
      },
    ]),
  });
  assert(calls.length === 0, "refused tool is not executed");
  assert(
    run.trace[0].status === "refused" && run.trace[0].happened === false,
    "refusal is on the trace",
  );
  assert(run.status === "needs_human", "model can escalate after a refusal");
}

// 7. Same tool three times, then the safety limit stops a fourth try.
{
  const rec = recording({ get_company: () => ({ empty: false, name: "Northwind" }) });
  const run = await runAgentLoop({
    objective: "Keep looking at the company until told to stop.",
    audience: "owner",
    execute: rec.execute,
    reason: async () => ({ kind: "tool", name: "get_company", args: {}, why: "Again" }),
  });
  assert(rec.calls.length === 3, "the same read runs three times, not four");
  assert(run.status === "safety_limit", "fourth identical call stops");
  assert(/repeated/i.test(run.summary), "safety summary names the repeat");
}

// 8. Complete with no evidence is not complete.
{
  const run = await runAgentLoop({
    objective: "Tell me the health score.",
    audience: "owner",
    execute: recording({}).execute,
    reason: async () => ({
      kind: "stop",
      reason: "objective_complete",
      summary: "The score is 80.",
    }),
  });
  assert(run.status === "insufficient_information", "no read cannot complete");
  assert(run.claimRejected === true, "invented complete is rejected");
  assert(!/score is 80/.test(run.summary), "invented figure is not the outcome");
}

// Classifiers and Claude decision parsing.
assert(
  classifyResult("create_task_from_recommendation", {
    created: true,
    verified: false,
    action_item_id: "x",
  }).happened === false,
  "unverified id is not a completed action",
);
assert(
  classifyResult("assign_task", { assigned: true, verified: true }).happened === true,
  "verified assignment happened",
);
assert(
  classifyResult("get_health", { error: "nope" }).happened === false,
  "read error did not happen",
);
assert(!isAgentToolName("send_email") && isAgentToolName("get_health"), "allowlist");
assert(
  !(
    "approve" in
    sanitizeToolArgs("create_task_from_recommendation", { recommendationId: "r", approve: true })
  ),
  "sanitize",
);

const parsed = decisionFromClaude({
  text: "ignore the second call",
  toolUses: [
    { name: "get_health", input: {} },
    { name: "send_email", input: {} },
  ],
});
assert(
  parsed.kind === "tool" && parsed.name === "get_health",
  "only the first tool in a turn is kept",
);

const finish = decisionFromClaude({
  text: "",
  toolUses: [
    {
      name: "finish",
      input: { reason: "needs_human", summary: "Need a decision", escalation_reason: "Approval" },
    },
  ],
});
assert(
  finish.kind === "stop" &&
    finish.reason === "needs_human" &&
    finish.escalationReason === "Approval",
  "finish parses",
);

const prompt = formatAgentPrompt({
  objective: "Check cash",
  audience: "owner",
  iteration: 2,
  maxIterations: 6,
  allowedTools: AGENT_TOOLS,
  transcript: [
    {
      iteration: 1,
      tool: "get_cash_flow",
      label: "Cash flow",
      why: "",
      status: "error",
      verified: false,
      happened: false,
      detail: "cashflow unavailable",
    },
  ],
});
assert(
  prompt.includes("happened=false") && prompt.includes("cashflow unavailable"),
  "next turn sees the failure",
);
assert(
  AGENT_SYSTEM.includes("happened=false") && AGENT_SYSTEM.includes("cannot approve"),
  "system forbids false claims and self-approval",
);
assert(AGENT_SYSTEM.includes("Never send email"), "system forbids email");

// Real advisory resolver and existing cash/health helpers — not a second engine.
const facts: NextStepFacts = {
  clientId: "00000000-0000-4000-8000-000000000001",
  state: "diagnosis",
  stateSource: "persisted",
  hasFirm: false,
  hasProfile: true,
  hasFinancials: true,
  hasSnapshot: true,
  hasForecast: true,
  openQuestions: 0,
  proposedRecommendations: 0,
  approvedWithoutAction: 0,
  openActions: 0,
  overdueActions: 0,
  blockedActions: 0,
  actionedUnmeasured: 0,
  openDataRequests: 0,
  nextReviewAt: null,
  now: "2026-10-03T12:00:00.000Z",
};
const position = shapeAdvisoryPosition(facts, "owner");
assert(position.state === "diagnosis", "advisory position uses the resolver state");
assert(
  typeof position.next_step === "string" && (position.next_step as string).length > 0,
  "resolver returns one next step",
);
assert(typeof position.reason === "string", "resolver reason is present");

const health = shapeHealth({ debtorDays: 75, grossMargin: 0.22 }, 5);
assert(health.scorer === "overview-health", "health uses the Overview scorer");
assert(health.empty === false && health.overall != null, "health scores the ratios");
assert(
  Array.isArray(health.priority_moves) && (health.priority_moves as unknown[]).length > 0,
  "priority moves come from rankNextSteps",
);

const cash = shapeCash(
  {
    openingBalance: "100000",
    revenue: [{ amount: "10000", frequency: "recurring-weekly", startWeek: 1 }],
    expenses: [{ amount: "40000", frequency: "recurring-weekly", startWeek: 1 }],
  },
  null,
);
assert(cash.empty === false, "cash summary from the existing forecast helper");
assert(!JSON.stringify(cash).includes("100000"), "cash tool does not echo the opening balance");
assert(typeof cash.runwayWeeks === "number", "runway weeks are returned");

assert(
  parseAgentObjective("Objective: find the cash pressure") === "find the cash pressure",
  "objective prefix",
);
assert(
  parseAgentObjective("What is my health score?") === null,
  "ordinary question is not an objective",
);
assert(parseAgentObjective("Objective: short") === null, "tiny objective is rejected");

const indexSrc = readFileSync(resolve("supabase/functions/milon-bot/index.ts"), "utf8");
const executeSrc = readFileSync(resolve("supabase/functions/milon-bot/execute.ts"), "utf8");
const handlerSrc = readFileSync(resolve("supabase/functions/milon-bot/handler.ts"), "utf8");
const widgetSrc = readFileSync(resolve("src/lib/ask-ai.js"), "utf8");
const migration = readFileSync(
  resolve("supabase/migrations/20261003160000_milon_bot_runs.sql"),
  "utf8",
);

assert(indexSrc.includes('body.mode === "agent"'), "edge function has an agent mode");
assert(indexSrc.includes("runMilonbotObjective"), "edge function runs the objective loop");
assert(
  indexSrc.includes("clientId and message are required"),
  "chat path still requires a message",
);
assert(executeSrc.includes("p_approve: false"), "task RPC is never asked to approve");
assert(!executeSrc.includes("p_approve: true"), "no self-approve path");
assert(!executeSrc.toLowerCase().includes("resend"), "agent does not send email");
assert(!executeSrc.includes("action_emails"), "agent does not queue assignment mail");
assert(
  executeSrc.includes("advisory_create_action_from_recommendation"),
  "tasks use the existing RPC",
);
assert(
  executeSrc.includes("resolveNextStep") ||
    handlerSrc.includes("get_advisory_position") ||
    executeSrc.includes("shapeAdvisoryPosition"),
  "advisory position is a tool",
);
assert(executeSrc.includes("shapeAdvisoryPosition"), "advisory tool calls the resolver shaper");
assert(
  executeSrc.includes("resolveRatioRecord"),
  "health reads ratios through the ask-ai resolver",
);
assert(handlerSrc.includes("milon_bot_runs"), "runs are stored");
assert(handlerSrc.includes("bot_tool_calls"), "tool audit still written");
assert(
  handlerSrc.includes('toolChoice: { type: "any" }'),
  "each Claude turn must choose a tool or finish",
);
assert(widgetSrc.includes('mode: "agent"'), "widget can start an objective");
assert(widgetSrc.includes("parseAgentObjective"), "widget detects the objective prefix");
assert(widgetSrc.includes("ask-ai-trace"), "widget renders the trace");
assert(migration.includes("CREATE TABLE IF NOT EXISTS public.milon_bot_runs"), "run table");
assert(migration.includes("has_client_access"), "run table is readable only with client access");
assert(!/token text/i.test(migration), "run table has no token column");

console.log("milon-bot-agent-test: all assertions passed");
